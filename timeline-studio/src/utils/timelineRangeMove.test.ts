import { describe, expect, it } from 'vitest';
import type { BrollClip, TextClip, Timeline, TimelineRangeSelection } from '../types/timeline';
import { buildTimeline } from './timeline';
import { planTimelineRangeMove } from './timelineRangeMove';

const SOURCE = '/generated/00000000-0000-4000-8000-000000000001.mp4';

function textClip(changes: Partial<TextClip> = {}): TextClip {
  return {
    id: 'text-1',
    kind: 'text',
    text: 'Frase',
    startTime: 2,
    endTime: 4,
    style: 'outline',
    font: 'modern',
    position: 'center',
    size: 'medium',
    color: 'blanco',
    x: .5,
    y: .5,
    width: .7,
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

function brollClip(changes: Partial<BrollClip> = {}): BrollClip {
  return {
    id: 'broll-1',
    sourceUrl: '/generated/00000000-0000-4000-8000-000000000002.png',
    name: 'Imagen',
    startTime: 2.5,
    endTime: 3.5,
    opacity: 1,
    x: .5,
    y: .5,
    width: .4,
    height: .4,
    blendMode: 'normal',
    ...changes
  };
}

function timelineWithThreeCuts(): Timeline {
  return buildTimeline(SOURCE, 6, [], {
    version: 2,
    sourceUrl: SOURCE,
    sourceDuration: 6,
    clips: [
      { id: 'video-a', sourceUrl: SOURCE, sourceDuration: 6, sourceIn: 0, sourceOut: 2 },
      { id: 'video-b', sourceUrl: SOURCE, sourceDuration: 6, sourceIn: 2, sourceOut: 4 },
      { id: 'video-c', sourceUrl: SOURCE, sourceDuration: 6, sourceIn: 4, sourceOut: 6 }
    ],
    textClips: [textClip()],
    brollClips: [brollClip()],
    audio: { mode: 'keep', volume: 1, externalName: '' },
    settings: {}
  });
}

describe('planTimelineRangeMove', () => {
  it('mueve un bloque enlazado al siguiente corte con un solo delta efectivo', () => {
    const timeline = timelineWithThreeCuts();
    const plan = planTimelineRangeMove(timeline, {
      startTime: 2,
      endTime: 4,
      tracks: ['video', 'broll', 'text'],
      contained: true
    }, 1.2);

    expect(plan).not.toBeNull();
    expect(plan?.targets).toMatchObject({
      videoIds: ['video-b'],
      brollIds: ['broll-1'],
      textIds: ['text-1']
    });
    expect(plan?.deltaSeconds).toBe(2);
    expect(plan?.previewDeltaSeconds).toBe(1.2);
    expect(plan?.videoInsertionIndex).toBe(2);
  });

  it('mantiene juntos los overlays mientras el v\u00eddeo a\u00fan no cruza el punto de snap', () => {
    const timeline = timelineWithThreeCuts();
    const plan = planTimelineRangeMove(timeline, {
      startTime: 2,
      endTime: 4,
      tracks: ['video', 'broll', 'text'],
      contained: true
    }, .8);

    expect(plan?.deltaSeconds).toBe(0);
    expect(plan?.previewDeltaSeconds).toBe(.8);
    expect(plan?.videoInsertionIndex).toBe(1);
  });

  it('mantiene tambi\u00e9n el fantasma del v\u00eddeo dentro de los bordes', () => {
    const timeline = timelineWithThreeCuts();
    const plan = planTimelineRangeMove(timeline, {
      startTime: 2.5,
      endTime: 3.5,
      tracks: ['video']
    }, -20);

    expect(plan?.previewDeltaSeconds).toBe(-2);
    expect(plan?.deltaSeconds).toBe(-2);
  });

  it('limita un movimiento continuo por los bordes del rango y del proyecto', () => {
    const timeline = timelineWithThreeCuts();
    const selection: TimelineRangeSelection = { startTime: 2, endTime: 4, tracks: ['text'], contained: true };

    expect(planTimelineRangeMove(timeline, selection, 20)?.deltaSeconds).toBe(2);
    expect(planTimelineRangeMove(timeline, selection, -20)?.deltaSeconds).toBe(-2);
  });

  it('descarta cortes de v\u00eddeo que sacar\u00edan un overlay seleccionado del proyecto', () => {
    const timeline = timelineWithThreeCuts();
    timeline.brollTrack.clips[0] = brollClip({ startTime: 2, endTime: 5.5 });
    const plan = planTimelineRangeMove(timeline, {
      startTime: 2,
      endTime: 5.5,
      tracks: ['video', 'broll'],
      contained: true
    }, 10);

    expect(plan?.deltaSeconds).toBe(0);
    expect(plan?.videoInsertionIndex).toBe(1);
  });

  it('no ofrece movimiento para una selecci\u00f3n que solo contiene audio', () => {
    const timeline = timelineWithThreeCuts();
    expect(planTimelineRangeMove(timeline, {
      startTime: 1,
      endTime: 2,
      tracks: ['audio']
    }, 1)).toBeNull();
  });
});
