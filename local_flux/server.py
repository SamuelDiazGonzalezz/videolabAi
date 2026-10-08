"""RacingMonos local image service.

This service keeps FLUX.2 Klein 4B on the user's GPU and injects the five
RacingMonos reference drawings into every generation. The Next.js app only
receives a PNG data URL, so no image is sent to a paid provider in local mode.
"""

import base64
import gc
import io
import os
import threading
from pathlib import Path
from typing import List

# Some Windows development environments install a local TLS-inspection
# certificate that Python does not trust. This is opt-in and only affects the
# public model-weight download performed by Hugging Face at startup.
# When data/certs/ca-bundle.pem exists (public CAs + the antivirus root, see
# local_flux/download_model.py), downloads stay verified against it instead.
_CA_BUNDLE = Path(__file__).resolve().parent.parent / "data" / "certs" / "ca-bundle.pem"
if _CA_BUNDLE.exists():
    import httpx
    from huggingface_hub import set_client_factory

    set_client_factory(lambda: httpx.Client(verify=str(_CA_BUNDLE), timeout=60))
elif os.getenv("LOCAL_FLUX_INSECURE_HF", "0") == "1":
    import httpx
    from huggingface_hub import set_client_factory

    os.environ["HF_HUB_DISABLE_XET"] = "1"
    set_client_factory(lambda: httpx.Client(verify=False))

import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool
from PIL import Image
from diffusers import Flux2KleinPipeline
from pydantic import BaseModel

from planner import StoryPlanner, plan_scene_fix, rewrite_edit_instruction
from writer import ScriptWriter

FALLBACK_MODEL_ID = "black-forest-labs/FLUX.2-klein-4B"
MODEL_ID = os.getenv("LOCAL_FLUX_MODEL", FALLBACK_MODEL_ID)
# FP8 storage halves the memory of the big Klein 9B (transformer 18 GB and
# Qwen3-8B text encoder 16 GB in bf16) so it fits a 16 GB card and 32 GB of RAM.
# "auto" enables it for 9B models only; weights are upcast to bf16 per layer.
FP8_SETTING = os.getenv("LOCAL_FLUX_FP8", "auto").lower()
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DTYPE = torch.bfloat16 if DEVICE == "cuda" else torch.float32
ROOT = Path(__file__).resolve().parent
DEFAULT_REFERENCE_DIR = ROOT / "default_references"
MAX_REFERENCE_EDGE = int(os.getenv("LOCAL_FLUX_REFERENCE_EDGE", "768"))
DEFAULT_REFERENCE_LIMIT = int(os.getenv("LOCAL_FLUX_DEFAULT_REFERENCES", "5"))
USER_REFERENCE_LIMIT = int(os.getenv("LOCAL_FLUX_USER_REFERENCES", "3"))
LIBRARY_REFERENCE_LIMIT = int(os.getenv("LOCAL_FLUX_LIBRARY_REFERENCES", "8"))
INFERENCE_STEPS = int(os.getenv("LOCAL_FLUX_STEPS", "4"))


def prepare_reference(image: Image.Image) -> Image.Image:
    """Normalize references before VAE encoding to keep VRAM predictable."""
    image = image.convert("RGB")
    if max(image.size) > MAX_REFERENCE_EDGE:
        image.thumbnail((MAX_REFERENCE_EDGE, MAX_REFERENCE_EDGE), Image.Resampling.LANCZOS)
    return image


# The built-in drawings contain signs with words (company names, prices) that
# FLUX copies into every scene. Those areas are painted over with the sign's own
# background colour before the references reach the model; the PNG files on
# disk stay untouched. Boxes are (left, top, right, bottom) in source pixels.
REFERENCE_TEXT_MASKS: dict[str, list[tuple[int, int, int, int]]] = {
    "monos-01.png": [(395, 0, 625, 140)],
    "monos-02.png": [(665, 180, 1185, 305)],
    "monos-03.png": [(522, 372, 826, 518)],
    "monos-05.png": [(542, 36, 818, 170), (812, 530, 874, 570)],
}


def mask_reference_text(name: str, image: Image.Image) -> Image.Image:
    boxes = REFERENCE_TEXT_MASKS.get(name)
    if not boxes:
        return image
    image = image.convert("RGB")
    for box in boxes:
        region = image.crop(box)
        # The median of each channel is the sign's background: letters are a
        # thin minority of the pixels inside the box.
        channels = region.split()
        colour = tuple(sorted(channel.getdata())[len(channel.getdata()) // 2] for channel in channels)
        image.paste(colour, box)
    return image


def whiten_background(image: Image.Image, threshold: int = 236, center: bool = True) -> Image.Image:
    """'Fondo blanco' style: near-white pixels become pure #FFFFFF, so slightly
    grey or cream backgrounds from the model end up perfectly white. Then the
    drawn subject is re-centred and enlarged, because the model often leaves it
    small and off to one side."""
    import numpy as np

    pixels = np.asarray(image.convert("RGB")).copy()
    pixels[pixels.min(axis=2) >= threshold] = 255
    result = Image.fromarray(pixels)
    if not center:
        return result
    ink = pixels.min(axis=2) < 250
    rows, cols = np.where(ink)
    if rows.size < 50:
        return result
    top, bottom, left, right = rows.min(), rows.max() + 1, cols.min(), cols.max() + 1
    width, height = result.size
    subject = result.crop((left, top, right, bottom))
    # Subject fills ~78% of the height (and at most 86% of the width); upscaling is
    # capped so a tiny drawing is not blown up into a blurry one.
    scale = min(height * 0.78 / subject.height, width * 0.86 / subject.width, 1.9)
    if abs(scale - 1) > 0.03:
        subject = subject.resize((max(1, round(subject.width * scale)), max(1, round(subject.height * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (width, height), (255, 255, 255))
    canvas.paste(subject, ((width - subject.width) // 2, (height - subject.height) // 2))
    return canvas


def load_default_references() -> list[Image.Image]:
    references: list[Image.Image] = []
    for path in sorted(DEFAULT_REFERENCE_DIR.glob("*.png"))[:DEFAULT_REFERENCE_LIMIT]:
        try:
            with Image.open(path) as source:
                references.append(prepare_reference(mask_reference_text(path.name, source.copy())))
        except (OSError, ValueError) as error:
            print(f"Skipping reference {path.name}: {error}")
    return references


def wants_fp8(model_id: str) -> bool:
    if DEVICE != "cuda":
        return False
    return FP8_SETTING in ("1", "true", "yes") or (FP8_SETTING == "auto" and "9b" in model_id.lower())


def load_pipeline(model_id: str):
    if not wants_fp8(model_id):
        return Flux2KleinPipeline.from_pretrained(model_id, torch_dtype=DTYPE)
    from diffusers import Flux2Transformer2DModel
    from diffusers.hooks import apply_layerwise_casting
    from transformers import Qwen3ForCausalLM

    # Each big module is cast right after loading, so RAM never has to hold
    # both of them in bf16 at the same time.
    transformer = Flux2Transformer2DModel.from_pretrained(model_id, subfolder="transformer", torch_dtype=DTYPE)
    transformer.enable_layerwise_casting(storage_dtype=torch.float8_e4m3fn, compute_dtype=DTYPE)
    gc.collect()
    text_encoder = Qwen3ForCausalLM.from_pretrained(model_id, subfolder="text_encoder", torch_dtype=DTYPE)
    # Embeddings and lm_head share weights (used by the planner): keep them in bf16.
    apply_layerwise_casting(
        text_encoder,
        storage_dtype=torch.float8_e4m3fn,
        compute_dtype=DTYPE,
        skip_modules_pattern=("norm", "embed_tokens", "lm_head"),
    )
    gc.collect()
    return Flux2KleinPipeline.from_pretrained(model_id, transformer=transformer, text_encoder=text_encoder, torch_dtype=DTYPE)


print(f"Loading {MODEL_ID} on {DEVICE} ({DTYPE}{', FP8 storage' if wants_fp8(MODEL_ID) else ''})")
try:
    pipe = load_pipeline(MODEL_ID)
except Exception as error:  # e.g. 9B not downloaded yet or licence not accepted
    if MODEL_ID == FALLBACK_MODEL_ID:
        raise
    print(f"Could not load {MODEL_ID} ({error}). Falling back to {FALLBACK_MODEL_ID}.")
    MODEL_ID = FALLBACK_MODEL_ID
    gc.collect()
    pipe = load_pipeline(MODEL_ID)
USING_FP8 = wants_fp8(MODEL_ID)
if DEVICE == "cuda":
    # Keeps the pipeline within a 16 GB card by offloading inactive modules.
    pipe.enable_model_cpu_offload()
else:
    pipe.to(DEVICE)

DEFAULT_REFERENCES = load_default_references()
planner = StoryPlanner(pipe, DEVICE)
writer = ScriptWriter(pipe, DEVICE)
print(f"Loaded {len(DEFAULT_REFERENCES)} default Monos references")
generation_lock = threading.Lock()

app = FastAPI(title="RacingMonos Local FLUX")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["POST"], allow_headers=["*"])


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": MODEL_ID,
        "fp8": USING_FP8,
        "device": DEVICE,
        "defaultReferences": len(DEFAULT_REFERENCES),
        "steps": INFERENCE_STEPS,
        "planner": True,
    }


class PlanRequest(BaseModel):
    script: str
    scenes: List[str]
    # monos: fixed Monos cast; free: the director invents style and cast;
    # custom: the user's reference style plus their art direction notes.
    mode: str = "monos"
    notes: str = ""
    # Técnica visual elegida en la web (dibujo, anime, realista…).
    medium: str = ""


@app.post("/plan")
def plan(request: PlanRequest):
    """Reads the whole script with Qwen3-4B and returns a story bible plus one
    concrete shot description per scene, so every image follows its sentence
    while staying consistent with the rest of the story."""
    if not request.script.strip() or not request.scenes:
        raise HTTPException(status_code=400, detail="Script and scenes are required.")
    with generation_lock:
        result = planner.plan(request.script, [scene.strip() for scene in request.scenes[:400]], mode=request.mode if request.mode in ("monos", "free", "white", "custom") else "monos", notes=request.notes, medium=request.medium)
    if DEVICE == "cuda":
        torch.cuda.empty_cache()
    return result


class ScriptRequest(BaseModel):
    idea: str
    seconds: int = 60
    tone: str = "narrativo"


@app.post("/write-script")
def write_script(request: ScriptRequest):
    """Streams a Spanish narration script written by Qwen3-4B, chunk by chunk."""
    if not request.idea.strip():
        raise HTTPException(status_code=400, detail="Idea is required.")
    return StreamingResponse(
        writer.stream(request.idea, request.seconds, request.tone, generation_lock),
        media_type="text/plain; charset=utf-8",
    )


class FixPlanRequest(BaseModel):
    request: str
    description: str = ""


@app.post("/edit-plan")
def edit_plan(body: FixPlanRequest):
    """Understands a fix request (problem or instruction) and picks edit vs. regenerate."""
    if not body.request.strip():
        raise HTTPException(status_code=400, detail="Request is required.")
    with generation_lock:
        result = plan_scene_fix(planner, body.request, body.description)
    if DEVICE == "cuda":
        torch.cuda.empty_cache()
    return result


@app.post("/edit")
async def edit(
    instruction: str = Form(...),
    context: str = Form(""),
    planned: str = Form("0"),
    white_background: str = Form("0"),
    seed: int = Form(481976),
    image: UploadFile = File(...),
):
    """Edits an existing scene: the current image is the only reference and the
    user's request (rewritten by Qwen3 into a precise English instruction)
    describes the change; everything else should stay the same."""
    raw = await image.read()
    try:
        with Image.open(io.BytesIO(raw)) as source:
            original = source.convert("RGB")
    except (OSError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid image.")
    width = max(512, min(1536, original.width)) // 16 * 16
    height = max(512, min(1536, original.height)) // 16 * 16
    if width * height > 1_100_000:
        scale = (1_100_000 / (width * height)) ** 0.5
        width = max(512, int(width * scale) // 16 * 16)
        height = max(512, int(height * scale) // 16 * 16)
    # Same reference size as generation: a bigger one only adds VRAM pressure.
    reference = prepare_reference(original.copy())

    def run_edit():
        with generation_lock, torch.inference_mode():
            english = instruction if planned == "1" else rewrite_edit_instruction(planner, instruction, context)
            if DEVICE == "cuda":
                torch.cuda.empty_cache()
            prompt = (
                f"{english} Keep everything else in the image exactly the same: the same characters, faces, clothing, "
                "pose, composition, background, colors, lighting and art style. No text, letters or logos."
            )
            image = pipe(
                prompt=prompt,
                image=[reference],
                width=width,
                height=height,
                guidance_scale=1.0,
                num_inference_steps=INFERENCE_STEPS,
                generator=torch.Generator(device=DEVICE).manual_seed(seed),
            ).images[0]
            return english, prompt, image

    # Off the event loop, so /health keeps answering while the GPU works.
    english, prompt, result = await run_in_threadpool(run_edit)
    if white_background == "1":
        result = whiten_background(result)

    out = io.BytesIO()
    result.save(out, format="PNG", optimize=True)
    if DEVICE == "cuda":
        torch.cuda.empty_cache()
    return {
        "dataUrl": f"data:image/png;base64,{base64.b64encode(out.getvalue()).decode('ascii')}",
        "instruction": english,
        "prompt": prompt,
    }


@app.post("/generate")
async def generate(
    prompt: str = Form(...),
    width: int = Form(768),
    height: int = Form(1344),
    seed: int = Form(481976),
    use_defaults: str = Form("1"),
    white_background: str = Form("0"),
    references: List[UploadFile] = File(default=[]),
):
    width = max(512, min(1536, width)) // 16 * 16
    height = max(512, min(1536, height)) // 16 * 16
    if width * height > 1_100_000:
        scale = (1_100_000 / (width * height)) ** 0.5
        width = max(512, int(width * scale) // 16 * 16)
        height = max(512, int(height * scale) // 16 * 16)

    # With use_defaults=0 the web app sends its editable reference library and
    # those images replace the built-in ones completely.
    library_mode = use_defaults == "0"
    limit = LIBRARY_REFERENCE_LIMIT if library_mode else USER_REFERENCE_LIMIT
    uploaded: list[Image.Image] = []
    for upload in references[:limit]:
        raw = await upload.read()
        try:
            with Image.open(io.BytesIO(raw)) as source:
                uploaded.append(prepare_reference(mask_reference_text(Path(upload.filename or "").name, source.copy())))
        except (OSError, ValueError):
            continue

    # Without the library the five built-in drawings go first and user
    # references only add subject-specific details.
    refs = uploaded if library_mode else [image.copy() for image in DEFAULT_REFERENCES] + uploaded
    kwargs = dict(
        prompt=prompt,
        width=width,
        height=height,
        guidance_scale=1.0,
        num_inference_steps=INFERENCE_STEPS,
        generator=torch.Generator(device=DEVICE).manual_seed(seed),
    )
    if refs:
        kwargs["image"] = refs

    # A single GPU should process one scene at a time. A guarded retry with
    # fewer references makes the endpoint recover gracefully if large
    # reference files exhaust a 16 GB card. It runs off the event loop so
    # /health keeps answering while the GPU works.
    def run_generate():
        with generation_lock, torch.inference_mode():
            try:
                return pipe(**kwargs).images[0]
            except torch.cuda.OutOfMemoryError:
                if DEVICE != "cuda" or len(refs) <= 4:
                    raise
                torch.cuda.empty_cache()
                kwargs["image"] = refs[:4]
                return pipe(**kwargs).images[0]

    result = await run_in_threadpool(run_generate)
    if white_background == "1":
        result = whiten_background(result)

    out = io.BytesIO()
    result.save(out, format="PNG", optimize=True)
    encoded = base64.b64encode(out.getvalue()).decode("ascii")
    if DEVICE == "cuda":
        torch.cuda.empty_cache()
    return {
        "dataUrl": f"data:image/png;base64,{encoded}",
        "model": MODEL_ID,
        "seed": seed,
        "referenceCount": len(refs),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("LOCAL_FLUX_PORT", "8188")))
