"""Downloads a FLUX.2 Klein model into the Hugging Face cache.

Only the diffusers folders are fetched (the repo root also holds a duplicated
single-file checkpoint). Works behind HTTPS-inspecting antivirus software such
as Avast by trusting data/certs/ca-bundle.pem when it exists.

Usage: .venv\Scripts\python.exe local_flux/download_model.py [repo_id]
"""

import os
import sys
from pathlib import Path

import httpx
from huggingface_hub import set_client_factory, snapshot_download

ROOT = Path(__file__).resolve().parent.parent
BUNDLE = ROOT / "data" / "certs" / "ca-bundle.pem"
if BUNDLE.exists():
    set_client_factory(lambda: httpx.Client(verify=str(BUNDLE), timeout=60))
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

repo = sys.argv[1] if len(sys.argv) > 1 else "black-forest-labs/FLUX.2-klein-9B"
print(f"Descargando {repo}…", flush=True)
path = snapshot_download(
    repo,
    allow_patterns=["model_index.json", "transformer/*", "text_encoder/*", "vae/*", "tokenizer/*", "scheduler/*"],
    max_workers=4,
)
print(f"Descarga completa en {path}", flush=True)
