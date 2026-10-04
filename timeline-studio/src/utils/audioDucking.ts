// Función 6 — Editor de audio por capas con ducking automático.
//
// La automatización de volumen de la pista de música (fade in/out +
// ducking manual) se expresa como una lista de puntos {timeMs, volume} —
// el mismo espíritu que los keyframes de la Función 1, pero en 1D y solo
// lineal (el brief no pide easing para audio, y una curva de volumen
// lineal es lo habitual en cualquier editor). Esta construcción de puntos
// es la ÚNICA fuente de verdad para el preview (aquí, evaluada en directo
// sobre el elemento <audio>) y para el export — el generador de expresión
// de FFmpeg (timeline-audio-ducking.js, en la raíz) reimplementa esta
// MISMA función a propósito, siguiendo el mismo patrón de duplicación
// documentado que ya usa timeline-keyframes.js (ver comentario allí).

export interface VolumePoint {
  timeMs: number;
  volume: number;
}

export interface DuckingRegion {
  id: string;
  startTime: number;
  endTime: number;
}

export interface VolumeEnvelopeOptions {
  durationMs: number;
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
  duckingEnabled: boolean;
  duckingAmount: number;
  /** Regiones en tiempo ABSOLUTO del proyecto (como se guardan) — se convierten aquí a relativas al inicio del clip de música. */
  duckingRegions: DuckingRegion[];
  musicStartTime: number;
  /** Rampa de bajada/subida del ducking, en ms — evita un salto brusco de volumen. */
  rampMs?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function buildVolumeEnvelope(options: VolumeEnvelopeOptions): VolumePoint[] {
  const durationMs = Math.max(1, options.durationMs);
  const baseVolume = clamp(options.volume, 0, 1);
  const fadeInMs = clamp(options.fadeInMs, 0, durationMs / 2);
  const fadeOutMs = clamp(options.fadeOutMs, 0, durationMs / 2);
  const ramp = clamp(options.rampMs ?? 200, 20, 2000);

  const points: VolumePoint[] = [{ timeMs: 0, volume: fadeInMs > 0 ? 0 : baseVolume }];
  if (fadeInMs > 0) points.push({ timeMs: fadeInMs, volume: baseVolume });

  if (options.duckingEnabled && options.duckingAmount > 0) {
    const duckedVolume = baseVolume * (1 - clamp(options.duckingAmount, 0, 1));
    const regions = [...options.duckingRegions]
      .map((region) => ({
        start: clamp(region.startTime - options.musicStartTime, 0, durationMs / 1000) * 1000,
        end: clamp(region.endTime - options.musicStartTime, 0, durationMs / 1000) * 1000
      }))
      .filter((region) => region.end > region.start)
      .sort((a, b) => a.start - b.start);

    for (const region of regions) {
      points.push({ timeMs: clamp(region.start - ramp, 0, durationMs), volume: baseVolume });
      points.push({ timeMs: clamp(region.start, 0, durationMs), volume: duckedVolume });
      points.push({ timeMs: clamp(region.end, 0, durationMs), volume: duckedVolume });
      points.push({ timeMs: clamp(region.end + ramp, 0, durationMs), volume: baseVolume });
    }
  }

  if (fadeOutMs > 0) points.push({ timeMs: durationMs - fadeOutMs, volume: baseVolume });
  points.push({ timeMs: durationMs, volume: fadeOutMs > 0 ? 0 : baseVolume });

  // Puntos ordenados y sin retrocesos de tiempo (un ducking cerca de un
  // borde con fade puede generar timeMs fuera de orden o duplicados; se
  // resuelve quedándose con el orden temporal y dejando que valores
  // repetidos en el mismo instante los resuelva simplemente el último).
  return points
    .sort((a, b) => a.timeMs - b.timeMs)
    .map((point) => ({ timeMs: clamp(point.timeMs, 0, durationMs), volume: clamp(point.volume, 0, 1) }));
}

export function evaluateVolumeEnvelope(points: VolumePoint[], timeMs: number): number {
  if (!points.length) return 1;
  if (points.length === 1) return points[0].volume;
  const first = points[0];
  const last = points[points.length - 1];
  if (timeMs <= first.timeMs) return first.volume;
  if (timeMs >= last.timeMs) return last.volume;
  for (let index = 1; index < points.length; index += 1) {
    const to = points[index];
    if (timeMs > to.timeMs) continue;
    const from = points[index - 1];
    const span = Math.max(1, to.timeMs - from.timeMs);
    const progress = (timeMs - from.timeMs) / span;
    return from.volume + (to.volume - from.volume) * progress;
  }
  return last.volume;
}
