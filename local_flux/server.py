"""RacingMonos local image service.

This service keeps FLUX.2 Klein 4B on the user's GPU and injects the five
RacingMonos reference drawings into every generation. The Next.js app only
receives a PNG data URL, so no image is sent to a paid provider in local mode.
"""

import base64
import io
import os
import threading
from pathlib import Path
from typing import List

# Some Windows development environments install a local TLS-inspection
# certificate that Python does not trust. This is opt-in and only affects the
# public model-weight download performed by Hugging Face at startup.
if os.getenv("LOCAL_FLUX_INSECURE_HF", "0") == "1":
    import httpx
    from huggingface_hub import set_client_factory

    os.environ["HF_HUB_DISABLE_XET"] = "1"
    set_client_factory(lambda: httpx.Client(verify=False))

import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from diffusers import Flux2KleinPipeline
from pydantic import BaseModel

from planner import StoryPlanner

MODEL_ID = os.getenv("LOCAL_FLUX_MODEL", "black-forest-labs/FLUX.2-klein-4B")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DTYPE = torch.bfloat16 if DEVICE == "cuda" else torch.float32
ROOT = Path(__file__).resolve().parent
DEFAULT_REFERENCE_DIR = ROOT / "default_references"
MAX_REFERENCE_EDGE = int(os.getenv("LOCAL_FLUX_REFERENCE_EDGE", "768"))
DEFAULT_REFERENCE_LIMIT = int(os.getenv("LOCAL_FLUX_DEFAULT_REFERENCES", "5"))
USER_REFERENCE_LIMIT = int(os.getenv("LOCAL_FLUX_USER_REFERENCES", "3"))
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


def load_default_references() -> list[Image.Image]:
    references: list[Image.Image] = []
    for path in sorted(DEFAULT_REFERENCE_DIR.glob("*.png"))[:DEFAULT_REFERENCE_LIMIT]:
        try:
            with Image.open(path) as source:
                references.append(prepare_reference(mask_reference_text(path.name, source.copy())))
        except (OSError, ValueError) as error:
            print(f"Skipping reference {path.name}: {error}")
    return references


print(f"Loading {MODEL_ID} on {DEVICE} ({DTYPE})")
pipe = Flux2KleinPipeline.from_pretrained(MODEL_ID, torch_dtype=DTYPE)
if DEVICE == "cuda":
    # Keeps the Klein 4B pipeline within a 16 GB card by offloading inactive modules.
    pipe.enable_model_cpu_offload()
else:
    pipe.to(DEVICE)

DEFAULT_REFERENCES = load_default_references()
planner = StoryPlanner(pipe, DEVICE)
print(f"Loaded {len(DEFAULT_REFERENCES)} default Monos references")
generation_lock = threading.Lock()

app = FastAPI(title="RacingMonos Local FLUX")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["POST"], allow_headers=["*"])


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": MODEL_ID,
        "device": DEVICE,
        "defaultReferences": len(DEFAULT_REFERENCES),
        "steps": INFERENCE_STEPS,
        "planner": True,
    }


class PlanRequest(BaseModel):
    script: str
    scenes: List[str]


@app.post("/plan")
def plan(request: PlanRequest):
    """Reads the whole script with Qwen3-4B and returns a story bible plus one
    concrete shot description per scene, so every image follows its sentence
    while staying consistent with the rest of the story."""
    if not request.script.strip() or not request.scenes:
        raise HTTPException(status_code=400, detail="Script and scenes are required.")
    with generation_lock:
        result = planner.plan(request.script, [scene.strip() for scene in request.scenes[:80]])
    if DEVICE == "cuda":
        torch.cuda.empty_cache()
    return result


@app.post("/generate")
async def generate(
    prompt: str = Form(...),
    width: int = Form(768),
    height: int = Form(1344),
    seed: int = Form(481976),
    references: List[UploadFile] = File(default=[]),
):
    width = max(512, min(1536, width)) // 16 * 16
    height = max(512, min(1536, height)) // 16 * 16
    if width * height > 1_100_000:
        scale = (1_100_000 / (width * height)) ** 0.5
        width = max(512, int(width * scale) // 16 * 16)
        height = max(512, int(height * scale) // 16 * 16)

    uploaded: list[Image.Image] = []
    for upload in references[:USER_REFERENCE_LIMIT]:
        raw = await upload.read()
        try:
            with Image.open(io.BytesIO(raw)) as source:
                uploaded.append(prepare_reference(source.copy()))
        except (OSError, ValueError):
            continue

    # The five built-in drawings are always first. User references can add
    # subject-specific details while the base character style stays locked.
    refs = [image.copy() for image in DEFAULT_REFERENCES] + uploaded
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

    # A single GPU should process one scene at a time. A guarded retry with the
    # built-in references only makes the endpoint recover gracefully if a user
    # adds unusually large reference files and exhausts a 16 GB card.
    with generation_lock, torch.inference_mode():
        try:
            result = pipe(**kwargs).images[0]
        except torch.cuda.OutOfMemoryError:
            if DEVICE != "cuda" or len(refs) <= len(DEFAULT_REFERENCES):
                raise
            torch.cuda.empty_cache()
            kwargs["image"] = refs[: len(DEFAULT_REFERENCES)]
            result = pipe(**kwargs).images[0]

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
