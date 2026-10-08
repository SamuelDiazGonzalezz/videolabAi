"""Generates the same scenes (same prompt, references and seed) with the FLUX
server that is currently running, so two models can be compared side by side.

Usage: .venv\\Scripts\\python.exe local_flux/compare_models.py <storyboard_id> <label> [scene numbers…]
Images go to data/compare/<label>/scene-XX.png and the timing to times.json.
"""

import base64
import json
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
storyboard_id, label = sys.argv[1], sys.argv[2]
scene_numbers = [int(value) for value in sys.argv[3:]] or [1]
record = json.loads((ROOT / "data" / "storyboards" / storyboard_id / "storyboard.json").read_text(encoding="utf-8"))
out_dir = ROOT / "data" / "compare" / label
out_dir.mkdir(parents=True, exist_ok=True)

width, height = (1344, 768) if record.get("aspectRatio") == "16:9" else (768, 1344)
health = httpx.get("http://127.0.0.1:8188/health", timeout=10).json()
print(f"Modelo cargado: {health.get('model')} (fp8={health.get('fp8')})", flush=True)

times = {}
for number in scene_numbers:
    scene = next(item for item in record["images"] if item["sceneId"] == number)
    start = time.time()
    response = httpx.post(
        "http://127.0.0.1:8188/generate",
        data={"prompt": scene["prompt"], "width": width, "height": height, "seed": 481976 + number * 7919, "use_defaults": "0"},
        timeout=1800,
    )
    response.raise_for_status()
    elapsed = time.time() - start
    data_url = response.json()["dataUrl"]
    (out_dir / f"scene-{number:02d}.png").write_bytes(base64.b64decode(data_url.split(",", 1)[1]))
    times[number] = round(elapsed, 1)
    print(f"Escena {number}: {elapsed:.1f} s", flush=True)

(out_dir / "times.json").write_text(json.dumps({"model": health.get("model"), "fp8": health.get("fp8"), "seconds": times}, indent=2), encoding="utf-8")
