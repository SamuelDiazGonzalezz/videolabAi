import {
  TEXT_COLORS,
  TEXT_FONT_FAMILIES,
  TEXT_FONT_WEIGHTS,
  type AspectRatio,
  type ExportResolution,
  type TextClip
} from '../types/timeline';
import { getSubtitlePresetOption } from '../constants/subtitlePresets';

const OUTPUT_SIZES: Record<ExportResolution, Record<AspectRatio, [number, number]>> = {
  '720p': {
    '9:16': [720, 1280],
    '1:1': [720, 720],
    '16:9': [1280, 720],
    '4:5': [720, 900]
  },
  '1080p': {
    '9:16': [1080, 1920],
    '1:1': [1080, 1080],
    '16:9': [1920, 1080],
    '4:5': [1080, 1350]
  }
};

export const TEXT_SIZE_DIVISORS = {
  small: 28,
  medium: 22,
  // "Grande" has to be visibly larger than the default caption size.  This
  // value is also mirrored by the server-side subtitle renderer.
  large: 15
} as const;

export interface RasterizedTextOverlay {
  renderedImage: string;
  renderedWidth: number;
  renderedHeight: number;
}

function splitLongWord(context: CanvasRenderingContext2D, word: string, maxWidth: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const character of Array.from(word)) {
    const candidate = current + character;
    if (current && context.measureText(candidate).width > maxWidth) {
      chunks.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }

    let current = '';
    for (const word of words) {
      const chunks = context.measureText(word).width > maxWidth
        ? splitLongWord(context, word, maxWidth)
        : [word];
      for (const chunk of chunks) {
        const candidate = current ? `${current} ${chunk}` : chunk;
        if (current && context.measureText(candidate).width > maxWidth) {
          lines.push(current);
          current = chunk;
        } else {
          current = candidate;
        }
      }
    }
    if (current) lines.push(current);
  }
  return lines.length ? lines : [''];
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.roundRect(x, y, width, height, safeRadius);
}

type FeaturedMaterialId = 'chrome-pink' | 'gum-pop' | 'pearl-gold' | 'studio-wood';

interface MaterialCanvasSpec {
  edge: string;
  bevel: string;
  extrusionNear: string;
  extrusionFar: string;
  highlight: string;
  highlightStroke?: number;
  highlightAlpha?: number;
  texture?: 'wood';
  shadow: string;
  depthX: number;
  depthY: number;
  outerStroke: number;
  bevelStroke: number;
  shadowBlur: number;
  shadowX: number;
  shadowY: number;
  faceStops: Array<[number, string]>;
}

const MATERIAL_CANVAS_SPECS: Record<FeaturedMaterialId, MaterialCanvasSpec> = {
  'chrome-pink': {
    edge: '#3a092d', bevel: '#f6acd3', extrusionNear: '#9f286c', extrusionFar: '#561038', highlight: '#fff9ff',
    shadow: 'rgba(47, 4, 29, .62)', depthX: .075, depthY: .13, outerStroke: .13, bevelStroke: .055,
    shadowBlur: .2, shadowX: .13, shadowY: .24,
    faceStops: [[0, '#fffaff'], [.09, '#ffd8ec'], [.23, '#9f286b'], [.39, '#ffe9f4'], [.55, '#e1549b'], [.72, '#6b1447'], [.88, '#ffc7e4'], [1, '#8c215c']]
  },
  'gum-pop': {
    edge: '#21103e', bevel: '#ff94ce', extrusionNear: '#c71978', extrusionFar: '#701047', highlight: '#fff2fb',
    shadow: 'rgba(6, 4, 22, .78)', depthX: .09, depthY: .15, outerStroke: .17, bevelStroke: .08,
    shadowBlur: .18, shadowX: .16, shadowY: .27,
    faceStops: [[0, '#ffd7ed'], [.15, '#ff92cc'], [.4, '#ff43aa'], [.66, '#ed177f'], [.84, '#ff73be'], [1, '#b90e66']]
  },
  'pearl-gold': {
    edge: '#80500f', bevel: '#f2ca68', extrusionNear: '#b97718', extrusionFar: '#69400d', highlight: '#ffffff',
    highlightStroke: .072, highlightAlpha: .94,
    shadow: 'rgba(28, 20, 8, .55)', depthX: .075, depthY: .12, outerStroke: .075, bevelStroke: .028,
    shadowBlur: .24, shadowX: .18, shadowY: .3,
    faceStops: [[0, '#ffffff'], [.17, '#e8e3da'], [.34, '#fffdf8'], [.55, '#c7c4bf'], [.73, '#ffffff'], [1, '#d4cec3']]
  },
  'studio-wood': {
    edge: '#38200f', bevel: '#e2a354', extrusionNear: '#75401f', extrusionFar: '#3d2012', highlight: '#ffe8ad',
    texture: 'wood',
    shadow: 'rgba(0, 0, 0, .76)', depthX: .09, depthY: .13, outerStroke: .13, bevelStroke: .052,
    shadowBlur: .17, shadowX: .16, shadowY: .25,
    faceStops: [[0, '#f2c475'], [.16, '#ba6d32'], [.31, '#7f441f'], [.45, '#e2a052'], [.56, '#9c5527'], [.7, '#edb462'], [.84, '#75401f'], [1, '#c47b35']]
  }
};

const EDITOR_FONT_LOAD_SPECS = [
  '800 64px "Vidreum Inter"',
  '400 64px "Vidreum Anton"',
  '700 64px "Vidreum Noto Serif"',
  '700 64px "Vidreum Roboto Mono"',
  '900 64px "Vidreum Nunito"',
  '700 64px "Vidreum Oswald"',
  '400 64px "Vidreum Pacifico"'
] as const;

export function getOutputSize(resolution: ExportResolution, aspectRatio: AspectRatio): [number, number] {
  return OUTPUT_SIZES[resolution][aspectRatio];
}

export async function waitForEditorFonts(clips?: readonly TextClip[]): Promise<void> {
  if (!document.fonts) return;
  const requestedFonts = clips
    ? [...new Set(clips.map((clip) => {
      const material = featuredMaterialSpec(clip.preset);
      const preset = material ? getSubtitlePresetOption(clip.preset) : null;
      const style = preset?.italic ? 'italic ' : '';
      const weight = preset?.weight || TEXT_FONT_WEIGHTS[clip.font];
      const family = preset?.cssFont || TEXT_FONT_FAMILIES[clip.font];
      return `${style}${weight} 64px ${family}`;
    }))]
    : EDITOR_FONT_LOAD_SPECS;
  await Promise.all(requestedFonts.map((font) => document.fonts.load(font)));
}

function featuredMaterialSpec(value: TextClip['preset']): MaterialCanvasSpec | null {
  return Object.prototype.hasOwnProperty.call(MATERIAL_CANVAS_SPECS, value)
    ? MATERIAL_CANVAS_SPECS[value as FeaturedMaterialId]
    : null;
}

function materialFaceGradient(
  context: CanvasRenderingContext2D,
  spec: MaterialCanvasSpec,
  y: number,
  fontSize: number
): CanvasGradient {
  const gradient = context.createLinearGradient(0, y - fontSize, 0, y + fontSize * .22);
  spec.faceStops.forEach(([stop, color]) => gradient.addColorStop(stop, color));
  return gradient;
}

function woodGrainPattern(context: CanvasRenderingContext2D, fontSize: number): CanvasPattern | null {
  const tile = document.createElement('canvas');
  const size = Math.max(24, Math.round(fontSize * .42));
  tile.width = size * 2;
  tile.height = size;
  const grain = tile.getContext('2d');
  if (!grain) return null;
  grain.clearRect(0, 0, tile.width, tile.height);
  grain.lineCap = 'round';
  for (let index = 0; index < 5; index += 1) {
    const y = (index + .65) * tile.height / 5;
    grain.beginPath();
    grain.moveTo(-tile.width * .08, y);
    grain.bezierCurveTo(tile.width * .2, y - size * .12, tile.width * .36, y + size * .11, tile.width * .58, y - size * .035);
    grain.bezierCurveTo(tile.width * .76, y - size * .12, tile.width * .9, y + size * .08, tile.width * 1.08, y - size * .04);
    grain.strokeStyle = index % 2 ? 'rgba(74, 31, 12, .72)' : 'rgba(255, 224, 154, .42)';
    grain.lineWidth = Math.max(1, size * (index % 2 ? .035 : .022));
    grain.stroke();
  }
  return context.createPattern(tile, 'repeat');
}

function drawMaterialText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  spec: MaterialCanvasSpec,
  reinforcedShadow: boolean
) {
  context.save();
  context.fillStyle = spec.extrusionFar;
  context.shadowColor = spec.shadow;
  context.shadowBlur = fontSize * (spec.shadowBlur + (reinforcedShadow ? .11 : 0));
  context.shadowOffsetX = fontSize * spec.shadowX;
  context.shadowOffsetY = fontSize * (spec.shadowY + (reinforcedShadow ? .06 : 0));
  context.fillText(text, x + fontSize * spec.depthX, y + fontSize * spec.depthY);
  context.restore();

  const depthSteps = 10;
  for (let step = depthSteps; step >= 1; step -= 1) {
    const progress = step / depthSteps;
    context.fillStyle = progress > .58 ? spec.extrusionFar : spec.extrusionNear;
    context.strokeStyle = spec.edge;
    context.lineWidth = Math.max(2, fontSize * spec.outerStroke);
    const layerX = x + fontSize * spec.depthX * progress;
    const layerY = y + fontSize * spec.depthY * progress;
    context.strokeText(text, layerX, layerY);
    context.fillText(text, layerX, layerY);
  }

  context.strokeStyle = spec.edge;
  context.lineWidth = Math.max(2, fontSize * spec.outerStroke);
  context.strokeText(text, x, y);
  context.strokeStyle = spec.bevel;
  context.lineWidth = Math.max(1, fontSize * spec.bevelStroke);
  context.strokeText(text, x, y);
  context.fillStyle = materialFaceGradient(context, spec, y, fontSize);
  context.fillText(text, x, y);
  if (spec.texture === 'wood') {
    const pattern = woodGrainPattern(context, fontSize);
    if (pattern) {
      context.save();
      context.globalAlpha = .62;
      context.fillStyle = pattern;
      context.fillText(text, x, y);
      context.restore();
    }
  }

  context.save();
  context.globalAlpha = spec.highlightAlpha || .58;
  context.strokeStyle = spec.highlight;
  context.lineWidth = Math.max(1, fontSize * (spec.highlightStroke || .014));
  context.shadowColor = 'rgba(255, 255, 255, .72)';
  context.shadowBlur = fontSize * .035;
  context.strokeText(text, x - fontSize * .012, y - fontSize * .018);
  context.restore();
}

export function rasterizeTextOverlay(
  clip: TextClip,
  resolution: ExportResolution,
  aspectRatio: AspectRatio
): RasterizedTextOverlay {
  const [outputWidth, outputHeight] = getOutputSize(resolution, aspectRatio);
  // The server renders captions as a fraction of the output height.  Use that
  // same reference here so the live preview and exported raster stay in sync.
  // Using the short side made vertical 9:16 captions nearly half their intended
  // size (for example, "Grande" was based on 1080 instead of 1920 at 1080p).
  const fontSize = outputHeight / TEXT_SIZE_DIVISORS[clip.size] * clip.scale;
  const materialSpec = featuredMaterialSpec(clip.preset);
  const preset = materialSpec ? getSubtitlePresetOption(clip.preset) : null;
  const renderedText = preset?.upperCase ? clip.text.toLocaleUpperCase(document.documentElement.lang || 'es') : clip.text;
  const width = Math.max(2, Math.round(outputWidth * clip.width));
  const paddingX = fontSize * (materialSpec ? .68 : .44);
  const paddingTop = fontSize * (materialSpec ? .46 : .22);
  const paddingBottom = fontSize * (materialSpec ? .78 : .22);
  const lineHeight = fontSize * (materialSpec ? 1.32 : 1.14);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.max(2, Math.ceil(fontSize + paddingTop + paddingBottom));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('El navegador no pudo preparar el texto para exportarlo.');
  const font = `${preset?.italic ? 'italic ' : ''}${preset?.weight || TEXT_FONT_WEIGHTS[clip.font]} ${fontSize}px ${preset?.cssFont || TEXT_FONT_FAMILIES[clip.font]}`;

  context.font = font;
  const lines = wrapText(context, renderedText, Math.max(1, width - paddingX * 2));
  const height = Math.max(2, Math.ceil(lines.length * lineHeight + paddingTop + paddingBottom));
  // Debe coincidir con los límites que valida server.js. Rechazarlo aquí
  // evita que el backend descarte el PNG y cambie silenciosamente a drawtext.
  if (height > 4096 || width * height > 4_000_000) {
    throw new Error('La frase ocupa demasiado espacio. Reduce su escala o aumenta su anchura antes de exportar.');
  }
  canvas.height = height;

  context.font = font;
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.lineJoin = 'round';
  const metrics = context.measureText('Mg');
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.8;
  const descent = metrics.actualBoundingBoxDescent || fontSize * 0.2;
  const baselineOffset = (lineHeight - ascent - descent) / 2 + ascent;

  if (clip.style === 'box') {
    roundedRect(context, 0, 0, width, height, fontSize * 0.2);
    context.fillStyle = 'rgba(0, 0, 0, 0.72)';
    context.fill();
  }

  context.fillStyle = TEXT_COLORS[clip.color];
  if (!materialSpec && clip.style === 'shadow') {
    context.shadowColor = 'rgba(0, 0, 0, 0.92)';
    context.shadowBlur = fontSize * 0.24;
    context.shadowOffsetY = fontSize * 0.13;
  }

  lines.forEach((line, index) => {
    const x = width / 2;
    const y = paddingTop + lineHeight * index + baselineOffset;
    if (materialSpec) {
      drawMaterialText(context, line, x, y, fontSize, materialSpec, clip.style === 'shadow');
    } else if (clip.style === 'outline') {
      context.strokeStyle = 'rgba(5, 5, 5, 0.96)';
      context.lineWidth = Math.max(2, fontSize * 0.12);
      context.strokeText(line, x, y);
      context.fillText(line, x, y);
    } else {
      context.fillText(line, x, y);
    }
  });

  return {
    renderedImage: canvas.toDataURL('image/png'),
    renderedWidth: width,
    renderedHeight: height
  };
}
