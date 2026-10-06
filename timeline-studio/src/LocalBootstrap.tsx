import { useEffect, useState } from 'react';
import { App } from './App';

const STORYBOARD_CONTEXT_PREFIX = 'vidreum.storyboard-editor-context.v1.';
const CONTEXT_TTL_MS = 60 * 60 * 1000;

type LocalStatus = 'loading' | 'ready' | 'error' | 'empty';

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function absoluteUrl(apiBase: string, value: unknown): string {
  const raw = text(value);
  if (!raw) return '';
  try {
    return new URL(raw, `${apiBase}/`).toString();
  } catch {
    return '';
  }
}

function localTarget() {
  const params = new URLSearchParams(window.location.search);
  const apiBase = (text(params.get('apiBase')) || window.location.origin).replace(/\/$/, '');
  const storyboardId = text(params.get('storyboardId'));
  return {
    apiBase,
    storyboardId,
    contextId: `local-${storyboardId}`
  };
}

function contextStorageKey(contextId: string) {
  return `${STORYBOARD_CONTEXT_PREFIX}${contextId}`;
}

function normalizeSavedEditorState(value: unknown, apiBase: string): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const state = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  const sourceUrl = absoluteUrl(apiBase, state.sourceUrl);
  if (!sourceUrl) return null;
  state.sourceUrl = sourceUrl;
  if (Array.isArray(state.clips)) {
    state.clips = state.clips.map((clip) => {
      if (!clip || typeof clip !== 'object') return clip;
      const next = { ...(clip as Record<string, unknown>) };
      next.sourceUrl = absoluteUrl(apiBase, next.sourceUrl);
      return next;
    });
  }
  if (Array.isArray(state.brollClips)) {
    state.brollClips = state.brollClips.map((clip) => {
      if (!clip || typeof clip !== 'object') return clip;
      const next = { ...(clip as Record<string, unknown>) };
      next.sourceUrl = absoluteUrl(apiBase, next.sourceUrl);
      return next;
    });
  }
  if (state.audio && typeof state.audio === 'object') {
    const audio = { ...(state.audio as Record<string, unknown>) };
    audio.externalUrl = absoluteUrl(apiBase, audio.externalUrl);
    state.audio = audio;
  }
  if (Array.isArray(state.mediaAssets)) {
    state.mediaAssets = state.mediaAssets.map((asset) => {
      if (!asset || typeof asset !== 'object') return asset;
      const next = { ...(asset as Record<string, unknown>) };
      next.url = absoluteUrl(apiBase, next.url);
      return next;
    });
  }
  return state;
}

type NarrationAlignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

function narrationAlignment(value: unknown): NarrationAlignment | null {
  if (!value || typeof value !== 'object') return null;
  const alignment = value as Partial<NarrationAlignment>;
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  if (!Array.isArray(characters) || !Array.isArray(starts) || !Array.isArray(ends)) return null;
  if (!characters.length || characters.length !== starts.length || characters.length !== ends.length) return null;
  return alignment as NarrationAlignment;
}

// Solo letras y números en minúsculas: los captions salen del mismo guion que se
// envía a ElevenLabs, pero con los espacios normalizados.
function matchKey(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]/g, '');
}

type SpokenText = {
  locate: (value: string) => { start: number; end: number } | null;
  audioEnd: number;
};

// Recorre el alineamiento carácter a carácter de ElevenLabs en orden: cada
// fragmento del guion se busca a partir del anterior y devuelve el instante en
// que la voz empieza y termina de pronunciarlo.
function spokenText(alignment: NarrationAlignment): SpokenText | null {
  const indexMap: number[] = [];
  let spoken = '';
  alignment.characters.forEach((character, index) => {
    const key = matchKey(String(character));
    for (let i = 0; i < key.length; i += 1) indexMap.push(index);
    spoken += key;
  });
  const audioEnd = Math.max(...alignment.character_end_times_seconds.map(Number).filter(Number.isFinite));
  if (!spoken || !Number.isFinite(audioEnd) || audioEnd <= 0) return null;
  let cursor = 0;
  return {
    audioEnd,
    locate(value) {
      const key = matchKey(value);
      const position = key ? spoken.indexOf(key, cursor) : -1;
      if (position < 0) return null;
      cursor = position + key.length;
      return {
        start: Number(alignment.character_start_times_seconds[indexMap[position]]) || 0,
        end: Number(alignment.character_end_times_seconds[indexMap[cursor - 1]]) || 0
      };
    }
  };
}

const SUBTITLE_MAX_WORDS = 6;

// Frases cortas y legibles: trozos de como mucho 6 palabras, repartidos de forma
// equilibrada para no dejar una palabra suelta al final.
function subtitleChunks(caption: string): string[] {
  const words = caption.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const count = Math.ceil(words.length / SUBTITLE_MAX_WORDS);
  const size = Math.ceil(words.length / count);
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += size) chunks.push(words.slice(index, index + size).join(' '));
  return chunks;
}

type SubtitleCue = { text: string; start: number; end: number };

type SceneTiming = { durations: number[]; subtitles: SubtitleCue[] };

const round = (value: number) => Math.round(value * 1000) / 1000;

// Con voz, cada imagen empieza cuando arranca su frase y dura hasta la
// siguiente; los subtítulos siguen palabra a palabra a la narración.
function timingFromNarration(captions: string[], alignment: NarrationAlignment): SceneTiming | null {
  const spoken = spokenText(alignment);
  if (!spoken) return null;
  const starts: number[] = [];
  const subtitles: SubtitleCue[] = [];
  for (const caption of captions) {
    let sceneStart: number | null = null;
    for (const chunk of subtitleChunks(caption)) {
      const range = spoken.locate(chunk);
      if (!range) return null;
      if (sceneStart == null) sceneStart = range.start;
      subtitles.push({ text: chunk, start: range.start, end: range.end });
    }
    starts.push(sceneStart ?? (starts[starts.length - 1] ?? 0));
  }
  starts[0] = 0;
  const totalEnd = spoken.audioEnd + 0.4;
  // Cada subtítulo se mantiene hasta que empieza el siguiente (sin parpadeos).
  subtitles.forEach((cue, index) => {
    const next = subtitles[index + 1];
    cue.start = round(index === 0 ? 0 : cue.start);
    cue.end = round(next ? Math.max(cue.start + 0.3, next.start) : totalEnd);
  });
  return {
    durations: starts.map((start, index) => round(Math.max(0.5, (index + 1 < starts.length ? starts[index + 1] : totalEnd) - start))),
    subtitles
  };
}

// Sin voz: intervalo fijo por imagen y frases repartidas por longitud dentro de
// su escena.
function timingFromInterval(captions: string[], interval: number): SceneTiming {
  const subtitles: SubtitleCue[] = [];
  captions.forEach((caption, sceneIndex) => {
    const chunks = subtitleChunks(caption);
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0) || 1;
    let cursor = sceneIndex * interval;
    for (const chunk of chunks) {
      const end = cursor + interval * chunk.length / total;
      subtitles.push({ text: chunk, start: round(cursor), end: round(end) });
      cursor = end;
    }
  });
  return { durations: captions.map(() => interval), subtitles };
}

// Versiones anteriores del editor recortaban la pista de imágenes a 8 clips, y
// un montaje guardado así perdía el resto de escenas. Cada imagen del
// storyboard que no esté en el montaje se vuelve a colocar en su tramo
// sincronizado, sin tocar las que el usuario ya movió o editó.
function restoreMissingScenes(
  state: Record<string, unknown>,
  scenes: Record<string, unknown>[],
  durations: number[],
  apiBase: string
) {
  const brollClips = Array.isArray(state.brollClips) ? [...state.brollClips] as Record<string, unknown>[] : [];
  const present = new Set(brollClips.map((clip) => absoluteUrl(apiBase, clip?.sourceUrl)));
  const ids = new Set(brollClips.map((clip) => text(clip?.id)));
  const mediaAssets = Array.isArray(state.mediaAssets) ? [...state.mediaAssets] as Record<string, unknown>[] : [];
  const assetUrls = new Set(mediaAssets.map((asset) => absoluteUrl(apiBase, asset?.url)));
  let cursor = 0;
  let restored = 0;
  scenes.forEach((scene, index) => {
    const startTime = cursor;
    const duration = durations[index] ?? 0;
    cursor += duration;
    const imageUrl = absoluteUrl(apiBase, scene.url);
    if (!imageUrl || present.has(imageUrl) || duration <= 0) return;
    const sceneNumber = Number(scene.sceneId) || index + 1;
    let id = `storyboard-image-${index + 1}`;
    while (ids.has(id)) id = `${id}-r`;
    ids.add(id);
    brollClips.push({ id, sourceUrl: imageUrl, name: `Imagen ${sceneNumber}`, startTime, endTime: startTime + duration, opacity: 1, x: .5, y: .5, width: 1, height: 1, blendMode: 'normal' });
    if (!assetUrls.has(imageUrl)) mediaAssets.push({ id: `storyboard-image-${index + 1}`, name: `Viñeta ${sceneNumber}`, type: 'image', url: imageUrl, duration: 0 });
    restored += 1;
  });
  if (!restored) return;
  state.brollClips = brollClips.sort((a, b) => Number(a.startTime) - Number(b.startTime));
  state.mediaAssets = mediaAssets;
  // Que el vídeo base cubra todas las escenas recuperadas.
  const clips = Array.isArray(state.clips) ? state.clips as Record<string, unknown>[] : [];
  const lastClip = clips[clips.length - 1];
  const covered = clips.reduce((sum, clip) => sum + Math.max(0, Number(clip.sourceOut) - Number(clip.sourceIn)), 0);
  if (lastClip && cursor > covered) {
    const extra = cursor - covered;
    lastClip.sourceOut = Number(lastClip.sourceOut) + extra;
    lastClip.sourceDuration = Math.max(Number(lastClip.sourceDuration) || 0, Number(lastClip.sourceOut));
    state.sourceDuration = Math.max(Number(state.sourceDuration) || 0, Number(lastClip.sourceOut));
  }
}

async function loadStoryboardContext(apiBase: string, storyboardId: string, contextId: string) {
  const response = await fetch(`${apiBase}/api/storyboards/${encodeURIComponent(storyboardId)}`, {
    cache: 'no-store'
  });
  const record = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(text(record?.error, 'No se pudo cargar el storyboard local.'));

  const baseVideoUrl = absoluteUrl(apiBase, '/assets/timeline-base.mp4');
  const scenes = Array.isArray(record.images) ? record.images : [];
  const interval = Math.max(0.5, Number(record.intervalSeconds) || 4);
  const audioUrl = absoluteUrl(apiBase, record.audioUrl);
  const savedEditorState = normalizeSavedEditorState(record.editorState, apiBase);
  // Si la voz se generó después de guardar el timeline, se añade la narración
  // sin perder las posiciones que el usuario ya había ajustado.
  if (savedEditorState && audioUrl) {
    const audio = (savedEditorState.audio && typeof savedEditorState.audio === 'object'
      ? savedEditorState.audio
      : {}) as Record<string, unknown>;
    if (!text(audio.externalUrl)) {
      savedEditorState.audio = { volume: 1, ...audio, mode: 'replace', externalName: 'Narración', externalUrl: audioUrl };
    }
  }
  const captions = scenes.map((scene: Record<string, unknown>) => text(scene.caption));
  const alignment = audioUrl ? narrationAlignment(record.alignment) : null;
  const timing = (alignment && timingFromNarration(captions, alignment)) || timingFromInterval(captions, interval);
  if (savedEditorState) restoreMissingScenes(savedEditorState, scenes, timing.durations, apiBase);
  const context = {
    expiresAt: Date.now() + CONTEXT_TTL_MS,
    ownerId: '',
    sourceUrl: baseVideoUrl,
    scenes: scenes.map((scene: Record<string, unknown>, index: number) => ({
      // El editor numera las viñetas como index + 1.
      index: Math.max(0, (Number(scene.sceneId) || index + 1) - 1),
      sourceUrl: baseVideoUrl,
      imageUrl: absoluteUrl(apiBase, scene.url),
      imageStorageKey: '',
      duration: timing.durations[index] ?? interval,
      narration: text(scene.caption)
    })),
    subtitles: timing.subtitles,
    audioUrl,
    audioStorageKey: '',
    ...(savedEditorState ? { editorState: savedEditorState } : {})
  };
  if (!context.scenes.length && !savedEditorState) {
    throw new Error('Este storyboard todavía no tiene imágenes generadas.');
  }
  window.sessionStorage.setItem(contextStorageKey(contextId), JSON.stringify(context));
  const params = new URLSearchParams(window.location.search);
  params.set('local', '1');
  params.set('apiBase', apiBase);
  params.set('storyboardEditorContextId', contextId);
  if (record.aspectRatio === '16:9' || record.aspectRatio === '9:16') params.set('aspectRatio', record.aspectRatio);
  const title = text(record.title);
  if (title) params.set('title', title.slice(0, 120));
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
}

export function LocalBootstrap() {
  const [status, setStatus] = useState<LocalStatus>('loading');
  const [message, setMessage] = useState('Preparando el storyboard local…');

  useEffect(() => {
    const target = localTarget();
    if (!target.storyboardId) {
      setStatus('empty');
      return;
    }
    let cancelled = false;
    void loadStoryboardContext(target.apiBase, target.storyboardId, target.contextId)
      .then(() => {
        if (!cancelled) setStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'No se pudo abrir el storyboard.');
      });
    return () => { cancelled = true; };
  }, []);

  if (status === 'ready') return <App />;
  if (status === 'empty') {
    return <div className="app app--loading"><strong>Video Lab Ai · Timeline</strong><span>Abre el editor desde un storyboard generado.</span></div>;
  }
  if (status === 'error') {
    return <div className="app app--loading"><strong>No se pudo abrir el storyboard</strong><span>{message}</span><a href="http://localhost:3000/">Volver a Video Lab Ai</a></div>;
  }
  return <div className="app app--loading"><span className="app__status-spinner" /><strong>{message}</strong></div>;
}
