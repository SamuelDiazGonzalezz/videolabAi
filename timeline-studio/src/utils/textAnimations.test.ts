import { describe, expect, it } from 'vitest';
import type { TextAnimationPreset, TextClip } from '../types/timeline';
import { interpolateKeyframes } from './keyframes';
import { buildTimeline } from './timeline';
import {
  fitTextAnimationDurations,
  resolveTextAnimationExportKeyframes,
  resolveTextAnimationKeyframes,
  resolveTextLayerScale,
  resolveTextPreviewTransform
} from './textAnimations';

function textClip(changes: Partial<TextClip> = {}): TextClip {
  return {
    id: 'text-1',
    kind: 'text',
    text: 'Una frase',
    startTime: 3,
    endTime: 5,
    style: 'outline',
    font: 'modern',
    position: 'center',
    size: 'medium',
    color: 'blanco',
    x: 0.5,
    y: 0.5,
    width: 0.72,
    scale: 1,
    preset: 'none',
    wordEffect: 'karaoke',
    entranceAnimation: 'none',
    entranceDurationMs: 500,
    exitAnimation: 'none',
    exitDurationMs: 500,
    ...changes
  };
}

describe('presets de animación de texto', () => {
  it('conserva los keyframes manuales cuando no hay presets', () => {
    const keyframes = [
      { id: 'a', timeMs: 0, x: .2, y: .5, scale: 1, opacity: 1, rotation: 0, easing: 'linear' as const },
      { id: 'b', timeMs: 2000, x: .8, y: .5, scale: 1, opacity: 1, rotation: 0, easing: 'linear' as const }
    ];
    expect(resolveTextAnimationKeyframes(textClip({ keyframes }))).toBe(keyframes);
  });

  it.each([
    ['slide-left', 'x', -0.5],
    ['slide-right', 'x', 1.5],
    ['slide-up', 'y', -0.5],
    ['slide-down', 'y', 1.5]
  ] as const)('empieza completamente fuera del lienzo con %s', (preset, axis, expected) => {
    const clip = textClip({ entranceAnimation: preset });
    const first = resolveTextAnimationKeyframes(clip)![0];
    expect(first[axis]).toBe(expected);
    expect(first.opacity).toBe(0);
    const settled = resolveTextPreviewTransform(clip, 500);
    expect(settled.x).toBeCloseTo(clip.x, 5);
    expect(settled.y).toBeCloseTo(clip.y, 5);
    expect(settled.opacity).toBeCloseTo(1, 5);
  });

  it.each([
    ['fade', 'opacity', 0],
    ['pop', 'scale', 0.42],
    ['bounce', 'y', 1.2],
    ['spin', 'rotation', -180]
  ] as Array<[TextAnimationPreset, 'opacity' | 'scale' | 'y' | 'rotation', number]>)('genera una entrada %s reconocible', (preset, property, expected) => {
    const first = resolveTextAnimationKeyframes(textClip({ entranceAnimation: preset }))![0];
    expect(first[property]).toBeCloseTo(expected, 5);
  });

  it('aplica la salida al final sin alterar el tramo estable', () => {
    const clip = textClip({ exitAnimation: 'slide-up', exitDurationMs: 400 });
    expect(resolveTextPreviewTransform(clip, 1000)).toMatchObject({ x: .5, y: .5, opacity: 1 });
    const keyframes = resolveTextAnimationKeyframes(clip)!;
    const last = keyframes[keyframes.length - 1];
    expect(last.timeMs).toBe(2000);
    expect(last.y).toBe(-0.5);
    expect(last.opacity).toBe(0);
  });

  it('reduce proporcionalmente entrada y salida en una frase corta', () => {
    const clip = textClip({
      startTime: 0,
      endTime: .3,
      entranceAnimation: 'bounce',
      exitAnimation: 'fade',
      entranceDurationMs: 500,
      exitDurationMs: 500
    });
    const durations = fitTextAnimationDurations(clip);
    expect(durations.entranceMs).toBeCloseTo(150, 5);
    expect(durations.exitMs).toBeCloseTo(150, 5);
    const keyframes = resolveTextAnimationKeyframes(clip)!;
    expect(keyframes[keyframes.length - 1].timeMs).toBe(300);
  });

  it('compone un preset con la trayectoria manual y respeta el límite del servidor', () => {
    const keyframes = Array.from({ length: 55 }, (_, index) => ({
      id: `manual-${index}`,
      timeMs: index * 2000 / 54,
      x: .2 + .6 * index / 54,
      y: .5,
      scale: 1,
      opacity: 1,
      rotation: 0,
      easing: 'linear' as const
    }));
    const clip = textClip({ keyframes, entranceAnimation: 'fade', exitAnimation: 'pop' });
    const effective = resolveTextAnimationKeyframes(clip)!;
    expect(effective.length).toBeLessThanOrEqual(40);
    expect(effective[0].opacity).toBe(0);
    expect(effective[effective.length - 1].opacity).toBe(0);
    expect(resolveTextPreviewTransform(clip, 1000).x).toBeCloseTo(.5, 2);
  });

  it.each([.5, 2])('mantiene escala y wrapping base con clip.scale=%s en preview y export', (staticScale) => {
    (['fade', 'slide-left', 'pop'] as TextAnimationPreset[]).forEach((entranceAnimation) => {
      const clip = textClip({ scale: staticScale, entranceAnimation });
      const previewKeyframes = resolveTextAnimationKeyframes(clip)!;
      const exportKeyframes = resolveTextAnimationExportKeyframes(clip)!;

      expect(exportKeyframes).toHaveLength(previewKeyframes.length);
      previewKeyframes.forEach((keyframe, index) => {
        expect(exportKeyframes[index]).toMatchObject({
          timeMs: keyframe.timeMs,
          x: keyframe.x,
          y: keyframe.y,
          opacity: keyframe.opacity,
          rotation: keyframe.rotation
        });
        expect(exportKeyframes[index].scale).toBeCloseTo(
          resolveTextLayerScale(keyframe.scale, staticScale),
          10
        );
      });

      const previewStart = resolveTextPreviewTransform(clip, 0);
      const exportStart = interpolateKeyframes(exportKeyframes, 0)!;
      expect(exportStart.scale).toBeCloseTo(previewStart.scale / staticScale, 10);
      expect(exportStart.scale).toBeCloseTo(entranceAnimation === 'pop' ? .42 : 1, 10);
      expect(resolveTextPreviewTransform(clip, 500).scale).toBeCloseTo(staticScale, 10);
      expect(interpolateKeyframes(exportKeyframes, 500)!.scale).toBeCloseTo(1, 10);
    });
  });

  it.each(['ease-in', 'ease-out'] as const)('conserva la trayectoria manual %s al componer presets', (easing) => {
    const keyframes = [
      { id: 'a', timeMs: 0, x: .2, y: .3, scale: .75, opacity: .4, rotation: -20, easing },
      { id: 'b', timeMs: 2000, x: .8, y: .7, scale: 1.75, opacity: 1, rotation: 60, easing: 'linear' as const }
    ];
    const clip = textClip({ keyframes, entranceAnimation: 'fade' });
    const effective = resolveTextAnimationKeyframes(clip)!;

    expect(effective.length).toBeLessThanOrEqual(40);
    expect(effective.every((keyframe) => keyframe.easing === 'linear')).toBe(true);
    [750, 1000, 1250, 1500, 1750].forEach((timeMs) => {
      const expected = interpolateKeyframes(keyframes, timeMs)!;
      const actual = resolveTextPreviewTransform(clip, timeMs);
      expect(actual.x).toBeCloseTo(expected.x, 10);
      expect(actual.y).toBeCloseTo(expected.y, 10);
      expect(actual.scale).toBeCloseTo(expected.scale, 10);
      expect(actual.opacity).toBeCloseTo(expected.opacity, 10);
      expect(actual.rotation).toBeCloseTo(expected.rotation, 10);
    });
  });

  it('hidrata proyectos antiguos y conserva presets nuevos al reabrir', () => {
    const source = '/generated/00000000-0000-4000-8000-000000000001.mp4';
    const base = {
      version: 2,
      sourceUrl: source,
      sourceDuration: 4,
      clips: [{ id: 'clip-1', sourceUrl: source, sourceDuration: 4, sourceIn: 0, sourceOut: 4 }],
      audio: { mode: 'keep', volume: 1, externalName: '' },
      settings: {},
      textClips: [{ ...textClip({ startTime: 0, endTime: 2, entranceAnimation: 'bounce', exitAnimation: 'slide-right' }) }]
    };
    const restored = buildTimeline(source, 4, [], base).textTrack.clips[0];
    expect(restored.entranceAnimation).toBe('bounce');
    expect(restored.exitAnimation).toBe('slide-right');

    const legacy = buildTimeline(source, 4, [], { ...base, textClips: [{ ...textClip(), entranceAnimation: undefined, exitAnimation: undefined }] }).textTrack.clips[0];
    expect(legacy.entranceAnimation).toBe('none');
    expect(legacy.exitAnimation).toBe('none');
    expect(legacy.entranceDurationMs).toBe(500);
  });
});
