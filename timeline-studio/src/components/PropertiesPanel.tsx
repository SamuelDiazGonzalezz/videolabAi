import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Clapperboard,
  CloudUpload,
  Image as ImageIcon,
  ImagePlus,
  LayoutTemplate,
  Music2,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  Video,
  Shapes
} from 'lucide-react';
import { useTimelineStore } from '../store/timelineStore';
import {
  CLOSING_TRANSITION_OPTIONS,
  OPENING_TRANSITION_OPTIONS,
  TRANSITION_OPTIONS,
  type TransitionOption
} from '../constants/transitions';
import {
  DEFAULT_VIDEO_CLIP_CORRECTION,
  TEXT_COLORS,
  type BrandLogoPosition,
  type BrollBlendMode,
  type ExportResolution,
  type MediaAsset,
  type TextClipColor,
  type TextClipFont,
  type TextClipKind,
  type TextAnimationPreset,
  type TextClip,
  type TextClipPosition,
  type TextClipSize,
  type TextClipStyle,
  type TransitionType
} from '../types/timeline';
import {
  FEATURED_3D_TEXT_PRESET_OPTIONS,
  STANDARD_SUBTITLE_PRESET_OPTIONS,
  WORD_EFFECT_OPTIONS,
  getSubtitlePresetOption,
  isFeatured3dPreset,
  type SubtitlePresetOption
} from '../constants/subtitlePresets';
import type { EditorPanel } from './EditorToolRail';
import { GraphicsLibrary, type GraphicInsert } from './GraphicsLibrary';
import { KeyframesEditor } from './KeyframesEditor';
import { TemplatesPanel, type TemplatesPanelProps } from './TemplatesPanel';
import { COLOR_PRESETS } from '../constants/colorPresets';
import { correctionSourceClip, correctionTargetClipIds, formatTimecode, getTimelineRangeTargets } from '../utils/timeline';
import { getIntlLocale, t, useUiLocale } from '../i18n';
import { TEXT_ANIMATION_OPTIONS } from '../constants/textAnimations';
import { fitTextAnimationDurations } from '../utils/textAnimations';

const COLOR_LABELS: Record<TextClipColor, string> = {
  blanco: 'Blanco', negro: 'Negro', amarillo: 'Amarillo', naranja: 'Naranja', rojo: 'Rojo',
  rosa: 'Rosa', violeta: 'Violeta', azul: 'Azul', cian: 'Cian', verde: 'Verde'
};

const TEXT_POSITION_Y: Record<TextClipPosition, number> = {
  top: 0.12,
  center: 0.5,
  bottom: 0.86
};

// Función 3 — Capas superpuestas.
const BROLL_BLEND_MODE_OPTIONS: Array<{ value: BrollBlendMode; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiplicar' },
  { value: 'screen', label: 'Trama' }
];

const FONT_OPTIONS: Array<{ value: TextClipFont; label: string; sample: string }> = [
  { value: 'modern', label: 'Moderna', sample: 'Aa' },
  { value: 'display', label: 'Impacto', sample: 'Aa' },
  { value: 'serif', label: 'Editorial', sample: 'Aa' },
  { value: 'mono', label: 'Mono', sample: 'Aa' },
  { value: 'rounded', label: 'Redonda', sample: 'Aa' },
  { value: 'condensed', label: 'Estrecha', sample: 'Aa' }
];

function PresetPreviewCard({ option, active, onSelect }: {
  option: SubtitlePresetOption;
  active: boolean;
  onSelect: () => void;
}) {
  useUiLocale();
  // Solo CROMO es una muestra editorial en español. El resto son nombres de
  // presets o copy deliberadamente inglés y no deben entrar como falsos
  // positivos en el catálogo de traducciones.
  const localizedSample = option.value === 'chrome-pink' ? t(option.sample) : option.sample;
  const localizedLabel = option.featured3d || option.value === 'none' ? t(option.label) : option.label;
  const sampleWords = localizedSample.split(/\s+/).filter(Boolean);
  const materialClass = option.featured3d ? ` material-text material-text--${option.value}` : '';
  return (
    <button
      type="button"
      className={`subtitle-preset-card${option.featured3d ? ' subtitle-preset-card--featured' : ''}${active ? ' is-active' : ''}`}
      style={{
        '--preset-bg': option.previewBackground,
        '--preset-active': option.color,
        '--preset-inactive': option.inactiveColor,
        '--preset-shadow': option.textShadow,
        '--preset-transform': option.previewTransform,
        '--preset-font': option.cssFont,
        '--preset-weight': option.weight,
        '--preset-style': option.italic ? 'italic' : 'normal'
      } as React.CSSProperties}
      onClick={onSelect}
      aria-pressed={active}
    >
      {option.featured3d && <i className="subtitle-preset-card__badge" aria-hidden="true">3D</i>}
      <span
        className={`subtitle-preset-card__sample${materialClass}`}
        data-i18n-skip=""
        data-text={option.featured3d ? localizedSample : undefined}
        aria-hidden="true"
      >
        {option.featured3d ? localizedSample : option.value === 'none' ? '⊘' : sampleWords.map((word, index) => (
          <span key={index} className={index === option.activeWordIndex ? 'is-active' : undefined}>
            {option.upperCase ? word.toLocaleUpperCase(getIntlLocale()) : word}
          </span>
        ))}
      </span>
      <small data-i18n-skip="">{localizedLabel}</small>
    </button>
  );
}

function textPositionFromY(y: number): TextClipPosition {
  if (y < 0.33) return 'top';
  if (y > 0.66) return 'bottom';
  return 'center';
}

async function graphicDataUrlToPng(graphic: GraphicInsert): Promise<File> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('No se pudo preparar el gráfico.'));
    image.src = graphic.url;
  });
  const canvas = document.createElement('canvas');
  const requestedRatio = graphic.width && graphic.height ? graphic.width / graphic.height : 0;
  const naturalRatio = image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1;
  const ratio = requestedRatio || naturalRatio;
  canvas.width = ratio >= 1 ? 1200 : Math.max(240, Math.round(1200 * ratio));
  canvas.height = ratio >= 1 ? Math.max(240, Math.round(1200 / ratio)) : 1200;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No se pudo preparar el lienzo del gráfico.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  removeConnectedImageBackground(context, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('No se pudo convertir el gráfico.')), 'image/png'));
  return new File([blob], `${graphic.name.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'elemento'}.png`, { type: 'image/png' });
}

// Los "vectores" de Pixabay a veces llegan rasterizados sobre un rectángulo
// negro o blanco. Solo hacemos transparente el color de fondo conectado con
// los bordes; así se conservan los trazos del mismo color encerrados dentro
// del dibujo. El segundo umbral suaviza el antialias del contorno.
function removeConnectedImageBackground(context: CanvasRenderingContext2D, width: number, height: number) {
  const image = context.getImageData(0, 0, width, height);
  const pixels = image.data;
  const cornerOffsets = [0, (width - 1) * 4, (height - 1) * width * 4, (width * height - 1) * 4];
  const background = [0, 1, 2].map((channel) => Math.round(cornerOffsets.reduce((sum, offset) => sum + pixels[offset + channel], 0) / 4));
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let read = 0;
  let write = 0;
  const matches = (index: number) => {
    const offset = index * 4;
    const red = pixels[offset] - background[0];
    const green = pixels[offset + 1] - background[1];
    const blue = pixels[offset + 2] - background[2];
    return red * red + green * green + blue * blue <= 72 * 72;
  };
  const enqueue = (index: number) => {
    if (index < 0 || index >= visited.length || visited[index] || !matches(index)) return;
    visited[index] = 1;
    queue[write++] = index;
  };
  for (let x = 0; x < width; x += 1) { enqueue(x); enqueue((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y += 1) { enqueue(y * width); enqueue(y * width + width - 1); }
  while (read < write) {
    const index = queue[read++];
    const offset = index * 4;
    const red = pixels[offset] - background[0];
    const green = pixels[offset + 1] - background[1];
    const blue = pixels[offset + 2] - background[2];
    const distance = Math.sqrt(red * red + green * green + blue * blue);
    pixels[offset + 3] = distance <= 32 ? 0 : Math.round(255 * (distance - 32) / 40);
    const x = index % width;
    if (x > 0) enqueue(index - 1);
    if (x < width - 1) enqueue(index + 1);
    if (index >= width) enqueue(index - width);
    if (index < width * (height - 1)) enqueue(index + width);
  }
  context.putImageData(image, 0, 0);
}

interface PropertiesPanelProps {
  panel: EditorPanel;
  selectedTransitionClipId?: string | null;
  assets: MediaAsset[];
  isUploading: boolean;
  hasExternalAudio: boolean;
  onUploadFiles: (files: File[]) => Promise<MediaAsset[]>;
  onAddVideo: (asset: MediaAsset) => void;
  onAddImageClip: (asset: MediaAsset) => void;
  onUseAudio: (asset: MediaAsset) => void;
  onUseLogo: (asset: MediaAsset) => void;
  onAddBroll: (asset: MediaAsset) => void;
  onAddGraphic: (graphic: GraphicInsert) => void;
  onInsertTemplate: TemplatesPanelProps['onInsertTemplate'];
  /** Función 5 — Tracking automático: analiza el vídeo bajo la posición ACTUAL del elemento y sustituye sus keyframes por la trayectoria detectada. */
  onTrackRegion: (clipKind: 'text' | 'broll', clipId: string, durationSec: number) => Promise<void>;
  getAuthToken: () => Promise<string>;
  onAddText: () => void;
  onAddSubtitle: () => void;
  onAutoCaption: () => void;
  isTranscribing?: boolean;
  onClearTransitionSelection?: () => void;
}

function PanelHeading({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="properties-panel__heading">
      <span className="properties-panel__icon">{icon}</span>
      <div><strong>{title}</strong><span>{subtitle}</span></div>
    </div>
  );
}

function CollapsibleSection({ title, open, onToggle, children }: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="properties-panel__section properties-panel__collapsible">
      <button
        type="button"
        className="properties-panel__collapsible-header"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="properties-panel__label">{title}</span>
        <ChevronDown size={14} className={`properties-panel__collapsible-chevron${open ? ' is-open' : ''}`} />
      </button>
      {open && <div className="properties-panel__collapsible-body">{children}</div>}
    </div>
  );
}

function RangeField({ label, value, min, max, step, suffix = '', disabled = false, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="properties-panel__range">
      <span>{label}<strong>{Number.isInteger(value) ? value : value.toFixed(2)}{suffix}</strong></span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function TransitionCutEditor({ type, duration, onChange, options = TRANSITION_OPTIONS }: {
  type: TransitionType;
  duration: number;
  onChange: (type: TransitionType, duration: number) => void;
  options?: TransitionOption[];
}) {
  return (
    <>
      <div className="transition-options">
        {options.map(({ value, title, subtitle }) => (
          <button key={value} type="button" className={type === value ? 'is-active' : ''} onClick={() => onChange(value, duration)}>
            <span className={`transition-swatch transition-swatch--${value}`} />
            <span><strong>{title}</strong><small>{subtitle}</small></span>
            {type === value && <Check size={14} />}
          </button>
        ))}
      </div>
      {type !== 'none' && (
        <RangeField label="Duración" value={duration} min={.1} max={1} step={.05} suffix=" s" onChange={(value) => onChange(type, value)} />
      )}
    </>
  );
}

function TextAnimationControls({ clip, clips, onChange, onPreview }: {
  clip: TextClip;
  clips: TextClip[];
  onChange: (changes: Partial<TextClip>) => void;
  onPreview: (phase: 'entrance' | 'exit', preset: TextAnimationPreset) => void;
}) {
  const [phase, setPhase] = useState<'entrance' | 'exit'>('entrance');
  const presets = clips.map((item) => phase === 'entrance' ? item.entranceAnimation : item.exitAnimation);
  const preset = presets.length > 0 && presets.every((value) => value === presets[0]) ? presets[0] : null;
  const durationMs = phase === 'entrance' ? clip.entranceDurationMs : clip.exitDurationMs;
  const durations = clips.map((item) => phase === 'entrance' ? item.entranceDurationMs : item.exitDurationMs);
  const mixedDuration = !durations.every((value) => value === durations[0]);
  const selectedOption = preset == null
    ? null
    : TEXT_ANIMATION_OPTIONS.find((option) => option.value === preset) || TEXT_ANIMATION_OPTIONS[0];
  const phaseLabel = phase === 'entrance' ? 'Entrada' : 'Salida';
  const effectiveDurationValues = clips.map((item) => {
    const fitted = fitTextAnimationDurations(item);
    return phase === 'entrance' ? fitted.entranceMs : fitted.exitMs;
  });
  const minimumEffectiveDurationMs = Math.min(...effectiveDurationValues);
  const maximumEffectiveDurationMs = Math.max(...effectiveDurationValues);
  const durationWasAdjusted = preset !== null && preset !== 'none' && clips.some((item, index) => {
    const requestedDurationMs = phase === 'entrance' ? item.entranceDurationMs : item.exitDurationMs;
    return Math.abs(effectiveDurationValues[index] - requestedDurationMs) >= 1;
  });
  const effectiveDurationLabel = Math.abs(maximumEffectiveDurationMs - minimumEffectiveDurationMs) < 1
    ? `${(minimumEffectiveDurationMs / 1000).toFixed(2)} s`
    : `${(minimumEffectiveDurationMs / 1000).toFixed(2)}–${(maximumEffectiveDurationMs / 1000).toFixed(2)} s`;

  const updatePreset = (value: TextAnimationPreset) => {
    onChange(phase === 'entrance' ? { entranceAnimation: value } : { exitAnimation: value });
    onPreview(phase, value);
  };
  const updateDuration = (seconds: number) => onChange(phase === 'entrance'
    ? { entranceDurationMs: Math.round(seconds * 1000) }
    : { exitDurationMs: Math.round(seconds * 1000) });

  return (
    <div className="properties-panel__section text-animation-controls">
      <span className="properties-panel__label"><Sparkles size={12} /> Efectos de entrada y salida</span>
      <p className="properties-panel__hint">Elige un efecto preparado para esta frase. Se combina con sus keyframes si ya tiene movimiento.</p>
      <div className="text-animation-controls__tabs" role="group" aria-label="Momento del efecto">
        {(['entrance', 'exit'] as const).map((value) => {
          const phasePresets = clips.map((item) => value === 'entrance' ? item.entranceAnimation : item.exitAnimation);
          const valuePreset = phasePresets.length > 0 && phasePresets.every((item) => item === phasePresets[0])
            ? phasePresets[0]
            : null;
          const option = valuePreset == null
            ? null
            : TEXT_ANIMATION_OPTIONS.find((item) => item.value === valuePreset) || TEXT_ANIMATION_OPTIONS[0];
          return (
            <button
              key={value}
              type="button"
              aria-pressed={phase === value}
              className={phase === value ? 'is-active' : ''}
              onClick={() => setPhase(value)}
            >
              <strong>{value === 'entrance' ? 'Entrada' : 'Salida'}</strong>
              <small>{option ? (value === 'entrance' ? option.entranceLabel : option.exitLabel) : 'Varios'}</small>
            </button>
          );
        })}
      </div>
      <div className="text-animation-options" role="group" aria-label={`Efecto de ${phaseLabel.toLocaleLowerCase('es')}`}>
        {TEXT_ANIMATION_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={preset === option.value ? 'is-active' : ''}
            title={option.hint}
            aria-label={`${phaseLabel}: ${phase === 'entrance' ? option.entranceLabel : option.exitLabel}. ${option.hint}`}
            aria-pressed={preset === option.value}
            onClick={() => updatePreset(option.value)}
          >
            <span className={`text-animation-option__demo text-animation-option__demo--${phase} text-animation-option__demo--${option.value}`} aria-hidden="true"><i>T</i></span>
            <small>{phase === 'entrance' ? option.entranceLabel : option.exitLabel}</small>
          </button>
        ))}
      </div>
      {preset !== null && preset !== 'none' && (
        <RangeField
          label={`${mixedDuration ? 'Igualar duración de ' : 'Duración de '}${phaseLabel.toLocaleLowerCase('es')}`}
          value={durationMs / 1000}
          min={0.1}
          max={2}
          step={0.05}
          suffix=" s"
          onChange={updateDuration}
        />
      )}
      {durationWasAdjusted && (
        <p className="text-animation-controls__adjustment">Duración efectiva en la selección: <strong>{effectiveDurationLabel}</strong>. Se ajusta para que entrada y salida quepan completas.</p>
      )}
      <p className="text-animation-controls__selection">Activo: <strong>{selectedOption ? (phase === 'entrance' ? selectedOption.entranceLabel : selectedOption.exitLabel) : 'Varios'}</strong></p>
    </div>
  );
}

export function PropertiesPanel({
  panel,
  selectedTransitionClipId,
  assets,
  isUploading,
  hasExternalAudio,
  onUploadFiles,
  onAddVideo,
  onAddImageClip,
  onUseAudio,
  onUseLogo,
  onAddBroll,
  onAddGraphic,
  onInsertTemplate,
  onTrackRegion,
  getAuthToken,
  onAddText,
  onAddSubtitle,
  onAutoCaption,
  isTranscribing,
  onClearTransitionSelection
}: PropertiesPanelProps) {
  useUiLocale();
  const timeline = useTimelineStore((state) => state.timeline);
  const selection = useTimelineStore((state) => state.selection);
  const rangeSelection = useTimelineStore((state) => state.rangeSelection);
  const currentTime = useTimelineStore((state) => state.currentTime);
  const setCurrentTime = useTimelineStore((state) => state.setCurrentTime);
  const selectClip = useTimelineStore((state) => state.selectClip);
  const updateSettings = useTimelineStore((state) => state.updateSettings);
  const updateVideoClips = useTimelineStore((state) => state.updateVideoClips);
  const updateClipTransition = useTimelineStore((state) => state.updateClipTransition);
  const setAllTransitions = useTimelineStore((state) => state.setAllTransitions);
  const updateAudioTrack = useTimelineStore((state) => state.updateAudioTrack);
  const setMusicTrack = useTimelineStore((state) => state.setMusicTrack);
  const updateMusicTrack = useTimelineStore((state) => state.updateMusicTrack);
  const addDuckingRegion = useTimelineStore((state) => state.addDuckingRegion);
  const removeDuckingRegion = useTimelineStore((state) => state.removeDuckingRegion);
  const setVideoClipBounds = useTimelineStore((state) => state.setVideoClipBounds);
  const moveVideoClip = useTimelineStore((state) => state.moveVideoClip);
  const removeVideoClip = useTimelineStore((state) => state.removeVideoClip);
  const updateTextClip = useTimelineStore((state) => state.updateTextClip);
  const updateTextClips = useTimelineStore((state) => state.updateTextClips);
  const setTextClipTiming = useTimelineStore((state) => state.setTextClipTiming);
  const removeTextClip = useTimelineStore((state) => state.removeTextClip);
  const updateBrollClip = useTimelineStore((state) => state.updateBrollClip);
  const updateBrollClips = useTimelineStore((state) => state.updateBrollClips);
  const removeBrollClip = useTimelineStore((state) => state.removeBrollClip);
  const moveBrollClip = useTimelineStore((state) => state.moveBrollClip);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const [mediaTab, setMediaTab] = useState<'all' | MediaAsset['type']>('all');
  const [openEnhanceSection, setOpenEnhanceSection] = useState<'correction' | 'focus' | 'quality' | null>(null);

  const filteredAssets = useMemo(
    () => assets.filter((asset) => mediaTab === 'all' || asset.type === mediaTab),
    [assets, mediaTab]
  );

  if (!timeline) return <aside className="properties-panel" />;

  const rangeTargets = getTimelineRangeTargets(timeline, rangeSelection);
  const selectedVideoIds = rangeSelection
    ? rangeTargets.videoIds
    : selection?.kind === 'video'
      ? selection.ids
      : [];
  const activeTextKind: TextClipKind = panel === 'subtitles' ? 'subtitle' : 'text';
  const selectedTextIds = (rangeSelection
    ? rangeTargets.textIds
    : selection?.kind === 'text'
      ? [selection.id]
      : []
  ).filter((id) => timeline.textTrack.clips.find((clip) => clip.id === id)?.kind === activeTextKind);
  // El estilo de "Subtítulos" (preset, efecto, posición, tamaño, color) es
  // una única configuración global aplicada a todas las frases del vídeo,
  // igual que en el Creador de clips y el editor de proyecto: el documento
  // ASS solo admite un aspecto por reproducción coherente, así que cambiarlo
  // afecta a todos los subtítulos a la vez, no solo al que esté seleccionado.
  const allSubtitleIds = timeline.textTrack.clips.filter((clip) => clip.kind === 'subtitle').map((clip) => clip.id);
  const selectedBrollIds = rangeSelection
    ? rangeTargets.brollIds
    : selection?.kind === 'broll'
      ? [selection.id]
      : [];
  const selectedVideo = selectedVideoIds.length
    ? timeline.videoTrack.clips.find((clip) => clip.id === selectedVideoIds[0])
    : undefined;
  const selectedText = selectedTextIds.length
    ? timeline.textTrack.clips.find((clip) => clip.id === selectedTextIds[0])
    : rangeSelection ? undefined : (
      // Sin selección explícita, prioriza la frase visible en el instante
      // actual del cabezal en vez de siempre la primera del array: si no,
      // el panel mostraría el contenido/tiempos de una frase que no es la
      // que se ve en el lienzo.
      timeline.textTrack.clips.find((clip) => clip.kind === activeTextKind && currentTime >= clip.startTime && currentTime <= clip.endTime)
      || timeline.textTrack.clips.find((clip) => clip.kind === activeTextKind)
    );
  const selectedBroll = selectedBrollIds.length
    ? timeline.brollTrack.clips.find((clip) => clip.id === selectedBrollIds[0])
    : rangeSelection ? undefined : timeline.brollTrack.clips[0];

  const mediaUpload = (
    <>
      <button type="button" className="media-dropzone" onClick={() => fileRef.current?.click()}>
        <CloudUpload size={24} />
        <strong>{isUploading ? 'Subiendo archivos…' : 'Subir multimedia'}</strong>
        <span>Imágenes, vídeos o audio</span>
      </button>
      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        multiple
        accept="image/*,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/ogg,audio/webm"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          if (files.length) onUploadFiles(files);
          event.target.value = '';
        }}
      />
    </>
  );

  if (panel === 'media') {
    return (
      <aside className="properties-panel">
        <PanelHeading icon={<CloudUpload size={16} />} title="Multimedia" subtitle="Recursos del proyecto" />
        {mediaUpload}
        <div className="media-tabs">
          {([['all', 'Todos'], ['image', 'Imágenes'], ['video', 'Vídeos'], ['audio', 'Audio']] as const).map(([value, label]) => (
            <button key={value} type="button" className={mediaTab === value ? 'is-active' : ''} onClick={() => setMediaTab(value)}>{label}</button>
          ))}
        </div>
        <div className="media-grid">
          {filteredAssets.map((asset) => (
            <article className="media-asset" key={asset.id}>
              <div className="media-asset__preview">
                {asset.type === 'image' && <img src={asset.url} alt="" />}
                {asset.type === 'video' && <video src={`${asset.url}#t=0.1`} muted preload="metadata" />}
                {asset.type === 'audio' && <Music2 size={24} />}
              </div>
              <strong title={asset.name} data-i18n-skip="">{asset.name}</strong>
              {asset.type === 'video' && <button type="button" onClick={() => onAddVideo(asset)}><Plus size={12} /> Añadir</button>}
              {asset.type === 'audio' && <button type="button" onClick={() => onUseAudio(asset)}><Check size={12} /> Usar audio</button>}
              {asset.type === 'image' && (
                <>
                  <button type="button" onClick={() => onAddImageClip(asset)}><Plus size={12} /> Añadir</button>
                  <div className="media-asset__actions">
                    <button type="button" onClick={() => onAddBroll(asset)}>B-Roll</button>
                    <button type="button" onClick={() => onUseLogo(asset)}>Logo</button>
                  </div>
                </>
              )}
            </article>
          ))}
          {!filteredAssets.length && <p className="properties-panel__empty">Los archivos que subas aparecerán aquí.</p>}
        </div>
      </aside>
    );
  }

  if (panel === 'graphics') {
    return <aside className="properties-panel">
      <PanelHeading icon={<Shapes size={16} />} title="Elementos" subtitle="Gráficos, Pixabay y Unsplash" />
      <p className="properties-panel__hint">Añade una capa en el cabezal actual. Después puedes moverla sobre el vídeo y ajustar su duración en la pista Elementos.</p>
      <GraphicsLibrary onInsert={(graphic) => {
        if (!graphic.transparentPng) { onAddGraphic(graphic); return; }
        void graphicDataUrlToPng(graphic).then((file) => onUploadFiles([file])).then(([asset]) => {
          if (asset) onAddBroll(asset);
        });
      }} getAuthToken={getAuthToken} />
    </aside>;
  }

  if (panel === 'templates') {
    return <aside className="properties-panel">
      <PanelHeading icon={<LayoutTemplate size={16} />} title="Plantillas" subtitle="Motion graphics listos para usar" />
      <TemplatesPanel assets={assets} onInsertTemplate={onInsertTemplate} />
    </aside>;
  }

  if (panel === 'enhance') {
    const videoIndex = selectedVideo ? timeline.videoTrack.clips.findIndex((clip) => clip.id === selectedVideo.id) : -1;
    const enhanceTargetIds = correctionTargetClipIds(timeline, selection, rangeSelection);
    const enhanceClip = correctionSourceClip(timeline, selection, rangeSelection);
    const correctionValues = enhanceClip ?? DEFAULT_VIDEO_CLIP_CORRECTION;
    const enhanceScopeLabel = rangeSelection
      ? enhanceTargetIds.length
        ? `${enhanceTargetIds.length} clips de vídeo seleccionados`
        : 'El rango no incluye clips de vídeo'
      : selection?.kind === 'video' && selection.ids.length > 1
      ? `${selection.ids.length} clips seleccionados`
      : selection?.kind === 'video' && selection.ids.length === 1
        ? `Clip ${timeline.videoTrack.clips.findIndex((clip) => clip.id === selection.ids[0]) + 1}`
        : timeline.videoTrack.clips.length > 1
          ? `Todos los clips (${timeline.videoTrack.clips.length})`
          : 'Imagen y encuadre';
    return (
      <aside className="properties-panel">
        <PanelHeading icon={<Sparkles size={16} />} title="Mejorar" subtitle={enhanceScopeLabel} />
        <button
          type="button"
          className="properties-panel__reset"
          disabled={!enhanceTargetIds.length}
          onClick={() => updateVideoClips(enhanceTargetIds, { brightness: 0, contrast: 1, saturation: 1, sharpen: 0, temperature: 0, focusX: .5, focusY: .5 })}
        ><RotateCcw size={14} /> Restablecer</button>

        <CollapsibleSection
          title="Corrección de imagen"
          open={openEnhanceSection === 'correction'}
          onToggle={() => setOpenEnhanceSection((current) => (current === 'correction' ? null : 'correction'))}
        >
          <p className="properties-panel__hint">Los ajustes se aplican a todos los clips de vídeo incluidos en la selección.</p>
          <div className="color-preset-row">
            {COLOR_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="color-preset-row__item"
                disabled={!enhanceTargetIds.length}
                title={preset.label}
                onClick={() => updateVideoClips(enhanceTargetIds, preset.values)}
              >
                <span
                  className="color-preset-row__swatch"
                  style={{
                    filter: `brightness(${1 + preset.values.brightness}) contrast(${preset.values.contrast}) saturate(${preset.values.saturation})`,
                    background: preset.values.temperature > 0
                      ? `linear-gradient(135deg, #ffb066, #ff7a3d)`
                      : preset.values.temperature < 0
                        ? `linear-gradient(135deg, #6db3ff, #3d6bff)`
                        : `linear-gradient(135deg, #9aa0ac, #565b64)`
                  }}
                />
                <small>{preset.label}</small>
              </button>
            ))}
          </div>
          <RangeField label="Brillo" value={Math.round(correctionValues.brightness * 100)} min={-30} max={30} step={1} suffix="%" disabled={!enhanceTargetIds.length} onChange={(value) => updateVideoClips(enhanceTargetIds, { brightness: value / 100 })} />
          <RangeField label="Contraste" value={Math.round(correctionValues.contrast * 100)} min={50} max={150} step={1} suffix="%" disabled={!enhanceTargetIds.length} onChange={(value) => updateVideoClips(enhanceTargetIds, { contrast: value / 100 })} />
          <RangeField label="Saturación" value={Math.round(correctionValues.saturation * 100)} min={0} max={200} step={1} suffix="%" disabled={!enhanceTargetIds.length} onChange={(value) => updateVideoClips(enhanceTargetIds, { saturation: value / 100 })} />
          <RangeField label="Temperatura" value={Math.round(correctionValues.temperature)} min={-100} max={100} step={1} suffix="" disabled={!enhanceTargetIds.length} onChange={(value) => updateVideoClips(enhanceTargetIds, { temperature: value })} />
          <RangeField label="Nitidez" value={Math.round(correctionValues.sharpen * 100)} min={0} max={100} step={1} suffix="%" disabled={!enhanceTargetIds.length} onChange={(value) => updateVideoClips(enhanceTargetIds, { sharpen: value / 100 })} />
        </CollapsibleSection>

        <CollapsibleSection
          title="Foco del encuadre"
          open={openEnhanceSection === 'focus'}
          onToggle={() => setOpenEnhanceSection((current) => (current === 'focus' ? null : 'focus'))}
        >
          <label className="properties-panel__toggle">
            <span><strong>Seguimiento de encuadre</strong><small>Conserva el foco elegido al recortar</small></span>
            <input type="checkbox" checked={correctionValues.trackingEnabled} disabled={!enhanceTargetIds.length} onChange={() => updateVideoClips(enhanceTargetIds, { trackingEnabled: !correctionValues.trackingEnabled })} />
          </label>
          <RangeField label="Horizontal" value={Math.round(correctionValues.focusX * 100)} min={0} max={100} step={1} suffix="%" disabled={!enhanceTargetIds.length} onChange={(value) => updateVideoClips(enhanceTargetIds, { focusX: value / 100 })} />
          <RangeField label="Vertical" value={Math.round(correctionValues.focusY * 100)} min={0} max={100} step={1} suffix="%" disabled={!enhanceTargetIds.length} onChange={(value) => updateVideoClips(enhanceTargetIds, { focusY: value / 100 })} />
        </CollapsibleSection>

        <CollapsibleSection
          title="Calidad de exportación"
          open={openEnhanceSection === 'quality'}
          onToggle={() => setOpenEnhanceSection((current) => (current === 'quality' ? null : 'quality'))}
        >
          <div className="properties-panel__segments">
            {(['720p', '1080p'] as ExportResolution[]).map((resolution) => (
              <button key={resolution} type="button" className={timeline.settings.resolution === resolution ? 'is-active' : ''} onClick={() => updateSettings({ resolution })}>{resolution}</button>
            ))}
          </div>
        </CollapsibleSection>

        {selectedVideo && selectedVideoIds.length === 1 && (
          <div className="properties-panel__section properties-panel__clip-box">
            <span className="properties-panel__label"><Video size={13} /> Clip {videoIndex + 1}</span>
            <div className="properties-panel__row">
              <label className="properties-panel__field"><span>Entrada</span><input type="number" min="0" max={selectedVideo.sourceOut - .2} step=".05" value={Number(selectedVideo.sourceIn.toFixed(2))} onChange={(event) => setVideoClipBounds(selectedVideo.id, Number(event.target.value), selectedVideo.sourceOut)} /></label>
              <label className="properties-panel__field"><span>Salida</span><input type="number" min={selectedVideo.sourceIn + .2} max={selectedVideo.sourceDuration} step=".05" value={Number(selectedVideo.sourceOut.toFixed(2))} onChange={(event) => setVideoClipBounds(selectedVideo.id, selectedVideo.sourceIn, Number(event.target.value))} /></label>
            </div>
            <div className="properties-panel__button-row">
              <button type="button" onClick={() => moveVideoClip(selectedVideo.id, -1)} disabled={videoIndex === 0}><ArrowLeft size={14} /> Antes</button>
              <button type="button" onClick={() => moveVideoClip(selectedVideo.id, 1)} disabled={videoIndex === timeline.videoTrack.clips.length - 1}>Después <ArrowRight size={14} /></button>
            </div>
            <button type="button" className="properties-panel__danger" onClick={() => removeVideoClip(selectedVideo.id)}><Trash2 size={14} /> Eliminar clip</button>
          </div>
        )}
      </aside>
    );
  }

  if (panel === 'subtitles') {
    const textScope = selectedTextIds.length > 1
      ? `${selectedTextIds.length} subtítulos seleccionados`
      : selectedTextIds.length === 1
        ? 'Subtítulo seleccionado'
        : 'Subtítulos sincronizados';
    return (
      <aside className="properties-panel">
        <PanelHeading icon={<span>CC</span>} title="Subtítulos" subtitle={textScope} />
        <button type="button" className="properties-panel__primary" onClick={onAutoCaption} disabled={isTranscribing}>
          <Sparkles size={14} /> {isTranscribing ? 'Transcribiendo…' : 'Subtitular con IA'}
        </button>
        <p className="properties-panel__hint">Transcribe el audio y crea subtítulos sincronizados automáticamente con el preset y efecto elegidos.</p>
        <button type="button" className="properties-panel__secondary" onClick={onAddSubtitle}><Plus size={14} /> Añadir subtítulo fijo</button>
        {selectedText ? (
          <>
            <p className="properties-panel__hint">El preset, efecto, estilo, posición, tamaño y color se aplican a todos los subtítulos del vídeo a la vez (un único aspecto por vídeo, como en el Creador de clips). El contenido y los tiempos son solo de la frase seleccionada/visible.</p>
            <label className="properties-panel__field"><span>Contenido</span><textarea data-i18n-skip="" rows={3} maxLength={80} value={selectedText.text} onChange={(event) => updateTextClip(selectedText.id, { text: event.target.value })} /></label>
            <div className="properties-panel__row">
              <label className="properties-panel__field"><span>Inicio</span><input type="number" min="0" max={selectedText.endTime - .2} step=".1" value={Number(selectedText.startTime.toFixed(1))} onChange={(event) => setTextClipTiming(selectedText.id, Number(event.target.value), selectedText.endTime)} /></label>
              <label className="properties-panel__field"><span>Fin</span><input type="number" min={selectedText.startTime + .2} max={timeline.duration} step=".1" value={Number(selectedText.endTime.toFixed(1))} onChange={(event) => setTextClipTiming(selectedText.id, selectedText.startTime, Number(event.target.value))} /></label>
            </div>
            <div className="properties-panel__section">
              <span className="properties-panel__label">Diseños 3D profesionales</span>
              <div className="subtitle-preset-grid subtitle-preset-grid--featured">
                {FEATURED_3D_TEXT_PRESET_OPTIONS.map((option) => (
                  <PresetPreviewCard
                    key={option.value}
                    option={option}
                    active={selectedText.preset === option.value}
                    onSelect={() => updateTextClips(allSubtitleIds, { preset: option.value })}
                  />
                ))}
              </div>
              <span className="subtitle-preset-subheading">Estilos animados</span>
              <div className="subtitle-preset-grid">
                {STANDARD_SUBTITLE_PRESET_OPTIONS.map((option) => (
                  <PresetPreviewCard
                    key={option.value}
                    option={option}
                    active={selectedText.preset === option.value}
                    onSelect={() => updateTextClips(allSubtitleIds, { preset: option.value })}
                  />
                ))}
              </div>
              <p className="properties-panel__hint">Los primeros modelos reproducen material, bisel, extrusión, brillo y sombra; todos conservan su identidad al exportar.</p>
            </div>
            <div className="properties-panel__section">
              <span className="properties-panel__label">Animación por palabra</span>
              <div className="subtitle-wordfx-grid" style={{
                '--wordfx-active': getSubtitlePresetOption(selectedText.preset).color,
                '--wordfx-inactive': getSubtitlePresetOption(selectedText.preset).inactiveColor
              } as React.CSSProperties}
              >
                {WORD_EFFECT_OPTIONS.map(({ value, label, hint }) => (
                  <button
                    key={value}
                    type="button"
                    className={`subtitle-wordfx-option${selectedText.wordEffect === value ? ' is-active' : ''}`}
                    title={hint}
                    onClick={() => updateTextClips(allSubtitleIds, { wordEffect: value })}
                    aria-pressed={selectedText.wordEffect === value}
                  >
                    <i className={`subtitle-wordfx-option__demo subtitle-wordfx-option__demo--${value}`} aria-hidden="true">PALABRA</i>
                    <b>{label}</b>
                    <small>{hint}</small>
                  </button>
                ))}
              </div>
            </div>
            <label className="properties-panel__field"><span>Estilo</span><select value={selectedText.style} onChange={(event) => updateTextClips(allSubtitleIds, { style: event.target.value as TextClipStyle })}><option value="outline">Contorno</option><option value="box">Caja</option><option value="shadow">Sombra</option></select></label>
            <div className="properties-panel__row">
              <label className="properties-panel__field"><span>Posición</span><select value={selectedText.position} onChange={(event) => { const position = event.target.value as TextClipPosition; updateTextClips(allSubtitleIds, { position, y: TEXT_POSITION_Y[position] }); }}><option value="top">Arriba</option><option value="center">Centro</option><option value="bottom">Abajo</option></select></label>
              <label className="properties-panel__field"><span>Tamaño</span><select value={selectedText.size} onChange={(event) => updateTextClips(allSubtitleIds, { size: event.target.value as TextClipSize })}><option value="small">Pequeño</option><option value="medium">Mediano</option><option value="large">Grande</option></select></label>
            </div>
            {selectedText.preset === 'none' && (
              <fieldset className="properties-panel__colors"><legend>Color</legend><div>{(Object.keys(TEXT_COLORS) as TextClipColor[]).map((color) => <label key={color} title={COLOR_LABELS[color]}><input type="radio" name="subtitle-color" checked={selectedText.color === color} onChange={() => updateTextClips(allSubtitleIds, { color })} /><span style={{ background: TEXT_COLORS[color] }} /></label>)}</div></fieldset>
            )}
            <button type="button" className="properties-panel__danger" onClick={() => removeTextClip(selectedText.id)}><Trash2 size={14} /> Eliminar subtítulo</button>
          </>
        ) : <p className="properties-panel__empty">Selecciona un subtítulo o crea uno nuevo.</p>}
      </aside>
    );
  }

  if (panel === 'text') {
    const textTargetIds = selectedTextIds.length ? selectedTextIds : selectedText ? [selectedText.id] : [];
    const textTargetClips = textTargetIds
      .map((id) => timeline.textTrack.clips.find((clip) => clip.id === id))
      .filter((clip): clip is TextClip => Boolean(clip));
    const textUsesFeatured3d = Boolean(selectedText && isFeatured3dPreset(selectedText.preset));
    const textScope = selectedTextIds.length > 1
      ? `${selectedTextIds.length} frases seleccionadas`
      : selectedTextIds.length === 1
        ? 'Frase seleccionada'
        : 'Rótulos libres';
    return (
      <aside className="properties-panel">
        <PanelHeading icon={<span>T</span>} title="Texto" subtitle={textScope} />
        <button type="button" className="properties-panel__primary" onClick={onAddText}><Plus size={14} /> Añadir frase</button>
        {selectedText ? (
          <>
            {selectedTextIds.length > 1 && <p className="properties-panel__hint">La apariencia se aplicará a todas las frases seleccionadas. El contenido y los tiempos pertenecen a la frase principal.</p>}
            <label className="properties-panel__field"><span>Contenido</span><textarea data-i18n-skip="" rows={4} maxLength={80} value={selectedText.text} onChange={(event) => updateTextClip(selectedText.id, { text: event.target.value })} /></label>
            <div className="properties-panel__row">
              <label className="properties-panel__field"><span>Inicio</span><input type="number" min="0" max={selectedText.endTime - .2} step=".1" value={Number(selectedText.startTime.toFixed(1))} onChange={(event) => setTextClipTiming(selectedText.id, Number(event.target.value), selectedText.endTime)} /></label>
              <label className="properties-panel__field"><span>Fin</span><input type="number" min={selectedText.startTime + .2} max={timeline.duration} step=".1" value={Number(selectedText.endTime.toFixed(1))} onChange={(event) => setTextClipTiming(selectedText.id, selectedText.startTime, Number(event.target.value))} /></label>
            </div>
            <TextAnimationControls
              clip={selectedText}
              clips={textTargetClips.length ? textTargetClips : [selectedText]}
              onChange={(changes) => updateTextClips(textTargetIds, changes)}
              onPreview={(phase, preset) => {
                if (preset === 'none') {
                  setCurrentTime(selectedText.startTime + (selectedText.endTime - selectedText.startTime) / 2);
                  return;
                }
                const previewClip = {
                  ...selectedText,
                  ...(phase === 'entrance' ? { entranceAnimation: preset } : { exitAnimation: preset })
                };
                const fitted = fitTextAnimationDurations(previewClip);
                const phaseDurationMs = phase === 'entrance' ? fitted.entranceMs : fitted.exitMs;
                const previewTime = phase === 'entrance'
                  ? selectedText.startTime + phaseDurationMs * .55 / 1000
                  : selectedText.endTime - phaseDurationMs * .55 / 1000;
                setCurrentTime(previewTime);
              }}
            />
            <div className="properties-panel__section">
              <span className="properties-panel__label">Diseños 3D profesionales</span>
              <div className="subtitle-preset-grid subtitle-preset-grid--featured">
                {FEATURED_3D_TEXT_PRESET_OPTIONS.map((option) => (
                  <PresetPreviewCard
                    key={option.value}
                    option={option}
                    active={selectedText.preset === option.value}
                    onSelect={() => updateTextClips(textTargetIds, { preset: option.value, font: option.textFont || selectedText.font })}
                  />
                ))}
              </div>
              <p className="properties-panel__hint">Cromo inflado, chicle gráfico, perla con oro y volumen de madera, inspirados en las referencias.</p>
            </div>
            <label className="properties-panel__field"><span>Acabado adicional</span><select value={selectedText.style} onChange={(event) => updateTextClips(textTargetIds, { style: event.target.value as TextClipStyle })}><option value="outline">Contorno</option><option value="box">Caja</option><option value="shadow">Sombra</option></select></label>
            <div className="properties-panel__section">
              <span className="properties-panel__label">Tipografías planas</span>
              <div className="font-options">
                {FONT_OPTIONS.map(({ value, label, sample }) => (
                  <button
                    key={value}
                    type="button"
                    className={`font-option font-option--${value}${!textUsesFeatured3d && selectedText.font === value ? ' is-active' : ''}`}
                    onClick={() => updateTextClips(textTargetIds, { font: value, preset: 'none' })}
                    aria-pressed={!textUsesFeatured3d && selectedText.font === value}
                  >
                    <strong>{sample}</strong><span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="properties-panel__row">
              <label className="properties-panel__field"><span>Posición</span><select value={selectedText.position} onChange={(event) => { const position = event.target.value as TextClipPosition; updateTextClips(textTargetIds, { position, y: TEXT_POSITION_Y[position] }); }}><option value="top">Arriba</option><option value="center">Centro</option><option value="bottom">Abajo</option></select></label>
              <label className="properties-panel__field"><span>Tamaño</span><select value={selectedText.size} onChange={(event) => updateTextClips(textTargetIds, { size: event.target.value as TextClipSize })}><option value="small">Pequeño</option><option value="medium">Mediano</option><option value="large">Grande</option></select></label>
            </div>
            <div className="properties-panel__section">
              <span className="properties-panel__label">Transformar</span>
              <RangeField label="Horizontal" value={Math.round(selectedText.x * 100)} min={Math.ceil(selectedText.width * 50)} max={Math.floor(100 - selectedText.width * 50)} step={1} suffix="%" onChange={(value) => updateTextClips(textTargetIds, { x: value / 100 })} />
              <RangeField label="Vertical" value={Math.round(selectedText.y * 100)} min={4} max={96} step={1} suffix="%" onChange={(value) => { const y = value / 100; updateTextClips(textTargetIds, { y, position: textPositionFromY(y) }); }} />
              <RangeField label="Ancho" value={Math.round(selectedText.width * 100)} min={15} max={96} step={1} suffix="%" onChange={(value) => updateTextClips(textTargetIds, { width: value / 100 })} />
              <RangeField label="Escala" value={Math.round(selectedText.scale * 100)} min={50} max={250} step={1} suffix="%" onChange={(value) => updateTextClips(textTargetIds, { scale: value / 100 })} />
            </div>
            <KeyframesEditor
              keyframes={selectedText.keyframes}
              clipDurationMs={(selectedText.endTime - selectedText.startTime) * 1000}
              currentRelativeMs={(currentTime - selectedText.startTime) * 1000}
              staticTransform={{ x: selectedText.x, y: selectedText.y, scale: selectedText.scale, opacity: 1 }}
              onChange={(keyframes) => updateTextClip(selectedText.id, { keyframes })}
              onSeekRelativeMs={(relativeMs) => setCurrentTime(selectedText.startTime + relativeMs / 1000)}
              onTrackRegion={(durationSec) => onTrackRegion('text', selectedText.id, durationSec)}
            />
            {!textUsesFeatured3d && <fieldset className="properties-panel__colors"><legend>Color</legend><div>{(Object.keys(TEXT_COLORS) as TextClipColor[]).map((color) => <label key={color} title={COLOR_LABELS[color]}><input type="radio" name="text-color" checked={selectedText.color === color} onChange={() => updateTextClips(textTargetIds, { color })} /><span style={{ background: TEXT_COLORS[color] }} /></label>)}</div></fieldset>}
            <button type="button" className="properties-panel__danger" onClick={() => removeTextClip(selectedText.id)}><Trash2 size={14} /> Eliminar frase</button>
          </>
        ) : <p className="properties-panel__empty">Selecciona una frase o crea una nueva.</p>}
      </aside>
    );
  }

  if (panel === 'audio') {
    return (
      <aside className="properties-panel">
        <PanelHeading icon={<Music2 size={16} />} title="Audio" subtitle={rangeTargets.audio ? 'Pista completa seleccionada' : 'Sonido y limpieza'} />
        <div className="properties-panel__audio-options">
          <label><input type="radio" name="audio-mode" checked={timeline.audioTrack.mode === 'keep'} onChange={() => updateAudioTrack({ mode: 'keep' })} /> Audio original</label>
          <label><input type="radio" name="audio-mode" checked={timeline.audioTrack.mode === 'mute'} onChange={() => updateAudioTrack({ mode: 'mute' })} /> Silencio</label>
          <label><input type="radio" name="audio-mode" checked={timeline.audioTrack.mode === 'replace'} onChange={() => updateAudioTrack({ mode: 'replace' })} /> Sustituir audio</label>
        </div>
        {timeline.audioTrack.mode === 'replace' && (
          <>
            {mediaUpload}
            {!hasExternalAudio && <p className="properties-panel__warning">Sube o selecciona un audio antes de exportar.</p>}
            {assets.filter((asset) => asset.type === 'audio').map((asset) => <button className="properties-panel__asset-row" key={asset.id} type="button" onClick={() => onUseAudio(asset)}><Music2 size={14} /><span data-i18n-skip="">{asset.name}</span><Check size={13} /></button>)}
          </>
        )}
        {timeline.audioTrack.mode !== 'mute' && <RangeField label="Volumen" value={Math.round(timeline.audioTrack.volume * 100)} min={0} max={100} step={1} suffix="%" onChange={(value) => updateAudioTrack({ volume: value / 100 })} />}
        <label className="properties-panel__toggle"><span><strong>Limpieza de audio</strong><small>Reduce ruido y mejora la voz con FFmpeg</small></span><input type="checkbox" checked={timeline.audioTrack.cleanup} onChange={() => updateAudioTrack({ cleanup: !timeline.audioTrack.cleanup })} /></label>

        {/* Función 6 — Editor de audio por capas: segunda pista, música de
            fondo independiente de la voz de arriba, con fades y ducking
            manual (el usuario marca dónde hay voz y la música baja ahí). */}
        <div className="properties-panel__section">
          <span className="properties-panel__label"><Music2 size={13} /> Música de fondo</span>
          {!timeline.musicTrack ? (
            <>
              <p className="properties-panel__hint">Añade una pista de música independiente de la voz, con su propio volumen, fades y ducking.</p>
              {mediaUpload}
              {assets.filter((asset) => asset.type === 'audio').map((asset) => (
                <button
                  className="properties-panel__asset-row"
                  key={asset.id}
                  type="button"
                  onClick={() => setMusicTrack({
                    id: `music-${asset.id}`,
                    type: 'music',
                    sourceUrl: asset.url,
                    ...(asset.storageKey ? { storageKey: asset.storageKey } : {}),
                    name: asset.name,
                    startTime: 0,
                    endTime: timeline.duration,
                    volume: .6,
                    fadeInMs: 500,
                    fadeOutMs: 800,
                    duckingEnabled: false,
                    duckingAmount: .7,
                    duckingRegions: []
                  })}
                ><Music2 size={14} /><span data-i18n-skip="">{asset.name}</span><Plus size={13} /></button>
              ))}
            </>
          ) : (
            <>
              <div className="properties-panel__asset-row" data-i18n-skip="" style={{ cursor: 'default' }}>
                <Music2 size={14} /><span>{timeline.musicTrack.name}</span>
                <button type="button" onClick={() => setMusicTrack(null)} title="Quitar música"><Trash2 size={13} /></button>
              </div>
              <div className="properties-panel__row">
                <label className="properties-panel__field"><span>Inicio</span><input type="number" min="0" max={timeline.musicTrack.endTime - .5} step=".1" value={Number(timeline.musicTrack.startTime.toFixed(1))} onChange={(event) => updateMusicTrack({ startTime: Number(event.target.value) })} /></label>
                <label className="properties-panel__field"><span>Fin</span><input type="number" min={timeline.musicTrack.startTime + .5} max={timeline.duration} step=".1" value={Number(timeline.musicTrack.endTime.toFixed(1))} onChange={(event) => updateMusicTrack({ endTime: Number(event.target.value) })} /></label>
              </div>
              <RangeField label="Volumen" value={Math.round(timeline.musicTrack.volume * 100)} min={0} max={100} step={1} suffix="%" onChange={(value) => updateMusicTrack({ volume: value / 100 })} />
              <div className="properties-panel__row">
                <label className="properties-panel__field"><span>Fade in</span><input type="number" min={0} max={5000} step={100} value={timeline.musicTrack.fadeInMs} onChange={(event) => updateMusicTrack({ fadeInMs: Number(event.target.value) })} /></label>
                <label className="properties-panel__field"><span>Fade out (ms)</span><input type="number" min={0} max={5000} step={100} value={timeline.musicTrack.fadeOutMs} onChange={(event) => updateMusicTrack({ fadeOutMs: Number(event.target.value) })} /></label>
              </div>
              <label className="properties-panel__toggle">
                <span><strong>Ducking automático</strong><small>Baja la música en los tramos de voz marcados abajo</small></span>
                <input type="checkbox" checked={timeline.musicTrack.duckingEnabled} onChange={() => updateMusicTrack({ duckingEnabled: !timeline.musicTrack!.duckingEnabled })} />
              </label>
              {timeline.musicTrack.duckingEnabled && (
                <>
                  <RangeField label="Intensidad del ducking" value={Math.round(timeline.musicTrack.duckingAmount * 100)} min={10} max={100} step={5} suffix="%" onChange={(value) => updateMusicTrack({ duckingAmount: value / 100 })} />
                  <button
                    type="button"
                    className="properties-panel__secondary"
                    onClick={() => addDuckingRegion(currentTime, Math.min(timeline.duration, currentTime + 2))}
                  ><Plus size={14} /> Marcar tramo de voz en el cabezal (+2 s)</button>
                  {timeline.musicTrack.duckingRegions.length > 0 && (
                    <ul className="properties-panel__ducking-list">
                      {timeline.musicTrack.duckingRegions.map((region) => (
                        <li key={region.id}>
                          <span>{region.startTime.toFixed(1)}s – {region.endTime.toFixed(1)}s</span>
                          <button type="button" onClick={() => removeDuckingRegion(region.id)} aria-label="Quitar tramo"><Trash2 size={12} /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </aside>
    );
  }

  if (panel === 'opening' || panel === 'closing') {
    const isOpening = panel === 'opening';
    const type = isOpening ? timeline.settings.startTransitionType : timeline.settings.endTransitionType;
    const duration = isOpening ? timeline.settings.startTransitionDuration : timeline.settings.endTransitionDuration;
    return (
      <aside className="properties-panel">
        <PanelHeading
          icon={isOpening ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}
          title={isOpening ? 'Apertura' : 'Cierre'}
          subtitle={isOpening ? 'Transición especial al comenzar' : 'Transición especial al terminar'}
        />
        <p className="properties-panel__hint">
          {isOpening
            ? 'Se mantiene siempre anclada al principio del primer vídeo.'
            : 'Se mantiene siempre anclada al final del último vídeo.'}
        </p>
        <TransitionCutEditor
          type={type}
          duration={duration}
          options={isOpening ? OPENING_TRANSITION_OPTIONS : CLOSING_TRANSITION_OPTIONS}
          onChange={(nextType, nextDuration) => updateSettings(isOpening
            ? { startTransitionType: nextType, startTransitionDuration: nextDuration }
            : { endTransitionType: nextType, endTransitionDuration: nextDuration })}
        />
      </aside>
    );
  }

  if (panel === 'transitions') {
    const isStartTransition = selectedTransitionClipId === '__timeline-start__';
    const isEndTransition = selectedTransitionClipId === '__timeline-end__';
    const selectedTransitionIndex = selectedTransitionClipId
      ? timeline.videoTrack.clips.findIndex((clip) => clip.id === selectedTransitionClipId)
      : -1;
    const selectedTransition = selectedTransitionIndex >= 0 && selectedTransitionIndex < timeline.videoTrack.clips.length - 1
      ? timeline.videoTrack.clips[selectedTransitionIndex]
      : undefined;

    if (selectedTransition || isStartTransition || isEndTransition) {
      const type = isStartTransition
        ? timeline.settings.startTransitionType
        : isEndTransition
          ? timeline.settings.endTransitionType
          : selectedTransition!.transitionType;
      const duration = isStartTransition
        ? timeline.settings.startTransitionDuration
        : isEndTransition
          ? timeline.settings.endTransitionDuration
          : selectedTransition!.transitionDuration;
      return (
        <aside className="properties-panel">
          <PanelHeading
            icon={<Sparkles size={16} />}
            title={isStartTransition ? 'Transición de entrada' : isEndTransition ? 'Transición de salida' : 'Transición del corte'}
            subtitle={isStartTransition ? 'Principio del vídeo' : isEndTransition ? 'Final del vídeo' : `Clip ${selectedTransitionIndex + 1} a clip ${selectedTransitionIndex + 2}`}
          />
          <button type="button" className="properties-panel__reset" onClick={onClearTransitionSelection}>
            <ArrowLeft size={14} /> Todas las transiciones
          </button>
          <TransitionCutEditor
            type={type}
            duration={duration}
            onChange={(nextType, nextDuration) => {
              if (isStartTransition) updateSettings({ startTransitionType: nextType, startTransitionDuration: nextDuration });
              else if (isEndTransition) updateSettings({ endTransitionType: nextType, endTransitionDuration: nextDuration });
              else updateClipTransition(selectedTransition!.id, nextType, nextDuration);
            }}
          />
        </aside>
      );
    }

    return (
      <aside className="properties-panel">
        <PanelHeading icon={<Sparkles size={16} />} title="Transiciones" subtitle="Aplicar a todas las uniones" />
        <div className="transition-options">
          {TRANSITION_OPTIONS.map(({ value, title, subtitle }) => (
            <button key={value} type="button" className={timeline.settings.transitionType === value ? 'is-active' : ''} onClick={() => setAllTransitions(value, timeline.settings.transitionDuration)}><span className={`transition-swatch transition-swatch--${value}`} /><span><strong>{title}</strong><small>{subtitle}</small></span>{timeline.settings.transitionType === value && <Check size={14} />}</button>
          ))}
        </div>
        {timeline.settings.transitionType !== 'none' && <RangeField label="Duración" value={timeline.settings.transitionDuration} min={.1} max={1} step={.05} suffix=" s" onChange={(value) => setAllTransitions(timeline.settings.transitionType, value)} />}
      </aside>
    );
  }

  if (panel === 'brand') {
    const imageAssets = assets.filter((asset) => asset.type === 'image');
    return (
      <aside className="properties-panel">
        <PanelHeading icon={<ImageIcon size={16} />} title="Plantilla de marca" subtitle="Logo y portada" />
        {timeline.settings.brandLogoUrl ? (
          <div className="brand-logo-preview"><img src={timeline.settings.brandLogoUrl} alt="Logo de marca" /><span data-i18n-skip="">{timeline.settings.brandLogoName}</span><button type="button" onClick={() => updateSettings({ brandLogoUrl: '', brandLogoName: '' })}>Quitar</button></div>
        ) : (
          <button type="button" className="media-dropzone media-dropzone--compact" onClick={() => logoRef.current?.click()}><Upload size={20} /><strong>Subir logotipo</strong><span>PNG o WEBP recomendado</span></button>
        )}
        <input ref={logoRef} className="sr-only" type="file" accept="image/*" onChange={async (event) => { const file = event.target.files?.[0]; if (file) { const uploaded = await onUploadFiles([file]); if (uploaded[0]?.type === 'image') onUseLogo(uploaded[0]); } event.target.value = ''; }} />
        {imageAssets.map((asset) => <button className="properties-panel__asset-row" key={asset.id} type="button" onClick={() => onUseLogo(asset)}><img src={asset.url} alt="" /><span data-i18n-skip="">{asset.name}</span><Check size={13} /></button>)}
        {timeline.settings.brandLogoUrl && (
          <>
            <label className="properties-panel__field"><span>Posición</span><select value={timeline.settings.brandLogoPosition} onChange={(event) => updateSettings({ brandLogoPosition: event.target.value as BrandLogoPosition })}><option value="top-left">Arriba izquierda</option><option value="top-right">Arriba derecha</option><option value="bottom-left">Abajo izquierda</option><option value="bottom-right">Abajo derecha</option></select></label>
            <RangeField label="Tamaño del logo" value={Math.round(timeline.settings.brandLogoScale * 100)} min={8} max={32} step={1} suffix="%" onChange={(value) => updateSettings({ brandLogoScale: value / 100 })} />
          </>
        )}
        <div className="properties-panel__section">
          <span className="properties-panel__label"><ImagePlus size={13} /> Portada</span>
          <button type="button" className="properties-panel__upload" onClick={() => updateSettings({ coverTime: currentTime })}><ImagePlus size={14} /> Usar fotograma actual</button>
          {timeline.settings.coverTime != null && <div className="properties-panel__cover-selected"><span>Fotograma {formatTimecode(timeline.settings.coverTime, false)}</span><button type="button" onClick={() => updateSettings({ coverTime: null })}>Quitar</button></div>}
          <label className="properties-panel__field"><span>Título de portada</span><input data-i18n-skip="" value={timeline.settings.coverTitle} maxLength={80} placeholder={t('Opcional')} onChange={(event) => updateSettings({ coverTitle: event.target.value })} /></label>
        </div>
      </aside>
    );
  }

  const brollTargetIds = selectedBrollIds.length ? selectedBrollIds : selectedBroll ? [selectedBroll.id] : [];
  const brollScope = selectedBrollIds.length > 1
    ? `${selectedBrollIds.length} B-Rolls seleccionados`
    : selectedBrollIds.length === 1
      ? 'B-Roll seleccionado'
      : 'Imágenes sobre el vídeo';

  return (
    <aside className="properties-panel">
      <PanelHeading icon={<Clapperboard size={16} />} title="B-Roll" subtitle={brollScope} />
      {/* Antes solo se mostraba el botón de subida cuando la biblioteca no
          tenía NINGUNA imagen todavía — en cuanto había una (p. ej. un logo
          subido desde "Marca"), este panel se quedaba sin forma de subir una
          imagen nueva. Se muestra siempre. */}
      {mediaUpload}
      {assets.filter((asset) => asset.type === 'image').map((asset) => <button className="properties-panel__asset-row" key={asset.id} type="button" onClick={() => onAddBroll(asset)}><img src={asset.url} alt="" /><span data-i18n-skip="">{asset.name}</span><Plus size={13} /></button>)}
      <div className="broll-list">
        {timeline.brollTrack.clips.map((clip) => <button type="button" className={selectedBrollIds.includes(clip.id) ? 'is-active' : ''} key={clip.id} onClick={() => selectClip({ kind: 'broll', id: clip.id })}><img src={clip.sourceUrl} alt="" /><span><strong data-i18n-skip="">{clip.name}</strong><small>{clip.startTime.toFixed(1)}s – {clip.endTime.toFixed(1)}s</small></span></button>)}
      </div>
      {selectedBroll && (
        <div className="properties-panel__section properties-panel__clip-box">
          {selectedBrollIds.length > 1 && <p className="properties-panel__hint">La opacidad y la transformación se aplicarán a todos los B-Rolls seleccionados. El tiempo pertenece al elemento principal.</p>}
          <div className="properties-panel__row"><label className="properties-panel__field"><span>Inicio</span><input type="number" min="0" max={selectedBroll.endTime - .2} step=".1" value={Number(selectedBroll.startTime.toFixed(1))} onChange={(event) => updateBrollClip(selectedBroll.id, { startTime: Number(event.target.value) })} /></label><label className="properties-panel__field"><span>Fin</span><input type="number" min={selectedBroll.startTime + .2} max={timeline.duration} step=".1" value={Number(selectedBroll.endTime.toFixed(1))} onChange={(event) => updateBrollClip(selectedBroll.id, { endTime: Number(event.target.value) })} /></label></div>
          <RangeField label="Opacidad" value={Math.round(selectedBroll.opacity * 100)} min={10} max={100} step={1} suffix="%" onChange={(value) => updateBrollClips(brollTargetIds, { opacity: value / 100 })} />
          <RangeField label="Horizontal" value={Math.round(selectedBroll.x * 100)} min={Math.ceil(selectedBroll.width * 50)} max={Math.floor(100 - selectedBroll.width * 50)} step={1} suffix="%" onChange={(value) => updateBrollClips(brollTargetIds, { x: value / 100 })} />
          <RangeField label="Vertical" value={Math.round(selectedBroll.y * 100)} min={Math.ceil(selectedBroll.height * 50)} max={Math.floor(100 - selectedBroll.height * 50)} step={1} suffix="%" onChange={(value) => updateBrollClips(brollTargetIds, { y: value / 100 })} />
          <RangeField label="Ancho" value={Math.round(selectedBroll.width * 100)} min={12} max={100} step={1} suffix="%" onChange={(value) => updateBrollClips(brollTargetIds, { width: value / 100 })} />
          <RangeField label="Alto" value={Math.round(selectedBroll.height * 100)} min={12} max={100} step={1} suffix="%" onChange={(value) => updateBrollClips(brollTargetIds, { height: value / 100 })} />
          <div className="properties-panel__section">
            <span className="properties-panel__label">Modo de fusión</span>
            <div className="properties-panel__segments" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {BROLL_BLEND_MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={selectedBroll.blendMode === option.value ? 'is-active' : ''}
                  onClick={() => updateBrollClips(brollTargetIds, { blendMode: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {selectedBroll.blendMode !== 'normal' && selectedBroll.keyframes && selectedBroll.keyframes.length >= 2 && (
              <p className="properties-panel__hint">Con keyframes activos, el modo de fusión solo se ve en la previsualización — el vídeo exportado usa "Normal" por ahora.</p>
            )}
          </div>
          {(() => {
            const brollIndex = timeline.brollTrack.clips.findIndex((clip) => clip.id === selectedBroll.id);
            return (
              <div className="properties-panel__button-row">
                <button type="button" onClick={() => moveBrollClip(selectedBroll.id, -1)} disabled={brollIndex <= 0}>Bajar capa</button>
                <button type="button" onClick={() => moveBrollClip(selectedBroll.id, 1)} disabled={brollIndex < 0 || brollIndex >= timeline.brollTrack.clips.length - 1}>Subir capa</button>
              </div>
            );
          })()}
          <KeyframesEditor
            keyframes={selectedBroll.keyframes}
            clipDurationMs={(selectedBroll.endTime - selectedBroll.startTime) * 1000}
            currentRelativeMs={(currentTime - selectedBroll.startTime) * 1000}
            staticTransform={{ x: selectedBroll.x, y: selectedBroll.y, scale: 1, opacity: selectedBroll.opacity }}
            onChange={(keyframes) => updateBrollClip(selectedBroll.id, { keyframes })}
            onSeekRelativeMs={(relativeMs) => setCurrentTime(selectedBroll.startTime + relativeMs / 1000)}
            onTrackRegion={(durationSec) => onTrackRegion('broll', selectedBroll.id, durationSec)}
          />
          <button type="button" className="properties-panel__danger" onClick={() => removeBrollClip(selectedBroll.id)}><Trash2 size={14} /> Eliminar B-Roll</button>
        </div>
      )}
    </aside>
  );
}
