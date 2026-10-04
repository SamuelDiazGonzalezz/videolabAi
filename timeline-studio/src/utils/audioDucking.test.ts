import { describe, expect, it } from 'vitest';
import { buildVolumeEnvelope, evaluateVolumeEnvelope } from './audioDucking';

describe('buildVolumeEnvelope', () => {
  it('sin fades ni ducking, el volumen es constante de punta a punta', () => {
    const points = buildVolumeEnvelope({
      durationMs: 5000, volume: .8, fadeInMs: 0, fadeOutMs: 0,
      duckingEnabled: false, duckingAmount: 0, duckingRegions: [], musicStartTime: 0
    });
    expect(evaluateVolumeEnvelope(points, 0)).toBeCloseTo(.8, 5);
    expect(evaluateVolumeEnvelope(points, 2500)).toBeCloseTo(.8, 5);
    expect(evaluateVolumeEnvelope(points, 5000)).toBeCloseTo(.8, 5);
  });

  it('aplica fade-in y fade-out en los bordes', () => {
    const points = buildVolumeEnvelope({
      durationMs: 4000, volume: 1, fadeInMs: 1000, fadeOutMs: 500,
      duckingEnabled: false, duckingAmount: 0, duckingRegions: [], musicStartTime: 0
    });
    expect(evaluateVolumeEnvelope(points, 0)).toBeCloseTo(0, 5);
    expect(evaluateVolumeEnvelope(points, 500)).toBeCloseTo(.5, 5);
    expect(evaluateVolumeEnvelope(points, 1000)).toBeCloseTo(1, 5);
    expect(evaluateVolumeEnvelope(points, 2000)).toBeCloseTo(1, 5);
    expect(evaluateVolumeEnvelope(points, 3750)).toBeCloseTo(.5, 5);
    expect(evaluateVolumeEnvelope(points, 4000)).toBeCloseTo(0, 5);
  });

  it('baja el volumen durante un tramo de voz marcado (ducking) y lo recupera después', () => {
    const points = buildVolumeEnvelope({
      durationMs: 10000, volume: 1, fadeInMs: 0, fadeOutMs: 0,
      duckingEnabled: true, duckingAmount: .75,
      duckingRegions: [{ id: 'r1', startTime: 4, endTime: 6 }],
      musicStartTime: 0,
      rampMs: 200
    });
    expect(evaluateVolumeEnvelope(points, 1000)).toBeCloseTo(1, 5);
    expect(evaluateVolumeEnvelope(points, 5000)).toBeCloseTo(.25, 5);
    expect(evaluateVolumeEnvelope(points, 9000)).toBeCloseTo(1, 5);
    // La transición no es un salto brusco: a mitad de la rampa de bajada
    // (200ms) el volumen está entre el nivel base y el "duckeado".
    const midRamp = evaluateVolumeEnvelope(points, 3900);
    expect(midRamp).toBeGreaterThan(.25);
    expect(midRamp).toBeLessThan(1);
  });

  it('convierte las regiones de ducking (tiempo absoluto del proyecto) a tiempo relativo al inicio del clip de música', () => {
    const points = buildVolumeEnvelope({
      durationMs: 10000, volume: 1, fadeInMs: 0, fadeOutMs: 0,
      duckingEnabled: true, duckingAmount: 1,
      duckingRegions: [{ id: 'r1', startTime: 12, endTime: 14 }], // absoluto: música empieza en t=10s del proyecto
      musicStartTime: 10,
      rampMs: 100
    });
    // Relativo al clip: la voz cae en [2000ms, 4000ms] de la música.
    expect(evaluateVolumeEnvelope(points, 3000)).toBeCloseTo(0, 5);
    expect(evaluateVolumeEnvelope(points, 500)).toBeCloseTo(1, 5);
  });
});

describe('evaluateVolumeEnvelope', () => {
  it('se mantiene fijo en los extremos (sin extrapolar) y devuelve 1 sin puntos', () => {
    expect(evaluateVolumeEnvelope([], 500)).toBe(1);
    const points = [{ timeMs: 1000, volume: .4 }, { timeMs: 2000, volume: .9 }];
    expect(evaluateVolumeEnvelope(points, 0)).toBeCloseTo(.4, 5);
    expect(evaluateVolumeEnvelope(points, 5000)).toBeCloseTo(.9, 5);
  });
});
