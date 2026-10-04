# Video Lab Ai

<img width="1024" height="571" alt="622205db-1aac-45df-b33e-48e1197b9f01" src="https://github.com/user-attachments/assets/2edd5117-60b9-4e2e-9c64-f4ba4e43428d" />


La generación usa un flujo NDJSON: el contador y cada PNG aparecen en la galería en cuanto terminan, sin esperar a que finalice todo el guion.

RacingMonos recibe un guion y genera una secuencia de imágenes coherentes con FLUX.2 Klein 4B. Divide el texto en escenas de 3, 4 o 5 segundos, mantiene bloqueado el estilo de los monos y permite abrir cada escena en grande o descargar todo el storyboard como ZIP.

La interfaz sigue una composición minimalista tipo showroom: la segunda ilustración de referencia se usa como visual principal, las escenas aparecen en directo y la biblioteca recupera los storyboards guardados incluso después de reiniciar Next.js. Cada ejecución se guarda en data/storyboards/<id>/, con un storyboard.json y un PNG por escena.

## Estilo Monos

El modo **Monos** está activo por defecto. Las cinco ilustraciones de `public/references/monos` se muestran en la interfaz y el servidor local las inyecta automáticamente en cada generación. Así se conservan el trazo limpio, los personajes grises, los colores y el coche rojo aunque el usuario no suba ninguna referencia. También se pueden añadir hasta cuatro imágenes propias.

## Modelo local recomendado

La integración local usa `black-forest-labs/FLUX.2-klein-4B`. Está pensada para una GPU NVIDIA de 16 GB con CPU offload y no consume créditos de fal.ai. La primera ejecución descarga los pesos del modelo desde Hugging Face; después las imágenes se generan en tu propia GPU.

## Instalación

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r local_flux\requirements.txt
```

## Arranque recomendado

```powershell
.\start-local.ps1
```

El script arranca el servidor FLUX local en `http://127.0.0.1:8188`, espera a que el modelo esté listo y después inicia Next.js en `http://localhost:3000`.

Si prefieres hacerlo en dos terminales:

```powershell
$env:LOCAL_FLUX_INSECURE_HF="1" # solo si Windows muestra un error de certificado SSL
.\.venv\Scripts\python.exe local_flux\server.py
```

En otra terminal:

```powershell
$env:GENERATION_PROVIDER="local"
$env:LOCAL_FLUX_URL="http://127.0.0.1:8188"
npm run dev
```

Pega el guion, elige el formato y el intervalo y pulsa **Generar imágenes**. La interfaz incluye un selector preparado para futuros estilos, pero ahora solo está disponible **Monos**.

## Ajustes opcionales del servidor local

`LOCAL_FLUX_STEPS` controla los pasos de inferencia (4 por defecto), `LOCAL_FLUX_REFERENCE_EDGE` limita el tamaño de las referencias (768 px por defecto) y `LOCAL_FLUX_DEFAULT_REFERENCES` permite cambiar cuántas referencias integradas se usan (5 por defecto).

## Fallback opcional a fal.ai

Si algún día quieres usar generación remota, configura `FAL_KEY` y cambia `GENERATION_PROVIDER` a `fal` en `.env.local`.

## Timeline local y voz

El botón **Abrir editor** de un storyboard abre `timeline-studio` en modo local. El editor recibe automáticamente cada PNG como una capa B-roll con el intervalo de su escena, el texto del guion como subtítulo editable y la pista `narration.mp3` cuando se genera la voz. Puedes arrastrar las capas, cambiar sus tiempos y editar el texto desde el timeline; **Guardar cambios** escribe la instantánea en `data/storyboards/<id>/storyboard.json`.

`start-local.ps1` levanta los tres procesos necesarios: FLUX (`8188`), el editor Vite (`5173`) y RacingMonos/Next (`3000`). Para habilitar las voces españolas, añade `ELEVENLABS_API_KEY` en `.env.local` y reinicia `npm run dev`. El selector **Voz española** carga las voces de tu cuenta (`/api/voices`), muestra primero las que hablan español (etiqueta ES) y permite escuchar una muestra con ▶ antes de generar. Para tener más acentos (castellano, mexicano, argentino…) añádelos desde la Voice Library de ElevenLabs a *My Voices* y aparecerán automáticamente. La voz elegida se recuerda en el navegador.

Cuando hay narración, cada imagen y su subtítulo se colocan en el timeline en el instante exacto en que la voz pronuncia esa parte del guion (timestamps de ElevenLabs), en lugar de usar el intervalo fijo de 3/4/5 s. Sin voz se usa el intervalo fijo. La API usa `eleven_multilingual_v2`, guarda el MP3 y los timestamps de alineación en la misma carpeta del storyboard. Sin esa clave las imágenes siguen generándose y el editor se abre igualmente, pero no se añade audio.

## Subtítulos y exportación MP4

Al abrir el editor, el guion se coloca como subtítulos cortos (máximo 6 palabras por frase) sincronizados con la narración. Cada frase es un clip editable del timeline: puedes cambiar texto, tiempos, posición, preset y efecto por palabra (karaoke, pop, rebote, flash).

**Exportar** guarda el montaje y lo renderiza con FFmpeg en la propia app (`/api/render-timeline`). El resultado es un MP4 H.264 1080p a 30 fps (CRF 14, preset `slow`, AAC 320 kbps), con las imágenes, los rótulos, los subtítulos quemados con libass usando las mismas fuentes que el editor (`public/assets/fonts/editor`), la narración y la música. Se guarda en `data/storyboards/<id>/export-<fecha>.mp4`. Necesita `ffmpeg` y `ffprobe` en el PATH.

Para generar o cambiar la voz de un storyboard ya creado, usa **Generar narración / Cambiar voz** en la galería con la voz seleccionada. Una voz nueva vuelve a sincronizar el timeline con sus tiempos.

Si tienes un antivirus que inspecciona HTTPS (Avast, Kaspersky…), `npm run dev` arranca Node con `--use-system-ca` para que las llamadas a ElevenLabs no fallen con `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.

## Director de escenas (Qwen3 local)

Antes de dibujar, el servidor FLUX usa su propio codificador de texto (Qwen3-4B, ya incluido en FLUX.2 Klein: no se descarga nada más ni usa VRAM extra) como director de arte (`local_flux/planner.py`, endpoint `/plan`):

1. Lee el guion completo y escribe una **biblia visual**: lugar, época, clima, papel de cada piloto, otros personajes y objetos recurrentes.
2. Convierte cada frase en una **descripción de plano concreta en inglés** (quién aparece, qué hace, expresión, lugar, luz, objetos y encuadre), teniendo en cuenta la biblia y las frases anterior y siguiente.

Cada imagen se genera con su descripción más un bloque de estilo fijo. El plan se guarda en `storyboard.json` (`plan`) y tarda unos 20 s para un guion corto. Si falla, se usa el prompt directo de la frase.

Las referencias integradas contienen carteles con texto ("TRONCOMÓVILES", "SE VENDE"…) que FLUX copiaba en las escenas: el servidor los tapa con el color del propio cartel al cargarlas (`REFERENCE_TEXT_MASKS` en `local_flux/server.py`). Los PNG originales no se modifican.
