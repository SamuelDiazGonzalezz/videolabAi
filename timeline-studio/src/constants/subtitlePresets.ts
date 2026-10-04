import type { SubtitlePreset, SubtitleWordEffect, TextClipFont, TextClipStyle } from '../types/timeline';
import subtitleRenderingCatalog from './subtitleRendering.json';

export interface SubtitlePresetRendering {
  borderStyle: number;
  outlineWidth: number;
  shadowDepth: number;
  scaleX: number;
  scaleY: number;
  spacing: number;
  angle: number;
  blur: number;
  sizeMultiplier: number;
  xShadow?: number;
  yShadow?: number;
  material3d?: boolean;
  extrusionNear?: string;
  extrusionFar?: string;
  forceBox?: boolean;
}

export interface SubtitlePresetOption {
  value: SubtitlePreset;
  label: string;
  color: string;
  inactiveColor: string;
  outlineColor: string;
  shadowColor: string;
  backColor: string;
  cssFont: string;
  weight: number;
  italic: boolean;
  upperCase: boolean;
  sample: string;
  activeWordIndex: number;
  previewBackground: string;
  textShadow: string;
  previewTransform: string;
  featured3d?: boolean;
  textFont?: TextClipFont;
  rendering: SubtitlePresetRendering;
}

const SUBTITLE_RENDERING = subtitleRenderingCatalog as Record<Exclude<SubtitlePreset, 'none'>, SubtitlePresetRendering>;

const PRESET_FONT_OVERRIDES: Record<Exclude<SubtitlePreset, 'none'>, Pick<SubtitlePresetOption, 'cssFont' | 'weight' | 'italic'>> = {
  'chrome-pink': { cssFont: '"Vidreum Nunito", sans-serif', weight: 900, italic: false },
  'gum-pop': { cssFont: '"Vidreum Nunito", sans-serif', weight: 900, italic: false },
  'pearl-gold': { cssFont: '"Vidreum Pacifico", cursive', weight: 400, italic: false },
  'studio-wood': { cssFont: '"Vidreum Noto Serif", serif', weight: 900, italic: false },
  karaoke: { cssFont: '"Vidreum Anton", sans-serif', weight: 400, italic: false },
  beasty: { cssFont: '"Vidreum Anton", sans-serif', weight: 400, italic: true },
  youshaei: { cssFont: '"Vidreum Inter", sans-serif', weight: 800, italic: false },
  mozi: { cssFont: '"Vidreum Anton", sans-serif', weight: 400, italic: false },
  glitch: { cssFont: '"Vidreum Anton", sans-serif', weight: 400, italic: false },
  deep: { cssFont: '"Vidreum Noto Serif", serif', weight: 700, italic: false },
  podp: { cssFont: '"Vidreum Inter", sans-serif', weight: 900, italic: false },
  popline: { cssFont: '"Vidreum Anton", sans-serif', weight: 400, italic: false },
  seamless: { cssFont: '"Vidreum Anton", sans-serif', weight: 400, italic: false },
  think: { cssFont: '"Vidreum Inter", sans-serif', weight: 900, italic: true },
  focus: { cssFont: '"Vidreum Anton", sans-serif', weight: 400, italic: false },
  blur: { cssFont: '"Vidreum Noto Serif", serif', weight: 700, italic: false },
  backdrop: { cssFont: '"Vidreum Inter", sans-serif', weight: 900, italic: true },
  soft: { cssFont: '"Vidreum Inter", sans-serif', weight: 800, italic: false },
  baby: { cssFont: '"Vidreum Inter", sans-serif', weight: 800, italic: false },
  grow: { cssFont: '"Vidreum Anton", sans-serif', weight: 400, italic: false },
  breathe: { cssFont: '"Vidreum Nunito", sans-serif', weight: 900, italic: false }
};

const MANUAL_RENDERING: SubtitlePresetRendering = {
  borderStyle: 1,
  outlineWidth: 4.6,
  shadowDepth: 2.4,
  scaleX: 100,
  scaleY: 100,
  spacing: 0,
  angle: 0,
  blur: 0.22,
  sizeMultiplier: 1
};

// Catálogo mínimo para el selector visual y la vista previa en vivo del
// editor profesional. La fuente de verdad de cada preset (paleta completa,
// render ASS) vive en clipping-subtitles.js, compartida con el Creador de
// clips; aquí solo se duplican los datos visuales (color, fuente, mayúsculas,
// muestra y palabra activa de la tarjeta) para poder aproximar el mismo
// aspecto en el selector y en el lienzo sin cargar ese módulo completo (ni
// sus datos de render de FFmpeg) en el bundle del editor.
const BASE_SUBTITLE_PRESET_OPTIONS: Omit<SubtitlePresetOption, 'rendering'>[] = [
  { value: 'chrome-pink', label: 'Cromo rosa', color: '#FFC3E2', inactiveColor: '#E6469A', outlineColor: '#3A092D', shadowColor: '#7C164D', backColor: '#1A0714', cssFont: '"Arial Rounded MT Bold", "Arial Black", Impact, sans-serif', weight: 900, italic: false, upperCase: true, sample: 'CROMO', activeWordIndex: 0, previewBackground: 'linear-gradient(145deg, #f3dce9, #cfa4be)', textShadow: '0 .08em 0 #7f1b55, 0 .16em 0 #521036, 0 .28em .3em rgba(49, 5, 31, .5)', previewTransform: 'scaleX(1.04)', featured3d: true, textFont: 'rounded' },
  { value: 'gum-pop', label: 'Chicle pop', color: '#FFB2DE', inactiveColor: '#FF3BA5', outlineColor: '#21103E', shadowColor: '#A91169', backColor: '#100923', cssFont: '"Arial Rounded MT Bold", "Trebuchet MS", sans-serif', weight: 900, italic: false, upperCase: false, sample: 'Text gum', activeWordIndex: 1, previewBackground: 'linear-gradient(145deg, #27c6cb 0 48%, #19142f 49% 100%)', textShadow: '0 .08em 0 #df217f, 0 .17em 0 #8c145d, .08em .25em .25em rgba(7, 5, 25, .8)', previewTransform: 'rotate(-2deg) scaleX(1.03)', featured3d: true, textFont: 'rounded' },
  { value: 'pearl-gold', label: 'Perla dorada', color: '#FFFDF7', inactiveColor: '#F0D9A8', outlineColor: '#A86C15', shadowColor: '#54320D', backColor: '#211708', cssFont: '"Segoe Script", "Brush Script MT", Georgia, serif', weight: 700, italic: true, upperCase: false, sample: 'Wish', activeWordIndex: 0, previewBackground: 'linear-gradient(145deg, #f5f4f1, #cbc9c5)', textShadow: '.04em .07em 0 #e9bd5a, .09em .14em 0 #9a5d11, .2em .28em .28em rgba(28, 20, 9, .5)', previewTransform: 'rotate(-3deg)', featured3d: true, textFont: 'serif' },
  { value: 'studio-wood', label: 'Madera estudio', color: '#F4C977', inactiveColor: '#C47B35', outlineColor: '#3A2110', shadowColor: '#160D08', backColor: '#100B08', cssFont: 'Rockwell, "Roboto Slab", Georgia, serif', weight: 900, italic: false, upperCase: true, sample: 'STUDIO', activeWordIndex: 0, previewBackground: 'repeating-linear-gradient(100deg, #2a160d 0 9px, #44271a 10px 18px, #1d100b 19px 25px)', textShadow: '.05em .07em 0 #8f4f26, .11em .14em 0 #542b17, .2em .25em .22em rgba(0, 0, 0, .72)', previewTransform: 'perspective(120px) rotateX(3deg)', featured3d: true, textFont: 'serif' },
  { value: 'karaoke', label: 'Karaoke', color: '#48FF69', inactiveColor: '#FFFFFF', outlineColor: '#07120A', shadowColor: '#2CFF5E', backColor: '#000000', cssFont: '"Arial Black", Impact, sans-serif', weight: 900, italic: false, upperCase: true, sample: 'CLIPPING WITH AI', activeWordIndex: 1, previewBackground: '#37393B', textShadow: '1px 1px 0 #fff, 3px 3px 0 #21e954', previewTransform: 'none' },
  { value: 'beasty', label: 'Beasty', color: '#F5FF63', inactiveColor: '#FFFFFF', outlineColor: '#090B0F', shadowColor: '#000000', backColor: '#000000', cssFont: '"Arial Black", Impact, sans-serif', weight: 900, italic: true, upperCase: true, sample: 'TO GET', activeWordIndex: 1, previewBackground: '#37393B', textShadow: '1px 2px 0 #08090b', previewTransform: 'skewX(-7deg)' },
  { value: 'youshaei', label: 'Youshaei', color: '#58FFB2', inactiveColor: '#FFFFFF', outlineColor: '#0B2821', shadowColor: '#124B3A', backColor: '#000000', cssFont: '"Trebuchet MS", "Segoe UI", sans-serif', weight: 800, italic: false, upperCase: true, sample: 'TO GET STARTED', activeWordIndex: 2, previewBackground: '#37393B', textShadow: '0 2px 0 #143b32', previewTransform: 'none' },
  { value: 'mozi', label: 'Mozi', color: '#56FF72', inactiveColor: '#F8F4FF', outlineColor: '#431778', shadowColor: '#B94CFF', backColor: '#000000', cssFont: 'Impact, "Arial Black", sans-serif', weight: 900, italic: false, upperCase: true, sample: 'TO GET STARTED', activeWordIndex: 1, previewBackground: '#37393B', textShadow: '2px 2px 0 #a94df5, -1px -1px 0 #172019', previewTransform: 'none' },
  { value: 'glitch', label: 'Glitch Infinite', color: '#FF344F', inactiveColor: '#FFFFFF', outlineColor: '#101010', shadowColor: '#34E7FF', backColor: '#000000', cssFont: '"Arial Black", Impact, sans-serif', weight: 900, italic: false, upperCase: false, sample: 'TO GET STARTED', activeWordIndex: 0, previewBackground: '#ECEDEF', textShadow: '-1px 0 #25dfff, 2px 1px 0 #ff254c, 0 2px 0 #111', previewTransform: 'none' },
  { value: 'deep', label: 'Deep Diver', color: '#83B7FF', inactiveColor: '#FFFFFF', outlineColor: '#101827', shadowColor: '#286DCE', backColor: '#000000', cssFont: 'Georgia, "Times New Roman", serif', weight: 700, italic: false, upperCase: false, sample: 'To get started', activeWordIndex: 1, previewBackground: '#37393B', textShadow: '0 3px 5px #245ca7', previewTransform: 'none' },
  { value: 'podp', label: 'Pod P', color: '#FF61D2', inactiveColor: '#FFFFFF', outlineColor: '#35103C', shadowColor: '#9E2486', backColor: '#000000', cssFont: 'Arial, "Segoe UI", sans-serif', weight: 900, italic: false, upperCase: true, sample: 'TO GET', activeWordIndex: 1, previewBackground: '#37393B', textShadow: '1px 2px 0 #3b153d', previewTransform: 'none' },
  { value: 'popline', label: 'Popline', color: '#FF9D2E', inactiveColor: '#FFF35A', outlineColor: '#9B171F', shadowColor: '#F23436', backColor: '#000000', cssFont: '"Arial Black", Impact, sans-serif', weight: 900, italic: false, upperCase: true, sample: 'TO GET STARTED', activeWordIndex: 1, previewBackground: '#37393B', textShadow: '2px 2px 0 #ee3137, 0 4px 0 #6f1118', previewTransform: 'none' },
  { value: 'seamless', label: 'Seamless Bounce', color: '#83E9FF', inactiveColor: '#FFFFFF', outlineColor: '#05080C', shadowColor: '#000000', backColor: '#000000', cssFont: '"Arial Black", Impact, sans-serif', weight: 900, italic: false, upperCase: true, sample: 'TO GET STARTED', activeWordIndex: 1, previewBackground: '#37393B', textShadow: '0 3px 0 #080808', previewTransform: 'none' },
  { value: 'think', label: 'Think Media', color: '#A8D3FF', inactiveColor: '#FFFFFF', outlineColor: '#0B0D12', shadowColor: '#000000', backColor: '#000000', cssFont: '"Trebuchet MS", "Segoe UI", sans-serif', weight: 900, italic: true, upperCase: true, sample: 'TO GET STARTED', activeWordIndex: 2, previewBackground: '#37393B', textShadow: '0 2px 0 #111', previewTransform: 'skewX(-8deg)' },
  { value: 'focus', label: 'Focus', color: '#ECF43B', inactiveColor: '#FFFFFF', outlineColor: '#171A0B', shadowColor: '#000000', backColor: '#000000', cssFont: 'Impact, "Arial Black", sans-serif', weight: 900, italic: false, upperCase: true, sample: 'TO GET STARTED', activeWordIndex: 1, previewBackground: '#37393B', textShadow: '2px 2px 0 #1f2123', previewTransform: 'none' },
  { value: 'blur', label: 'Blur In', color: '#FF87DF', inactiveColor: '#FFF5FD', outlineColor: '#41123C', shadowColor: '#FF58D5', backColor: '#000000', cssFont: 'Georgia, "Times New Roman", serif', weight: 700, italic: false, upperCase: false, sample: 'To get started', activeWordIndex: 1, previewBackground: '#37393B', textShadow: '0 1px 2px #fff, 0 4px 7px #ff5ee0', previewTransform: 'none' },
  { value: 'backdrop', label: 'With Backdrop', color: '#D9FF3F', inactiveColor: '#FFFFFF', outlineColor: '#090B0D', shadowColor: '#000000', backColor: '#090B0D', cssFont: '"Trebuchet MS", "Segoe UI", sans-serif', weight: 900, italic: true, upperCase: false, sample: 'To get started', activeWordIndex: 0, previewBackground: '#101317', textShadow: 'none', previewTransform: 'skewX(-4deg)' },
  { value: 'soft', label: 'Soft Landing', color: '#5DEBF5', inactiveColor: '#F4FFFF', outlineColor: '#12343B', shadowColor: '#188995', backColor: '#000000', cssFont: '"Trebuchet MS", "Segoe UI", sans-serif', weight: 800, italic: false, upperCase: false, sample: 'To get started', activeWordIndex: 2, previewBackground: '#37393B', textShadow: '0 3px 5px #176a75', previewTransform: 'none' },
  { value: 'baby', label: 'Baby Steps', color: '#FF67D5', inactiveColor: '#FFFFFF', outlineColor: '#321137', shadowColor: '#B529A0', backColor: '#000000', cssFont: '"Trebuchet MS", "Segoe UI", sans-serif', weight: 800, italic: false, upperCase: true, sample: 'TO GET STARTED', activeWordIndex: 2, previewBackground: '#37393B', textShadow: '1px 2px 0 #38113d', previewTransform: 'none' },
  { value: 'grow', label: 'Grow', color: '#C18BFF', inactiveColor: '#FFFFFF', outlineColor: '#2A1246', shadowColor: '#9A45F5', backColor: '#000000', cssFont: '"Arial Black", Impact, sans-serif', weight: 900, italic: false, upperCase: true, sample: 'TO GET STARTED', activeWordIndex: 1, previewBackground: '#37393B', textShadow: '2px 3px 0 #9745eb, 0 5px 8px #22112f', previewTransform: 'none' },
  { value: 'breathe', label: 'Breathe', color: '#32F56A', inactiveColor: '#FFFFFF', outlineColor: '#041109', shadowColor: '#000000', backColor: '#000000', cssFont: 'Verdana, "Segoe UI", sans-serif', weight: 900, italic: false, upperCase: true, sample: 'TO GET STARTED', activeWordIndex: 2, previewBackground: '#37393B', textShadow: '3px 3px 0 #030303', previewTransform: 'none' },
  { value: 'none', label: 'Sin preset', color: '#8890A0', inactiveColor: '#FFFFFF', outlineColor: '#050505', shadowColor: '#000000', backColor: '#000000', cssFont: '"Segoe UI", Arial, sans-serif', weight: 800, italic: false, upperCase: false, sample: 'Sin preset', activeWordIndex: -1, previewBackground: '#26282c', textShadow: 'none', previewTransform: 'none' }
];

export const SUBTITLE_PRESET_OPTIONS: SubtitlePresetOption[] = BASE_SUBTITLE_PRESET_OPTIONS.map((option) => ({
  ...option,
  ...(option.value === 'none' ? {} : PRESET_FONT_OVERRIDES[option.value]),
  rendering: option.value === 'none' ? MANUAL_RENDERING : SUBTITLE_RENDERING[option.value]
}));

export function resolveSubtitleRendering(
  preset: SubtitlePreset,
  treatment: TextClipStyle,
  scale = 1
): SubtitlePresetRendering {
  const base = preset === 'none' ? MANUAL_RENDERING : SUBTITLE_RENDERING[preset];
  const rendering = { ...base };
  if (rendering.forceBox) {
    if (treatment === 'box') rendering.outlineWidth += 3;
    else if (treatment === 'shadow') rendering.shadowDepth = Math.max(3.2, rendering.shadowDepth + 3.2);
  } else if (treatment === 'box') {
    rendering.borderStyle = 3;
    rendering.outlineWidth = Math.max(8, rendering.outlineWidth + 3);
    rendering.shadowDepth = 0;
  } else if (treatment === 'shadow') {
    rendering.borderStyle = 1;
    rendering.outlineWidth = Math.max(1.4, rendering.outlineWidth * .58);
    rendering.shadowDepth = Math.max(3.2, rendering.shadowDepth + 1.4);
  }
  if (scale !== 1) {
    rendering.outlineWidth *= scale;
    rendering.shadowDepth *= scale;
    rendering.spacing *= scale;
    rendering.blur *= scale;
    if (rendering.xShadow != null) rendering.xShadow *= scale;
    if (rendering.yShadow != null) rendering.yShadow *= scale;
  }
  return rendering;
}

export const FEATURED_3D_TEXT_PRESET_OPTIONS = SUBTITLE_PRESET_OPTIONS.filter((option) => option.featured3d);
export const STANDARD_SUBTITLE_PRESET_OPTIONS = SUBTITLE_PRESET_OPTIONS.filter((option) => !option.featured3d);

export function isFeatured3dPreset(preset: SubtitlePreset): boolean {
  return FEATURED_3D_TEXT_PRESET_OPTIONS.some((option) => option.value === preset);
}

export function getSubtitlePresetOption(preset: SubtitlePreset): SubtitlePresetOption {
  return SUBTITLE_PRESET_OPTIONS.find((option) => option.value === preset) || SUBTITLE_PRESET_OPTIONS[0];
}

export const WORD_EFFECT_OPTIONS: Array<{ value: SubtitleWordEffect; label: string; hint: string }> = [
  { value: 'karaoke', label: 'Karaoke', hint: 'Relleno fluido al hablar' },
  { value: 'pop', label: 'Pop', hint: 'Golpe elástico y preciso' },
  { value: 'bounce', label: 'Rebote', hint: 'Impulso rítmico suave' },
  { value: 'flash', label: 'Flash', hint: 'Brillo breve de énfasis' }
];

export interface EstimatedWord {
  text: string;
  start: number;
  end: number;
}

export interface SubtitleWordFrame {
  emphasis: number;
  outlineEmphasis: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  blur: number;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function transitionProgress(timeMs: number, startMs: number, endMs: number, acceleration = 1): number {
  if (endMs <= startMs) return timeMs >= endMs ? 1 : 0;
  return Math.pow(clampUnit((timeMs - startMs) / (endMs - startMs)), acceleration);
}

/** Deterministic equivalent of the ASS word transforms used by the exporter. */
export function subtitleWordFrame(
  effect: SubtitleWordEffect,
  currentTime: number,
  wordStart: number,
  wordEnd: number,
  baseBlur: number
): SubtitleWordFrame {
  const durationMs = Math.max(60, Math.round((wordEnd - wordStart) * 1000));
  const timeMs = Math.round((currentTime - wordStart) * 1000);
  const idle = { emphasis: 0, outlineEmphasis: 0, scaleX: 1, scaleY: 1, rotation: 0, blur: baseBlur };
  if (timeMs < 0 || timeMs >= durationMs) return idle;

  if (effect === 'karaoke') {
    const fadeMs = Math.min(90, Math.round(durationMs * .35));
    const fadeOutStart = Math.max(fadeMs, durationMs - fadeMs);
    const emphasis = timeMs < fadeMs
      ? transitionProgress(timeMs, 0, fadeMs)
      : timeMs >= fadeOutStart
        ? 1 - transitionProgress(timeMs, fadeOutStart, durationMs)
        : 1;
    return { ...idle, emphasis };
  }

  const peakEnd = Math.min(durationMs, 85);
  const settleEnd = Math.min(durationMs, 210);
  const releaseStart = Math.max(settleEnd, durationMs - 90);
  const attackAcceleration = effect === 'flash' ? .35 : .45;
  const attack = transitionProgress(timeMs, 0, peakEnd, attackAcceleration);
  const release = releaseStart < durationMs && timeMs >= releaseStart
    ? transitionProgress(timeMs, releaseStart, durationMs)
    : 0;
  const emphasis = clampUnit(attack * (1 - release));

  if (effect === 'pop') {
    const settle = timeMs <= peakEnd ? 0 : transitionProgress(timeMs, peakEnd, settleEnd, 1.25);
    const amount = timeMs <= peakEnd ? attack : 1 - settle;
    const scale = 1 + .18 * amount;
    return {
      ...idle,
      emphasis,
      scaleX: scale,
      scaleY: scale,
      blur: baseBlur + (.1 - baseBlur) * amount
    };
  }
  if (effect === 'bounce') {
    const settle = timeMs <= peakEnd ? 0 : transitionProgress(timeMs, peakEnd, settleEnd, 1.35);
    const amount = timeMs <= peakEnd ? attack : 1 - settle;
    return {
      ...idle,
      emphasis,
      scaleX: 1 + .08 * amount,
      scaleY: 1 + .26 * amount,
      rotation: -2 * amount
    };
  }

  const settle = timeMs <= peakEnd ? 0 : transitionProgress(timeMs, peakEnd, settleEnd, 1.15);
  const amount = timeMs <= peakEnd ? attack : 1 - settle;
  const scale = 1 + .06 * amount;
  return {
    emphasis,
    outlineEmphasis: attack,
    scaleX: scale,
    scaleY: scale,
    rotation: 0,
    blur: baseBlur + (1.45 - baseBlur) * amount
  };
}

export function mixHexColors(from: string, to: string, amount: number): string {
  const parse = (value: string) => /^#([0-9a-f]{6})$/i.exec(value)?.[1] || 'ffffff';
  const left = parse(from);
  const right = parse(to);
  const channel = (offset: number) => Math.round(
    Number.parseInt(left.slice(offset, offset + 2), 16)
    + (Number.parseInt(right.slice(offset, offset + 2), 16) - Number.parseInt(left.slice(offset, offset + 2), 16)) * clampUnit(amount)
  ).toString(16).padStart(2, '0');
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

// El editor no guarda el tiempo real de cada palabra transcrita (solo el
// inicio/fin de la frase completa), así que la vista previa en el lienzo
// reparte la duración de la frase entre sus palabras de forma proporcional a
// su longitud. Es la misma heurística de "peso por caracteres" que usa
// clipping-subtitles.js para agrupar frases, aplicada aquí palabra a palabra
// para aproximar en directo el barrido karaoke que FFmpeg hace al exportar.
export function estimateWordTimings(text: string, startTime: number, endTime: number): EstimatedWord[] {
  const words = text.split(/\s+/).filter(Boolean);
  const duration = Math.max(0, endTime - startTime);
  if (!words.length || duration <= 0) return words.map((word) => ({ text: word, start: startTime, end: endTime }));
  const weights = words.map((word) => word.length + 1);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = startTime;
  return words.map((word, index) => {
    const start = cursor;
    const share = (weights[index] / totalWeight) * duration;
    const end = index === words.length - 1 ? endTime : start + share;
    cursor = end;
    return { text: word, start, end };
  });
}
