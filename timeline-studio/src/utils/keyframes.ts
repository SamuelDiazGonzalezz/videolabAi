import type { Keyframe, KeyframeEasing } from '../types/timeline';

// Función 1 — Keyframes simples de transformación.
//
// Esta interpolación es la ÚNICA fuente de verdad para cómo se anima un
// elemento entre dos keyframes, y la usa el preview del editor (aquí,
// directamente) tal cual. El servidor NO puede importar este archivo TS
// (server.js es Node plano, sin bundler) así que su generador de expresiones
// de FFmpeg para el export (`timeline-keyframes.js`, en la raíz del repo)
// reimplementa la MISMA fórmula matemática a propósito — ver el comentario
// en ese archivo. Si cambias el easing o la interpolación aquí, replica el
// cambio allí (hay tests a los dos lados: este archivo vía Vitest,
// timeline-keyframes.js vía timeline-keyframes.test.js en la raíz).

export interface KeyframeTransform {
  x: number;
  y: number;
  scale: number;
  opacity: number;
  rotation: number;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Progreso "suavizado" (0–1) de un tramo entre dos keyframes, según el
 * easing del keyframe de PARTIDA de ese tramo. Curvas cuadráticas simples
 * (no Bézier) a propósito: el brief pide una lista cerrada de 4 opciones,
 * no un editor visual de curvas.
 */
export function easeProgress(rawProgress: number, easing: KeyframeEasing): number {
  const progress = clamp01(rawProgress);
  switch (easing) {
    case 'ease-in':
      return progress * progress;
    case 'ease-out':
      return 1 - (1 - progress) * (1 - progress);
    case 'ease-in-out':
      return progress < 0.5
        ? 2 * progress * progress
        : 1 - ((-2 * progress + 2) ** 2) / 2;
    case 'linear':
    default:
      return progress;
  }
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

export function sortKeyframes(keyframes: Keyframe[]): Keyframe[] {
  return [...keyframes].sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * Interpola x/y/scale/opacity/rotation en `timeMs` (relativo al inicio del
 * clip, en milisegundos) a partir de su lista de keyframes.
 *
 * - Sin keyframes (o solo uno): devuelve `null` — el elemento debe seguir
 *   usando sus campos estáticos habituales (x/y/scale/opacity del propio
 *   TextClip/BrollClip), sin animación.
 * - Antes del primer keyframe / después del último: se mantiene fijo en el
 *   valor de ese extremo (sin extrapolar).
 */
export function interpolateKeyframes(
  keyframes: Keyframe[] | undefined,
  timeMs: number
): KeyframeTransform | null {
  if (!keyframes || keyframes.length < 2) return null;
  const ordered = sortKeyframes(keyframes);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  if (timeMs <= first.timeMs) return pickTransform(first);
  if (timeMs >= last.timeMs) return pickTransform(last);

  for (let index = 1; index < ordered.length; index += 1) {
    const to = ordered[index];
    if (timeMs > to.timeMs) continue;
    const from = ordered[index - 1];
    const span = Math.max(1, to.timeMs - from.timeMs);
    const progress = easeProgress((timeMs - from.timeMs) / span, from.easing);
    return {
      x: lerp(from.x, to.x, progress),
      y: lerp(from.y, to.y, progress),
      scale: lerp(from.scale, to.scale, progress),
      opacity: lerp(from.opacity, to.opacity, progress),
      rotation: lerp(from.rotation, to.rotation, progress)
    };
  }
  // Inalcanzable en la práctica (ya se cubrieron los extremos arriba).
  return pickTransform(last);
}

function pickTransform(keyframe: Keyframe): KeyframeTransform {
  return {
    x: keyframe.x,
    y: keyframe.y,
    scale: keyframe.scale,
    opacity: keyframe.opacity,
    rotation: keyframe.rotation
  };
}

export function createKeyframeId(): string {
  return `kf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
