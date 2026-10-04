import type {
  AspectRatio,
  AudioMode,
  BrandLogoPosition,
  BrollBlendMode,
  BrollClip,
  ClipSelection,
  ExportResolution,
  FitMode,
  FramePreset,
  Keyframe,
  KeyframeEasing,
  LayoutPreset,
  MusicTrack,
  RectangleSelection,
  SerializedTimeline,
  SubtitlePreset,
  SubtitleWordEffect,
  TextAnimationPreset,
  TextClip,
  TextClipColor,
  TextClipFont,
  TextClipKind,
  TextClipPosition,
  TextClipSize,
  TextClipStyle,
  Timeline,
  TimelineRangeSelection,
  TransitionType,
  VideoClip
} from '../types/timeline';
import {
  DEFAULT_TEXT_ANIMATION_DURATION_MS,
  MAX_TEXT_ANIMATION_DURATION_MS,
  MIN_TEXT_ANIMATION_DURATION_MS,
  TEXT_ANIMATION_OPTIONS
} from '../constants/textAnimations';

const ASPECT_RATIOS: AspectRatio[] = ['9:16', '1:1', '16:9', '4:5'];
const FIT_MODES: FitMode[] = ['contain', 'cover'];
const LAYOUT_PRESETS: LayoutPreset[] = ['fit', 'fill', 'split', 'three', 'four', 'screen-share', 'gameplay'];
const FRAME_PRESETS: FramePreset[] = ['none', 'minimal', 'neon', 'film', 'polaroid', 'cinema'];
const TRANSITIONS: TransitionType[] = [
  'none', 'fade', 'dissolve', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'circleopen'
];
const RESOLUTIONS: ExportResolution[] = ['720p', '1080p'];
const AUDIO_MODES: AudioMode[] = ['keep', 'mute', 'replace'];
const LOGO_POSITIONS: BrandLogoPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const TEXT_STYLES: TextClipStyle[] = ['outline', 'box', 'shadow'];
const TEXT_FONTS: TextClipFont[] = ['modern', 'display', 'serif', 'mono', 'rounded', 'condensed'];
const TEXT_POSITIONS: TextClipPosition[] = ['top', 'center', 'bottom'];
const TEXT_SIZES: TextClipSize[] = ['small', 'medium', 'large'];
const TEXT_COLORS: TextClipColor[] = [
  'blanco', 'negro', 'amarillo', 'naranja', 'rojo', 'rosa', 'violeta', 'azul', 'cian', 'verde'
];
const TEXT_CLIP_KINDS: TextClipKind[] = ['text', 'subtitle'];
const TEXT_ANIMATIONS: TextAnimationPreset[] = TEXT_ANIMATION_OPTIONS.map((option) => option.value);
const SUBTITLE_WORD_EFFECTS: SubtitleWordEffect[] = ['karaoke', 'pop', 'bounce', 'flash'];
const SUBTITLE_PRESETS: SubtitlePreset[] = [
  'chrome-pink', 'gum-pop', 'pearl-gold', 'studio-wood',
  'none', 'beasty', 'youshaei', 'mozi', 'glitch', 'karaoke', 'deep', 'podp', 'popline',
  'seamless', 'think', 'focus', 'blur', 'backdrop', 'soft', 'baby', 'grow', 'breathe'
];
const KEYFRAME_EASINGS: KeyframeEasing[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out'];
const BROLL_BLEND_MODES: BrollBlendMode[] = ['normal', 'multiply', 'screen'];
// 60 para admitir el storyboard de stickmans de 10 minutos (60 escenas), que
// entrega un clip de vídeo independiente por imagen generada.
export const MAX_TIMELINE_VIDEO_CLIPS = 60;
export const MAX_TIMELINE_TEXT_CLIPS = 48;
// Los subtítulos generados por transcripción automática se renderizan en un
// único archivo .ass (createTimedKaraokeSubtitleFilter), a diferencia de cada
// frase de texto libre, que se rasteriza como overlay/entrada de ffmpeg
// aparte: por eso admiten muchos más clips sin afectar al render. Sin un tope
// propio, un vídeo largo solo se subtitulaba hasta el clip 48 (unos 3-4
// minutos) aunque la transcripción completa sí se generase.
export const MAX_TIMELINE_SUBTITLE_CLIPS = 600;

const GENERATED_VIDEO_PATTERN = /^\/generated\/[0-9a-f-]{36}(?:-e\d+)?\.mp4$/i;
const GENERATED_IMAGE_PATTERN = /^\/generated\/[0-9a-f-]{36}\.(?:png|jpe?g|webp)$/i;
const GENERATED_AUDIO_PATTERN = /^\/generated\/[0-9a-f-]{36}\.(?:mp3|m4a|aac|wav|ogg|weba)$/i;
// Un clip recién generado vive en /generated/... (disco local del
// servidor), pero en cuanto el proyecto se guarda una vez pasa a servirse
// desde una URL firmada de R2 (https://...): sin aceptar también ese
// formato, reabrir cualquier proyecto ya guardado descartaba en silencio
// todos sus clips de vídeo, imagen y audio.
const REMOTE_MEDIA_PATTERN = /^(?:https?:\/\/|\/(?:assets|api\/storyboards|generated)\/)/i;
const GENERATED_VIDEO = { test: (value: string) => GENERATED_VIDEO_PATTERN.test(value) || REMOTE_MEDIA_PATTERN.test(value) };
const GENERATED_IMAGE = { test: (value: string) => GENERATED_IMAGE_PATTERN.test(value) || REMOTE_MEDIA_PATTERN.test(value) };
const GENERATED_AUDIO = { test: (value: string) => GENERATED_AUDIO_PATTERN.test(value) || REMOTE_MEDIA_PATTERN.test(value) };

function isChoice<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? value as T : fallback;
}

function finite(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Función 1 — Keyframes: al reabrir un proyecto guardado, hidrata (y valida
// defensivamente, por si el JSON quedó corrupto o es de una versión previa
// del editor) la lista de keyframes de un clip. Con menos de 2 keyframes
// válidos se descarta entera — un solo keyframe no anima nada (ver
// utils/keyframes.ts).
function normalizeKeyframesClip(value: unknown, clipDurationMs: number): Keyframe[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const keyframes = value
    .map((item, index): Keyframe | null => {
      if (!item || typeof item !== 'object') return null;
      const source = item as Partial<Keyframe>;
      const timeMs = finite(source.timeMs, NaN);
      if (!Number.isFinite(timeMs)) return null;
      return {
        id: String(source.id || `kf-${index + 1}`).slice(0, 80),
        timeMs: clamp(timeMs, 0, Math.max(0, clipDurationMs)),
        // Rango ampliado a propósito: permite entradas/salidas "desde fuera
        // de pantalla" (plantillas de la Función 2) — ver mismo comentario
        // en normalizeKeyframes de server.js.
        x: clamp(finite(source.x, 0.5), -0.5, 1.5),
        y: clamp(finite(source.y, 0.5), -0.5, 1.5),
        scale: clamp(finite(source.scale, 1), 0.05, 4),
        opacity: clamp(finite(source.opacity, 1), 0, 1),
        rotation: clamp(finite(source.rotation, 0), -360, 360),
        easing: isChoice(source.easing, KEYFRAME_EASINGS, 'linear')
      };
    })
    .filter((kf): kf is Keyframe => Boolean(kf));
  return keyframes.length >= 2 ? keyframes : undefined;
}

function normalizeTextClip(value: unknown, duration: number, index: number): TextClip | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<TextClip>;
  const text = String(source.text || '').trim().slice(0, 80);
  const startTime = clamp(finite(source.startTime, 0), 0, Math.max(0, duration - 0.2));
  const endTime = clamp(finite(source.endTime, startTime + 2), startTime + 0.2, duration);
  if (!text || endTime <= startTime) return null;
  const position = isChoice(source.position, TEXT_POSITIONS, 'center');
  const width = clamp(finite(source.width, 0.72), 0.15, 0.96);
  return {
    id: String(source.id || `text-${index + 1}`).slice(0, 80),
    kind: isChoice(source.kind, TEXT_CLIP_KINDS, 'text'),
    text,
    startTime,
    endTime,
    style: isChoice(source.style, TEXT_STYLES, 'outline'),
    font: isChoice(source.font, TEXT_FONTS, 'modern'),
    position,
    size: isChoice(source.size, TEXT_SIZES, 'medium'),
    color: isChoice(source.color, TEXT_COLORS, 'blanco'),
    x: clamp(finite(source.x, 0.5), width / 2, 1 - width / 2),
    y: clamp(finite(source.y, position === 'top' ? 0.12 : position === 'bottom' ? 0.86 : 0.5), 0.04, 0.96),
    width,
    scale: clamp(finite(source.scale, 1), 0.5, 2.5),
    preset: isChoice(source.preset, SUBTITLE_PRESETS, 'karaoke'),
    wordEffect: isChoice(source.wordEffect, SUBTITLE_WORD_EFFECTS, 'karaoke'),
    entranceAnimation: isChoice(source.entranceAnimation, TEXT_ANIMATIONS, 'none'),
    entranceDurationMs: clamp(
      finite(source.entranceDurationMs, DEFAULT_TEXT_ANIMATION_DURATION_MS),
      MIN_TEXT_ANIMATION_DURATION_MS,
      MAX_TEXT_ANIMATION_DURATION_MS
    ),
    exitAnimation: isChoice(source.exitAnimation, TEXT_ANIMATIONS, 'none'),
    exitDurationMs: clamp(
      finite(source.exitDurationMs, DEFAULT_TEXT_ANIMATION_DURATION_MS),
      MIN_TEXT_ANIMATION_DURATION_MS,
      MAX_TEXT_ANIMATION_DURATION_MS
    ),
    keyframes: normalizeKeyframesClip(source.keyframes, (endTime - startTime) * 1000)
  };
}

function normalizeBrollClip(value: unknown, duration: number, index: number): BrollClip | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<BrollClip>;
  const sourceUrl = String(source.sourceUrl || '');
  if (!GENERATED_IMAGE.test(sourceUrl)) return null;
  const startTime = clamp(finite(source.startTime, 0), 0, Math.max(0, duration - 0.2));
  const endTime = clamp(finite(source.endTime, startTime + 2), startTime + 0.2, duration);
  const width = clamp(finite(source.width, 1), 0.12, 1);
  const height = clamp(finite(source.height, 1), 0.12, 1);
  return {
    id: String(source.id || `broll-${index + 1}`).slice(0, 80),
    sourceUrl,
    ...(String(source.storageKey || '').trim() ? { storageKey: String(source.storageKey).trim().slice(0, 300) } : {}),
    name: String(source.name || `Recurso ${index + 1}`).slice(0, 120),
    startTime,
    endTime,
    opacity: clamp(finite(source.opacity, 1), 0.1, 1),
    x: clamp(finite(source.x, 0.5), width / 2, 1 - width / 2),
    y: clamp(finite(source.y, 0.5), height / 2, 1 - height / 2),
    width,
    height,
    blendMode: isChoice(source.blendMode, BROLL_BLEND_MODES, 'normal'),
    keyframes: normalizeKeyframesClip(source.keyframes, (endTime - startTime) * 1000)
  };
}

// Función 6 — Editor de audio por capas.
function normalizeMusicTrack(value: unknown, duration: number): MusicTrack | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<MusicTrack>;
  const sourceUrl = String(source.sourceUrl || '');
  if (!GENERATED_AUDIO.test(sourceUrl)) return null;
  const startTime = clamp(finite(source.startTime, 0), 0, Math.max(0, duration - 0.5));
  const endTime = clamp(finite(source.endTime, duration), startTime + 0.5, duration);
  const regions = Array.isArray(source.duckingRegions) ? source.duckingRegions : [];
  return {
    id: String(source.id || 'music-1').slice(0, 80),
    type: 'music',
    sourceUrl,
    ...(String(source.storageKey || '').trim() ? { storageKey: String(source.storageKey).trim().slice(0, 300) } : {}),
    name: String(source.name || 'Música').slice(0, 120),
    startTime,
    endTime,
    volume: clamp(finite(source.volume, 0.6), 0, 1),
    fadeInMs: Math.max(0, finite(source.fadeInMs, 500)),
    fadeOutMs: Math.max(0, finite(source.fadeOutMs, 800)),
    duckingEnabled: Boolean(source.duckingEnabled),
    duckingAmount: clamp(finite(source.duckingAmount, 0.7), 0, 1),
    duckingRegions: regions
      .map((region, index) => {
        const item = region as { id?: string; startTime?: number; endTime?: number };
        const regionStart = clamp(finite(item?.startTime, NaN), 0, duration);
        const regionEnd = clamp(finite(item?.endTime, NaN), 0, duration);
        if (!Number.isFinite(regionStart) || !Number.isFinite(regionEnd) || regionEnd - regionStart < 0.05) return null;
        return { id: String(item?.id || `duck-${index + 1}`).slice(0, 80), startTime: regionStart, endTime: regionEnd };
      })
      .filter((region): region is { id: string; startTime: number; endTime: number } => Boolean(region))
  };
}

function normalizeRectangleSelection(value: unknown): RectangleSelection | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<RectangleSelection>;
  const x = clamp(finite(source.x, 0), 0, 1);
  const y = clamp(finite(source.y, 0), 0, 1);
  const width = clamp(finite(source.width, 0), 0.02, 1 - x);
  const height = clamp(finite(source.height, 0), 0.02, 1 - y);
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

export function buildTimeline(
  sourceUrl: string,
  sourceDuration: number,
  thumbnails: string[],
  saved?: unknown,
  initialAspectRatio: AspectRatio = '9:16'
): Timeline {
  const safeDuration = clamp(finite(sourceDuration, 5), 0.5, 90);
  const serialized = saved && typeof saved === 'object' && [1, 2].includes(Number((saved as { version?: unknown }).version))
    ? saved as Partial<SerializedTimeline>
    : null;
  const persistedSource = serialized && typeof serialized.sourceUrl === 'string'
    ? serialized.sourceUrl
    : sourceUrl;
  const effectiveSource = GENERATED_VIDEO.test(persistedSource) ? persistedSource : sourceUrl;
  const hasVideoSource = GENERATED_VIDEO.test(effectiveSource);
  const effectiveSourceDuration = clamp(finite(serialized?.sourceDuration, safeDuration), 0.5, 90);
  const settings: Partial<SerializedTimeline['settings']> = serialized?.settings && typeof serialized.settings === 'object'
    ? serialized.settings
    : {};
  const defaultTransitionType = isChoice(settings.transitionType, TRANSITIONS, 'none');
  const defaultTransitionDuration = clamp(finite(settings.transitionDuration, 0.35), 0.1, 1);
  const startTransitionType = isChoice(settings.startTransitionType, TRANSITIONS, 'none');
  const startTransitionDuration = clamp(finite(settings.startTransitionDuration, 0.35), 0.1, 1);
  const endTransitionType = isChoice(settings.endTransitionType, TRANSITIONS, 'none');
  const endTransitionDuration = clamp(finite(settings.endTransitionDuration, 0.35), 0.1, 1);

  let cursor = 0;
  const savedClips = Array.isArray(serialized?.clips) ? serialized.clips.slice(0, MAX_TIMELINE_VIDEO_CLIPS) : [];
  const clips = savedClips.reduce<VideoClip[]>((items, value, index) => {
    const savedClipSource = String(value?.sourceUrl || '');
    const clipSource = GENERATED_VIDEO.test(savedClipSource) ? savedClipSource : effectiveSource;
    if (!GENERATED_VIDEO.test(clipSource)) return items;
    const clipSourceDuration = clamp(finite(value?.sourceDuration, effectiveSourceDuration), 0.5, 90);
    const sourceIn = clamp(finite(value?.sourceIn, 0), 0, clipSourceDuration - 0.2);
    const sourceOut = clamp(finite(value?.sourceOut, clipSourceDuration), sourceIn + 0.2, clipSourceDuration);
    if (sourceOut - sourceIn < 0.2) return items;
    const clip: VideoClip = {
      id: String(value?.id || `clip-${index + 1}`).slice(0, 80),
      sourceUrl: clipSource,
      ...(String(value?.storageKey || '').trim() ? { storageKey: String(value.storageKey).trim().slice(0, 300) } : {}),
      sourceDuration: clipSourceDuration,
      thumbnails: clipSource === effectiveSource ? thumbnails : [],
      sourceIn,
      sourceOut,
      startTime: cursor,
      endTime: cursor + sourceOut - sourceIn,
      name: String(value?.name || `Clip ${index + 1}`).slice(0, 120),
      transitionType: isChoice(value?.transitionType, TRANSITIONS, defaultTransitionType),
      transitionDuration: clamp(finite(value?.transitionDuration, defaultTransitionDuration), 0.1, 1),
      brightness: clamp(finite(value?.brightness, finite(settings.brightness, 0)), -0.3, 0.3),
      contrast: clamp(finite(value?.contrast, finite(settings.contrast, 1)), 0.5, 1.5),
      saturation: clamp(finite(value?.saturation, finite(settings.saturation, 1)), 0, 2),
      sharpen: clamp(finite(value?.sharpen, finite(settings.sharpen, 0)), 0, 1),
      temperature: clamp(finite(value?.temperature, finite(settings.temperature, 0)), -100, 100),
      trackingEnabled: Boolean(value?.trackingEnabled ?? settings.trackingEnabled),
      focusX: clamp(finite(value?.focusX, finite(settings.focusX, 0.5)), 0, 1),
      focusY: clamp(finite(value?.focusY, finite(settings.focusY, 0.5)), 0, 1)
    };
    cursor = clip.endTime;
    items.push(clip);
    return items;
  }, []);

  if (!clips.length && hasVideoSource) {
    clips.push({
      id: 'clip-1',
      sourceUrl: effectiveSource,
      sourceDuration: safeDuration,
      thumbnails,
      sourceIn: 0,
      sourceOut: safeDuration,
      startTime: 0,
      endTime: safeDuration,
      name: 'V\u00eddeo original',
      transitionType: defaultTransitionType,
      transitionDuration: defaultTransitionDuration,
      brightness: clamp(finite(settings.brightness, 0), -0.3, 0.3),
      contrast: clamp(finite(settings.contrast, 1), 0.5, 1.5),
      saturation: clamp(finite(settings.saturation, 1), 0, 2),
      sharpen: clamp(finite(settings.sharpen, 0), 0, 1),
      temperature: clamp(finite(settings.temperature, 0), -100, 100),
      trackingEnabled: Boolean(settings.trackingEnabled),
      focusX: clamp(finite(settings.focusX, 0.5), 0, 1),
      focusY: clamp(finite(settings.focusY, 0.5), 0, 1)
    });
    cursor = safeDuration;
  }

  const audio: Partial<SerializedTimeline['audio']> = serialized?.audio && typeof serialized.audio === 'object'
    ? serialized.audio
    : {};
  const rawTextClips = Array.isArray(serialized?.textClips) ? serialized.textClips : [];
  const textClips = [
    ...rawTextClips.filter((value) => (value as { kind?: string })?.kind === 'subtitle').slice(0, MAX_TIMELINE_SUBTITLE_CLIPS),
    ...rawTextClips.filter((value) => (value as { kind?: string })?.kind !== 'subtitle').slice(0, MAX_TIMELINE_TEXT_CLIPS)
  ]
    .map((value, index) => normalizeTextClip(value, cursor, index))
    .filter((value): value is TextClip => Boolean(value));
  const brollClips = (Array.isArray(serialized?.brollClips) ? serialized.brollClips : [])
    .slice(0, 8)
    .map((value, index) => normalizeBrollClip(value, cursor, index))
    .filter((value): value is BrollClip => Boolean(value));
  const fitMode = isChoice(settings.fitMode, FIT_MODES, 'contain');
  const layoutPreset = isChoice(settings.layoutPreset, LAYOUT_PRESETS, fitMode === 'cover' ? 'fill' : 'fit');
  const brandLogoUrl = GENERATED_IMAGE.test(String(settings.brandLogoUrl || '')) ? String(settings.brandLogoUrl) : '';
  const externalUrl = GENERATED_AUDIO.test(String(audio.externalUrl || '')) ? String(audio.externalUrl) : '';

  return {
    duration: cursor,
    sourceDuration: effectiveSourceDuration,
    videoTrack: { id: 'video-track', type: 'video', clips },
    audioTrack: {
      id: 'audio-track',
      type: 'audio',
      sourceUrl: effectiveSource,
      mode: isChoice(audio.mode, AUDIO_MODES, 'keep'),
      volume: clamp(finite(audio.volume, 1), 0, 1),
      externalName: String(audio.externalName || '').slice(0, 120),
      externalUrl,
      ...(String(audio.externalStorageKey || '').trim()
        ? { externalStorageKey: String(audio.externalStorageKey).trim().slice(0, 300) }
        : {}),
      cleanup: Boolean(audio.cleanup)
    },
    musicTrack: normalizeMusicTrack(serialized?.musicTrack, cursor),
    textTrack: { id: 'text-track', type: 'text', clips: textClips },
    brollTrack: { id: 'broll-track', type: 'broll', clips: brollClips },
    roi: normalizeRectangleSelection(serialized?.roi),
    settings: {
      aspectRatio: isChoice(settings.aspectRatio, ASPECT_RATIOS, initialAspectRatio),
      fitMode: layoutPreset === 'fill' ? 'cover' : layoutPreset === 'fit' ? 'contain' : fitMode,
      layoutPreset,
      framePreset: isChoice(settings.framePreset, FRAME_PRESETS, 'none'),
      resolution: isChoice(settings.resolution, RESOLUTIONS, '1080p'),
      trackingEnabled: Boolean(settings.trackingEnabled),
      focusX: clamp(finite(settings.focusX, 0.5), 0, 1),
      focusY: clamp(finite(settings.focusY, 0.5), 0, 1),
      transitionType: defaultTransitionType,
      transitionDuration: defaultTransitionDuration,
      startTransitionType,
      startTransitionDuration,
      endTransitionType,
      endTransitionDuration,
      brightness: clamp(finite(settings.brightness, 0), -0.3, 0.3),
      contrast: clamp(finite(settings.contrast, 1), 0.5, 1.5),
      saturation: clamp(finite(settings.saturation, 1), 0, 2),
      sharpen: clamp(finite(settings.sharpen, 0), 0, 1),
      temperature: clamp(finite(settings.temperature, 0), -100, 100),
      brandLogoUrl,
      ...(String(settings.brandLogoStorageKey || '').trim()
        ? { brandLogoStorageKey: String(settings.brandLogoStorageKey).trim().slice(0, 300) }
        : {}),
      brandLogoName: String(settings.brandLogoName || '').slice(0, 120),
      brandLogoPosition: isChoice(settings.brandLogoPosition, LOGO_POSITIONS, 'top-right'),
      brandLogoScale: clamp(finite(settings.brandLogoScale, 0.16), 0.08, 0.32),
      coverTime: settings.coverTime == null ? null : clamp(finite(settings.coverTime, 0), 0, cursor),
      coverTitle: String(settings.coverTitle || '').slice(0, 80),
      coverTitlePosition: isChoice(settings.coverTitlePosition, TEXT_POSITIONS, 'bottom'),
      coverTitleColor: isChoice(settings.coverTitleColor, TEXT_COLORS, 'blanco')
    }
  };
}

export function serializeTimeline(timeline: Timeline): SerializedTimeline {
  return {
    version: 2,
    sourceUrl: timeline.videoTrack.clips[0]?.sourceUrl || '',
    sourceDuration: timeline.videoTrack.clips[0]?.sourceDuration || timeline.sourceDuration,
    clips: timeline.videoTrack.clips.map(({
      id,
      sourceUrl,
      storageKey,
      sourceDuration,
      sourceIn,
      sourceOut,
      name,
      transitionType,
      transitionDuration,
      brightness,
      contrast,
      saturation,
      sharpen,
      temperature,
      trackingEnabled,
      focusX,
      focusY
    }) => ({
      id, sourceUrl, storageKey, sourceDuration, sourceIn, sourceOut, name, transitionType, transitionDuration,
      brightness, contrast, saturation, sharpen, temperature, trackingEnabled, focusX, focusY
    })),
    textClips: timeline.textTrack.clips.map((clip) => ({ ...clip })),
    brollClips: timeline.brollTrack.clips.map((clip) => ({ ...clip })),
    roi: timeline.roi ? { ...timeline.roi } : null,
    audio: {
      mode: timeline.audioTrack.mode,
      volume: timeline.audioTrack.volume,
      externalName: timeline.audioTrack.externalName,
      externalUrl: timeline.audioTrack.externalUrl,
      externalStorageKey: timeline.audioTrack.externalStorageKey,
      cleanup: timeline.audioTrack.cleanup
    },
    musicTrack: timeline.musicTrack ? { ...timeline.musicTrack, duckingRegions: timeline.musicTrack.duckingRegions.map((region) => ({ ...region })) } : null,
    settings: { ...timeline.settings }
  };
}

export interface TimelineRangeTargets {
  videoIds: string[];
  brollIds: string[];
  textIds: string[];
  audio: boolean;
}

export function getTimelineRangeTargets(
  timeline: Timeline,
  rangeSelection: TimelineRangeSelection | null | undefined
): TimelineRangeTargets {
  if (!rangeSelection) return { videoIds: [], brollIds: [], textIds: [], audio: false };
  const intersectsRange = (startTime: number, endTime: number) => rangeSelection.contained
    ? startTime >= rangeSelection.startTime && endTime <= rangeSelection.endTime
    : startTime < rangeSelection.endTime && endTime > rangeSelection.startTime;
  return {
    videoIds: rangeSelection.tracks.includes('video')
      ? timeline.videoTrack.clips.filter((clip) => intersectsRange(clip.startTime, clip.endTime)).map((clip) => clip.id)
      : [],
    brollIds: rangeSelection.tracks.includes('broll')
      ? timeline.brollTrack.clips.filter((clip) => intersectsRange(clip.startTime, clip.endTime)).map((clip) => clip.id)
      : [],
    textIds: rangeSelection.tracks.includes('text')
      ? timeline.textTrack.clips.filter((clip) => intersectsRange(clip.startTime, clip.endTime)).map((clip) => clip.id)
      : [],
    audio: rangeSelection.tracks.includes('audio')
  };
}

export function correctionTargetClipIds(
  timeline: Timeline,
  selection: ClipSelection | null,
  rangeSelection?: TimelineRangeSelection | null
): string[] {
  if (rangeSelection) return getTimelineRangeTargets(timeline, rangeSelection).videoIds;
  if (selection?.kind === 'video' && selection.ids.length) return selection.ids;
  return timeline.videoTrack.clips.map((clip) => clip.id);
}

export function correctionSourceClip(
  timeline: Timeline,
  selection: ClipSelection | null,
  rangeSelection?: TimelineRangeSelection | null
): VideoClip | undefined {
  if (rangeSelection) {
    const clipId = getTimelineRangeTargets(timeline, rangeSelection).videoIds[0];
    return clipId ? timeline.videoTrack.clips.find((clip) => clip.id === clipId) : undefined;
  }
  if (selection?.kind === 'video') {
    const found = timeline.videoTrack.clips.find((clip) => clip.id === selection.id);
    if (found) return found;
  }
  return timeline.videoTrack.clips[0];
}

export function clipAtProjectTime(timeline: Timeline, projectTime: number): VideoClip | undefined {
  const safeTime = clamp(projectTime, 0, timeline.duration);
  return timeline.videoTrack.clips.find((clip, index, clips) => (
    safeTime >= clip.startTime && (safeTime < clip.endTime || index === clips.length - 1)
  ));
}

export function sourceTimeAtProjectTime(timeline: Timeline, projectTime: number): number {
  const clip = clipAtProjectTime(timeline, projectTime);
  if (!clip) return 0;
  return clamp(clip.sourceIn + projectTime - clip.startTime, clip.sourceIn, clip.sourceOut);
}

export function formatTimecode(seconds: number, includeFrames = true): string {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const frames = Math.floor((safe % 1) * 100);
  const base = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return includeFrames ? `${base}.${String(frames).padStart(2, '0')}` : base;
}
