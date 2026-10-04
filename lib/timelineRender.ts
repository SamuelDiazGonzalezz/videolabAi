import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isSafeStoryboardId, storyboardsRoot } from './storyboards';

// Exportador local del timeline de timeline-studio. El editor envía el montaje
// ya resuelto (posiciones en píxeles, colores y tipografías de cada preset,
// tiempos por palabra) y aquí se compone con FFmpeg: vídeos, imágenes B-roll,
// rótulos rasterizados por el navegador, subtítulos ASS quemados con libass y
// la mezcla de narración y música.

export type RenderWord = { text: string; start: number; end: number };

export type RenderSubtitle = {
  startTime: number;
  endTime: number;
  words: RenderWord[];
  fontFamily: string;
  fontWeight: number;
  italic: boolean;
  fontSize: number;
  activeColor: string;
  inactiveColor: string;
  outlineColor: string;
  shadowColor: string;
  backColor: string;
  wordEffect: 'karaoke' | 'pop' | 'bounce' | 'flash';
  x: number;
  y: number;
  width: number;
  rendering: {
    borderStyle: number;
    outlineWidth: number;
    shadowDepth: number;
    xShadow?: number;
    yShadow?: number;
    scaleX: number;
    scaleY: number;
    spacing: number;
    angle: number;
    blur: number;
  };
};

export type LocalRenderPayload = {
  storyboardId: string;
  title?: string;
  width: number;
  height: number;
  fps?: number;
  duration: number;
  fitMode: 'contain' | 'cover';
  videoClips: Array<{ sourceUrl: string; sourceIn: number; sourceOut: number; startTime: number; endTime: number }>;
  broll: Array<{ sourceUrl: string; startTime: number; endTime: number; x: number; y: number; width: number; height: number; opacity: number }>;
  overlays: Array<{ image: string; startTime: number; endTime: number; x: number; y: number; width: number; height: number }>;
  subtitles: RenderSubtitle[];
  voice: { mode: 'keep' | 'mute' | 'replace'; url?: string; volume: number };
  music?: { url: string; startTime: number; endTime: number; envelope: Array<{ timeMs: number; volume: number }> } | null;
};

export type RenderJob = {
  jobId: string;
  phase: 'queued' | 'rendering' | 'completed' | 'error' | 'cancelled';
  progress: number;
  statusMessage: string;
  updatedAt: number;
  videoUrl?: string;
  duration: number;
  error?: string;
};

type JobState = RenderJob & { child?: ChildProcess; cancelled?: boolean };

const ROOT = process.cwd();
const RENDERS_ROOT = path.join(ROOT, 'data', 'renders');
const FONTS_DIR = path.join(ROOT, 'public', 'assets', 'fonts', 'editor');
const BASE_VIDEO = /\/assets\/timeline-base\.mp4$/i;

const globalJobs = globalThis as typeof globalThis & { __racingMonosRenderJobs?: Map<string, JobState> };
const jobs = globalJobs.__racingMonosRenderJobs ??= new Map<string, JobState>();

export function getRenderJob(jobId: string): RenderJob | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  const { child: _child, cancelled: _cancelled, ...publicJob } = job;
  return publicJob;
}

export function cancelRenderJob(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.cancelled = true;
  job.child?.kill();
  update(job, { phase: 'cancelled', statusMessage: 'Exportación cancelada.' });
  return true;
}

function update(job: JobState, patch: Partial<RenderJob>) {
  Object.assign(job, patch, { updatedAt: Date.now() });
}

export function startRenderJob(payload: LocalRenderPayload): RenderJob {
  const jobId = randomUUID();
  const job: JobState = { jobId, phase: 'queued', progress: 0, statusMessage: 'Preparando la exportación…', updatedAt: Date.now(), duration: payload.duration };
  jobs.set(jobId, job);
  void runJob(job, payload).catch((error) => {
    if (job.cancelled) return;
    update(job, { phase: 'error', error: error instanceof Error ? error.message : 'No se pudo exportar el vídeo.' });
  });
  return getRenderJob(jobId)!;
}

// ---------------------------------------------------------------------------
// Medios: las URLs del editor apuntan a esta misma app, así que se leen del
// disco directamente. Solo se descarga lo que venga de otro origen.

async function resolveMedia(url: string, workDir: string, index: number): Promise<string> {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    const file = path.join(workDir, `inline-${index}.png`);
    await writeFile(file, Buffer.from(url.slice(comma + 1), 'base64'));
    return file;
  }
  const parsed = new URL(url, 'http://localhost:3000');
  const pathname = decodeURIComponent(parsed.pathname);
  const storyboardAsset = /^\/api\/storyboards\/([0-9a-f-]{20,50})\/([A-Za-z0-9._-]+)$/i.exec(pathname);
  if (storyboardAsset && isSafeStoryboardId(storyboardAsset[1])) {
    return path.join(storyboardsRoot(), storyboardAsset[1], storyboardAsset[2]);
  }
  if (/^\/(?:assets|references)\/[A-Za-z0-9._/-]+$/.test(pathname) && !pathname.includes('..')) {
    return path.join(ROOT, 'public', pathname);
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`Recurso no compatible: ${url.slice(0, 80)}`);
  const response = await fetch(parsed, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`No se pudo descargar ${parsed.pathname} (${response.status}).`);
  const extension = path.extname(parsed.pathname).replace(/[^.a-z0-9]/gi, '').slice(0, 6) || '.bin';
  const file = path.join(workDir, `remote-${index}${extension}`);
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

function run(command: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function hasAudioStream(file: string) {
  const result = await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file], ROOT);
  return result.code === 0 && result.stdout.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Subtítulos ASS. libass dimensiona la fuente por la altura de celda
// (usWinAscent + usWinDescent) mientras que el navegador usa el em, así que se
// corrige con las métricas reales de cada TTF para que coincidan con el preview.

const FONT_FILES: Record<string, Record<number, { file: string; name: string }>> = {
  inter: {
    400: { file: 'inter-400.ttf', name: 'Inter' },
    600: { file: 'inter-600.ttf', name: 'Inter SemiBold' },
    700: { file: 'inter-700.ttf', name: 'Inter Bold' },
    800: { file: 'inter-800.ttf', name: 'Inter ExtraBold' },
    900: { file: 'inter-900.ttf', name: 'Inter Black' },
  },
  anton: { 400: { file: 'anton-400.ttf', name: 'Anton' } },
  'noto serif': {
    400: { file: 'noto-serif-400.ttf', name: 'Noto Serif' },
    700: { file: 'noto-serif-700.ttf', name: 'Noto Serif Bold' },
    900: { file: 'noto-serif-900.ttf', name: 'Noto Serif Black' },
  },
  'roboto mono': {
    400: { file: 'roboto-mono-400.ttf', name: 'Roboto Mono' },
    700: { file: 'roboto-mono-700.ttf', name: 'Roboto Mono Bold' },
  },
  nunito: {
    400: { file: 'nunito-400.ttf', name: 'Nunito ExtraLight Regular' },
    700: { file: 'nunito-700.ttf', name: 'Nunito ExtraLight Bold' },
    900: { file: 'nunito-900.ttf', name: 'Nunito ExtraLight Black' },
  },
  oswald: {
    400: { file: 'oswald-400.ttf', name: 'Oswald' },
    700: { file: 'oswald-700.ttf', name: 'Oswald Bold' },
  },
  pacifico: { 400: { file: 'pacifico-400.ttf', name: 'Pacifico' } },
};

function pickFont(cssFamily: string, weight: number) {
  const families = cssFamily.split(',').map((value) => value.replace(/["']/g, '').replace(/^Vidreum\s+/i, '').trim().toLowerCase());
  const family = families.find((value) => FONT_FILES[value]) || 'inter';
  const variants = FONT_FILES[family];
  const closest = Object.keys(variants).map(Number).sort((a, b) => Math.abs(a - weight) - Math.abs(b - weight))[0];
  return variants[closest];
}

const cellRatioCache = new Map<string, number>();

async function fontCellRatio(file: string) {
  const cached = cellRatioCache.get(file);
  if (cached) return cached;
  let ratio = 1.2;
  try {
    const data = await readFile(path.join(FONTS_DIR, file));
    const tables = new Map<string, number>();
    const count = data.readUInt16BE(4);
    for (let index = 0; index < count; index += 1) {
      const offset = 12 + index * 16;
      tables.set(data.toString('latin1', offset, offset + 4), data.readUInt32BE(offset + 8));
    }
    const head = tables.get('head');
    const os2 = tables.get('OS/2');
    if (head != null && os2 != null) {
      const unitsPerEm = data.readUInt16BE(head + 18);
      ratio = (data.readUInt16BE(os2 + 74) + data.readUInt16BE(os2 + 76)) / unitsPerEm;
    }
  } catch { /* se usa la proporción por defecto */ }
  cellRatioCache.set(file, ratio);
  return ratio;
}

function assColor(hex: string, alpha = 0) {
  const value = /^#?([0-9a-f]{6})/i.exec(hex)?.[1] || 'ffffff';
  const a = Math.max(0, Math.min(255, Math.round(alpha))).toString(16).padStart(2, '0');
  return `&H${a}${value.slice(4, 6)}${value.slice(2, 4)}${value.slice(0, 2)}&`.toUpperCase();
}

function assTime(seconds: number) {
  const centis = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(centis / 360000);
  const m = Math.floor((centis % 360000) / 6000);
  const s = Math.floor((centis % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(centis % 100).padStart(2, '0')}`;
}

function assText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\n/g, ' ');
}

const n = (value: number, digits = 2) => Number(value.toFixed(digits));

// Mismas curvas que subtitleWordFrame() del editor: la palabra que se está
// diciendo cambia al color activo y, según el efecto, crece, rebota o destella.
function wordTag(sub: RenderSubtitle, durationMs: number, inactive: string, active: string) {
  const fade = Math.min(90, Math.round(durationMs * 0.35));
  const peak = Math.min(durationMs, 85);
  const settle = Math.min(durationMs, 210);
  const release = Math.max(settle, durationMs - 90);
  switch (sub.wordEffect) {
    case 'pop':
      return `{\\1c${inactive}\\t(0,${peak},\\1c${active}\\fscx${n(sub.rendering.scaleX * 1.18)}\\fscy${n(sub.rendering.scaleY * 1.18)})\\t(${peak},${settle},\\fscx${sub.rendering.scaleX}\\fscy${sub.rendering.scaleY})\\t(${release},${durationMs},\\1c${inactive})}`;
    case 'bounce':
      return `{\\1c${inactive}\\t(0,${peak},\\1c${active}\\fscx${n(sub.rendering.scaleX * 1.08)}\\fscy${n(sub.rendering.scaleY * 1.26)})\\t(${peak},${settle},\\fscx${sub.rendering.scaleX}\\fscy${sub.rendering.scaleY})\\t(${release},${durationMs},\\1c${inactive})}`;
    case 'flash':
      return `{\\1c${inactive}\\t(0,${peak},\\1c${active}\\blur1.45)\\t(${peak},${settle},\\blur${sub.rendering.blur})\\t(${release},${durationMs},\\1c${inactive})}`;
    default:
      return `{\\1c${inactive}\\t(0,${fade},\\1c${active})\\t(${Math.max(fade, durationMs - fade)},${durationMs},\\1c${inactive})}`;
  }
}

async function buildAss(subtitles: RenderSubtitle[], width: number, height: number) {
  const styles: string[] = [];
  const events: string[] = [];
  const styleIds = new Map<string, string>();

  for (const sub of subtitles) {
    if (!sub.words.length || sub.endTime <= sub.startTime) continue;
    const font = pickFont(sub.fontFamily, sub.fontWeight);
    const fontSize = n(sub.fontSize * await fontCellRatio(font.file), 1);
    const r = sub.rendering;
    const boxed = r.borderStyle === 3;
    const key = JSON.stringify([font.name, fontSize, sub.italic, sub.outlineColor, sub.shadowColor, sub.backColor, r]);
    let style = styleIds.get(key);
    if (!style) {
      style = `S${styleIds.size + 1}`;
      styleIds.set(key, style);
      const outlineColor = boxed ? assColor(sub.backColor, 0x42) : assColor(sub.outlineColor);
      const backColor = boxed ? assColor(sub.backColor, 0x42) : assColor(sub.shadowColor, 0x58);
      styles.push(`Style: ${style},${font.name},${fontSize},${assColor(sub.inactiveColor)},${assColor(sub.activeColor)},${outlineColor},${backColor},0,${sub.italic ? -1 : 0},0,0,${r.scaleX},${r.scaleY},${n(r.spacing)},${n(-r.angle)},${boxed ? 3 : 1},${n(r.outlineWidth)},${boxed ? 0 : n(r.shadowDepth)},5,0,0,0,1`);
    }
    const margin = Math.max(0, Math.round((width - sub.width * width) / 2));
    const pos = `\\an5\\pos(${Math.round(sub.x * width)},${Math.round(sub.y * height)})`;
    const shadow = !boxed && (r.xShadow != null || r.yShadow != null)
      ? `\\xshad${n(r.xShadow ?? r.shadowDepth)}\\yshad${n(r.yShadow ?? r.shadowDepth)}`
      : '';
    const inactive = assColor(sub.inactiveColor);
    const active = assColor(sub.activeColor);
    // Un evento por palabra: la frase completa con la palabra hablada resaltada.
    sub.words.forEach((word, wordIndex) => {
      const start = wordIndex === 0 ? sub.startTime : word.start;
      const end = wordIndex === sub.words.length - 1 ? sub.endTime : sub.words[wordIndex + 1].start;
      if (end - start < 0.01) return;
      const fadeIn = wordIndex === 0 ? 55 : 0;
      const fadeOut = wordIndex === sub.words.length - 1 ? 85 : 0;
      const head = `{${pos}${shadow}\\blur${n(r.blur)}${fadeIn || fadeOut ? `\\fad(${fadeIn},${fadeOut})` : ''}}`;
      const durationMs = Math.max(60, Math.round((word.end - word.start) * 1000));
      const offsetMs = Math.round((word.start - start) * 1000);
      const body = sub.words.map((item, index) => {
        if (index !== wordIndex) return `{\\1c${inactive}}${assText(item.text)}`;
        // \t usa tiempos relativos al evento: se desplaza hasta el inicio real de la palabra.
        const tag = wordTag(sub, durationMs, inactive, active).replace(/\\t\((\d+),(\d+),/g, (_, a, b) => `\\t(${Number(a) + offsetMs},${Number(b) + offsetMs},`);
        return `${tag}${assText(item.text)}{\\1c${inactive}\\fscx${r.scaleX}\\fscy${r.scaleY}\\blur${n(r.blur)}}`;
      }).join(' ');
      events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},${style},,${margin},${margin},0,,${head}${body}`);
    });
  }

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------

function even(value: number) {
  return Math.max(2, Math.round(value / 2) * 2);
}

function volumeExpression(points: Array<{ timeMs: number; volume: number }>, offset: number) {
  const sorted = points.filter((point) => Number.isFinite(point.timeMs) && Number.isFinite(point.volume)).sort((a, b) => a.timeMs - b.timeMs);
  if (!sorted.length) return '1';
  // Interpolación lineal por tramos, igual que evaluateVolumeEnvelope() del editor.
  let expression = `${n(sorted[sorted.length - 1].volume, 4)}`;
  for (let index = sorted.length - 2; index >= 0; index -= 1) {
    const a = sorted[index];
    const b = sorted[index + 1];
    const t0 = n(a.timeMs / 1000 + offset, 3);
    const t1 = n(b.timeMs / 1000 + offset, 3);
    const segment = t1 > t0
      ? `${n(a.volume, 4)}+(${n(b.volume - a.volume, 4)})*(t-${t0})/${n(t1 - t0, 3)}`
      : `${n(b.volume, 4)}`;
    expression = `if(lt(t,${t1}),${segment},${expression})`;
  }
  return `if(lt(t,${n(sorted[0].timeMs / 1000 + offset, 3)}),${n(sorted[0].volume, 4)},${expression})`;
}

async function runJob(job: JobState, payload: LocalRenderPayload) {
  if (!isSafeStoryboardId(payload.storyboardId)) throw new Error('Storyboard no válido.');
  const width = even(payload.width);
  const height = even(payload.height);
  const fps = Math.min(60, Math.max(24, Math.round(payload.fps || 30)));
  const duration = Math.max(0.5, Math.min(60 * 30, payload.duration));
  const workDir = path.join(RENDERS_ROOT, job.jobId);
  await mkdir(workDir, { recursive: true });
  update(job, { phase: 'rendering', statusMessage: 'Preparando imágenes, subtítulos y audio…', progress: 1 });

  try {
    const inputs: string[][] = [['-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${n(duration, 3)}`]];
    const filters: string[] = [`[0:v]format=yuv444p,setsar=1[base0]`];
    let last = 'base0';
    let mediaIndex = 0;
    const audioLabels: string[] = [];
    const addInput = (args: string[]) => { inputs.push(args); return inputs.length - 1; };
    const overlayStep = (label: string, x: string, y: string, start: number, end: number) => {
      const next = `base${filters.length}`;
      filters.push(`[${last}][${label}]overlay=x=${x}:y=${y}:eof_action=pass:format=yuv444:enable='between(t,${n(start, 3)},${n(end, 3)})'[${next}]`);
      last = next;
    };

    // Vídeos propios del usuario (el vídeo negro de base del storyboard se omite).
    const fitScale = payload.fitMode === 'cover'
      ? `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}`
      : `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;
    for (const clip of payload.videoClips) {
      if (BASE_VIDEO.test(clip.sourceUrl)) continue;
      const length = Math.min(clip.sourceOut - clip.sourceIn, clip.endTime - clip.startTime);
      if (length <= 0.04) continue;
      const file = await resolveMedia(clip.sourceUrl, workDir, mediaIndex++);
      const index = addInput(['-ss', String(n(clip.sourceIn, 3)), '-t', String(n(length, 3)), '-i', file]);
      const label = `v${index}`;
      filters.push(`[${index}:v]${fitScale},setsar=1,fps=${fps},format=yuv444p,setpts=PTS-STARTPTS+${n(clip.startTime, 3)}/TB[${label}]`);
      overlayStep(label, '0', '0', clip.startTime, clip.startTime + length);
      if (payload.voice.mode === 'keep' && await hasAudioStream(file)) {
        const audio = `a${index}`;
        filters.push(`[${index}:a]aresample=48000,asetpts=PTS-STARTPTS,volume=${n(payload.voice.volume, 3)},adelay=${Math.round(clip.startTime * 1000)}:all=1[${audio}]`);
        audioLabels.push(audio);
      }
    }

    // Imágenes del storyboard: caja centrada en (x, y) con object-fit: cover.
    for (const clip of payload.broll) {
      const length = clip.endTime - clip.startTime;
      if (length <= 0.04) continue;
      const file = await resolveMedia(clip.sourceUrl, workDir, mediaIndex++);
      const index = addInput(['-loop', '1', '-framerate', String(fps), '-t', String(n(length, 3)), '-i', file]);
      const boxWidth = even(clip.width * width);
      const boxHeight = even(clip.height * height);
      const label = `b${index}`;
      const alpha = Math.max(0, Math.min(1, clip.opacity ?? 1));
      filters.push(`[${index}:v]scale=${boxWidth}:${boxHeight}:force_original_aspect_ratio=increase:flags=lanczos,crop=${boxWidth}:${boxHeight},setsar=1,format=yuva444p${alpha < 1 ? `,colorchannelmixer=aa=${n(alpha, 3)}` : ''},setpts=PTS-STARTPTS+${n(clip.startTime, 3)}/TB[${label}]`);
      overlayStep(label, String(Math.round(clip.x * width - boxWidth / 2)), String(Math.round(clip.y * height - boxHeight / 2)), clip.startTime, clip.endTime);
    }

    // Rótulos libres: PNG transparente generado por el propio editor.
    for (const overlay of payload.overlays) {
      const length = overlay.endTime - overlay.startTime;
      if (length <= 0.04 || !overlay.image.startsWith('data:image/png')) continue;
      const file = await resolveMedia(overlay.image, workDir, mediaIndex++);
      const index = addInput(['-loop', '1', '-framerate', String(fps), '-t', String(n(length, 3)), '-i', file]);
      const label = `t${index}`;
      filters.push(`[${index}:v]format=yuva444p,setpts=PTS-STARTPTS+${n(overlay.startTime, 3)}/TB[${label}]`);
      overlayStep(label, String(Math.round(overlay.x * width - overlay.width / 2)), String(Math.round(overlay.y * height - overlay.height / 2)), overlay.startTime, overlay.endTime);
    }

    // Subtítulos quemados con libass y las mismas fuentes que el editor.
    if (payload.subtitles.length) {
      await writeFile(path.join(workDir, 'subtitles.ass'), await buildAss(payload.subtitles, width, height), 'utf8');
      const fontsDir = path.relative(workDir, FONTS_DIR).split(path.sep).join('/');
      filters.push(`[${last}]ass=subtitles.ass:fontsdir=${fontsDir}:shaping=complex[subs]`);
      last = 'subs';
    }
    filters.push(`[${last}]format=yuv420p[vout]`);

    // Narración (sustituye al audio del vídeo) y música con su envolvente.
    if (payload.voice.mode === 'replace' && payload.voice.url) {
      const file = await resolveMedia(payload.voice.url, workDir, mediaIndex++);
      const index = addInput(['-i', file]);
      filters.push(`[${index}:a]aresample=48000,volume=${n(payload.voice.volume, 3)}[narration]`);
      audioLabels.push('narration');
    }
    if (payload.music?.url && payload.music.endTime > payload.music.startTime) {
      const file = await resolveMedia(payload.music.url, workDir, mediaIndex++);
      const index = addInput(['-stream_loop', '-1', '-i', file]);
      const start = payload.music.startTime;
      filters.push(`[${index}:a]aresample=48000,atrim=0:${n(payload.music.endTime - start, 3)},asetpts=PTS-STARTPTS,adelay=${Math.round(start * 1000)}:all=1,volume='${volumeExpression(payload.music.envelope, start)}':eval=frame[music]`);
      audioLabels.push('music');
    }
    if (audioLabels.length) {
      filters.push(`${audioLabels.map((label) => `[${label}]`).join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,alimiter=limit=0.98,apad[aout]`);
    } else {
      const index = addInput(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']);
      filters.push(`[${index}:a]anull[aout]`);
    }

    await writeFile(path.join(workDir, 'graph.txt'), filters.join(';\n'), 'utf8');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    const filename = `export-${stamp}.mp4`;
    const output = path.join(storyboardsRoot(), payload.storyboardId, filename);
    const args = [
      '-hide_banner', '-y', '-nostats', '-progress', 'pipe:1',
      ...inputs.flat(),
      '-/filter_complex', 'graph.txt',
      '-map', '[vout]', '-map', '[aout]',
      '-t', String(n(duration, 3)),
      // Máxima calidad práctica en H.264: CRF 14 (visualmente sin pérdidas),
      // preset lento y ajuste para dibujos planos; compatible con cualquier reproductor.
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-tune', 'animation',
      '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(fps),
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-ac', '2',
      '-movflags', '+faststart',
      output,
    ];

    update(job, { statusMessage: 'Renderizando con FFmpeg… 0%', progress: 2 });
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', args, { cwd: workDir, windowsHide: true });
      job.child = child;
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        const match = /out_time_us=(\d+)/.exec(chunk.toString().split('\n').reverse().join('\n'));
        if (!match) return;
        const seconds = Number(match[1]) / 1_000_000;
        const progress = Math.max(2, Math.min(99, Math.round(seconds / duration * 100)));
        if (progress !== job.progress) update(job, { progress, statusMessage: `Renderizando con FFmpeg… ${progress}%` });
      });
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-6000); });
      child.on('error', (error) => reject(new Error(`No se pudo ejecutar FFmpeg (${error.message}). Comprueba que está instalado y en el PATH.`)));
      child.on('close', (code) => {
        job.child = undefined;
        if (job.cancelled) return reject(new Error('cancelled'));
        if (code === 0) return resolve();
        const reason = stderr.trim().split('\n').filter((line) => /error|invalid|no such|unable|failed/i.test(line)).slice(-3).join(' · ');
        reject(new Error(`FFmpeg terminó con error ${code}${reason ? `: ${reason}` : ''}`));
      });
    });

    update(job, {
      phase: 'completed',
      progress: 100,
      statusMessage: 'Exportación terminada.',
      videoUrl: `/api/storyboards/${payload.storyboardId}/${filename}`,
      duration,
    });
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  } catch (error) {
    if (job.cancelled) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
      return;
    }
    // Se conserva la carpeta de trabajo (graph.txt, subtitles.ass) para depurar.
    throw error;
  }
}
