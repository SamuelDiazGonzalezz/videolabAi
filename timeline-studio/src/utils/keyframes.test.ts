import { describe, expect, it } from 'vitest';
import type { Keyframe } from '../types/timeline';
import { easeProgress, interpolateKeyframes } from './keyframes';

function kf(partial: Partial<Keyframe> & Pick<Keyframe, 'timeMs'>): Keyframe {
  return {
    id: `kf-${partial.timeMs}`,
    x: 0.5,
    y: 0.5,
    scale: 1,
    opacity: 1,
    rotation: 0,
    easing: 'linear',
    ...partial
  };
}

describe('easeProgress', () => {
  it('linear es identidad', () => {
    expect(easeProgress(0, 'linear')).toBe(0);
    expect(easeProgress(0.25, 'linear')).toBe(0.25);
    expect(easeProgress(1, 'linear')).toBe(1);
  });

  it('ease-in arranca despacio (por debajo de la diagonal)', () => {
    expect(easeProgress(0.5, 'ease-in')).toBeCloseTo(0.25, 5);
    expect(easeProgress(0.25, 'ease-in')).toBeLessThan(0.25);
  });

  it('ease-out termina despacio (por encima de la diagonal)', () => {
    expect(easeProgress(0.5, 'ease-out')).toBeCloseTo(0.75, 5);
    expect(easeProgress(0.75, 'ease-out')).toBeGreaterThan(0.75);
  });

  it('ease-in-out es simétrico respecto al punto medio', () => {
    expect(easeProgress(0.5, 'ease-in-out')).toBeCloseTo(0.5, 5);
    expect(easeProgress(0.25, 'ease-in-out')).toBeCloseTo(1 - easeProgress(0.75, 'ease-in-out'), 5);
  });

  it('clampa progresos fuera de [0,1]', () => {
    expect(easeProgress(-0.5, 'linear')).toBe(0);
    expect(easeProgress(1.5, 'linear')).toBe(1);
  });
});

describe('interpolateKeyframes', () => {
  it('devuelve null sin keyframes o con solo uno (usar valores estáticos del clip)', () => {
    expect(interpolateKeyframes(undefined, 0)).toBeNull();
    expect(interpolateKeyframes([], 0)).toBeNull();
    expect(interpolateKeyframes([kf({ timeMs: 0 })], 500)).toBeNull();
  });

  it('se mantiene fijo antes del primer keyframe y después del último (sin extrapolar)', () => {
    const keyframes = [
      kf({ timeMs: 1000, x: 0.2, opacity: 0.5 }),
      kf({ timeMs: 3000, x: 0.8, opacity: 1 })
    ];
    expect(interpolateKeyframes(keyframes, 0)).toEqual({ x: 0.2, y: 0.5, scale: 1, opacity: 0.5, rotation: 0 });
    expect(interpolateKeyframes(keyframes, 5000)).toEqual({ x: 0.8, y: 0.5, scale: 1, opacity: 1, rotation: 0 });
  });

  it('interpola linealmente a mitad de camino con easing linear', () => {
    const keyframes = [
      kf({ timeMs: 0, x: 0, y: 0, scale: 1, opacity: 0, rotation: 0, easing: 'linear' }),
      kf({ timeMs: 1000, x: 1, y: 1, scale: 2, opacity: 1, rotation: 90 })
    ];
    expect(interpolateKeyframes(keyframes, 500)).toEqual({ x: 0.5, y: 0.5, scale: 1.5, opacity: 0.5, rotation: 45 });
  });

  it('aplica el easing del keyframe de partida del tramo', () => {
    const keyframes = [
      kf({ timeMs: 0, x: 0, easing: 'ease-in' }),
      kf({ timeMs: 1000, x: 1 })
    ];
    // ease-in a mitad de tramo (progreso 0.5) da 0.25, no 0.5.
    expect(interpolateKeyframes(keyframes, 500)!.x).toBeCloseTo(0.25, 5);
  });

  it('usa el easing correcto por tramo cuando hay 3+ keyframes', () => {
    const keyframes = [
      kf({ timeMs: 0, x: 0, easing: 'linear' }),
      kf({ timeMs: 1000, x: 1, easing: 'ease-out' }),
      kf({ timeMs: 2000, x: 0 })
    ];
    // Primer tramo (linear): a mitad de camino, x = 0.5.
    expect(interpolateKeyframes(keyframes, 500)!.x).toBeCloseTo(0.5, 5);
    // Segundo tramo (ease-out, de x=1 a x=0): progreso eased(0.5)=0.75, así
    // que x = 1 + (0 - 1) * 0.75 = 0.25.
    expect(interpolateKeyframes(keyframes, 1500)!.x).toBeCloseTo(0.25, 5);
  });

  it('ignora el orden de entrada de los keyframes (los ordena por tiempo)', () => {
    const keyframes = [
      kf({ timeMs: 1000, x: 1 }),
      kf({ timeMs: 0, x: 0 })
    ];
    expect(interpolateKeyframes(keyframes, 500)!.x).toBeCloseTo(0.5, 5);
  });
});
