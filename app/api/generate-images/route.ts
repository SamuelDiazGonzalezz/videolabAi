import { fluxFetch } from '../../../lib/fluxFetch';
import { FLUX_BASE, generateLocally, waitForLocalFlux, type Ratio } from '../../../lib/fluxClient';
import { buildScenePrompt, sceneDescription, type StoryPlan } from '../../../lib/scenePrompts';
import { NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';
import {
  createStoryboard,
  saveStoryboardScene,
  saveStoryboardPlan,
  updateStoryboardStatus,
  type StoryboardRecord,
} from '../../../lib/storyboards';
import { getStyle, referenceFilesForGeneration, type ReferenceStyle } from '../../../lib/references';
import { artTypeById, type ArtType } from '../../../lib/artTypes';

export const runtime = 'nodejs';
export const maxDuration = 300;

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
  style: ReferenceStyle;
  artType: ArtType;
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

// El director lee el guion completo una vez y devuelve una biblia visual y una
// descripción concreta por escena. Si falla, se usa el prompt directo.
async function planStory(script: string, parts: string[], style: ReferenceStyle, hasReferences = false, medium = ''): Promise<StoryPlan | null> {
  try {
    const response = await fluxFetch(`${FLUX_BASE}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script, scenes: parts, mode: style.kind, notes: style.kind === 'custom' ? style.description : style.kind === 'white' && hasReferences ? 'Reference images are provided.' : '', medium }),
      // ~1-3 s por escena en una RTX 4080; margen amplio para guiones largos.
      signal: AbortSignal.timeout(Math.max(5 * 60_000, parts.length * 20_000)),
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

async function generateStoryboard(args: StoryboardArgs) {
  const { script, parts, interval, aspectRatio, seed, provider, files, referenceUrls, storyboard, style, artType, onEvent } = args;
  // Monos tiene la técnica fijada por sus referencias.
  const artPrompt = style.kind === 'monos' ? '' : artType.prompt;
  const images: GeneratedImage[] = [];
  await onEvent?.({ type: 'start', total: parts.length, intervalSeconds: interval, aspectRatio, storyboardId: storyboard.id });
  if (provider === 'local') {
    await waitForLocalFlux(() => onEvent?.({ type: 'scene-start', current: 1, total: parts.length, caption: 'Cargando FLUX en la GPU… la primera imagen tardará 1-2 minutos.' }));
  }

  let plan: StoryPlan | null = null;
  if (provider === 'local') {
    await onEvent?.({ type: 'scene-start', current: 1, total: parts.length, caption: 'El director (Qwen3) está leyendo el guion y planificando cada escena…' });
    plan = await planStory(script, parts, style, files.length > 0, artPrompt);
    if (plan) await saveStoryboardPlan(storyboard.id, plan);
  }

  for (let index = 0; index < parts.length; index += 1) {
    const caption = parts[index];
    const current = index + 1;
    await onEvent?.({ type: 'scene-start', current, total: parts.length, caption });
    const prompt = buildScenePrompt(style, plan, index, { script, caption, total: parts.length }, files.length > 0, artPrompt);
    const scene = sceneSeed(seed, current);
    const source = provider === 'local' ? await generateLocally(prompt, aspectRatio, scene, files, { whiteBackground: style.kind === 'white' }) : await generateWithFal(prompt, aspectRatio, scene, referenceUrls[0]);
    if (!source) throw new Error('El motor no devolvió una imagen para esta escena.');
    const stored = await saveStoryboardScene(storyboard.id, {
      sceneId: current,
      time: `${String(index * interval).padStart(2, '0')}s – ${String((index + 1) * interval).padStart(2, '0')}s`,
      prompt,
      caption,
      description: sceneDescription(plan, index, caption),
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
    const script = String(form.get('script') || '').trim().slice(0, 10_000);
    const interval = Math.min(10, Math.max(2, Number(form.get('intervalSeconds') || 4)));
    const aspectRatio = String(form.get('aspectRatio') || '9:16') as Ratio;
    const styleId = String(form.get('style') || 'monos');
    const artType = artTypeById(String(form.get('artType') || 'auto'));
    const wantsStream = String(form.get('stream') || '') === '1';
    if (!script) return NextResponse.json({ error: 'Escribe un guion antes de generar.' }, { status: 400 });
    if (!['9:16', '16:9'].includes(aspectRatio)) return NextResponse.json({ error: 'Formato no válido.' }, { status: 400 });
    const style = await getStyle(styleId);
    if (!style) return NextResponse.json({ error: 'El estilo seleccionado ya no existe.' }, { status: 400 });

    const files = await referenceFilesForGeneration(style.id);
    const provider = (process.env.GENERATION_PROVIDER || 'local').toLowerCase();
    const referenceUrls = provider === 'local' ? [] : await uploadReferences(files.slice(0, 4));
    const parts = splitScript(script, interval);
    const storyboard = await createStoryboard({ script, aspectRatio, intervalSeconds: interval, style: style.id, styleName: style.name, artType: artType.id });
    storyboardId = storyboard.id;
    const args: Omit<StoryboardArgs, 'onEvent'> = { script, parts, interval, aspectRatio, seed: Number(process.env.FLUX_BASE_SEED || 481976), provider, files, referenceUrls, storyboard, style, artType };
    if (wantsStream) return streamResponse(args);
    const images = await generateStoryboard(args);
    await updateStoryboardStatus(storyboard.id, 'complete');
    return NextResponse.json({ images, mode: provider, intervalSeconds: interval, style: style.id, references: files.length, storyboardId: storyboard.id, folder: storyboard.folder });
  } catch (error) {
    if (storyboardId) await updateStoryboardStatus(storyboardId, 'error');
    console.error('generate-images', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error generando imágenes.' }, { status: 500 });
  }
}
