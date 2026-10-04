# Local FLUX.2 Klein 4B

Este servicio ejecuta el modelo localmente y no usa fal.ai ni consume créditos. FLUX.2 Klein 4B es un modelo de 4B parámetros con edición multi-referencia y aproximadamente 13 GB de VRAM, por lo que encaja en una GPU de 16 GB usando `enable_model_cpu_offload()`.

## Referencias integradas

Las cinco imágenes de `local_flux/default_references` se cargan al arrancar y se pasan automáticamente en cada petición. El frontend mantiene una copia pública en `public/references/monos` para mostrar el estilo seleccionado. Las referencias propias se añaden después de las integradas y se reducen para mantener estable el consumo de VRAM.

## Instalación

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r local_flux/requirements.txt
```

Si tu instalación de PyTorch necesita otra versión CUDA, instala primero el wheel correspondiente desde pytorch.org. El proyecto usa la versión publicada de Diffusers para evitar depender de GitHub durante la instalación.

## Arranque

```powershell
$env:LOCAL_FLUX_MODEL="black-forest-labs/FLUX.2-klein-4B"
$env:LOCAL_FLUX_INSECURE_HF="1" # solo si Windows da error de certificado SSL al descargar
.\.venv\Scripts\python.exe local_flux/server.py
```

En otra terminal:

```powershell
$env:GENERATION_PROVIDER="local"
$env:LOCAL_FLUX_URL="http://127.0.0.1:8188"
npm run dev
```

La primera ejecución descarga los pesos desde Hugging Face. Después la generación es local y no hay coste por imagen. El endpoint devuelve PNG en base64 al frontend y limita una generación simultánea para proteger una GPU de 16 GB.
