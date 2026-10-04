// Extrae la storageKey de R2 de una URL firmada, si lo es — misma lógica que
// ya usa main.tsx para reintentar imágenes/vídeo/audio rotos vía el proxy
// del propio servidor (`/api/r2/objects?proxy=1`) cuando la URL firmada
// falla (caducada, o bloqueada por CORS). Se extrae aquí como utilidad
// compartida porque WaveSurfer (AudioTrackView/MusicTrackView) necesita el
// mismo fallback: a diferencia de un <img>/<video>/<audio> normal, cuando
// WaveSurfer no puede descargar+decodificar el audio para dibujar la forma
// de onda NO dispara un evento `error` del DOM (el listener global de
// main.tsx nunca lo ve) — dispara su PROPIO evento `error` en la instancia,
// que hay que capturar y reintentar aparte.
export function extractR2StorageKey(value: string): string {
  try {
    const url = new URL(value);
    if (!url.hostname.toLowerCase().endsWith('.r2.cloudflarestorage.com')) return '';
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    return /^users\/[^/]+\/.+/.test(key) && !key.includes('..') ? key.slice(0, 300) : '';
  } catch {
    return '';
  }
}

type MinimalWaveSurfer = { load: (url: string) => Promise<void> };

/**
 * Reintenta cargar la forma de onda a través del proxy propio del servidor
 * cuando WaveSurfer no puede descargar+decodificar la URL firmada de R2
 * directamente (caducada o bloqueada por CORS al pedirla por `fetch`, algo
 * que un `<audio>`/`<video>` normal no sufre para la reproducción básica,
 * por eso este caso no lo cubre el fallback global de main.tsx). Como mucho
 * un reintento: si el proxy también falla, se deja tal cual (evita un bucle).
 */
export function createWaveformErrorFallback(
  wave: MinimalWaveSurfer,
  source: string,
  resolveProxyUrl: (storageKey: string) => Promise<string>
): () => void {
  let retried = false;
  return () => {
    if (retried) return;
    retried = true;
    const key = extractR2StorageKey(source);
    if (!key) return;
    resolveProxyUrl(key).then((proxyUrl) => {
      if (proxyUrl) void wave.load(proxyUrl);
    }).catch(() => undefined);
  };
}
