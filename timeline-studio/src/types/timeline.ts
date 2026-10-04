export type AspectRatio = '9:16' | '1:1' | '16:9' | '4:5';
export type FitMode = 'contain' | 'cover';
export type LayoutPreset = 'fit' | 'fill' | 'split' | 'three' | 'four' | 'screen-share' | 'gameplay';
export type FramePreset = 'none' | 'minimal' | 'neon' | 'film' | 'polaroid' | 'cinema';
export type TransitionType =
  | 'none'
  | 'fade'
  | 'dissolve'
  | 'wipeleft'
  | 'wiperight'
  | 'slideleft'
  | 'slideright'
  | 'circleopen';
export type ExportResolution = '720p' | '1080p';
export type AudioMode = 'keep' | 'mute' | 'replace';
export type BrandLogoPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface VideoClip {
  id: string;
  sourceUrl: string;
  storageKey?: string;
  sourceDuration: number;
  thumbnails: string[];
  sourceIn: number;
  sourceOut: number;
  startTime: number;
  endTime: number;
  name: string;
  transitionType: TransitionType;
  transitionDuration: number;
  brightness: number;
  contrast: number;
  saturation: number;
  sharpen: number;
  /** Función 4 — Corrección de color: -100 (fría/azulada) a 100 (cálida/anaranjada), 0 = neutra. */
  temperature: number;
  trackingEnabled: boolean;
  focusX: number;
  focusY: number;
}

export const DEFAULT_VIDEO_CLIP_CORRECTION: Pick<
  VideoClip,
  'brightness' | 'contrast' | 'saturation' | 'sharpen' | 'temperature' | 'trackingEnabled' | 'focusX' | 'focusY'
> = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  sharpen: 0,
  temperature: 0,
  trackingEnabled: false,
  focusX: 0.5,
  focusY: 0.5
};

export interface VideoTrack {
  id: string;
  type: 'video';
  clips: VideoClip[];
}

export interface AudioTrack {
  id: string;
  type: 'audio';
  sourceUrl: string;
  mode: AudioMode;
  volume: number;
  externalName: string;
  externalUrl: string;
  externalStorageKey?: string;
  cleanup: boolean;
}

// Función 6 — Editor de audio por capas con ducking automático. Segunda
// pista de audio independiente ("música"), en paralelo a `AudioTrack`
// (que sigue siendo la voz/narración: audio original del vídeo o
// sustituido). `startTime`/`endTime` la colocan en el timeline igual que un
// B-Roll; si la fuente dura menos que ese hueco, se repite en bucle (igual
// que ya hace el `<audio loop>` de la pista de voz sustituida).
export interface MusicDuckingRegion {
  id: string;
  /** Tiempo ABSOLUTO del proyecto (no relativo al clip de música) — se marca directamente sobre donde hay voz. */
  startTime: number;
  endTime: number;
}

export interface MusicTrack {
  id: string;
  type: 'music';
  sourceUrl: string;
  storageKey?: string;
  name: string;
  startTime: number;
  endTime: number;
  /** 0–1, volumen base fuera de cualquier ducking/fade. */
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
  duckingEnabled: boolean;
  /** 0–1: fracción en que baja el volumen durante un tramo marcado (0 = no baja, 1 = silencio total). */
  duckingAmount: number;
  duckingRegions: MusicDuckingRegion[];
}

export type TextClipStyle = 'outline' | 'box' | 'shadow';
export type TextClipFont = 'modern' | 'display' | 'serif' | 'mono' | 'rounded' | 'condensed';
export type TextClipPosition = 'top' | 'center' | 'bottom';
export type TextClipSize = 'small' | 'medium' | 'large';
export type TextAnimationPreset =
  | 'none'
  | 'fade'
  | 'pop'
  | 'bounce'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'spin';
export type TextClipColor =
  | 'blanco'
  | 'negro'
  | 'amarillo'
  | 'naranja'
  | 'rojo'
  | 'rosa'
  | 'violeta'
  | 'azul'
  | 'cian'
  | 'verde';

// 'text' es un rótulo libre (posición x/y/ancho/escala arbitrarios, se quema
// como imagen PNG rasterizada). 'subtitle' usa el motor ASS karaoke real
// (preset + wordEffect, posición fija arriba/centro/abajo) compartido con el
// Creador de clips.
// Función 1 — Keyframes simples de transformación: anima x/y/escala/opacidad/
// rotación de un TextClip ('text', no 'subtitle') o BrollClip entre 2+
// puntos en el tiempo. `timeMs` es RELATIVO al inicio del propio clip (0 =
// startTime del clip), así que mover o recortar el clip no desplaza su
// animación. `easing` describe cómo se anima el TRAMO que sale de este
// keyframe hacia el siguiente (igual que un "ease out" de After Effects); el
// easing del último keyframe no se usa. La interpolación real vive en
// utils/keyframes.ts (pura, testeada) y se espeja en server.js para el
// export — ver comentario en ese archivo.
export type KeyframeEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export interface Keyframe {
  id: string;
  timeMs: number;
  x: number;
  y: number;
  /** Multiplicador de tamaño: 1 = tamaño base del elemento. */
  scale: number;
  /** 0–1, igual escala que el resto de campos de opacidad del proyecto. */
  opacity: number;
  /** Grados, sentido horario. */
  rotation: number;
  easing: KeyframeEasing;
}

export type TextClipKind = 'text' | 'subtitle';
export type SubtitleWordEffect = 'karaoke' | 'pop' | 'bounce' | 'flash';
export type SubtitlePreset =
  | 'chrome-pink'
  | 'gum-pop'
  | 'pearl-gold'
  | 'studio-wood'
  | 'none'
  | 'beasty'
  | 'youshaei'
  | 'mozi'
  | 'glitch'
  | 'karaoke'
  | 'deep'
  | 'podp'
  | 'popline'
  | 'seamless'
  | 'think'
  | 'focus'
  | 'blur'
  | 'backdrop'
  | 'soft'
  | 'baby'
  | 'grow'
  | 'breathe';

export interface TextClip {
  id: string;
  kind: TextClipKind;
  text: string;
  startTime: number;
  endTime: number;
  style: TextClipStyle;
  font: TextClipFont;
  position: TextClipPosition;
  size: TextClipSize;
  color: TextClipColor;
  x: number;
  y: number;
  width: number;
  scale: number;
  preset: SubtitlePreset;
  wordEffect: SubtitleWordEffect;
  /** Preset listo para usar al aparecer la frase (solo kind:'text'). */
  entranceAnimation: TextAnimationPreset;
  /** Duracion del efecto de entrada, relativa al inicio de la frase. */
  entranceDurationMs: number;
  /** Preset listo para usar al desaparecer la frase (solo kind:'text'). */
  exitAnimation: TextAnimationPreset;
  /** Duracion del efecto de salida, relativa al final de la frase. */
  exitDurationMs: number;
  /** Función 1: animación opcional de transformación (solo kind:'text'). */
  keyframes?: Keyframe[];
}

export interface TextTrack {
  id: string;
  type: 'text';
  clips: TextClip[];
}

// Función 3 — Capas superpuestas. El orden dentro de BrollTrack.clips ES el
// orden de composición (el último del array se dibuja encima de todos) —
// moveBrollClip en el store lo reordena. 'multiply'/'screen' solo se aplican
// en el export cuando el clip NO tiene keyframes (Función 1): combinar
// blend modes con una posición/tamaño animados requeriría recortar una
// región que también se mueve fotograma a fotograma, fuera de alcance por
// ahora — con keyframes, un blend mode distinto de 'normal' se ignora en el
// export (la previsualización si lo respeta, vía mix-blend-mode CSS).
export type BrollBlendMode = 'normal' | 'multiply' | 'screen';

export interface BrollClip {
  id: string;
  sourceUrl: string;
  name: string;
  startTime: number;
  endTime: number;
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  storageKey?: string;
  blendMode: BrollBlendMode;
  /** Función 1: animación opcional de transformación. */
  keyframes?: Keyframe[];
}

export interface BrollTrack {
  id: string;
  type: 'broll';
  clips: BrollClip[];
}

/** A non-destructive region of interest, expressed in canvas-relative coordinates. */
export interface RectangleSelection {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProjectSettings {
  aspectRatio: AspectRatio;
  fitMode: FitMode;
  layoutPreset: LayoutPreset;
  framePreset: FramePreset;
  resolution: ExportResolution;
  trackingEnabled: boolean;
  focusX: number;
  focusY: number;
  transitionType: TransitionType;
  transitionDuration: number;
  startTransitionType: TransitionType;
  startTransitionDuration: number;
  endTransitionType: TransitionType;
  endTransitionDuration: number;
  brightness: number;
  contrast: number;
  saturation: number;
  sharpen: number;
  temperature: number;
  brandLogoUrl: string;
  brandLogoStorageKey?: string;
  brandLogoName: string;
  brandLogoPosition: BrandLogoPosition;
  brandLogoScale: number;
  coverTime: number | null;
  coverTitle: string;
  coverTitlePosition: TextClipPosition;
  coverTitleColor: TextClipColor;
}

export interface Timeline {
  duration: number;
  sourceDuration: number;
  videoTrack: VideoTrack;
  audioTrack: AudioTrack;
  /** Función 6: pista de música independiente, null si no se ha añadido ninguna. */
  musicTrack: MusicTrack | null;
  textTrack: TextTrack;
  brollTrack: BrollTrack;
  roi: RectangleSelection | null;
  settings: ProjectSettings;
}

export type TimelineTrackKind = 'video' | 'broll' | 'audio' | 'text';

export interface TimelineRangeSelection {
  startTime: number;
  endTime: number;
  tracks: TimelineTrackKind[];
  contained?: boolean;
}

export type ClipSelection =
  | { kind: 'video'; id: string; ids: string[] }
  | { kind: 'text'; id: string }
  | { kind: 'broll'; id: string };

export interface SerializedVideoClip {
  id: string;
  sourceUrl?: string;
  sourceDuration?: number;
  sourceIn: number;
  sourceOut: number;
  name?: string;
  transitionType?: TransitionType;
  transitionDuration?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  sharpen?: number;
  temperature?: number;
  trackingEnabled?: boolean;
  focusX?: number;
  focusY?: number;
  // Clave del objeto en R2. Se anota al guardar para poder volver a firmar la
  // URL al reabrir el proyecto: las URLs firmadas caducan a los 15 minutos.
  storageKey?: string;
  imageUrl?: string;
  imageStorageKey?: string;
}

export interface SerializedTimeline {
  version: 1 | 2;
  sourceUrl: string;
  sourceDuration: number;
  clips: SerializedVideoClip[];
  textClips: TextClip[];
  brollClips?: BrollClip[];
  roi?: RectangleSelection | null;
  mediaAssets?: MediaAsset[];
  audio: Pick<AudioTrack, 'mode' | 'volume' | 'externalName'> & Partial<Pick<AudioTrack, 'externalUrl' | 'externalStorageKey' | 'cleanup'>>;
  /** Función 6. */
  musicTrack?: MusicTrack | null;
  settings: ProjectSettings;
}

export interface MediaAsset {
  id: string;
  name: string;
  type: 'image' | 'video' | 'audio';
  url: string;
  duration: number;
  thumbnailUrl?: string;
  storageKey?: string;
}

export const TEXT_COLORS: Record<TextClipColor, string> = {
  blanco: '#ffffff',
  negro: '#111111',
  amarillo: '#ffd400',
  naranja: '#ff8a3d',
  rojo: '#ff4d4d',
  rosa: '#ff7fb2',
  violeta: '#b388ff',
  azul: '#4d9fff',
  cian: '#4fe3e0',
  verde: '#52e07c'
};

export const TEXT_FONT_FAMILIES: Record<TextClipFont, string> = {
  modern: '"Vidreum Inter", sans-serif',
  display: '"Vidreum Anton", sans-serif',
  serif: '"Vidreum Noto Serif", serif',
  mono: '"Vidreum Roboto Mono", monospace',
  rounded: '"Vidreum Nunito", sans-serif',
  condensed: '"Vidreum Oswald", sans-serif'
};

export const TEXT_FONT_WEIGHTS: Record<TextClipFont, number> = {
  modern: 800,
  display: 400,
  serif: 700,
  mono: 700,
  rounded: 900,
  condensed: 700
};
