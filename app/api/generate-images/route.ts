import { NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';
import {
  createStoryboard,
  saveStoryboardScene,
  saveStoryboardPlan,
  updateStoryboardStatus,
  type StoryboardRecord,
} from '../../../lib/storyboards';

export const runtime = 'nodejs';
export const maxDuration = 300;

const STYLE = 'clean flat 2D digital cartoon matching the supplied Monos references, naive hand-drawn character design, crisp thick black outlines, smooth solid color fills, simple geometric backgrounds, saturated turquoise sky and grass, two recurring gray-furred chimpanzee pilots with pale gray faces, Pilot A wears a coral-red jacket, Pilot B wears a white jacket with dark trousers, recurring red race cars that the pilots sit in and drive whenever the story mentions driving, racing, overtaking or crossing the finish line, playful proportions, clean cel-shaded illustration, no wax, no crayon, no marker texture, no paper grain, no painterly rendering, no photorealism, no 3D';
const QUALITY_GUARD = 'Keep anatomy clean and readable: one head and one face per character, two eyes, two arms and two hands, no extra limbs, no fused fingers, no duplicate characters, no warped faces, no melted car, no random text, no watermark, no logo. Use a clear foreground action, simple background shapes and a stable camera composition. Never redesign the established pilots or change their clothing between scenes. Do not add hats, helmets, glasses or new accessories unless the current story beat explicitly asks for them. If only one pilot is mentioned, use one of the two established pilots instead of inventing a new character.';

type Ratio = '9:16' | '16:9';
type GeneratedImage = { sceneId: number; time: string; prompt: string; url: string; caption: string; filename: string };
type ProgressEvent =
  | { type: 'start'; total: number; intervalSeconds: number; aspectRatio: Ratio; storyboardId: string }
  | { type: 'scene-start'; current: number; total: number; caption: string }
  | { type: 'scene-complete'; current: number; total: number; image: GeneratedImage }
  | { type: 'complete'; total: number; storyboardId: string }
  | { type: 'error'; error: string };

type StoryboardArgs = {
  script: string;
  parts: string[];
  interval: number;
  aspectRatio: Ratio;
  seed: number;
  provider: string;
  files: File[];
  referenceUrls: string[];
  storyboard: StoryboardRecord;
  onEvent?: (event: ProgressEvent) => Promise<void> | void;
};

function wordCount(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}

function splitScript(script: string, interval: number) {
  const targetWords = Math.max(8, Math.round(interval * 2.45));
  const minWords = Math.max(4, Math.round(targetWords * 0.5));
  const rawSentences = script.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [];
  // Fragmentos muy cortos ("Fuji, 1976.") no son una escena por sí solos:
  // se unen a la frase siguiente (o a la anterior si es la última).
  const sentences: string[] = [];
  let carry = '';
  for (const sentence of rawSentences) {
    const joined = carry ? `${carry} ${sentence}` : sentence;
    if (wordCount(joined) < minWords) { carry = joined; continue; }
    sentences.push(joined);
    carry = '';
  }
  if (carry) {
    if (sentences.length) sentences[sentences.length - 1] += ` ${carry}`;
    else sentences.push(carry);
  }

  const frames: string[] = [];
  let current: string[] = [];
  let currentWords = 0;
  const flush = () => {
    if (current.length) frames.push(current.join(' ').trim());
    current = [];
    currentWords = 0;
  };
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    if (words.length > targetWords * 1.45) {
      flush();
      // Trozos de tamaño parecido, sin dejar una cola de 2-3 palabras.
      const chunks = Math.ceil(words.length / targetWords);
      const size = Math.ceil(words.length / chunks);
      for (let index = 0; index < words.length; index += size) frames.push(words.slice(index, index + size).join(' '));
      continue;
    }
    if (current.length && currentWords + words.length > targetWords * 1.25) flush();
    current.push(sentence);
    currentWords += words.length;
  }
  flush();
  return frames.length ? frames : [''];
}

// Cada escena usa su propia semilla: con la misma semilla todas las imágenes
// repetían composición. Es determinista, así que regenerar da el mismo resultado.
function sceneSeed(baseSeed: number, sceneNumber: number) {
  return (baseSeed + sceneNumber * 7919) % 2_147_483_647;
}

function storySetting(fullScript: string) {
  const first = fullScript.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.slice(0, 2).join(' ').trim() || fullScript;
  return first.replace(/\s+/g, ' ').slice(0, 220);
}

function sizeFor(ratio: Ratio) {
  return ratio === '9:16' ? { width: 768, height: 1344 } : { width: 1344, height: 768 };
}

function buildPrompt(fullScript: string, caption: string, sceneNumber: number, totalScenes: number) {
  // La acción de la escena va primero: con el guion completo delante, todas las
  // imágenes mezclaban la historia entera y acababan siendo casi iguales.
  return `Illustrate exactly this story moment (scene ${sceneNumber} of ${totalScenes}): "${caption}". Show the action, objects and emotion described in that sentence as the clear focus of the frame; do not depict earlier or later events. Story setting for reference only: "${storySetting(fullScript)}". Art style: ${STYLE}. ${QUALITY_GUARD} Absolutely no written words, letters, signs with text, banners or logos anywhere in the image.`;
}

// Con plan del director (Qwen3), el prompt es la descripción visual de la escena
// y un bloque de estilo compacto: todo cabe en los 512 tokens que lee FLUX.
const PLANNED_STYLE = 'Art style: flat 2D cartoon exactly matching the reference images, crisp thick black outlines, smooth solid color fills, simple shapes, saturated turquoise sky and green grass, gray-furred chimpanzee pilots (one in a coral-red jacket, one in a white jacket with dark trousers), red race cars, clean cel shading, no 3D, no photorealism, no paper or crayon texture.';
const PLANNED_GUARD = 'Clean anatomy: one head, two eyes, two arms and two hands per character, no extra limbs, no duplicated characters. Both pilots are bare-headed, gray fur visible on top of their heads. Keep the clothing of every pilot identical to the references. Absolutely no written words, letters, numbers, signs, banners or logos.';

function buildPlannedPrompt(description: string) {
  return `${description} ${PLANNED_STYLE} ${PLANNED_GUARD}`;
}

type StoryPlan = { bible: Record<string, unknown>; scenes: string[] };

// El director lee el guion completo una vez y devuelve una biblia visual y una
// descripción concreta por escena. Si falla, se usa el prompt directo.
async function planStory(script: string, parts: string[]): Promise<StoryPlan | null> {
  try {
    const response = await fetch(`${FLUX_BASE}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script, scenes: parts }),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!response.ok) throw new Error(`/plan respondió ${response.status}`);
    const plan = await response.json() as StoryPlan;
    if (!Array.isArray(plan.scenes) || plan.scenes.length !== parts.length || plan.scenes.some((scene) => typeof scene !== 'string' || scene.trim().length < 20)) {
      throw new Error('el plan no tiene una descripción válida por escena');
    }
    return plan;
  } catch (error) {
    console.warn('generate-images: sin plan del director, se usa el prompt directo.', error);
    return null;
  }
}

async function generateWithFal(prompt: string, aspectRatio: Ratio, seed: number, referenceUrl?: string) {
  if (!process.env.FAL_KEY) return null;
  fal.config({ credentials: process.env.FAL_KEY });
  const model = process.env.FAL_FLUX_MODEL || (referenceUrl ? 'fal-ai/flux/dev/image-to-image' : 'fal-ai/flux/dev');
  const input: Record<string, unknown> = { prompt, num_images: 1, seed, enable_safety_checker: true, output_format: 'png', guidance_scale: 3.5 };
  if (!referenceUrl) input.image_size = aspectRatio === '9:16' ? 'portrait_16_9' : 'landscape_16_9';
  if (referenceUrl) { input.image_url = referenceUrl; input.strength = 0.82; }
  const result: any = await fal.subscribe(model, { input });
  return result?.images?.[0]?.url || result?.data?.images?.[0]?.url || null;
}

async function uploadReferences(files: File[]) {
  if (!process.env.FAL_KEY || !files.length) return [] as string[];
  fal.config({ credentials: process.env.FAL_KEY });
  const urls: string[] = [];
  for (const file of files) urls.push(await fal.storage.upload(file));
  return urls;
}

const FLUX_BASE = (process.env.LOCAL_FLUX_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');

// FLUX tarda 1-2 minutos en cargar el modelo en la GPU: si se pulsa Generar
// justo después de arrancar, se espera en vez de fallar con "fetch failed".
async function waitForLocalFlux(onWaiting?: () => Promise<void> | void) {
  const deadline = Date.now() + 6 * 60_000;
  let notified = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${FLUX_BASE}/health`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return;
    } catch { /* todavía no responde */ }
    if (!notified) { notified = true; await onWaiting?.(); }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`El generador de imágenes FLUX no responde en ${FLUX_BASE}. Arranca la app con start-local.ps1 o npm run dev (que lo inician) y espera a que cargue el modelo.`);
}

async function generateLocally(prompt: string, aspectRatio: Ratio, seed: number, files: File[]) {
  const base = FLUX_BASE;
  const payload = new FormData();
  const size = sizeFor(aspectRatio);
  payload.append('prompt', prompt);
  payload.append('width', String(size.width));
  payload.append('height', String(size.height));
  payload.append('seed', String(seed));
  for (const file of files.slice(0, 4)) payload.append('references', new Blob([await file.arrayBuffer()], { type: file.type }), file.name);
  const response = await fetch(`${base.replace(/\/$/, '')}/generate`, { method: 'POST', body: payload, signal: AbortSignal.timeout(240000) });
  if (!response.ok) throw new Error(`El generador local respondió ${response.status}. Arranca local_flux/server.py.`);
  const data: any = await response.json();
  return data.dataUrl || data.url || '';
}

async function generateStoryboard(args: StoryboardArgs) {
  const { script, parts, interval, aspectRatio, seed, provider, files, referenceUrls, storyboard, onEvent } = args;
  const images: GeneratedImage[] = [];
  await onEvent?.({ type: 'start', total: parts.length, intervalSeconds: interval, aspectRatio, storyboardId: storyboard.id });
  if (provider === 'local') {
    await waitForLocalFlux(() => onEvent?.({ type: 'scene-start', current: 1, total: parts.length, caption: 'Cargando FLUX en la GPU… la primera imagen tardará 1-2 minutos.' }));
  }

  let plan: StoryPlan | null = null;
  if (provider === 'local') {
    await onEvent?.({ type: 'scene-start', current: 1, total: parts.length, caption: 'El director (Qwen3) está leyendo el guion y planificando cada escena…' });
    plan = await planStory(script, parts);
    if (plan) await saveStoryboardPlan(storyboard.id, plan);
  }

  for (let index = 0; index < parts.length; index += 1) {
    const caption = parts[index];
    const current = index + 1;
    await onEvent?.({ type: 'scene-start', current, total: parts.length, caption });
    const prompt = plan ? buildPlannedPrompt(plan.scenes[index]) : buildPrompt(script, caption, current, parts.length);
    const scene = sceneSeed(seed, current);
    const source = provider === 'local' ? await generateLocally(prompt, aspectRatio, scene, files) : await generateWithFal(prompt, aspectRatio, scene, referenceUrls[0]);
    if (!source) throw new Error('El motor no devolvió una imagen para esta escena.');
    const stored = await saveStoryboardScene(storyboard.id, {
      sceneId: current,
      time: `${String(index * interval).padStart(2, '0')}s – ${String((index + 1) * interval).padStart(2, '0')}s`,
      prompt,
      caption,
    }, source);
    const image: GeneratedImage = stored;
    images.push(image);
    await onEvent?.({ type: 'scene-complete', current, total: parts.length, image });
  }
  return images;
}

function streamResponse(args: Omit<StoryboardArgs, 'onEvent'>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ProgressEvent) => {
        try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { /* client disconnected */ }
      };
      try {
        const images = await generateStoryboard({ ...args, onEvent: send });
        await updateStoryboardStatus(args.storyboard.id, 'complete');
        send({ type: 'complete', total: images.length, storyboardId: args.storyboard.id });
      } catch (error) {
        await updateStoryboardStatus(args.storyboard.id, 'error');
        send({ type: 'error', error: error instanceof Error ? error.message : 'Error generando imágenes.' });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}

export async function POST(request: Request) {
  let storyboardId: string | undefined;
  try {
    const form = await request.formData();
    const script = String(form.get('script') || '').trim();
    const interval = Math.min(10, Math.max(2, Number(form.get('intervalSeconds') || 4)));
    const aspectRatio = String(form.get('aspectRatio') || '9:16') as Ratio;
    const style = String(form.get('style') || 'monos');
    const wantsStream = String(form.get('stream') || '') === '1';
    if (!script) return NextResponse.json({ error: 'Escribe un guion antes de generar.' }, { status: 400 });
    if (!['9:16', '16:9'].includes(aspectRatio)) return NextResponse.json({ error: 'Formato no válido.' }, { status: 400 });
    if (style !== 'monos') return NextResponse.json({ error: 'El estilo seleccionado no está disponible todavía.' }, { status: 400 });

    const files = form.getAll('references').filter((item): item is File => typeof item !== 'string' && item.size > 0);
    const provider = (process.env.GENERATION_PROVIDER || 'local').toLowerCase();
    const referenceUrls = provider === 'local' ? [] : await uploadReferences(files.slice(0, 4));
    const parts = splitScript(script, interval);
    const storyboard = await createStoryboard({ script, aspectRatio, intervalSeconds: interval, style: 'monos' });
    storyboardId = storyboard.id;
    const args: Omit<StoryboardArgs, 'onEvent'> = { script, parts, interval, aspectRatio, seed: Number(process.env.FLUX_BASE_SEED || 481976), provider, files, referenceUrls, storyboard };
    if (wantsStream) return streamResponse(args);
    const images = await generateStoryboard(args);
    await updateStoryboardStatus(storyboard.id, 'complete');
    return NextResponse.json({ images, mode: provider, intervalSeconds: interval, style: 'monos', references: 'default-local-library', storyboardId: storyboard.id, folder: storyboard.folder });
  } catch (error) {
    if (storyboardId) await updateStoryboardStatus(storyboardId, 'error');
    console.error('generate-images', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error generando imágenes.' }, { status: 500 });
  }
}
