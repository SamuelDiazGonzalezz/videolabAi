import { create } from 'zustand';
import {
  getTimelineRangeTargets,
  MAX_TIMELINE_BROLL_CLIPS,
  MAX_TIMELINE_SUBTITLE_CLIPS,
  MAX_TIMELINE_TEXT_CLIPS,
  MAX_TIMELINE_VIDEO_CLIPS
} from '../utils/timeline';
import { planTimelineRangeMove } from '../utils/timelineRangeMove';
import type {
  AudioTrack,
  BrollClip,
  ClipSelection,
  MusicTrack,
  ProjectSettings,
  RectangleSelection,
  TextClip,
  Timeline,
  TimelineRangeSelection,
  TimelineTrackKind,
  TransitionType,
  VideoClip
} from '../types/timeline';

const MIN_ZOOM = 24;
const MAX_ZOOM = 260;
const MIN_CLIP_DURATION = 0.2;
const MAX_HISTORY = 60;
const ROI_MIN_SIZE = 0.12;
const ROI_FULL_FRAME: RectangleSelection = { x: 0, y: 0, width: 1, height: 1 };

interface TimelineClipboard {
  anchorTime: number;
  endTime: number;
  videoClips: VideoClip[];
  textClips: TextClip[];
  brollClips: BrollClip[];
}

interface TimelineState {
  timeline: Timeline | null;
  currentTime: number;
  isPlaying: boolean;
  pixelsPerSecond: number;
  selection: ClipSelection | null;
  rangeSelection: TimelineRangeSelection | null;
  clipboardCount: number;
  clipboard: TimelineClipboard | null;
  rectangleSelectionActive: boolean;
  history: Timeline[];
  future: Timeline[];
  isDirty: boolean;

  loadTimeline: (timeline: Timeline) => void;
  markSaved: () => void;
  setCurrentTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  setRectangleSelectionActive: (active: boolean) => void;
  setZoom: (pixelsPerSecond: number) => void;
  zoomBy: (factor: number) => void;
  selectClip: (selection: ClipSelection | null) => void;
  toggleVideoClipSelection: (clipId: string) => void;
  setRangeSelection: (startTime: number, endTime: number, tracks: TimelineTrackKind[], options?: { contained?: boolean }) => void;
  clearRangeSelection: () => void;
  copySelection: () => number;
  pasteClipboard: () => number;
  duplicateSelection: () => number;
  updateSettings: (changes: Partial<ProjectSettings>) => void;
  updateVideoClips: (clipIds: string[], changes: Partial<VideoClip>) => void;
  updateClipTransition: (clipId: string, transitionType: TransitionType, transitionDuration: number) => void;
  setAllTransitions: (transitionType: TransitionType, transitionDuration: number) => void;
  updateAudioTrack: (changes: Partial<AudioTrack>) => void;
  /** Función 6 — Audio por capas: añade/reemplaza la pista de música. */
  setMusicTrack: (track: MusicTrack | null) => void;
  updateMusicTrack: (changes: Partial<MusicTrack>) => void;
  addDuckingRegion: (startTime: number, endTime: number) => void;
  removeDuckingRegion: (regionId: string) => void;

  addVideoClip: (clip: VideoClip) => void;
  setSourceThumbnails: (sourceUrl: string, thumbnails: string[]) => void;
  setVideoClipBounds: (clipId: string, sourceIn: number, sourceOut: number) => void;
  splitVideoClipAtPlayhead: () => void;
  moveVideoClip: (clipId: string, direction: -1 | 1) => void;
  removeVideoClip: (clipId: string) => void;
  setTextClipTiming: (clipId: string, startTime: number, endTime: number) => void;
  updateTextClip: (clipId: string, changes: Partial<TextClip>) => void;
  updateTextClips: (clipIds: string[], changes: Partial<TextClip>) => void;
  addTextClip: (clip: TextClip) => void;
  removeTextClip: (clipId: string) => void;
  setAutoSubtitleClips: (clips: TextClip[]) => void;
  addBrollClip: (clip: BrollClip) => void;
  updateBrollClip: (clipId: string, changes: Partial<BrollClip>) => void;
  updateBrollClips: (clipIds: string[], changes: Partial<BrollClip>) => void;
  removeBrollClip: (clipId: string) => void;
  /** Función 3 — Capas: reordena qué capa se dibuja encima de cuál (el orden del array ES el orden de composición). */
  moveBrollClip: (clipId: string, direction: -1 | 1) => void;
  setRectangleSelection: (selection: RectangleSelection) => void;
  zoomRectangleSelection: (factor: number, anchor?: { x: number; y: number }) => void;
  clearRectangleSelection: () => void;
  moveRangeSelection: (deltaSeconds: number) => void;
  removeSelection: () => void;
  undo: () => void;
  redo: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cloneTimeline(timeline: Timeline): Timeline {
  return JSON.parse(JSON.stringify(timeline)) as Timeline;
}

function cloneClipboardValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function clipboardSize(clipboard: TimelineClipboard): number {
  return clipboard.videoClips.length + clipboard.textClips.length + clipboard.brollClips.length;
}

function buildClipboard(
  timeline: Timeline | null,
  selection: ClipSelection | null,
  rangeSelection: TimelineRangeSelection | null
): TimelineClipboard | null {
  if (!timeline || (!selection && !rangeSelection)) return null;

  let videoIds = new Set<string>();
  let textIds = new Set<string>();
  let brollIds = new Set<string>();
  if (rangeSelection) {
    const targets = getTimelineRangeTargets(timeline, rangeSelection);
    videoIds = new Set(targets.videoIds);
    textIds = new Set(targets.textIds);
    brollIds = new Set(targets.brollIds);
  } else if (selection?.kind === 'video') {
    videoIds = new Set([...selection.ids, selection.id]);
  } else if (selection?.kind === 'text') {
    textIds.add(selection.id);
  } else if (selection?.kind === 'broll') {
    brollIds.add(selection.id);
  }

  const videoClips = timeline.videoTrack.clips.filter((clip) => videoIds.has(clip.id));
  const textClips = timeline.textTrack.clips.filter((clip) => textIds.has(clip.id));
  const brollClips = timeline.brollTrack.clips.filter((clip) => brollIds.has(clip.id));
  const clips = [...videoClips, ...textClips, ...brollClips];
  if (!clips.length) return null;
  return {
    anchorTime: Math.min(...clips.map((clip) => clip.startTime)),
    endTime: Math.max(...clips.map((clip) => clip.endTime)),
    videoClips: cloneClipboardValue(videoClips),
    textClips: cloneClipboardValue(textClips),
    brollClips: cloneClipboardValue(brollClips)
  };
}

let clipboardIdSequence = 0;

function createClipboardId(prefix: string, usedIds: Set<string>): string {
  let id = '';
  do {
    clipboardIdSequence += 1;
    id = `${prefix}-${Date.now().toString(36)}-${clipboardIdSequence.toString(36)}`;
  } while (usedIds.has(id));
  usedIds.add(id);
  return id;
}

function pasteSelectionState(
  timeline: Timeline,
  videoIds: string[],
  textIds: string[],
  brollIds: string[]
): Pick<TimelineState, 'selection' | 'rangeSelection'> {
  const count = videoIds.length + textIds.length + brollIds.length;
  if (count === 1) {
    if (videoIds.length) return { selection: { kind: 'video', id: videoIds[0], ids: videoIds }, rangeSelection: null };
    if (textIds.length) return { selection: { kind: 'text', id: textIds[0] }, rangeSelection: null };
    return { selection: { kind: 'broll', id: brollIds[0] }, rangeSelection: null };
  }
  if (count === videoIds.length) {
    return { selection: { kind: 'video', id: videoIds[0], ids: videoIds }, rangeSelection: null };
  }

  const videoSet = new Set(videoIds);
  const textSet = new Set(textIds);
  const brollSet = new Set(brollIds);
  const pastedClips = [
    ...timeline.videoTrack.clips.filter((clip) => videoSet.has(clip.id)),
    ...timeline.textTrack.clips.filter((clip) => textSet.has(clip.id)),
    ...timeline.brollTrack.clips.filter((clip) => brollSet.has(clip.id))
  ];
  const tracks: TimelineTrackKind[] = [];
  if (videoIds.length) tracks.push('video');
  if (brollIds.length) tracks.push('broll');
  if (textIds.length) tracks.push('text');
  return {
    selection: null,
    rangeSelection: {
      startTime: Math.min(...pastedClips.map((clip) => clip.startTime)),
      endTime: Math.max(...pastedClips.map((clip) => clip.endTime)),
      tracks,
      contained: true
    }
  };
}

interface ClipboardPasteResult {
  count: number;
  update: Partial<TimelineState>;
}

function pasteClipboardAt(
  state: TimelineState,
  clipboard: TimelineClipboard,
  requestedAnchorTime: number
): ClipboardPasteResult {
  const timeline = state.timeline;
  if (!timeline || !clipboardSize(clipboard)) return { count: 0, update: {} };

  const availableVideos = Math.max(0, MAX_TIMELINE_VIDEO_CLIPS - timeline.videoTrack.clips.length);
  const availableBroll = Math.max(0, MAX_TIMELINE_BROLL_CLIPS - timeline.brollTrack.clips.length);
  let availableText = Math.max(
    0,
    MAX_TIMELINE_TEXT_CLIPS - timeline.textTrack.clips.filter((clip) => clip.kind === 'text').length
  );
  let availableSubtitles = Math.max(
    0,
    MAX_TIMELINE_SUBTITLE_CLIPS - timeline.textTrack.clips.filter((clip) => clip.kind === 'subtitle').length
  );
  const sourceVideos = clipboard.videoClips.slice(0, availableVideos);
  const sourceBroll = clipboard.brollClips.slice(0, availableBroll);
  const sourceText = clipboard.textClips.filter((clip) => {
    if (clip.kind === 'subtitle') {
      if (!availableSubtitles) return false;
      availableSubtitles -= 1;
      return true;
    }
    if (!availableText) return false;
    availableText -= 1;
    return true;
  });
  const acceptedClips = [...sourceVideos, ...sourceText, ...sourceBroll];
  if (!acceptedClips.length) return { count: 0, update: {} };

  const sourceAnchor = Math.min(...acceptedClips.map((clip) => clip.startTime));
  const sourceEnd = Math.max(...acceptedClips.map((clip) => clip.endTime));
  const requestedAnchor = clamp(
    Number.isFinite(requestedAnchorTime) ? requestedAnchorTime : state.currentTime,
    0,
    timeline.duration
  );
  const insertedVideoDuration = sourceVideos.reduce(
    (total, clip) => total + Math.max(MIN_CLIP_DURATION, clip.sourceOut - clip.sourceIn),
    0
  );
  const futureDuration = timeline.duration + insertedVideoDuration;
  let insertionIndex = timeline.videoTrack.clips.length;
  let videoInsertionTime: number | null = null;
  let targetAnchor = requestedAnchor;
  if (sourceVideos.length) {
    const firstVideoOffset = sourceVideos[0].startTime - sourceAnchor;
    const desiredFirstVideoTime = requestedAnchor + firstVideoOffset;
    const foundIndex = timeline.videoTrack.clips.findIndex((clip) => clip.startTime >= desiredFirstVideoTime - .0001);
    insertionIndex = foundIndex < 0 ? timeline.videoTrack.clips.length : foundIndex;
    const insertionTime = timeline.videoTrack.clips[insertionIndex]?.startTime ?? timeline.duration;
    videoInsertionTime = insertionTime;
    targetAnchor = insertionTime - firstVideoOffset;
  } else {
    targetAnchor = clamp(requestedAnchor, 0, Math.max(0, futureDuration - (sourceEnd - sourceAnchor)));
  }
  const timeDelta = targetAnchor - sourceAnchor;

  const usedClipIds = new Set([
    ...timeline.videoTrack.clips.map((clip) => clip.id),
    ...timeline.textTrack.clips.map((clip) => clip.id),
    ...timeline.brollTrack.clips.map((clip) => clip.id)
  ]);
  const usedKeyframeIds = new Set([
    ...timeline.textTrack.clips.flatMap((clip) => (clip.keyframes || []).map((keyframe) => keyframe.id)),
    ...timeline.brollTrack.clips.flatMap((clip) => (clip.keyframes || []).map((keyframe) => keyframe.id))
  ]);
  const cloneKeyframes = <T extends TextClip | BrollClip>(clip: T): T['keyframes'] => (
    clip.keyframes?.map((keyframe) => ({
      ...keyframe,
      id: createClipboardId('kf-copy', usedKeyframeIds)
    }))
  );
  const pastedVideos = sourceVideos.map((clip) => ({
    ...cloneClipboardValue(clip),
    id: createClipboardId('video-copy', usedClipIds)
  }));
  const pastedText = sourceText.map((clip) => ({
    ...cloneClipboardValue(clip),
    id: createClipboardId('text-copy', usedClipIds),
    startTime: clip.startTime + timeDelta,
    endTime: clip.endTime + timeDelta,
    ...(clip.keyframes ? { keyframes: cloneKeyframes(clip) } : {})
  }));
  const pastedBroll = sourceBroll.map((clip) => ({
    ...cloneClipboardValue(clip),
    id: createClipboardId('broll-copy', usedClipIds),
    startTime: clip.startTime + timeDelta,
    endTime: clip.endTime + timeDelta,
    ...(clip.keyframes ? { keyframes: cloneKeyframes(clip) } : {})
  }));

  const update = withHistory(state, (current) => {
    const videoClips = [...current.videoTrack.clips];
    videoClips.splice(insertionIndex, 0, ...pastedVideos);
    const rippleAfterVideoInsertion = <T extends { startTime: number; endTime: number }>(clip: T): T => {
      if (videoInsertionTime == null || insertedVideoDuration <= 0) return clip;
      if (clip.startTime >= videoInsertionTime - .0001) {
        return {
          ...clip,
          startTime: clip.startTime + insertedVideoDuration,
          endTime: clip.endTime + insertedVideoDuration
        };
      }
      if (clip.endTime > videoInsertionTime + .0001) {
        return { ...clip, endTime: clip.endTime + insertedVideoDuration };
      }
      return clip;
    };
    return {
      ...current,
      videoTrack: { ...current.videoTrack, clips: videoClips },
      // La pista principal es secuencial: insertar un vídeo desplaza todo lo
      // que venía después. Aplicamos el mismo ripple a frases e imágenes ya
      // existentes para que no pierdan la sincronía con sus escenas.
      textTrack: {
        ...current.textTrack,
        clips: [...current.textTrack.clips.map(rippleAfterVideoInsertion), ...pastedText]
      },
      brollTrack: {
        ...current.brollTrack,
        clips: [...current.brollTrack.clips.map(rippleAfterVideoInsertion), ...pastedBroll]
      }
    };
  }, null);
  if (!update.timeline) return { count: 0, update: {} };
  const videoIds = pastedVideos.map((clip) => clip.id);
  const textIds = pastedText.map((clip) => clip.id);
  const brollIds = pastedBroll.map((clip) => clip.id);
  return {
    count: videoIds.length + textIds.length + brollIds.length,
    update: {
      ...update,
      ...pasteSelectionState(update.timeline, videoIds, textIds, brollIds)
    }
  };
}

function reflowTimeline(timeline: Timeline): Timeline {
  let cursor = 0;
  const clips = timeline.videoTrack.clips.map((clip) => {
    const duration = Math.max(MIN_CLIP_DURATION, clip.sourceOut - clip.sourceIn);
    const next = { ...clip, startTime: cursor, endTime: cursor + duration };
    cursor += duration;
    return next;
  });
  const duration = Math.max(0, cursor);
  const textClips = timeline.textTrack.clips
    .map((clip) => {
      const startTime = clamp(clip.startTime, 0, Math.max(0, duration - MIN_CLIP_DURATION));
      const endTime = clamp(clip.endTime, startTime + MIN_CLIP_DURATION, duration);
      const width = clamp(clip.width, 0.15, 0.96);
      return {
        ...clip,
        startTime,
        endTime,
        width,
        scale: clamp(clip.scale, 0.5, 2.5),
        x: clamp(clip.x, width / 2, 1 - width / 2),
        y: clamp(clip.y, 0.04, 0.96)
      };
    })
    .filter((clip) => clip.endTime - clip.startTime >= MIN_CLIP_DURATION);
  const brollClips = timeline.brollTrack.clips
    .map((clip) => {
      const startTime = clamp(clip.startTime, 0, Math.max(0, duration - MIN_CLIP_DURATION));
      const endTime = clamp(clip.endTime, startTime + MIN_CLIP_DURATION, duration);
      const width = clamp(clip.width, 0.12, 1);
      const height = clamp(clip.height, 0.12, 1);
      return {
        ...clip,
        startTime,
        endTime,
        opacity: clamp(clip.opacity, 0.1, 1),
        width,
        height,
        x: clamp(clip.x, width / 2, 1 - width / 2),
        y: clamp(clip.y, height / 2, 1 - height / 2)
      };
    })
    .filter((clip) => clip.endTime - clip.startTime >= MIN_CLIP_DURATION);
  const musicTrack = timeline.musicTrack && (() => {
    const startTime = clamp(timeline.musicTrack!.startTime, 0, Math.max(0, duration - MIN_CLIP_DURATION));
    const endTime = clamp(timeline.musicTrack!.endTime, startTime + MIN_CLIP_DURATION, duration);
    if (endTime - startTime < MIN_CLIP_DURATION) return null;
    return {
      ...timeline.musicTrack!,
      startTime,
      endTime,
      volume: clamp(timeline.musicTrack!.volume, 0, 1),
      fadeInMs: Math.max(0, timeline.musicTrack!.fadeInMs),
      fadeOutMs: Math.max(0, timeline.musicTrack!.fadeOutMs),
      duckingAmount: clamp(timeline.musicTrack!.duckingAmount, 0, 1),
      duckingRegions: timeline.musicTrack!.duckingRegions
        .map((region) => ({
          ...region,
          startTime: clamp(region.startTime, 0, duration),
          endTime: clamp(region.endTime, 0, duration)
        }))
        .filter((region) => region.endTime - region.startTime >= 0.05)
    };
  })();

  return {
    ...timeline,
    duration,
    videoTrack: { ...timeline.videoTrack, clips },
    musicTrack: musicTrack || null,
    textTrack: { ...timeline.textTrack, clips: textClips },
    brollTrack: { ...timeline.brollTrack, clips: brollClips },
    settings: {
      ...timeline.settings,
      coverTime: timeline.settings.coverTime == null
        ? null
        : clamp(timeline.settings.coverTime, 0, duration)
    }
  };
}

function withHistory(
  state: TimelineState,
  transform: (timeline: Timeline) => Timeline,
  selection = state.selection
): Partial<TimelineState> {
  if (!state.timeline) return {};
  const previous = cloneTimeline(state.timeline);
  const next = reflowTimeline(transform(cloneTimeline(state.timeline)));
  return {
    timeline: next,
    currentTime: clamp(state.currentTime, 0, next.duration),
    selection,
    history: [...state.history.slice(-(MAX_HISTORY - 1)), previous],
    future: [],
    isDirty: true
  };
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  timeline: null,
  currentTime: 0,
  isPlaying: false,
  pixelsPerSecond: 80,
  selection: null,
  rangeSelection: null,
  clipboardCount: 0,
  clipboard: null,
  rectangleSelectionActive: false,
  history: [],
  future: [],
  isDirty: false,

  loadTimeline: (timeline) => set({
    timeline: reflowTimeline(cloneTimeline(timeline)),
    currentTime: 0,
    isPlaying: false,
    selection: null,
    rangeSelection: null,
    clipboardCount: 0,
    clipboard: null,
    rectangleSelectionActive: false,
    history: [],
    future: [],
    isDirty: false
  }),

  markSaved: () => set({ isDirty: false }),

  setCurrentTime: (time) => {
    const max = get().timeline?.duration ?? 0;
    set({ currentTime: clamp(time, 0, max) });
  },

  setPlaying: (playing) => set({ isPlaying: playing }),
  togglePlaying: () => set((state) => ({ isPlaying: !state.isPlaying })),
  setRectangleSelectionActive: (active) => set({ rectangleSelectionActive: active }),
  setZoom: (pixelsPerSecond) => set({ pixelsPerSecond: clamp(pixelsPerSecond, MIN_ZOOM, MAX_ZOOM) }),
  zoomBy: (factor) => set((state) => ({
    pixelsPerSecond: clamp(state.pixelsPerSecond * factor, MIN_ZOOM, MAX_ZOOM)
  })),
  selectClip: (selection) => set({ selection, rangeSelection: null }),

  toggleVideoClipSelection: (clipId) => set((state) => {
    const current = state.selection;
    if (current?.kind === 'video') {
      const wasSelected = current.ids.includes(clipId);
      const ids = wasSelected
        ? current.ids.filter((id) => id !== clipId)
        : [...current.ids, clipId];
      if (!ids.length) return { selection: null, rangeSelection: null };
      return { selection: { kind: 'video', id: wasSelected ? ids[ids.length - 1] : clipId, ids }, rangeSelection: null };
    }
    return { selection: { kind: 'video', id: clipId, ids: [clipId] }, rangeSelection: null };
  }),

  setRangeSelection: (startTime, endTime, tracks, options) => set((state) => {
    const duration = state.timeline?.duration ?? 0;
    const from = clamp(Math.min(startTime, endTime), 0, duration);
    const to = clamp(Math.max(startTime, endTime), 0, duration);
    const validTracks: TimelineTrackKind[] = ['video', 'broll', 'audio', 'text'];
    const uniqueTracks = [...new Set(tracks)].filter((track): track is TimelineTrackKind => validTracks.includes(track));
    return {
      selection: null,
      rangeSelection: { startTime: from, endTime: to, tracks: uniqueTracks, contained: Boolean(options?.contained) }
    };
  }),

  clearRangeSelection: () => set({ rangeSelection: null }),

  copySelection: () => {
    const state = get();
    const clipboard = buildClipboard(state.timeline, state.selection, state.rangeSelection);
    if (!clipboard) return 0;
    const count = clipboardSize(clipboard);
    set({ clipboard, clipboardCount: count });
    return count;
  },

  pasteClipboard: () => {
    const state = get();
    if (!state.clipboard) return 0;
    const result = pasteClipboardAt(state, state.clipboard, state.currentTime);
    if (!result.count) return 0;
    set(result.update);
    return result.count;
  },

  duplicateSelection: () => {
    const state = get();
    const clipboard = buildClipboard(state.timeline, state.selection, state.rangeSelection);
    if (!clipboard) return 0;
    const result = pasteClipboardAt(state, clipboard, clipboard.endTime);
    if (!result.count) return 0;
    set(result.update);
    return result.count;
  },

  updateSettings: (changes) => set((state) => withHistory(state, (timeline) => ({
    ...timeline,
    settings: { ...timeline.settings, ...changes }
  }))),

  updateVideoClips: (clipIds, changes) => set((state) => {
    if (!clipIds.length) return {};
    return withHistory(state, (timeline) => ({
      ...timeline,
      videoTrack: {
        ...timeline.videoTrack,
        clips: timeline.videoTrack.clips.map((clip) => clipIds.includes(clip.id) ? { ...clip, ...changes } : clip)
      }
    }));
  }),

  updateClipTransition: (clipId, transitionType, transitionDuration) => set((state) => withHistory(state, (timeline) => ({
    ...timeline,
    videoTrack: {
      ...timeline.videoTrack,
      clips: timeline.videoTrack.clips.map((clip) => clip.id === clipId
        ? { ...clip, transitionType, transitionDuration: clamp(transitionDuration, 0.1, 1) }
        : clip)
    }
  }))),

  setAllTransitions: (transitionType, transitionDuration) => set((state) => withHistory(state, (timeline) => ({
    ...timeline,
    settings: {
      ...timeline.settings,
      transitionType,
      transitionDuration: clamp(transitionDuration, 0.1, 1)
    },
    videoTrack: {
      ...timeline.videoTrack,
      clips: timeline.videoTrack.clips.map((clip) => ({
        ...clip,
        transitionType,
        transitionDuration: clamp(transitionDuration, 0.1, 1)
      }))
    }
  }))),

  updateAudioTrack: (changes) => set((state) => withHistory(state, (timeline) => ({
    ...timeline,
    audioTrack: { ...timeline.audioTrack, ...changes }
  }))),

  setMusicTrack: (track) => set((state) => withHistory(state, (timeline) => ({ ...timeline, musicTrack: track }))),

  updateMusicTrack: (changes) => set((state) => withHistory(state, (timeline) => (
    timeline.musicTrack ? { ...timeline, musicTrack: { ...timeline.musicTrack, ...changes } } : timeline
  ))),

  addDuckingRegion: (startTime, endTime) => set((state) => withHistory(state, (timeline) => {
    if (!timeline.musicTrack) return timeline;
    const from = clamp(Math.min(startTime, endTime), 0, timeline.duration);
    const to = clamp(Math.max(startTime, endTime), 0, timeline.duration);
    if (to - from < 0.1) return timeline;
    const region = { id: `duck-${Date.now()}-${Math.round(Math.random() * 1e6)}`, startTime: from, endTime: to };
    return { ...timeline, musicTrack: { ...timeline.musicTrack, duckingRegions: [...timeline.musicTrack.duckingRegions, region] } };
  })),

  removeDuckingRegion: (regionId) => set((state) => withHistory(state, (timeline) => (
    timeline.musicTrack
      ? { ...timeline, musicTrack: { ...timeline.musicTrack, duckingRegions: timeline.musicTrack.duckingRegions.filter((region) => region.id !== regionId) } }
      : timeline
  ))),

  addVideoClip: (clip) => set((state) => {
    if (!state.timeline || state.timeline.videoTrack.clips.length >= MAX_TIMELINE_VIDEO_CLIPS) return {};
    return withHistory(state, (timeline) => ({
      ...timeline,
      videoTrack: { ...timeline.videoTrack, clips: [...timeline.videoTrack.clips, clip] }
    }), { kind: 'video', id: clip.id, ids: [clip.id] });
  }),

  setSourceThumbnails: (sourceUrl, thumbnails) => set((state) => {
    if (!state.timeline) return {};
    return {
      timeline: {
        ...state.timeline,
        videoTrack: {
          ...state.timeline.videoTrack,
          clips: state.timeline.videoTrack.clips.map((clip) => (
            clip.sourceUrl === sourceUrl ? { ...clip, thumbnails: [...thumbnails] } : clip
          ))
        }
      }
    };
  }),

  setVideoClipBounds: (clipId, sourceIn, sourceOut) => set((state) => withHistory(state, (timeline) => {
    const clips = timeline.videoTrack.clips.map((clip) => {
      if (clip.id !== clipId) return clip;
      const nextIn = clamp(sourceIn, 0, clip.sourceDuration - MIN_CLIP_DURATION);
      const nextOut = clamp(sourceOut, nextIn + MIN_CLIP_DURATION, clip.sourceDuration);
      return { ...clip, sourceIn: nextIn, sourceOut: nextOut };
    });
    return { ...timeline, videoTrack: { ...timeline.videoTrack, clips } };
  })),

  splitVideoClipAtPlayhead: () => set((state) => {
    const { timeline, currentTime } = state;
    if (!timeline || timeline.videoTrack.clips.length >= MAX_TIMELINE_VIDEO_CLIPS) return {};
    const clipIndex = timeline.videoTrack.clips.findIndex(
      (clip) => currentTime > clip.startTime + 0.1 && currentTime < clip.endTime - 0.1
    );
    if (clipIndex < 0) return {};
    const clip = timeline.videoTrack.clips[clipIndex];
    const sourceSplit = clip.sourceIn + currentTime - clip.startTime;
    const left: VideoClip = {
      ...clip,
      id: `${clip.id}-l${Date.now()}`,
      sourceOut: sourceSplit,
      transitionType: 'none'
    };
    const right: VideoClip = { ...clip, id: `${clip.id}-r${Date.now()}`, sourceIn: sourceSplit };
    return withHistory(state, (draft) => {
      const clips = [...draft.videoTrack.clips];
      clips.splice(clipIndex, 1, left, right);
      return { ...draft, videoTrack: { ...draft.videoTrack, clips } };
    }, { kind: 'video', id: right.id, ids: [right.id] });
  }),

  moveVideoClip: (clipId, direction) => set((state) => withHistory(state, (timeline) => {
    const clips = [...timeline.videoTrack.clips];
    const index = clips.findIndex((clip) => clip.id === clipId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= clips.length) return timeline;
    [clips[index], clips[target]] = [clips[target], clips[index]];
    return { ...timeline, videoTrack: { ...timeline.videoTrack, clips } };
  })),

  removeVideoClip: (clipId) => set((state) => {
    if (!state.timeline) return {};
    return withHistory(state, (timeline) => ({
      ...timeline,
      videoTrack: {
        ...timeline.videoTrack,
        clips: timeline.videoTrack.clips.filter((clip) => clip.id !== clipId)
      }
    }), null);
  }),

  setTextClipTiming: (clipId, startTime, endTime) => set((state) => withHistory(state, (timeline) => ({
    ...timeline,
    textTrack: {
      ...timeline.textTrack,
      clips: timeline.textTrack.clips.map((clip) => {
        if (clip.id !== clipId) return clip;
        const nextStart = clamp(startTime, 0, timeline.duration - MIN_CLIP_DURATION);
        return {
          ...clip,
          startTime: nextStart,
          endTime: clamp(endTime, nextStart + MIN_CLIP_DURATION, timeline.duration)
        };
      })
    }
  }))),

  updateTextClip: (clipId, changes) => set((state) => withHistory(state, (timeline) => ({
    ...timeline,
    textTrack: {
      ...timeline.textTrack,
      clips: timeline.textTrack.clips.map((clip) => clip.id === clipId ? { ...clip, ...changes } : clip)
    }
  }))),

  updateTextClips: (clipIds, changes) => set((state) => {
    if (!clipIds.length) return {};
    return withHistory(state, (timeline) => ({
      ...timeline,
      textTrack: {
        ...timeline.textTrack,
        clips: timeline.textTrack.clips.map((clip) => clipIds.includes(clip.id) ? { ...clip, ...changes } : clip)
      }
    }));
  }),

  addTextClip: (clip) => set((state) => withHistory(state, (timeline) => ({
    ...timeline,
    textTrack: { ...timeline.textTrack, clips: [...timeline.textTrack.clips, clip] }
  }), { kind: 'text', id: clip.id })),

  removeTextClip: (clipId) => set((state) => withHistory(state, (timeline) => ({
    ...timeline,
    textTrack: {
      ...timeline.textTrack,
      clips: timeline.textTrack.clips.filter((clip) => clip.id !== clipId)
    }
  }), null)),

  // Sustituye todos los clips de subtítulo (kind:'subtitle') por los que llegan
  // de la transcripción automática, sin tocar los rótulos de texto libre; se
  // hace en un único paso de deshacer/rehacer en vez de uno por frase.
  setAutoSubtitleClips: (clips) => set((state) => withHistory(state, (timeline) => ({
    ...timeline,
    textTrack: {
      ...timeline.textTrack,
      clips: [...timeline.textTrack.clips.filter((clip) => clip.kind !== 'subtitle'), ...clips]
    }
  }), null)),

  addBrollClip: (clip) => set((state) => withHistory(state, (timeline) => ({
    ...timeline,
    brollTrack: { ...timeline.brollTrack, clips: [...timeline.brollTrack.clips, clip].slice(0, MAX_TIMELINE_BROLL_CLIPS) }
  }), { kind: 'broll', id: clip.id })),

  updateBrollClip: (clipId, changes) => set((state) => withHistory(state, (timeline) => ({
    ...timeline,
    brollTrack: {
      ...timeline.brollTrack,
      clips: timeline.brollTrack.clips.map((clip) => clip.id === clipId ? { ...clip, ...changes } : clip)
    }
  }))),

  updateBrollClips: (clipIds, changes) => set((state) => {
    if (!clipIds.length) return {};
    return withHistory(state, (timeline) => ({
      ...timeline,
      brollTrack: {
        ...timeline.brollTrack,
        clips: timeline.brollTrack.clips.map((clip) => clipIds.includes(clip.id) ? { ...clip, ...changes } : clip)
      }
    }));
  }),

  removeBrollClip: (clipId) => set((state) => withHistory(state, (timeline) => ({
    ...timeline,
    brollTrack: {
      ...timeline.brollTrack,
      clips: timeline.brollTrack.clips.filter((clip) => clip.id !== clipId)
    }
  }), null)),

  moveBrollClip: (clipId, direction) => set((state) => withHistory(state, (timeline) => {
    const clips = [...timeline.brollTrack.clips];
    const index = clips.findIndex((clip) => clip.id === clipId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= clips.length) return timeline;
    [clips[index], clips[target]] = [clips[target], clips[index]];
    return { ...timeline, brollTrack: { ...timeline.brollTrack, clips } };
  })),

  setRectangleSelection: (selection) => set((state) => withHistory(state, (timeline) => ({
    ...timeline,
    roi: {
      x: clamp(selection.x, 0, 1),
      y: clamp(selection.y, 0, 1),
      width: clamp(selection.width, 0.02, 1),
      height: clamp(selection.height, 0.02, 1)
    }
  }), null)),

  // Acerca/aleja manteniendo fijo el punto anchor (o el centro del recorte
  // actual si no se indica uno): lo usan tanto la rueda del ratón sobre el
  // vídeo como los botones +/- de la barra de controles, que ya no dependen
  // de ningún estado de arrastre local para funcionar.
  zoomRectangleSelection: (factor, anchor) => set((state) => {
    if (!state.timeline) return {};
    const current = state.timeline.roi ?? ROI_FULL_FRAME;
    const width = clamp(current.width * factor, ROI_MIN_SIZE, 1);
    const height = clamp(current.height * factor, ROI_MIN_SIZE, 1);
    const anchorX = anchor?.x ?? current.x + current.width / 2;
    const anchorY = anchor?.y ?? current.y + current.height / 2;
    const relativeX = (anchorX - current.x) / current.width;
    const relativeY = (anchorY - current.y) / current.height;
    const x = clamp(anchorX - relativeX * width, 0, 1 - width);
    const y = clamp(anchorY - relativeY * height, 0, 1 - height);
    return withHistory(state, (timeline) => ({ ...timeline, roi: { x, y, width, height } }), null);
  }),

  clearRectangleSelection: () => set((state) => {
    if (!state.timeline?.roi) return {};
    return withHistory(state, (timeline) => ({ ...timeline, roi: null }), null);
  }),

  moveRangeSelection: (deltaSeconds) => set((state) => {
    const { timeline, rangeSelection } = state;
    if (!timeline || !rangeSelection || !Number.isFinite(deltaSeconds) || Math.abs(deltaSeconds) < 0.001) return {};
    const plan = planTimelineRangeMove(timeline, rangeSelection, deltaSeconds);
    if (!plan || Math.abs(plan.deltaSeconds) < 0.001) return {};
    const videoIds = new Set(plan.targets.videoIds);
    const textIds = new Set(plan.targets.textIds);
    const brollIds = new Set(plan.targets.brollIds);

    const update = withHistory(state, (current) => {
      const selectedVideos = current.videoTrack.clips.filter((clip) => videoIds.has(clip.id));
      const remainingVideos = current.videoTrack.clips.filter((clip) => !videoIds.has(clip.id));
      const insertionIndex = plan.videoInsertionIndex == null
        ? null
        : clamp(plan.videoInsertionIndex, 0, remainingVideos.length);
      const orderedVideos = insertionIndex == null
        ? current.videoTrack.clips
        : [
          ...remainingVideos.slice(0, insertionIndex),
          ...selectedVideos,
          ...remainingVideos.slice(insertionIndex)
        ];
      return {
        ...current,
        videoTrack: { ...current.videoTrack, clips: orderedVideos },
        textTrack: {
          ...current.textTrack,
          clips: current.textTrack.clips.map((clip) => textIds.has(clip.id)
            ? { ...clip, startTime: clip.startTime + plan.deltaSeconds, endTime: clip.endTime + plan.deltaSeconds }
            : clip)
        },
        brollTrack: {
          ...current.brollTrack,
          clips: current.brollTrack.clips.map((clip) => brollIds.has(clip.id)
            ? { ...clip, startTime: clip.startTime + plan.deltaSeconds, endTime: clip.endTime + plan.deltaSeconds }
            : clip)
        }
      };
    }, null);
    return {
      ...update,
      rangeSelection: {
        ...rangeSelection,
        startTime: rangeSelection.startTime + plan.deltaSeconds,
        endTime: rangeSelection.endTime + plan.deltaSeconds
      }
    };
  }),

  removeSelection: () => {
    const { selection, rangeSelection, timeline } = get();
    if (!selection && !rangeSelection) return;
    if (rangeSelection && timeline) {
      const intersectsRange = (startTime: number, endTime: number) => rangeSelection.contained
        ? startTime >= rangeSelection.startTime && endTime <= rangeSelection.endTime
        : startTime < rangeSelection.endTime && endTime > rangeSelection.startTime;
      const videoIds = rangeSelection.tracks.includes('video')
        ? new Set(timeline.videoTrack.clips.filter((clip) => intersectsRange(clip.startTime, clip.endTime)).map((clip) => clip.id))
        : new Set<string>();
      const textIds = rangeSelection.tracks.includes('text')
        ? new Set(timeline.textTrack.clips.filter((clip) => intersectsRange(clip.startTime, clip.endTime)).map((clip) => clip.id))
        : new Set<string>();
      const brollIds = rangeSelection.tracks.includes('broll')
        ? new Set(timeline.brollTrack.clips.filter((clip) => intersectsRange(clip.startTime, clip.endTime)).map((clip) => clip.id))
        : new Set<string>();
      if (!videoIds.size && !textIds.size && !brollIds.size) {
        set({ rangeSelection: null });
        return;
      }
      set((state) => {
        if (!state.timeline) return { rangeSelection: null };
        return {
          ...withHistory(state, (current) => ({
            ...current,
            videoTrack: {
              ...current.videoTrack,
              clips: current.videoTrack.clips.filter((clip) => !videoIds.has(clip.id))
            },
            textTrack: {
              ...current.textTrack,
              clips: current.textTrack.clips.filter((clip) => !textIds.has(clip.id))
            },
            brollTrack: {
              ...current.brollTrack,
              clips: current.brollTrack.clips.filter((clip) => !brollIds.has(clip.id))
            }
          }), null),
          rangeSelection: null
        };
      });
      return;
    }
    if (!selection) return;
    if (selection.kind === 'video') {
      set((state) => {
        if (!state.timeline) return {};
        const selectedIds = new Set(selection.ids);
        return withHistory(state, (timeline) => ({
          ...timeline,
          videoTrack: {
            ...timeline.videoTrack,
            clips: timeline.videoTrack.clips.filter((clip) => !selectedIds.has(clip.id))
          }
        }), null);
      });
    } else if (selection.kind === 'text') get().removeTextClip(selection.id);
    else get().removeBrollClip(selection.id);
  },

  undo: () => set((state) => {
    if (!state.timeline || !state.history.length) return {};
    const previous = state.history[state.history.length - 1];
    return {
      timeline: cloneTimeline(previous),
      currentTime: clamp(state.currentTime, 0, previous.duration),
      selection: null,
      rangeSelection: null,
      history: state.history.slice(0, -1),
      future: [cloneTimeline(state.timeline), ...state.future].slice(0, MAX_HISTORY),
      isDirty: true
    };
  }),

  redo: () => set((state) => {
    if (!state.timeline || !state.future.length) return {};
    const next = state.future[0];
    return {
      timeline: cloneTimeline(next),
      currentTime: clamp(state.currentTime, 0, next.duration),
      selection: null,
      rangeSelection: null,
      history: [...state.history, cloneTimeline(state.timeline)].slice(-MAX_HISTORY),
      future: state.future.slice(1),
      isDirty: true
    };
  })
}));
