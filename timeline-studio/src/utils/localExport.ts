// Exportación local para RacingMonos: traduce el timeline al encargo que
// renderiza FFmpeg en la app Next.js (/api/render-timeline). Los subtítulos se
// envían ya resueltos (colores, fuente, tamaño en píxeles y tiempo de cada
// palabra) con los mismos cálculos que usa el preview del editor, para que el
// vídeo exportado se vea igual que el lienzo.
import { estimateWordTimings, getSubtitlePresetOption, resolveSubtitleRendering } from '../constants/subtitlePresets';
import { TEXT_COLORS, TEXT_FONT_FAMILIES, TEXT_FONT_WEIGHTS, type Timeline } from '../types/timeline';
import { buildVolumeEnvelope } from './audioDucking';
import { getOutputSize, rasterizeTextOverlay, TEXT_SIZE_DIVISORS } from './textOverlay';

export interface LocalRenderJob {
  jobId: string;
  phase: 'queued' | 'rendering' | 'completed' | 'error' | 'cancelled';
  progress: number;
  statusMessage: string;
  videoUrl?: string;
  duration: number;
  error?: string;
}

// La exportación local siempre sale a 1080p (la máxima del editor) a 30 fps.
const LOCAL_EXPORT_RESOLUTION = '1080p' as const;
const LOCAL_EXPORT_FPS = 30;

export function buildLocalRenderPayload(timeline: Timeline, storyboardId: string, title: string) {
  const { aspectRatio } = timeline.settings;
  const [width, height] = getOutputSize(LOCAL_EXPORT_RESOLUTION, aspectRatio);
  const locale = document.documentElement.lang || 'es';

  const subtitles = timeline.textTrack.clips
    .filter((clip) => clip.kind === 'subtitle' && clip.text.trim() && clip.endTime > clip.startTime)
    .map((clip) => {
      const preset = getSubtitlePresetOption(clip.preset);
      const usesPreset = clip.preset !== 'none';
      const rendering = resolveSubtitleRendering(clip.preset, clip.style, clip.scale);
      const text = usesPreset && preset.upperCase ? clip.text.toLocaleUpperCase(locale) : clip.text;
      return {
        startTime: clip.startTime,
        endTime: clip.endTime,
        words: estimateWordTimings(text, clip.startTime, clip.endTime),
        fontFamily: usesPreset ? preset.cssFont : TEXT_FONT_FAMILIES[clip.font],
        fontWeight: usesPreset ? preset.weight : TEXT_FONT_WEIGHTS[clip.font],
        italic: usesPreset && preset.italic,
        fontSize: height / TEXT_SIZE_DIVISORS[clip.size] * clip.scale * (rendering.sizeMultiplier || 1),
        activeColor: usesPreset ? preset.color : TEXT_COLORS[clip.color],
        inactiveColor: usesPreset ? preset.inactiveColor : (clip.color === 'blanco' ? '#AEB7C5' : '#FFFFFF'),
        outlineColor: preset.outlineColor,
        shadowColor: preset.shadowColor,
        backColor: preset.backColor,
        wordEffect: clip.wordEffect,
        x: clip.x,
        y: clip.y,
        width: clip.width,
        rendering
      };
    });

  const overlays = timeline.textTrack.clips
    .filter((clip) => clip.kind === 'text' && clip.text.trim() && clip.endTime > clip.startTime)
    .map((clip) => {
      const raster = rasterizeTextOverlay(clip, LOCAL_EXPORT_RESOLUTION, aspectRatio);
      return {
        image: raster.renderedImage,
        width: raster.renderedWidth,
        height: raster.renderedHeight,
        startTime: clip.startTime,
        endTime: clip.endTime,
        x: clip.x,
        y: clip.y
      };
    });

  const music = timeline.musicTrack && timeline.musicTrack.sourceUrl
    ? {
      url: timeline.musicTrack.sourceUrl,
      startTime: timeline.musicTrack.startTime,
      endTime: timeline.musicTrack.endTime,
      envelope: buildVolumeEnvelope({
        durationMs: (timeline.musicTrack.endTime - timeline.musicTrack.startTime) * 1000,
        volume: timeline.musicTrack.volume,
        fadeInMs: timeline.musicTrack.fadeInMs,
        fadeOutMs: timeline.musicTrack.fadeOutMs,
        duckingEnabled: timeline.musicTrack.duckingEnabled,
        duckingAmount: timeline.musicTrack.duckingAmount,
        duckingRegions: timeline.musicTrack.duckingRegions,
        musicStartTime: timeline.musicTrack.startTime
      })
    }
    : null;

  return {
    storyboardId,
    title,
    width,
    height,
    fps: LOCAL_EXPORT_FPS,
    duration: timeline.duration,
    fitMode: timeline.settings.fitMode === 'cover' ? 'cover' as const : 'contain' as const,
    videoClips: timeline.videoTrack.clips.map((clip) => ({
      sourceUrl: clip.sourceUrl,
      sourceIn: clip.sourceIn,
      sourceOut: clip.sourceOut,
      startTime: clip.startTime,
      endTime: clip.endTime
    })),
    broll: timeline.brollTrack.clips.map((clip) => ({
      sourceUrl: clip.sourceUrl,
      startTime: clip.startTime,
      endTime: clip.endTime,
      x: clip.x,
      y: clip.y,
      width: clip.width,
      height: clip.height,
      opacity: clip.opacity
    })),
    overlays,
    subtitles,
    voice: {
      mode: timeline.audioTrack.mode,
      url: timeline.audioTrack.externalUrl || undefined,
      volume: timeline.audioTrack.volume
    },
    music
  };
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Operación cancelada.', 'AbortError'));
    }, { once: true });
  });
}

export async function runLocalRender(
  apiBase: string,
  payload: ReturnType<typeof buildLocalRenderPayload>,
  onProgress: (progress: number, message: string) => void,
  onJob: (jobId: string) => void,
  signal?: AbortSignal
): Promise<LocalRenderJob> {
  const response = await fetch(`${apiBase}/api/render-timeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });
  let job = await response.json().catch(() => ({})) as LocalRenderJob & { error?: string };
  if (!response.ok || !job.jobId) throw new Error(job.error || 'No se pudo iniciar la exportación.');
  onJob(job.jobId);
  for (;;) {
    onProgress(job.progress || 0, job.statusMessage || `Renderizando… ${job.progress || 0}%`);
    if (job.phase === 'completed') {
      if (!job.videoUrl) throw new Error('La exportación terminó sin un archivo de vídeo.');
      return { ...job, videoUrl: new URL(job.videoUrl, `${apiBase}/`).toString() };
    }
    if (job.phase === 'error' || job.phase === 'cancelled') {
      throw new Error(job.error || (job.phase === 'cancelled' ? 'Exportación cancelada.' : 'No se pudo exportar el vídeo.'));
    }
    await sleep(800, signal);
    const status = await fetch(`${apiBase}/api/render-timeline/${encodeURIComponent(job.jobId)}`, { cache: 'no-store', signal });
    job = await status.json().catch(() => job);
    if (!status.ok) throw new Error((job as { error?: string }).error || 'Se perdió la exportación.');
  }
}

export async function cancelLocalRender(apiBase: string, jobId: string) {
  await fetch(`${apiBase}/api/render-timeline/${encodeURIComponent(jobId)}`, { method: 'DELETE' }).catch(() => {});
}
