import type { Keyframe, TextAnimationPreset, TextClip } from '../types/timeline';
import {
  DEFAULT_TEXT_ANIMATION_DURATION_MS,
  MAX_TEXT_ANIMATION_DURATION_MS,
  MIN_TEXT_ANIMATION_DURATION_MS
} from '../constants/textAnimations';
import { clamp01, interpolateKeyframes, type KeyframeTransform } from './keyframes';

const MAX_EFFECTIVE_KEYFRAMES = 40;
const PHASE_SAMPLE_STEPS = 8;
const MANUAL_EASING_SAMPLE_STEPS = 8;

export interface TextAnimationDurations {
  entranceMs: number;
  exitMs: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function numericDuration(value: number): number {
  return clamp(
    Number.isFinite(value) ? value : DEFAULT_TEXT_ANIMATION_DURATION_MS,
    MIN_TEXT_ANIMATION_DURATION_MS,
    MAX_TEXT_ANIMATION_DURATION_MS
  );
}

export function fitTextAnimationDurations(clip: TextClip): TextAnimationDurations {
  const clipDurationMs = Math.max(1, (clip.endTime - clip.startTime) * 1000);
  let entranceMs = clip.entranceAnimation === 'none' ? 0 : numericDuration(clip.entranceDurationMs);
  let exitMs = clip.exitAnimation === 'none' ? 0 : numericDuration(clip.exitDurationMs);
  const requested = entranceMs + exitMs;
  if (requested > clipDurationMs) {
    const factor = clipDurationMs / requested;
    entranceMs *= factor;
    exitMs *= factor;
  }
  return { entranceMs, exitMs };
}

export function isTextAnimationInProgress(clip: TextClip, timeMs: number): boolean {
  const clipDurationMs = Math.max(1, (clip.endTime - clip.startTime) * 1000);
  const durations = fitTextAnimationDurations(clip);
  return (durations.entranceMs > 0 && timeMs < durations.entranceMs)
    || (durations.exitMs > 0 && timeMs > clipDurationMs - durations.exitMs);
}

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

function easeOutBack(progress: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (progress - 1) ** 3 + c1 * (progress - 1) ** 2;
}

function easeOutBounce(progress: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (progress < 1 / d1) return n1 * progress * progress;
  if (progress < 2 / d1) {
    const shifted = progress - 1.5 / d1;
    return n1 * shifted * shifted + 0.75;
  }
  if (progress < 2.5 / d1) {
    const shifted = progress - 2.25 / d1;
    return n1 * shifted * shifted + 0.9375;
  }
  const shifted = progress - 2.625 / d1;
  return n1 * shifted * shifted + 0.984375;
}

function smoothstep(progress: number): number {
  const value = clamp01(progress);
  return value * value * (3 - 2 * value);
}

function baseTransformAt(clip: TextClip, timeMs: number): KeyframeTransform {
  return interpolateKeyframes(clip.keyframes, timeMs) || {
    x: clip.x,
    y: clip.y,
    scale: clip.scale,
    opacity: 1,
    rotation: 0
  };
}

function applyPreset(
  preset: TextAnimationPreset,
  visibleProgress: number,
  base: KeyframeTransform
): KeyframeTransform {
  const progress = clamp01(visibleProgress);
  if (preset === 'none' || progress >= 1) return base;

  const opacity = base.opacity * smoothstep(Math.min(1, progress * 1.8));
  if (preset === 'fade') return { ...base, opacity: base.opacity * smoothstep(progress) };

  if (preset === 'pop') {
    const eased = easeOutBack(progress);
    return { ...base, scale: base.scale * (0.42 + 0.58 * eased), opacity };
  }

  if (preset === 'bounce') {
    const bounced = easeOutBounce(progress);
    const targetY = 1.2;
    return {
      ...base,
      y: targetY + (base.y - targetY) * bounced,
      scale: base.scale * (0.72 + 0.28 * easeOutBack(progress)),
      opacity
    };
  }

  if (preset === 'spin') {
    const eased = easeOutBack(progress);
    return {
      ...base,
      scale: base.scale * (0.48 + 0.52 * eased),
      rotation: base.rotation - 180 * (1 - easeOutCubic(progress)),
      opacity
    };
  }

  const eased = easeOutCubic(progress);
  const target = preset === 'slide-left'
    ? { x: -0.5, y: base.y }
    : preset === 'slide-right'
      ? { x: 1.5, y: base.y }
      : preset === 'slide-up'
        ? { x: base.x, y: -0.5 }
        : { x: base.x, y: 1.5 };
  return {
    ...base,
    x: target.x + (base.x - target.x) * eased,
    y: target.y + (base.y - target.y) * eased,
    opacity
  };
}

function presetTransformAt(clip: TextClip, timeMs: number, durations: TextAnimationDurations): KeyframeTransform {
  const clipDurationMs = Math.max(1, (clip.endTime - clip.startTime) * 1000);
  const clampedTime = clamp(timeMs, 0, clipDurationMs);
  const base = baseTransformAt(clip, clampedTime);
  if (durations.entranceMs > 0 && clampedTime < durations.entranceMs) {
    return applyPreset(clip.entranceAnimation, clampedTime / durations.entranceMs, base);
  }
  const exitStartMs = clipDurationMs - durations.exitMs;
  if (durations.exitMs > 0 && clampedTime > exitStartMs) {
    return applyPreset(clip.exitAnimation, (clipDurationMs - clampedTime) / durations.exitMs, base);
  }
  return base;
}

function phaseSampleTimes(startMs: number, durationMs: number): number[] {
  if (durationMs <= 0) return [];
  return Array.from({ length: PHASE_SAMPLE_STEPS + 1 }, (_, index) => (
    Math.round(startMs + durationMs * index / PHASE_SAMPLE_STEPS)
  ));
}

function uniqueSortedTimes(times: number[]): number[] {
  return [...new Set(times)].sort((a, b) => a - b);
}

function sampleTimes(times: number[], limit: number): number[] {
  if (limit <= 0) return [];
  if (times.length <= limit) return times;
  if (limit === 1) return [times[Math.floor(times.length / 2)]];
  return Array.from({ length: limit }, (_, index) => (
    times[Math.round(index * (times.length - 1) / (limit - 1))]
  ));
}

function manualEasingSampleTimes(keyframes: Keyframe[] | undefined, clipDurationMs: number): number[] {
  if (!keyframes || keyframes.length < 2) return [];
  const ordered = [...keyframes].sort((a, b) => a.timeMs - b.timeMs);
  const samples: number[] = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const from = ordered[index];
    const to = ordered[index + 1];
    // Los keyframes compilados son lineales para que FFmpeg y el preview
    // compartan exactamente la misma trayectoria. En los tramos manuales
    // curvos evaluamos primero el easing original y lo aproximamos con
    // muestras intermedias; así no se convierte accidentalmente en lineal.
    if (!from.easing || from.easing === 'linear') continue;
    const startMs = clamp(from.timeMs, 0, clipDurationMs);
    const endMs = clamp(to.timeMs, 0, clipDurationMs);
    if (endMs <= startMs) continue;
    for (let step = 1; step < MANUAL_EASING_SAMPLE_STEPS; step += 1) {
      samples.push(Math.round(startMs + (endMs - startMs) * step / MANUAL_EASING_SAMPLE_STEPS));
    }
  }
  return samples;
}

function selectEffectiveTimes(requiredTimes: number[], priorityTimes: number[], optionalTimes: number[]): number[] {
  const required = uniqueSortedTimes(requiredTimes).slice(0, MAX_EFFECTIVE_KEYFRAMES);
  const requiredSet = new Set(required);
  const priority = uniqueSortedTimes(priorityTimes).filter((time) => !requiredSet.has(time));
  const selectedPriority = sampleTimes(priority, MAX_EFFECTIVE_KEYFRAMES - required.length);
  const selectedSet = new Set([...required, ...selectedPriority]);
  const optional = uniqueSortedTimes(optionalTimes).filter((time) => !selectedSet.has(time));
  const selectedOptional = sampleTimes(optional, MAX_EFFECTIVE_KEYFRAMES - selectedSet.size);
  return uniqueSortedTimes([...selectedSet, ...selectedOptional]);
}

/**
 * Compila los presets semánticos de entrada/salida a los keyframes que ya
 * comparten el preview y FFmpeg. Los keyframes manuales se usan como base, de
 * modo que una entrada preparada puede convivir con tracking o movimiento.
 */
export function resolveTextAnimationKeyframes(clip: TextClip): Keyframe[] | undefined {
  const hasEntrance = clip.entranceAnimation !== 'none';
  const hasExit = clip.exitAnimation !== 'none';
  if (!hasEntrance && !hasExit) return clip.keyframes;

  const clipDurationMs = Math.max(1, Math.round((clip.endTime - clip.startTime) * 1000));
  const durations = fitTextAnimationDurations(clip);
  const requiredTimes = [
    ...phaseSampleTimes(0, durations.entranceMs),
    ...phaseSampleTimes(clipDurationMs - durations.exitMs, durations.exitMs),
    0,
    clipDurationMs
  ].map((time) => clamp(Math.round(time), 0, clipDurationMs));
  const manualTimes = (clip.keyframes || []).map((keyframe) => clamp(Math.round(keyframe.timeMs), 0, clipDurationMs));
  const manualEasingTimes = manualEasingSampleTimes(clip.keyframes, clipDurationMs);
  return selectEffectiveTimes(requiredTimes, manualTimes, manualEasingTimes).map((timeMs) => ({
    id: `text-animation-${clip.id}-${timeMs}`,
    timeMs,
    ...presetTransformAt(clip, timeMs, durations),
    easing: 'linear'
  }));
}

/**
 * Convierte una escala absoluta del editor en el multiplicador de la capa
 * rasterizada a la escala estática del clip. Preview y export usan esta misma
 * relación para que animar no cambie ni la tipografía ni el wrapping base.
 */
export function resolveTextLayerScale(animatedScale: number, staticScale: number): number {
  const baseScale = Number.isFinite(staticScale) && staticScale > 0 ? staticScale : 1;
  const resolvedScale = Number.isFinite(animatedScale) ? animatedScale : baseScale;
  return resolvedScale / baseScale;
}

/** Keyframes listos para FFmpeg, cuya escala es relativa al PNG base. */
export function resolveTextAnimationExportKeyframes(clip: TextClip): Keyframe[] | undefined {
  const keyframes = resolveTextAnimationKeyframes(clip);
  if (!keyframes) return undefined;
  return keyframes.map((keyframe) => ({
    ...keyframe,
    scale: resolveTextLayerScale(keyframe.scale, clip.scale)
  }));
}

export function resolveTextPreviewTransform(clip: TextClip, timeMs: number): KeyframeTransform {
  return interpolateKeyframes(resolveTextAnimationKeyframes(clip), timeMs) || baseTransformAt(clip, timeMs);
}
