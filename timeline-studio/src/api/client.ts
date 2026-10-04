export interface ThumbnailsResponse {
  thumbnails: string[];
}

type AuthToken = string | (() => Promise<string>);

async function resolveAuthToken(token: AuthToken): Promise<string> {
  return typeof token === 'function' ? token() : token;
}

export async function fetchVideoThumbnails(
  sourceUrl: string,
  duration: number,
  token: AuthToken,
  storageKey = ''
): Promise<string[]> {
  const params = new URLSearchParams({ source: sourceUrl, duration: String(duration) });
  if (storageKey) params.set('storageKey', storageKey);
  const response = await fetch(`/api/video-thumbnails?${params.toString()}`, {
    headers: { Authorization: `Bearer ${await resolveAuthToken(token)}` },
    cache: 'no-store'
  });
  const data = (await response.json().catch(() => ({}))) as Partial<ThumbnailsResponse> & { error?: string };
  if (!response.ok) throw new Error(data.error || 'No se pudieron obtener los fotogramas del vídeo.');
  return Array.isArray(data.thumbnails) ? data.thumbnails : [];
}

export interface KeyframePayload {
  id: string;
  timeMs: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  rotation: number;
  easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
}

export interface TextOverlayPayload {
  text: string;
  start: number;
  end: number;
  style: string;
  font: string;
  position: string;
  size: string;
  color: string;
  x: number;
  y: number;
  width: number;
  scale: number;
  preset: string;
  renderedImage?: string;
  renderedWidth?: number;
  renderedHeight?: number;
  /** Función 1 — Keyframes. */
  keyframes?: KeyframePayload[];
}

export interface RenderTimelinePayload {
  clientRequestId: string;
  source: string;
  sourceStorageKey?: string;
  clips: Array<{
    source: string;
    storageKey?: string;
    start: number;
    end: number;
    brightness?: number;
    contrast?: number;
    saturation?: number;
    sharpen?: number;
    /** Función 4 — Corrección de color: -100 (fría) a 100 (cálida). */
    temperature?: number;
    focusX?: number;
    focusY?: number;
  }>;
  transitions: Array<{
    type: 'none' | 'fade' | 'dissolve' | 'wipeleft' | 'wiperight' | 'slideleft' | 'slideright' | 'circleopen';
    duration: number;
  }>;
  music: 'keep' | 'mute' | 'replace';
  audio?: string;
  audioUrl?: string;
  audioStorageKey?: string;
  audioVolume: number;
  audioCleanup: boolean;
  /** Función 6 — Editor de audio por capas: pista de música independiente de la voz. */
  backgroundMusic?: {
    sourceUrl: string;
    storageKey?: string;
    start: number;
    end: number;
    volume: number;
    fadeInMs: number;
    fadeOutMs: number;
    duckingEnabled: boolean;
    duckingAmount: number;
    duckingRegions: Array<{ start: number; end: number }>;
  };
  aspectRatio: '9:16' | '1:1' | '16:9' | '4:5';
  fitMode: 'contain' | 'cover';
  layoutPreset: 'fit' | 'fill' | 'split' | 'three' | 'four' | 'screen-share' | 'gameplay';
  framePreset: 'none' | 'minimal' | 'neon' | 'film' | 'polaroid' | 'cinema';
  focusX: number;
  focusY: number;
  roi?: { x: number; y: number; width: number; height: number } | null;
  transitionType: 'none' | 'fade' | 'dissolve' | 'wipeleft' | 'wiperight' | 'slideleft' | 'slideright' | 'circleopen';
  transitionDuration: number;
  startTransitionType: 'none' | 'fade' | 'dissolve' | 'wipeleft' | 'wiperight' | 'slideleft' | 'slideright' | 'circleopen';
  startTransitionDuration: number;
  endTransitionType: 'none' | 'fade' | 'dissolve' | 'wipeleft' | 'wiperight' | 'slideleft' | 'slideright' | 'circleopen';
  endTransitionDuration: number;
  brightness: number;
  contrast: number;
  saturation: number;
  sharpen: number;
  /** Función 4 — Corrección de color: -100 (fría) a 100 (cálida). */
  temperature?: number;
  brandLogoUrl?: string;
  brandLogoStorageKey?: string;
  brandLogoPosition?: string;
  brandLogoScale?: number;
  broll: Array<{
    sourceUrl: string;
    storageKey?: string;
    start: number;
    end: number;
    opacity: number;
    x: number;
    y: number;
    width: number;
    height: number;
    /** Función 3 — Capas superpuestas. */
    blendMode?: 'normal' | 'multiply' | 'screen';
    /** Función 1 — Keyframes. */
    keyframes?: KeyframePayload[];
  }>;
  resolution: '720p' | '1080p';
  coverTime?: number;
  coverTitle?: string;
  coverTitlePosition?: 'top' | 'center' | 'bottom';
  coverTitleColor?: string;
  textOverlays: TextOverlayPayload[];
  subtitleClips: Array<{
    text: string;
    start: number;
    end: number;
    style: string;
    position: string;
    size: string;
    color: string;
    font: string;
    preset: string;
    wordEffect: string;
    placement: {
      x: number;
      y: number;
      width: number;
      scale: number;
    };
  }>;
}

export interface EditorMediaResponse {
  id: string;
  name: string;
  type: 'image' | 'video' | 'audio';
  url: string;
  duration: number;
  key?: string;
  thumbnailUrl?: string;
}

export interface RenderTimelineResponse {
  videoUrl: string;
  videoDownloadUrl?: string;
  videoStorageKey?: string;
  duration: number;
  coverUrl?: string;
  coverStorageKey?: string;
}

interface RenderTimelineJobStatus {
  jobId: string;
  phase: string;
  progress: number;
  updatedAt?: number;
  statusMessage?: string;
  videoUrl: string;
  videoDownloadUrl?: string;
  videoStorageKey?: string;
  duration: number;
  coverUrl?: string;
  coverStorageKey?: string;
  resolution?: string;
  aspectRatio?: string;
  error?: string;
}

export interface ClientRequestJobStatus {
  jobId: string;
  phase: string;
  mode?: string;
  model?: string;
  creditsCost?: number;
  idempotent: true;
}

export class TimelineRenderError extends Error {
  readonly status: number;
  readonly terminal: boolean;

  constructor(message: string, options: { status?: number; terminal?: boolean } = {}) {
    super(message);
    this.name = 'TimelineRenderError';
    this.status = options.status || 0;
    this.terminal = Boolean(options.terminal);
  }
}

export function isTerminalTimelineRenderError(reason: unknown): boolean {
  return reason instanceof TimelineRenderError && reason.terminal;
}

// Cada consulta queda abierta en el servidor hasta que el job cambia. Además
// de evitar sondeos vacíos, en App Hosting mantiene una petición activa
// mientras FFmpeg trabaja y, por tanto, conserva CPU asignada al contenedor.
const RENDER_TIMELINE_LONG_POLL_MS = 20_000;
const RENDER_TIMELINE_RETRY_DELAY_MS = 1500;
// Si el trabajo deja de dar señales de vida (ni progreso ni cambio de estado)
// durante este tiempo, se considera colgado: mejor avisar que dejar el botón
// "Renderizando…" girando indefinidamente sin que el usuario pueda reaccionar.
const RENDER_TIMELINE_STALL_TIMEOUT_MS = 10 * 60 * 1000;
// Estar en cola no es falta de actividad: con un único worker puede ser
// legítimo esperar a que termine una exportación larga anterior.
const RENDER_TIMELINE_QUEUE_STALL_TIMEOUT_MS = 30 * 60 * 1000;
// Un corte de red puntual no debe tirar una exportación que sigue viva en el
// servidor: se reintenta el sondeo unas cuantas veces antes de rendirse.
const RENDER_TIMELINE_MAX_POLL_FAILURES = 5;
const RENDER_TIMELINE_MAX_SUBMIT_FAILURES = 8;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes} min ${seconds}s` : `${seconds}s`;
}

function isTransientRenderHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function renderHttpError(status: number, message: string): TimelineRenderError {
  return new TimelineRenderError(message, {
    status,
    terminal: status >= 400 && !isTransientRenderHttpStatus(status)
  });
}

function waitForRenderRetry(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Operación cancelada.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException('Operación cancelada.', 'AbortError'));
    };
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, RENDER_TIMELINE_RETRY_DELAY_MS);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function resumeTimelineRender(
  jobId: string,
  token: AuthToken,
  onProgress?: (progress: number, statusMessage: string) => void,
  signal?: AbortSignal,
  initialUpdatedAt = 0
): Promise<RenderTimelineResponse> {
  const startedAt = Date.now();
  let lastActivityAt = startedAt;
  let lastSignature = '';
  let consecutiveFailures = 0;
  let lastUpdatedAt = Number.isFinite(initialUpdatedAt) && initialUpdatedAt > 0 ? initialUpdatedAt : 0;
  // Compatibilidad durante un despliegue gradual: el servidor anterior no
  // devuelve updatedAt ni entiende long polling. En ese caso conservamos el
  // intervalo clásico para no crear un bucle de peticiones inmediato.
  let supportsLongPolling = lastUpdatedAt > 0;

  for (;;) {
    let statusData: Partial<RenderTimelineJobStatus> & { error?: string };
    try {
      const query = new URLSearchParams({ wait: String(RENDER_TIMELINE_LONG_POLL_MS) });
      if (lastUpdatedAt > 0) query.set('after', String(lastUpdatedAt));
      const statusResponse = await fetch(`/api/render-timeline/${encodeURIComponent(jobId)}?${query}`, {
        headers: { Authorization: `Bearer ${await resolveAuthToken(token)}` },
        cache: 'no-store',
        signal
      });
      statusData = (await statusResponse.json().catch(() => ({}))) as Partial<RenderTimelineJobStatus> & { error?: string };
      if (!statusResponse.ok) {
        throw renderHttpError(statusResponse.status, statusData.error || 'No se pudo recuperar la exportación.');
      }
      const responseUpdatedAt = Number(statusData.updatedAt);
      if (Number.isFinite(responseUpdatedAt) && responseUpdatedAt > 0) {
        lastUpdatedAt = responseUpdatedAt;
        supportsLongPolling = true;
      }
      consecutiveFailures = 0;
    } catch (reason) {
      if (signal?.aborted) throw reason;
      const transient = reason instanceof TypeError
        || (reason instanceof TimelineRenderError && !reason.terminal);
      if (transient && ++consecutiveFailures <= RENDER_TIMELINE_MAX_POLL_FAILURES) {
        onProgress?.(-1, 'Se perdió la conexión; reintentando…');
        await waitForRenderRetry(signal);
        continue;
      }
      throw reason;
    }

    const signature = `${statusData.phase || ''}|${statusData.progress ?? 0}|${statusData.statusMessage || ''}`;
    if (signature !== lastSignature) {
      lastSignature = signature;
      lastActivityAt = Date.now();
    }

    const progress = statusData.progress ?? 0;
    const elapsed = Date.now() - startedAt;
    const baseMessage = statusData.statusMessage || `Renderizando… ${progress}%`;
    onProgress?.(progress, `${baseMessage} · ${formatElapsed(elapsed)}`);

    if (statusData.phase === 'completed') {
      if (!statusData.videoUrl) {
        throw new TimelineRenderError('La exportación terminó sin un archivo de vídeo válido.', { terminal: true });
      }
      return {
        videoUrl: statusData.videoUrl,
        videoDownloadUrl: statusData.videoDownloadUrl,
        videoStorageKey: statusData.videoStorageKey,
        duration: statusData.duration || 0,
        coverUrl: statusData.coverUrl,
        coverStorageKey: statusData.coverStorageKey
      };
    }
    if (['error', 'cancelled', 'cancelado'].includes(statusData.phase || '')) {
      throw new TimelineRenderError(
        statusData.error || (statusData.phase === 'error' ? 'No se pudo exportar el vídeo.' : 'La exportación se canceló.'),
        { terminal: true }
      );
    }
    const stallTimeout = statusData.phase === 'queued'
      ? RENDER_TIMELINE_QUEUE_STALL_TIMEOUT_MS
      : RENDER_TIMELINE_STALL_TIMEOUT_MS;
    if (Date.now() - lastActivityAt > stallTimeout) {
      // Se conserva el pendiente: el trabajo puede seguir vivo aunque haya
      // dejado de publicar avances temporalmente.
      throw new TimelineRenderError(
        `La exportación no informa de avances desde hace ${formatElapsed(stallTimeout)}. Se conservará para reanudarla.`,
        { terminal: false }
      );
    }
    if (!supportsLongPolling) await waitForRenderRetry(signal);
  }
}

export async function submitTimelineRender(
  payload: RenderTimelinePayload,
  // Se admite una función además de un string: los tokens de Firebase caducan
  // a la hora y un render largo se quedaba a medias con un 401. Pidiendo el
  // token en cada sondeo, el SDK lo renueva solo cuando hace falta.
  token: AuthToken,
  onProgress?: (progress: number, statusMessage: string) => void,
  onJobStarted?: (jobId: string) => void | Promise<void>,
  signal?: AbortSignal
): Promise<RenderTimelineResponse> {
  let failures = 0;
  for (;;) {
    try {
      const response = await fetch('/api/render-timeline', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await resolveAuthToken(token)}`
        },
        body: JSON.stringify(payload),
        signal
      });
      const data = (await response.json().catch(() => ({}))) as Partial<RenderTimelineJobStatus> & { error?: string };
      if (!response.ok) throw renderHttpError(response.status, data.error || 'No se pudo exportar el vídeo.');
      const jobId = data.jobId;
      if (!jobId) {
        throw new TimelineRenderError(
          'El servidor aceptó la exportación, pero no devolvió su identificador.',
          { terminal: false }
        );
      }
      await onJobStarted?.(jobId);
      return resumeTimelineRender(jobId, token, onProgress, signal, Number(data.updatedAt) || 0);
    } catch (reason) {
      if (signal?.aborted) throw reason;
      const transient = reason instanceof TypeError
        || (reason instanceof TimelineRenderError && !reason.terminal);
      if (!transient || ++failures > RENDER_TIMELINE_MAX_SUBMIT_FAILURES) throw reason;
      onProgress?.(-1, 'No se pudo confirmar el inicio; reenviando la misma exportación sin duplicarla…');
      await waitForRenderRetry(signal);
    }
  }
}

export async function cancelTimelineRender(jobId: string, token: AuthToken): Promise<void> {
  const response = await fetch(`/api/render-timeline/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${await resolveAuthToken(token)}` }
  });
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw renderHttpError(response.status, data.error || 'No se pudo cancelar la exportación.');
}

export async function lookupJobByClientRequestId(
  clientRequestId: string,
  token: AuthToken,
  signal?: AbortSignal
): Promise<ClientRequestJobStatus | null> {
  const response = await fetch(`/api/jobs/by-client-request/${encodeURIComponent(clientRequestId)}`, {
    headers: { Authorization: `Bearer ${await resolveAuthToken(token)}` },
    cache: 'no-store',
    signal
  });
  const data = await response.json().catch(() => ({})) as Partial<ClientRequestJobStatus> & { error?: string };
  if (response.status === 404) return null;
  if (!response.ok) throw renderHttpError(response.status, data.error || 'No se pudo recuperar la exportación pendiente.');
  if (!data.jobId) throw new TimelineRenderError('El servidor no devolvió el trabajo asociado a la solicitud.', { terminal: false });
  return data as ClientRequestJobStatus;
}

export async function cancelTimelineRenderByClientRequestId(
  clientRequestId: string,
  token: AuthToken
): Promise<void> {
  const response = await fetch(`/api/jobs/by-client-request/${encodeURIComponent(clientRequestId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${await resolveAuthToken(token)}` }
  });
  const data = await response.json().catch(() => ({})) as { error?: string };
  // El 404 es una confirmación terminal: el POST nunca llegó a crear un job.
  if (response.status === 404) return;
  if (!response.ok) throw renderHttpError(response.status, data.error || 'No se pudo cancelar la exportación.');
}

export interface TranscribeMediaWord {
  text: string;
  start: number;
  end: number;
}

export async function transcribeMedia(source: string, token: string, storageKey = ''): Promise<TranscribeMediaWord[]> {
  const response = await fetch('/api/transcribe-media', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ source, ...(storageKey ? { storageKey } : {}) })
  });
  const data = (await response.json().catch(() => ({}))) as { words?: TranscribeMediaWord[]; error?: string };
  if (!response.ok) throw new Error(data.error || 'No se pudo transcribir el vídeo.');
  return Array.isArray(data.words) ? data.words : [];
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado.'));
    reader.readAsDataURL(file);
  });
}

export async function uploadEditorMedia(file: File, token: string, duration = 0, imageAsVideo = false): Promise<EditorMediaResponse> {
  const data = await fileToDataUrl(file);
  const response = await fetch('/api/editor-media', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ name: file.name, data, duration, imageAsVideo })
  });
  const result = (await response.json().catch(() => ({}))) as Partial<EditorMediaResponse> & { error?: string };
  if (!response.ok) throw new Error(result.error || 'No se pudo subir el archivo al proyecto.');
  return result as EditorMediaResponse;
}

export async function convertImageAssetToVideo(
  sourceUrl: string,
  name: string,
  token: string,
  duration = 5,
  storageKey = ''
): Promise<EditorMediaResponse> {
  const response = await fetch('/api/editor-media', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ name, sourceUrl, duration, ...(storageKey ? { sourceStorageKey: storageKey } : {}) })
  });
  const result = (await response.json().catch(() => ({}))) as Partial<EditorMediaResponse> & { error?: string };
  if (!response.ok) throw new Error(result.error || 'No se pudo añadir la imagen a la línea de tiempo.');
  return result as EditorMediaResponse;
}

// Función 5 — Tracking automático de texto/sticker.
export interface TrackRegionPoint {
  timeMs: number;
  x: number;
  y: number;
}

export interface TrackRegionPayload {
  sourceUrl: string;
  storageKey?: string;
  sourceIn: number;
  sourceOut: number;
  regionX: number;
  regionY: number;
  regionWidth: number;
  regionHeight: number;
}

export async function trackRegion(payload: TrackRegionPayload, token: AuthToken): Promise<TrackRegionPoint[]> {
  const response = await fetch('/api/timeline/track-region', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await resolveAuthToken(token)}`
    },
    body: JSON.stringify(payload)
  });
  const data = (await response.json().catch(() => ({}))) as { points?: TrackRegionPoint[]; error?: string };
  if (!response.ok) throw new Error(data.error || 'No se pudo completar el seguimiento automático.');
  return Array.isArray(data.points) ? data.points : [];
}
