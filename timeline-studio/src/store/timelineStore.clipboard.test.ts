import { describe, expect, it } from 'vitest';
import type { BrollClip, TextClip, Timeline, VideoClip } from '../types/timeline';
import { buildTimeline } from '../utils/timeline';
import { useTimelineStore } from './timelineStore';

const SOURCE = '/generated/00000000-0000-4000-8000-000000000001.mp4';

function baseTimeline(duration = 12): Timeline {
  return buildTimeline(SOURCE, duration, []);
}

function textClip(id: string, startTime: number, endTime: number, kind: TextClip['kind'] = 'text'): TextClip {
  return {
    id,
    kind,
    text: id,
    startTime,
    endTime,
    style: 'outline',
    font: 'modern',
    position: 'center',
    size: 'medium',
    color: 'blanco',
    x: .5,
    y: .5,
    width: .72,
    scale: 1,
    preset: 'none',
    wordEffect: 'karaoke',
    entranceAnimation: 'none',
    entranceDurationMs: 500,
    exitAnimation: 'none',
    exitDurationMs: 500,
    ...(kind === 'text' ? {
      keyframes: [
        { id: `${id}-kf-a`, timeMs: 0, x: .4, y: .5, scale: 1, opacity: 0, rotation: 0, easing: 'ease-out' as const },
        { id: `${id}-kf-b`, timeMs: 500, x: .5, y: .5, scale: 1, opacity: 1, rotation: 0, easing: 'linear' as const }
      ]
    } : {})
  };
}

function brollClip(id: string, startTime: number, endTime: number): BrollClip {
  return {
    id,
    sourceUrl: '/generated/00000000-0000-4000-8000-000000000002.png',
    name: id,
    startTime,
    endTime,
    opacity: 1,
    x: .5,
    y: .5,
    width: .4,
    height: .4,
    blendMode: 'normal',
    keyframes: [
      { id: `${id}-kf-a`, timeMs: 0, x: .4, y: .5, scale: 1, opacity: 1, rotation: 0, easing: 'linear' },
      { id: `${id}-kf-b`, timeMs: 500, x: .6, y: .5, scale: 1, opacity: 1, rotation: 0, easing: 'linear' }
    ]
  };
}

function videoClips(timeline: Timeline): [VideoClip, VideoClip] {
  const source = timeline.videoTrack.clips[0];
  return [
    { ...source, id: 'video-a', sourceIn: 0, sourceOut: 4, startTime: 0, endTime: 4, name: 'A' },
    { ...source, id: 'video-b', sourceIn: 4, sourceOut: 8, startTime: 4, endTime: 8, name: 'B' }
  ];
}

describe('portapapeles interno del timeline', () => {
  it('copia un rango mixto sin audio, pega en el cabezal y renueva clips y keyframes en un solo historial', () => {
    const timeline = baseTimeline();
    timeline.textTrack.clips = [textClip('title', 1, 2), textClip('subtitle', 2.5, 3.5, 'subtitle')];
    timeline.brollTrack.clips = [brollClip('image', 4, 5)];
    timeline.audioTrack.volume = .37;
    const store = useTimelineStore.getState();
    store.loadTimeline(timeline);
    store.setRangeSelection(.5, 5.5, ['text', 'broll', 'audio'], { contained: true });

    expect(store.copySelection()).toBe(3);
    expect(useTimelineStore.getState().clipboardCount).toBe(3);
    expect(useTimelineStore.getState().history).toHaveLength(0);
    store.setCurrentTime(6);
    expect(store.pasteClipboard()).toBe(3);

    const pasted = useTimelineStore.getState();
    const newTexts = pasted.timeline!.textTrack.clips.filter((clip) => !['title', 'subtitle'].includes(clip.id));
    const newBroll = pasted.timeline!.brollTrack.clips.find((clip) => clip.id !== 'image')!;
    expect(newTexts.map((clip) => clip.startTime)).toEqual([6, 7.5]);
    expect(newBroll.startTime).toBe(9);
    expect(new Set(newTexts.flatMap((clip) => (clip.keyframes || []).map((keyframe) => keyframe.id))).has('title-kf-a')).toBe(false);
    expect(new Set((newBroll.keyframes || []).map((keyframe) => keyframe.id))).not.toContain('image-kf-a');
    expect(pasted.timeline!.audioTrack.volume).toBe(.37);
    expect(pasted.history).toHaveLength(1);
    expect(pasted.selection).toBeNull();
    expect(pasted.rangeSelection).toMatchObject({ startTime: 6, endTime: 10, tracks: ['broll', 'text'], contained: true });

    pasted.undo();
    const undone = useTimelineStore.getState();
    expect(undone.timeline!.textTrack.clips).toHaveLength(2);
    expect(undone.timeline!.brollTrack.clips).toHaveLength(1);
    expect(undone.history).toHaveLength(0);
    expect(undone.clipboardCount).toBe(3);
  });

  it('duplica una selección mixta después de su contenido sin reemplazar el portapapeles', () => {
    const timeline = baseTimeline();
    timeline.textTrack.clips = [textClip('title', 1, 2)];
    timeline.brollTrack.clips = [brollClip('image', 3, 4)];
    const store = useTimelineStore.getState();
    store.loadTimeline(timeline);
    store.setRangeSelection(.5, 4.5, ['text', 'broll'], { contained: true });

    expect(store.duplicateSelection()).toBe(2);
    const state = useTimelineStore.getState();
    const copiedText = state.timeline!.textTrack.clips.find((clip) => clip.id !== 'title')!;
    const copiedBroll = state.timeline!.brollTrack.clips.find((clip) => clip.id !== 'image')!;
    expect(copiedText.startTime).toBe(4);
    expect(copiedBroll.startTime).toBe(6);
    expect(copiedText.keyframes?.map((keyframe) => keyframe.id)).not.toEqual(timeline.textTrack.clips[0].keyframes?.map((keyframe) => keyframe.id));
    expect(copiedBroll.keyframes?.map((keyframe) => keyframe.id)).not.toEqual(timeline.brollTrack.clips[0].keyframes?.map((keyframe) => keyframe.id));
    expect(state.history).toHaveLength(1);
    expect(state.clipboardCount).toBe(0);
    expect(state.rangeSelection).toMatchObject({ startTime: 4, endTime: 7, tracks: ['broll', 'text'] });
  });

  it('conserva el orden de una selección múltiple de vídeo y selecciona todas las copias', () => {
    const timeline = baseTimeline(8);
    timeline.videoTrack.clips = videoClips(timeline);
    timeline.duration = 8;
    const store = useTimelineStore.getState();
    store.loadTimeline(timeline);
    store.selectClip({ kind: 'video', id: 'video-a', ids: ['video-a', 'video-b'] });

    expect(store.copySelection()).toBe(2);
    store.setCurrentTime(4);
    expect(store.pasteClipboard()).toBe(2);
    let state = useTimelineStore.getState();
    expect(state.timeline!.videoTrack.clips.map((clip) => clip.name)).toEqual(['A', 'A', 'B', 'B']);
    expect(state.timeline!.videoTrack.clips.map((clip) => clip.startTime)).toEqual([0, 4, 8, 12]);
    expect(state.history).toHaveLength(1);
    expect(state.selection?.kind).toBe('video');
    if (state.selection?.kind !== 'video') throw new Error('Se esperaba selección múltiple de vídeo');
    expect(state.selection.ids).toHaveLength(2);
    expect(new Set(state.timeline!.videoTrack.clips.map((clip) => clip.id)).size).toBe(4);

    expect(state.duplicateSelection()).toBe(2);
    state = useTimelineStore.getState();
    expect(state.history).toHaveLength(2);
    expect(state.timeline!.videoTrack.clips).toHaveLength(6);
    expect(new Set(state.timeline!.videoTrack.clips.map((clip) => clip.id)).size).toBe(6);
    expect(state.clipboardCount).toBe(2);
  });

  it('mantiene sincronizados los textos e imágenes posteriores al insertar un vídeo duplicado', () => {
    const timeline = baseTimeline(8);
    timeline.videoTrack.clips = videoClips(timeline);
    timeline.duration = 8;
    timeline.textTrack.clips = [textClip('scene-a', 1, 2), textClip('scene-b', 5, 6)];
    timeline.brollTrack.clips = [brollClip('image-b', 5.5, 6.5)];
    const store = useTimelineStore.getState();
    store.loadTimeline(timeline);
    store.setRangeSelection(0, 4, ['video', 'text'], { contained: true });

    expect(store.duplicateSelection()).toBe(2);
    const state = useTimelineStore.getState();
    expect(state.timeline!.videoTrack.clips.map((clip) => clip.name)).toEqual(['A', 'A', 'B']);
    expect(state.timeline!.textTrack.clips.find((clip) => clip.id === 'scene-a')).toMatchObject({ startTime: 1, endTime: 2 });
    expect(state.timeline!.textTrack.clips.find((clip) => clip.id === 'scene-b')).toMatchObject({ startTime: 9, endTime: 10 });
    expect(state.timeline!.brollTrack.clips[0]).toMatchObject({ startTime: 9.5, endTime: 10.5 });
    const copiedText = state.timeline!.textTrack.clips.find((clip) => !['scene-a', 'scene-b'].includes(clip.id));
    expect(copiedText).toMatchObject({ startTime: 5, endTime: 6 });
    expect(state.history).toHaveLength(1);
  });

  it('aplica por separado los límites de texto, subtítulos y B-roll y no crea historial al quedar lleno', () => {
    const source = baseTimeline();
    source.textTrack.clips = [textClip('free-source', 1, 2), textClip('subtitle-source', 2, 3, 'subtitle')];
    source.brollTrack.clips = [brollClip('broll-source', 3, 4)];
    const store = useTimelineStore.getState();
    store.loadTimeline(source);
    store.setRangeSelection(.5, 4.5, ['text', 'broll'], { contained: true });
    expect(store.copySelection()).toBe(3);

    const current = useTimelineStore.getState().timeline!;
    useTimelineStore.setState({
      timeline: {
        ...current,
        textTrack: {
          ...current.textTrack,
          clips: [
            ...Array.from({ length: 48 }, (_, index) => ({ ...textClip(`free-${index}`, 0, 1), keyframes: undefined })),
            ...Array.from({ length: 599 }, (_, index) => textClip(`subtitle-${index}`, 0, 1, 'subtitle'))
          ]
        },
        brollTrack: {
          ...current.brollTrack,
          clips: Array.from({ length: 8 }, (_, index) => ({ ...brollClip(`broll-${index}`, 0, 1), keyframes: undefined }))
        }
      },
      selection: null,
      rangeSelection: null,
      history: [],
      future: []
    });
    store.setCurrentTime(6);

    expect(store.pasteClipboard()).toBe(1);
    let state = useTimelineStore.getState();
    expect(state.timeline!.textTrack.clips.filter((clip) => clip.kind === 'text')).toHaveLength(48);
    expect(state.timeline!.textTrack.clips.filter((clip) => clip.kind === 'subtitle')).toHaveLength(600);
    expect(state.timeline!.brollTrack.clips).toHaveLength(8);
    expect(state.history).toHaveLength(1);
    expect(store.pasteClipboard()).toBe(0);
    state = useTimelineStore.getState();
    expect(state.history).toHaveLength(1);
  });

  it('respeta el límite de vídeo y devuelve cero sin tocar historial', () => {
    const source = baseTimeline();
    const store = useTimelineStore.getState();
    store.loadTimeline(source);
    store.selectClip({ kind: 'video', id: 'clip-1', ids: ['clip-1'] });
    expect(store.copySelection()).toBe(1);

    const timeline = useTimelineStore.getState().timeline!;
    const template = timeline.videoTrack.clips[0];
    useTimelineStore.setState({
      timeline: {
        ...timeline,
        videoTrack: {
          ...timeline.videoTrack,
          clips: Array.from({ length: 60 }, (_, index) => ({
            ...template,
            id: `video-${index}`,
            sourceIn: 0,
            sourceOut: .2,
            startTime: index * .2,
            endTime: (index + 1) * .2
          }))
        }
      },
      history: [],
      future: []
    });

    expect(store.pasteClipboard()).toBe(0);
    expect(useTimelineStore.getState().history).toHaveLength(0);
    expect(useTimelineStore.getState().timeline!.videoTrack.clips).toHaveLength(60);
  });
});
