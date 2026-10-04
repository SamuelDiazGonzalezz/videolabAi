import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../utils/timeline';
import type { BrollClip, TextClip } from '../types/timeline';
import { useTimelineStore } from './timelineStore';

const SOURCE = '/generated/00000000-0000-4000-8000-000000000011.mp4';

function linkedTimeline() {
  const textClip: TextClip = {
    id: 'text-linked',
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
    exitDurationMs: 500
  };
  const brollClip: BrollClip = {
    id: 'broll-linked',
    sourceUrl: '/generated/00000000-0000-4000-8000-000000000012.png',
    name: 'Imagen',
    startTime: 2.5,
    endTime: 3.5,
    opacity: 1,
    x: .5,
    y: .5,
    width: .4,
    height: .4,
    blendMode: 'normal'
  };
  return buildTimeline(SOURCE, 6, [], {
    version: 2,
    sourceUrl: SOURCE,
    sourceDuration: 6,
    clips: [
      { id: 'video-a', sourceUrl: SOURCE, sourceDuration: 6, sourceIn: 0, sourceOut: 2 },
      { id: 'video-b', sourceUrl: SOURCE, sourceDuration: 6, sourceIn: 2, sourceOut: 4 },
      { id: 'video-c', sourceUrl: SOURCE, sourceDuration: 6, sourceIn: 4, sourceOut: 6 }
    ],
    textClips: [textClip],
    brollClips: [brollClip],
    audio: { mode: 'keep', volume: 1, externalName: '' },
    settings: {}
  });
}

describe('moveRangeSelection linked transaction', () => {
  it('confirma v\u00eddeo, texto y B-roll como una sola entrada de historial', () => {
    const store = useTimelineStore.getState();
    store.loadTimeline(linkedTimeline());
    useTimelineStore.getState().setRangeSelection(2, 4, ['video', 'broll', 'text'], { contained: true });
    useTimelineStore.getState().moveRangeSelection(2);

    const state = useTimelineStore.getState();
    expect(state.timeline?.videoTrack.clips.map((clip) => clip.id)).toEqual(['video-a', 'video-c', 'video-b']);
    expect(state.timeline?.textTrack.clips[0]).toMatchObject({ startTime: 4, endTime: 6 });
    expect(state.timeline?.brollTrack.clips[0]).toMatchObject({ startTime: 4.5, endTime: 5.5 });
    expect(state.rangeSelection).toMatchObject({ startTime: 4, endTime: 6, contained: true });
    expect(state.history).toHaveLength(1);
  });
});
