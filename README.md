# Video Lab Ai

<img width="1024" height="571" alt="622205db-1aac-45df-b33e-48e1197b9f01" src="https://github.com/user-attachments/assets/2edd5117-60b9-4e2e-9c64-f4ba4e43428d" />


La generación usa un flujo NDJSON: el contador y cada PNG aparecen en la galería en cuanto terminan, sin esperar a que finalice todo el guion.

Video Lab Ai recibe un guion y genera una secuencia de imágenes coherentes con FLUX.2 Klein 4B. Divide el texto en escenas de 3, 4 o 5 segundos, mantiene bloqueado el estilo de los monos y permite abrir cada escena en grande o descargar todo el storyboard como ZIP.

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

`start-local.ps1` levanta los tres procesos necesarios: FLUX (`8188`), el editor Vite (`5173`) y Video Lab Ai/Next (`3000`). Para habilitar las voces españolas, añade `ELEVENLABS_API_KEY` en `.env.local` y reinicia `npm run dev`. El selector **Voz española** carga las voces de tu cuenta (`/api/voices`), muestra primero las que hablan español (etiqueta ES) y permite escuchar una muestra con ▶ antes de generar. Para tener más acentos (castellano, mexicano, argentino…) añádelos desde la Voice Library de ElevenLabs a *My Voices* y aparecerán automáticamente. La voz elegida se recuerda en el navegador.

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

## Estilos (tipos de referencias)

Al crear un storyboard eliges un **estilo**. Cada estilo tiene sus propias imágenes de referencia, y solo esas se envían a FLUX:

- **Monos** (integrado): tus ilustraciones de `public/references/monos`, los pilotos y los coches rojos.
- **En blanco** (integrado): sin referencias ni reparto fijo. El director (Qwen3) lee el guion, elige un estilo de dibujo (`art_style`), diseña a los personajes y los describe completos en cada escena para que salgan iguales.
- **Estilos propios**: se crean desde **Editar → Nuevo estilo**, con un nombre, una nota de estilo opcional para el director y sus propias imágenes.

La ventana de referencias filtra por estilo (Todos / Monos / En blanco / propios) y permite añadir o borrar imágenes de cada uno, o eliminar un estilo propio con todas sus imágenes. Todo se guarda en `data/references/manifest.json`.

## Guiones con Qwen3

La sección **Guiones** (debajo de Assets) escribe guiones de narración en español a partir de una idea o un texto, con el mismo Qwen3-4B local que hace de director (`local_flux/writer.py`, endpoint `/write-script`, retransmitido por `/api/scripts/generate`). Eliges duración (30 s – 5 min, a unas 2,5 palabras por segundo) y tono; al pulsar **Generar** el chat sube y debajo se abre la ventana donde el guion aparece letra a letra. Después puedes **Copiar**, **Guardar** o **Usar en storyboard** (lo lleva al cuadro de guion de Crear). Los guardados están en **Guiones guardados** (`data/scripts/scripts.json`). El fondo es `public/assets/guiones-bg.mp4`.

## Editar escenas con IA

Cada imagen de la galería tiene un botón de varita (arriba a la derecha) que abre **¿Qué quieres cambiar?**: describe el arreglo en español ("quítale la mano que sobra", "que el balón sea naranja") o usa una sugerencia. Qwen3 lo convierte en una instrucción precisa en inglés y FLUX edita la imagen usando la escena actual como referencia, manteniendo personajes, encuadre y estilo (endpoint `/edit`, ~20-30 s). Mientras tanto la tarjeta muestra una animación de degradados. Cada edición se guarda como una versión nueva (`scene-XX-vN.png`), el montaje del editor de vídeo pasa a usarla y **Deshacer última edición** vuelve a la anterior.

Las llamadas de Next al servidor FLUX usan `lib/fluxFetch.ts` (undici sin el límite de 5 minutos de Node) y el servidor ejecuta el trabajo de GPU fuera de su bucle de eventos, así que `/health` responde aunque esté generando.

## Mapa de nodos

Al generar, el panel de escenas muestra por defecto un **mapa de nodos** (selector Mapa / Cuadrícula): un nodo **Guion**, y por escena un nodo **Prompt** con la descripción visual usada para la imagen conectado a su nodo **Imagen**; las imágenes se encadenan en orden. Detrás va `public/assets/mapa-bg.mp4` (el vídeo vertical girado a horizontal y sin audio).

- Edita el texto de un Prompt y pulsa **Generar** para rehacer esa imagen con el prompt nuevo (nueva versión, con deshacer); la varita de cada imagen sigue abriendo **Editar con IA**.
- Arrastra nodos, desplaza el lienzo (herramienta mano o arrastrando el fondo) y haz zoom con la rueda.
- Crea conexiones arrastrando desde la salida (derecha) de un nodo a la entrada (izquierda) de otro; selecciona una conexión o una nota y bórrala con la papelera o Supr.
- Notas amarillas con la herramienta nota (N); restaurar disposición, encuadrar, zoom y pantalla completa en la barra inferior.

La disposición (posiciones, conexiones, notas y vista) se guarda en `storyboard.json` (`mapState`) mediante `/api/storyboards/<id>/map`.

## Modelo de imágenes: Klein 4B o 9B

El modelo se elige en `.env.local` con `LOCAL_FLUX_MODEL` (lo leen `npm run dev` y `start-local.ps1`). Por defecto está configurado **FLUX.2 Klein 9B**, que dibuja mejor (anatomía, seguir el prompt) y trae Qwen3-8B como director/escritor:

- Pesa ~35 GB y no cabe tal cual en 16 GB de VRAM: con `LOCAL_FLUX_FP8=auto` el servidor guarda generador y codificador en FP8 (~9 GB + ~8,5 GB) y calcula en bf16. Cada imagen tarda aproximadamente el doble que con el 4B.
- **Licencia no comercial** (FLUX Non-Commercial License) y descarga protegida: acepta la licencia en https://huggingface.co/black-forest-labs/FLUX.2-klein-9B, crea un token de lectura en https://huggingface.co/settings/tokens y ejecuta `.\.venv\Scripts\hf.exe auth login`.
- Si el 9B no está descargado o falla al cargar, el servidor vuelve automáticamente a **Klein 4B** (Apache 2.0). Para usar siempre el 4B, pon `LOCAL_FLUX_MODEL=black-forest-labs/FLUX.2-klein-4B`.

El menú lateral (GPU local) muestra el modelo cargado en cada momento.

## Estilo «Fondo blanco» (vídeos educativos)

Estilo integrado para explicadores: el director ilustra cada frase con objetos, personajes o pequeños esquemas **aislados sobre fondo blanco puro**, sin paisaje ni suelo, mostrando solo el concepto de esa frase. El servidor FLUX deja el fondo en #FFFFFF exacto (`white_background=1`: los tonos casi blancos pasan a blanco puro) y recentra y agranda el sujeto. Admite referencias opcionales (Editar → Fondo blanco) para fijar un estilo de dibujo; sin ellas el director elige un estilo limpio tipo vector. Las ediciones y regeneraciones de escenas de este estilo también mantienen el fondo blanco.

## Tipo de imagen

En el panel de creación, **Tipo de imagen** fija la técnica de todas las escenas: Automático (el director decide), Dibujo, Anime, Realista, Natural, Cómic, Rotulador, Ceras, Mal pintado, Acuarela, Lápiz, Óleo, Animación 3D, Plastilina, Pixel art, Vector plano o Recortes de papel (`lib/artTypes.ts`). La técnica se pasa al director (`medium` en `/plan`) y abre el prompt de FLUX; se guarda en el storyboard (`artType`) y se reutiliza al regenerar o redibujar escenas. En **Monos** está desactivado porque el dibujo lo marcan sus referencias; con un estilo propio con referencias, la técnica cambia el acabado manteniendo sus personajes.
