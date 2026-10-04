import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, Minus, Pause, Play, Plus, RotateCcw, RotateCw, Upload, Volume2, VolumeX } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { TEXT_COLORS, TEXT_FONT_FAMILIES, TEXT_FONT_WEIGHTS, type TextClip, type TransitionType, type VideoClip } from '../../types/timeline';
import { clipAtProjectTime, formatTimecode, getTimelineRangeTargets, sourceTimeAtProjectTime } from '../../utils/timeline';
import { interpolateKeyframes } from '../../utils/keyframes';
import { buildVolumeEnvelope, evaluateVolumeEnvelope } from '../../utils/audioDucking';
import { getOutputSize, TEXT_SIZE_DIVISORS } from '../../utils/textOverlay';
import {
  isTextAnimationInProgress,
  resolveTextAnimationKeyframes,
  resolveTextLayerScale
} from '../../utils/textAnimations';
import {
  estimateWordTimings,
  getSubtitlePresetOption,
  mixHexColors,
  resolveSubtitleRendering,
  subtitleWordFrame
} from '../../constants/subtitlePresets';
import { RectangleSelectionOverlay, ROI_DRAG_HINT } from './RectangleSelectionOverlay';
import { getIntlLocale, t, useUiLocale } from '../../i18n';
import './VideoPreview.css';

interface VideoPreviewProps {
  externalAudioUrl?: string;
  onImportFiles?: (files: File[]) => Promise<void>;
  rectangleSelectionActive?: boolean;
}

const LAYOUT_CELLS = { fit: 1, fill: 1, split: 2, three: 3, four: 4, 'screen-share': 2, gameplay: 2 } as const;
const RESIZE_CORNERS = ['nw', 'ne', 'sw', 'se'] as const;
const MEDIA_OPERATION_TIMEOUT = 5000;
const SEEK_TOLERANCE = 0.08;

type TransformKind = 'text' | 'broll';
type ResizeCorner = typeof RESIZE_CORNERS[number];

interface TransformDraft {
  kind: TransformKind;
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

interface PointerSession {
  pointerId: number;
  mode: 'move' | 'resize';
  corner: ResizeCorner;
  startClientX: number;
  startClientY: number;
  start: TransformDraft;
  box: { left: number; right: number; top: number; bottom: number; width: number; height: number };
  changed: boolean;
}

interface TextEditState {
  id: string;
  value: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Reproduce en CSS el mismo xfade contra negro que el backend aplica en los
// bordes del vídeo exportado (ver `startTransitionType`/`endTransitionType`
// en server.js), para que la apertura y el cierre también se vean al
// previsualizar. `progress` va de 0 (negro) a 1 (vídeo totalmente visible).
function edgeTransitionStyle(type: TransitionType, progress: number): React.CSSProperties {
  if (type === 'none' || progress >= 1) return {};
  switch (type) {
    case 'fade':
      return { opacity: progress };
    case 'dissolve':
      return { opacity: Math.max(.08, progress), filter: `contrast(${1 + (1 - progress) * .8}) blur(${(1 - progress) * 7}px)` };
    case 'wipeleft':
      return { clipPath: `inset(0 0 0 ${(1 - progress) * 100}%)` };
    case 'wiperight':
      return { clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)` };
    case 'slideleft':
      return { opacity: Math.max(.2, progress), transform: `translateX(${(1 - progress) * 18}%)` };
    case 'slideright':
      return { opacity: Math.max(.2, progress), transform: `translateX(${-(1 - progress) * 18}%)` };
    case 'circleopen':
      return { clipPath: `circle(${progress * 75}% at 50% 50%)` };
    default:
      return {};
  }
}

function textPositionFromY(y: number): 'top' | 'center' | 'bottom' {
  if (y < 0.33) return 'top';
  if (y > 0.66) return 'bottom';
  return 'center';
}

function resizeTextEditor(editor: HTMLTextAreaElement) {
  editor.style.height = '0';
  editor.style.height = `${editor.scrollHeight}px`;
}

// Recorte "cover" por defecto al entrar en modo de ajuste manual: en vez de
// arrancar desde el fotograma completo (que con un vídeo horizontal en un
// lienzo vertical deja al width/height en 1 y bloquea el arrastre hasta que
// el usuario hace zoom a mano), calculamos ya el recorte centrado que llena
// el lienzo sin barras negras, igual que haría el layout "Rellenar".
function coverRoiForAspect(naturalWidth: number, naturalHeight: number, ratioWidth: number, ratioHeight: number) {
  const sourceAspect = naturalWidth / naturalHeight;
  const targetAspect = ratioWidth / ratioHeight;
  if (sourceAspect > targetAspect) {
    const width = targetAspect / sourceAspect;
    return { x: (1 - width) / 2, y: 0, width, height: 1 };
  }
  if (sourceAspect < targetAspect) {
    const height = sourceAspect / targetAspect;
    return { x: 0, y: (1 - height) / 2, width: 1, height };
  }
  return { x: 0, y: 0, width: 1, height: 1 };
}

export function VideoPreview({ externalAudioUrl = '', onImportFiles, rectangleSelectionActive = false }: VideoPreviewProps) {
  useUiLocale();
  const previewRef = useRef<HTMLElement>(null);
  const [frameNode, setFrameNode] = useState<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const secondaryVideoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const musicWasActiveRef = useRef(false);
  const animationRef = useRef<number>();
  const lastPlaybackTime = useRef(0);
  const playbackStoreTimeRef = useRef<number | null>(null);
  const mediaSwitchTokenRef = useRef(0);
  const mediaWaitCancelsRef = useRef(new Set<() => void>());
  const isSwitchingClipRef = useRef(false);
  const pointerCleanupRef = useRef<() => void>();
  const draftRef = useRef<TransformDraft | null>(null);
  const textEditorRef = useRef<HTMLTextAreaElement>(null);
  const editCancelledRef = useRef(false);
  const previousClipIdRef = useRef('');
  const transitionFrameRef = useRef<number>();
  const transitionTimerRef = useRef<number>();
  const [transformDraft, setTransformDraft] = useState<TransformDraft | null>(null);
  const [textEdit, setTextEdit] = useState<TextEditState | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  // Silencia solo la monitorización en vivo, sin tocar timeline.audioTrack.mode
  // (esa opción decide si el audio se conserva en el vídeo exportado).
  const [previewMuted, setPreviewMuted] = useState(false);
  const previewMutedRef = useRef(false);
  // Tamaño real del fotograma y del vídeo fuente: hacen falta en píxeles para
  // que el recorte manual (roi) se vea en la previsualización exactamente
  // igual que lo calcula timelineRoiFilter en el backend.
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [videoNaturalSize, setVideoNaturalSize] = useState({ width: 0, height: 0 });
  const timeline = useTimelineStore((state) => state.timeline);
  const currentTime = useTimelineStore((state) => state.currentTime);
  const isPlaying = useTimelineStore((state) => state.isPlaying);
  const setCurrentTime = useTimelineStore((state) => state.setCurrentTime);
  const setPlaying = useTimelineStore((state) => state.setPlaying);
  const selectClip = useTimelineStore((state) => state.selectClip);
  const selection = useTimelineStore((state) => state.selection);
  const rangeSelection = useTimelineStore((state) => state.rangeSelection);
  const updateTextClip = useTimelineStore((state) => state.updateTextClip);
  const setRectangleSelection = useTimelineStore((state) => state.setRectangleSelection);
  const zoomRectangleSelection = useTimelineStore((state) => state.zoomRectangleSelection);

  // Every seek/load belongs to a media operation. Cancelling the previous one
  // prevents a late `loadedmetadata`/`seeked` callback from starting an older
  // clip after the user has moved the playhead again.
  const invalidateMediaOperations = useCallback(() => {
    mediaSwitchTokenRef.current += 1;
    [...mediaWaitCancelsRef.current].forEach((cancel) => cancel());
    return mediaSwitchTokenRef.current;
  }, []);

  const cancelMediaOperations = useCallback(() => {
    invalidateMediaOperations();
    isSwitchingClipRef.current = false;
  }, [invalidateMediaOperations]);

  useEffect(() => () => {
    cancelMediaOperations();
    pointerCleanupRef.current?.();
    if (transitionFrameRef.current) cancelAnimationFrame(transitionFrameRef.current);
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
  }, [cancelMediaOperations]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === previewRef.current);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    // Depende del nodo (no de un ref leído una sola vez al montar): si en el
    // primer render el vídeo aún no estaba listo, el elemento del fotograma
    // no existía todavía y un efecto con `[]` nunca se habría vuelto a
    // ejecutar, dejando frameSize en 0 para siempre y bloqueando en
    // silencio el recorte manual (roiVideoStyle nunca se activaba).
    if (!frameNode) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setFrameSize({ width, height });
    });
    observer.observe(frameNode);
    return () => observer.disconnect();
  }, [frameNode]);

  // Al activar "Mover/Ajustar vídeo" sin recorte previo, arrancar ya con el
  // encuadre tipo "cover" (centrado, sin barras negras) en vez del fotograma
  // completo: así desaparecen los márgenes negros al instante y el primer
  // arrastre puede mover el vídeo de inmediato (con roi=fotograma completo,
  // width/height=1, no había margen para desplazar hasta hacer zoom antes).
  useEffect(() => {
    if (!rectangleSelectionActive || !timeline || timeline.roi) return;
    const naturalWidth = videoNaturalSize.width || frameSize.width;
    const naturalHeight = videoNaturalSize.height || frameSize.height;
    if (!naturalWidth || !naturalHeight) return;
    const [ratioWidth, ratioHeight] = timeline.settings.aspectRatio.split(':').map(Number);
    const defaultRoi = coverRoiForAspect(naturalWidth, naturalHeight, ratioWidth, ratioHeight);
    if (defaultRoi.width < 0.999 || defaultRoi.height < 0.999) setRectangleSelection(defaultRoi);
  }, [rectangleSelectionActive, timeline, videoNaturalSize, frameSize, setRectangleSelection]);

  useEffect(() => {
    if (!textEdit) return;
    const editor = textEditorRef.current;
    if (!editor) return;
    resizeTextEditor(editor);
    editor.focus();
    editor.select();
  }, [textEdit?.id]);

  // Función 6 — Editor de audio por capas: sincroniza el <audio> de la
  // música con el cabezal del proyecto — play/pausa cuando entra/sale de su
  // ventana [startTime,endTime), bucle nativo si la fuente es más corta que
  // el hueco, y el volumen recalculado cada fotograma a partir de la MISMA
  // envolvente (fades + ducking) que usa el export (ver server.js). Se
  // apoya en que `currentTime` ya se actualiza a ritmo de vídeo mediante el
  // bucle de reproducción principal de más abajo — no hace falta un rAF propio.
  useEffect(() => {
    const music = timeline?.musicTrack;
    const el = musicRef.current;
    if (!music || !el) return;
    const active = currentTime >= music.startTime && currentTime < music.endTime;
    if (!active) {
      if (musicWasActiveRef.current) {
        el.pause();
        musicWasActiveRef.current = false;
      }
      return;
    }
    const relativeSeconds = currentTime - music.startTime;
    if (el.duration > 0) {
      const target = relativeSeconds % el.duration;
      if (Math.abs(el.currentTime - target) > 0.4) { try { el.currentTime = target; } catch { /* aún cargando */ } }
    } else if (!musicWasActiveRef.current) {
      try { el.currentTime = relativeSeconds; } catch { /* aún cargando */ }
    }
    musicWasActiveRef.current = true;
    const envelope = buildVolumeEnvelope({
      durationMs: (music.endTime - music.startTime) * 1000,
      volume: music.volume,
      fadeInMs: music.fadeInMs,
      fadeOutMs: music.fadeOutMs,
      duckingEnabled: music.duckingEnabled,
      duckingAmount: music.duckingAmount,
      duckingRegions: music.duckingRegions,
      musicStartTime: music.startTime
    });
    el.volume = clamp(evaluateVolumeEnvelope(envelope, relativeSeconds * 1000), 0, 1);
    if (isPlaying && el.paused) el.play().catch(() => undefined);
    else if (!isPlaying && !el.paused) el.pause();
  }, [currentTime, isPlaying, timeline?.musicTrack]);

  const startTextEdit = useCallback((event: React.MouseEvent<HTMLElement>, clip: TextClip) => {
    event.preventDefault();
    event.stopPropagation();
    pointerCleanupRef.current?.();
    draftRef.current = null;
    setTransformDraft(null);
    setPlaying(false);
    selectClip({ kind: 'text', id: clip.id });
    editCancelledRef.current = false;
    setTextEdit({ id: clip.id, value: clip.text });
  }, [selectClip, setPlaying]);

  const beginTransform = useCallback((
    event: React.PointerEvent<HTMLElement>,
    initial: TransformDraft,
    mode: 'move' | 'resize',
    corner: ResizeCorner = 'se'
  ) => {
    if (event.button !== 0) return;
    const frame = frameNode;
    const layer = event.currentTarget.closest<HTMLElement>('[data-transform-layer]');
    if (!frame || !layer) return;
    event.preventDefault();
    event.stopPropagation();
    pointerCleanupRef.current?.();
    setPlaying(false);
    selectClip({ kind: initial.kind, id: initial.id });

    // getBoundingClientRect() incluye el borde de 1px de .video-preview__frame,
    // pero el left/top en % del hijo (y el overflow:hidden que lo recorta) se
    // calculan sobre la caja interior SIN ese borde. Sin este ajuste, arrastrar
    // hasta "0%"/"100%" deja siempre un hueco de ~1px (el grosor del borde)
    // entre la imagen y la esquina real, por mucho que se permita salir del
    // lienzo — es un desajuste de sistema de coordenadas, no un límite.
    const frameBorderRect = frame.getBoundingClientRect();
    const frameStyle = getComputedStyle(frame);
    const borderLeft = parseFloat(frameStyle.borderLeftWidth) || 0;
    const borderTop = parseFloat(frameStyle.borderTopWidth) || 0;
    const borderRight = parseFloat(frameStyle.borderRightWidth) || 0;
    const borderBottom = parseFloat(frameStyle.borderBottomWidth) || 0;
    const frameRect = {
      left: frameBorderRect.left + borderLeft,
      top: frameBorderRect.top + borderTop,
      width: frameBorderRect.width - borderLeft - borderRight,
      height: frameBorderRect.height - borderTop - borderBottom
    };
    const layerRect = layer.getBoundingClientRect();
    if (!frameRect.width || !frameRect.height) return;
    const box = {
      left: (layerRect.left - frameRect.left) / frameRect.width,
      right: (layerRect.right - frameRect.left) / frameRect.width,
      top: (layerRect.top - frameRect.top) / frameRect.height,
      bottom: (layerRect.bottom - frameRect.top) / frameRect.height,
      width: layerRect.width / frameRect.width,
      height: layerRect.height / frameRect.height
    };
    const start: TransformDraft = {
      ...initial,
      width: box.width,
      height: box.height
    };
    const session: PointerSession = {
      pointerId: event.pointerId,
      mode,
      corner,
      startClientX: event.clientX,
      startClientY: event.clientY,
      start,
      box,
      changed: false
    };
    draftRef.current = start;
    setTransformDraft(start);

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = mode === 'move' ? 'move' : (corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize');

    const onMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== session.pointerId) return;
      pointerEvent.preventDefault();
      const dx = (pointerEvent.clientX - session.startClientX) / frameRect.width;
      const dy = (pointerEvent.clientY - session.startClientY) / frameRect.height;
      let next: TransformDraft;

      // El b-roll/imagen puede arrastrarse hasta quedar totalmente fuera del
      // lienzo, para poder encajarlo a ras de una esquina sin que quede un
      // hueco fino por redondeo; el texto se queda acotado al lienzo, donde
      // sí queremos que siga siendo legible.
      const allowOverflow = session.start.kind === 'broll';

      if (session.mode === 'move') {
        const halfWidth = session.box.width / 2;
        const halfHeight = session.box.height / 2;
        const minX = allowOverflow ? -halfWidth : halfWidth;
        const maxX = allowOverflow ? 1 + halfWidth : 1 - halfWidth;
        const minY = allowOverflow ? -halfHeight : halfHeight;
        const maxY = allowOverflow ? 1 + halfHeight : 1 - halfHeight;
        next = {
          ...session.start,
          x: clamp(session.start.x + dx, minX, maxX),
          y: clamp(session.start.y + dy, minY, maxY)
        };
      } else {
        let { left, right, top, bottom } = session.box;
        const minWidth = session.start.kind === 'text' ? 0.15 : 0.12;
        const minHeight = session.start.kind === 'text'
          ? Math.max(0.03, session.box.height * (0.5 / session.start.scale))
          : 0.12;
        const maxHeight = session.start.kind === 'text'
          ? session.box.height * (2.5 / session.start.scale)
          : 1;

        if (session.corner.includes('w')) left = clamp(session.box.left + dx, allowOverflow ? -1 : 0, right - minWidth);
        if (session.corner.includes('e')) right = clamp(session.box.right + dx, left + minWidth, allowOverflow ? 2 : 1);
        if (session.corner.includes('n')) top = clamp(session.box.top + dy, allowOverflow ? -1 : Math.max(0, bottom - maxHeight), bottom - minHeight);
        if (session.corner.includes('s')) bottom = clamp(session.box.bottom + dy, top + minHeight, allowOverflow ? 2 : Math.min(1, top + maxHeight));
        const width = right - left;
        const height = bottom - top;
        next = {
          ...session.start,
          x: (left + right) / 2,
          y: (top + bottom) / 2,
          width,
          height,
          scale: session.start.kind === 'text'
            ? clamp(session.start.scale * (height / session.box.height), 0.5, 2.5)
            : 1
        };
      }

      session.changed = true;
      draftRef.current = next;
      setTransformDraft(next);
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      pointerCleanupRef.current = undefined;
    };
    const onUp = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== session.pointerId) return;
      const finalDraft = draftRef.current;
      cleanup();
      if (session.changed && finalDraft) {
        const state = useTimelineStore.getState();
        if (finalDraft.kind === 'text') {
          state.updateTextClip(finalDraft.id, {
            x: finalDraft.x,
            y: finalDraft.y,
            width: finalDraft.width,
            scale: finalDraft.scale,
            position: textPositionFromY(finalDraft.y)
          });
        } else {
          state.updateBrollClip(finalDraft.id, {
            x: finalDraft.x,
            y: finalDraft.y,
            width: finalDraft.width,
            height: finalDraft.height
          });
        }
      }
      draftRef.current = null;
      setTransformDraft(null);
    };
    const onCancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== session.pointerId) return;
      cleanup();
      draftRef.current = null;
      setTransformDraft(null);
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    pointerCleanupRef.current = cleanup;
  }, [frameNode, selectClip, setPlaying]);

  const waitForMediaCondition = useCallback((
    element: HTMLMediaElement,
    token: number,
    eventNames: string[],
    condition: () => boolean,
    start?: () => void,
    checkImmediately = true
  ): Promise<boolean> => new Promise((resolve) => {
    let settled = false;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      eventNames.forEach((eventName) => element.removeEventListener(eventName, check));
      element.removeEventListener('error', fail);
      mediaWaitCancelsRef.current.delete(cancel);
      resolve(success && token === mediaSwitchTokenRef.current);
    };
    const check = () => {
      if (token !== mediaSwitchTokenRef.current) {
        finish(false);
        return;
      }
      if (condition()) finish(true);
    };
    const fail = () => finish(false);
    const cancel = () => finish(false);
    const timeout = window.setTimeout(() => finish(false), MEDIA_OPERATION_TIMEOUT);

    mediaWaitCancelsRef.current.add(cancel);
    eventNames.forEach((eventName) => element.addEventListener(eventName, check));
    element.addEventListener('error', fail, { once: true });
    try {
      start?.();
      if (checkImmediately) check();
    } catch {
      finish(false);
    }
  }), []);

  const waitForMediaMetadata = useCallback(async (element: HTMLMediaElement, token: number) => {
    if (token !== mediaSwitchTokenRef.current) return false;
    if (element.readyState >= HTMLMediaElement.HAVE_METADATA) return true;
    return waitForMediaCondition(
      element,
      token,
      ['loadedmetadata', 'loadeddata', 'canplay'],
      () => element.readyState >= HTMLMediaElement.HAVE_METADATA
    );
  }, [waitForMediaCondition]);

  // `currentTime = x; play()` is not atomic. In particular after changing src,
  // Chrome may resolve play() while the seek to x is still pending; the RAF then
  // reads 0 and writes it back into the timeline store. Always wait for the
  // *seeked event* before playback is allowed to advance. Reading currentTime
  // immediately after assigning it is not enough: browsers can synchronously
  // expose the requested target before their decoder has reached that frame.
  const seekMediaElement = useCallback(async (element: HTMLMediaElement, time: number, token: number) => {
    if (!await waitForMediaMetadata(element, token) || token !== mediaSwitchTokenRef.current) return false;
    if (Math.abs(element.currentTime - time) <= SEEK_TOLERANCE && !element.seeking) return true;
    return waitForMediaCondition(
      element,
      token,
      ['seeked'],
      () => Math.abs(element.currentTime - time) <= SEEK_TOLERANCE && !element.seeking,
      () => { element.currentTime = time; },
      false
    );
  }, [waitForMediaCondition, waitForMediaMetadata]);

  const prepareVideoElement = useCallback(async (
    element: HTMLVideoElement,
    sourceUrl: string,
    sourceTime: number,
    token: number
  ) => {
    if (token !== mediaSwitchTokenRef.current) return false;
    // Keep React out of ownership of `src`: rendering while a seek is pending
    // must not reset the native video element back to the beginning.
    if (element.dataset.timelineSource !== sourceUrl) {
      try {
        element.pause();
        element.dataset.timelineSource = sourceUrl;
        element.src = sourceUrl;
        element.load();
      } catch {
        return false;
      }
    }
    return seekMediaElement(element, sourceTime, token);
  }, [seekMediaElement]);

  const syncExternalAudio = useCallback(async (projectTime: number, token: number, shouldPlay: boolean) => {
    const state = useTimelineStore.getState();
    const audio = audioRef.current;
    if (!audio || state.timeline?.audioTrack.mode !== 'replace') return;
    audio.volume = Math.min(1, state.timeline.audioTrack.volume);
    const ready = await seekMediaElement(audio, projectTime, token);
    if (!ready || token !== mediaSwitchTokenRef.current || !shouldPlay || !useTimelineStore.getState().isPlaying) return;
    audio.play().catch(() => undefined);
  }, [seekMediaElement]);

  const playClipMedia = useCallback((clip: VideoClip, projectTime: number) => {
    const activeTimeline = useTimelineStore.getState().timeline;
    const primaryVideo = videoRef.current;
    if (!activeTimeline || !primaryVideo) return;

    const switchToken = invalidateMediaOperations();
    isSwitchingClipRef.current = true;
    const sourceTime = clamp(
      clip.sourceIn + projectTime - clip.startTime,
      clip.sourceIn,
      Math.max(clip.sourceIn, clip.sourceOut - 0.001)
    );
    const stopIfCurrent = () => {
      if (switchToken !== mediaSwitchTokenRef.current) return;
      isSwitchingClipRef.current = false;
      if (useTimelineStore.getState().isPlaying) setPlaying(false);
    };
    const startSecondary = async (element: HTMLVideoElement) => {
      element.muted = true;
      if (!await prepareVideoElement(element, clip.sourceUrl, sourceTime, switchToken)) return;
      if (switchToken !== mediaSwitchTokenRef.current || !useTimelineStore.getState().isPlaying) return;
      await element.play().catch(() => undefined);
    };
    const startPrimary = async () => {
      primaryVideo.muted = activeTimeline.audioTrack.mode !== 'keep' || previewMutedRef.current;
      primaryVideo.volume = Math.min(1, activeTimeline.audioTrack.volume);
      const ready = await prepareVideoElement(primaryVideo, clip.sourceUrl, sourceTime, switchToken);
      if (!ready || switchToken !== mediaSwitchTokenRef.current || !useTimelineStore.getState().isPlaying) {
        if (!ready) stopIfCurrent();
        return;
      }

      // Secondary layout cells should follow the same source/seek, but never
      // delay the authoritative primary element or its playhead.
      secondaryVideoRefs.current.forEach((secondary) => {
        if (secondary) void startSecondary(secondary);
      });

      try {
        await primaryVideo.play();
      } catch {
        stopIfCurrent();
        return;
      }
      if (switchToken !== mediaSwitchTokenRef.current || !useTimelineStore.getState().isPlaying) return;

      // A source reload can occasionally occur immediately after play() on
      // slower media. Never let that stale zero escape into the RAF loop.
      if (primaryVideo.currentTime + SEEK_TOLERANCE < sourceTime) {
        const reseeked = await seekMediaElement(primaryVideo, sourceTime, switchToken);
        if (!reseeked || switchToken !== mediaSwitchTokenRef.current || !useTimelineStore.getState().isPlaying) {
          if (!reseeked) stopIfCurrent();
          return;
        }
        try {
          await primaryVideo.play();
        } catch {
          stopIfCurrent();
          return;
        }
      }
      if (switchToken !== mediaSwitchTokenRef.current || !useTimelineStore.getState().isPlaying) return;
      isSwitchingClipRef.current = false;
      void syncExternalAudio(projectTime, switchToken, true);
    };

    void startPrimary();
  }, [invalidateMediaOperations, prepareVideoElement, seekMediaElement, setPlaying, syncExternalAudio]);

  const syncMedia = useCallback((projectTime: number) => {
    const state = useTimelineStore.getState();
    const activeTimeline = state.timeline;
    const video = videoRef.current;
    const activeClip = activeTimeline ? clipAtProjectTime(activeTimeline, projectTime) : undefined;
    if (!activeTimeline || !video || !activeClip) return;

    const switchToken = invalidateMediaOperations();
    const sourceTime = sourceTimeAtProjectTime(activeTimeline, projectTime);
    video.muted = activeTimeline.audioTrack.mode !== 'keep' || previewMutedRef.current;
    video.volume = Math.min(1, activeTimeline.audioTrack.volume);
    const sync = async () => {
      const primaryReady = await prepareVideoElement(video, activeClip.sourceUrl, sourceTime, switchToken);
      if (!primaryReady || switchToken !== mediaSwitchTokenRef.current) return;
      secondaryVideoRefs.current.forEach((secondary) => {
        if (!secondary) return;
        secondary.muted = true;
        void prepareVideoElement(secondary, activeClip.sourceUrl, sourceTime, switchToken);
      });
      void syncExternalAudio(projectTime, switchToken, false);
    };
    void sync();
  }, [invalidateMediaOperations, prepareVideoElement, syncExternalAudio]);

  useEffect(() => {
    if (!timeline) return;
    const difference = Math.abs(currentTime - lastPlaybackTime.current);
    const wasWrittenByPlayback = isPlaying
      && playbackStoreTimeRef.current != null
      && Math.abs(currentTime - playbackStoreTimeRef.current) <= 0.03;
    // A store update from the RAF is expected. Any other change while playing
    // is a user seek and must restart from the new project time, even if the
    // native element is still reporting the previous source position.
    if (!isPlaying || (!wasWrittenByPlayback && difference > 0.04)) {
      lastPlaybackTime.current = currentTime;
      playbackStoreTimeRef.current = null;
      const targetClip = clipAtProjectTime(timeline, currentTime);
      if (isPlaying && targetClip) playClipMedia(targetClip, currentTime);
      else syncMedia(currentTime);
    }
  }, [currentTime, isPlaying, playClipMedia, syncMedia, timeline]);

  useEffect(() => {
    const video = videoRef.current;
    if (!timeline || !video) return;
    const secondaryVideos = secondaryVideoRefs.current.filter(Boolean) as HTMLVideoElement[];
    if (!isPlaying) {
      // The cleanup of the previous playing effect already cancels playback.
      // Do not invalidate the paused seek started by the effect above.
      isSwitchingClipRef.current = false;
      video.pause();
      secondaryVideos.forEach((item) => item.pause());
      audioRef.current?.pause();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      return;
    }

    let cancelled = false;
    let startTime = useTimelineStore.getState().currentTime;
    if (startTime >= timeline.duration - 0.02) {
      startTime = 0;
      setCurrentTime(0);
    }
    lastPlaybackTime.current = startTime;
    playbackStoreTimeRef.current = null;
    const startingClip = clipAtProjectTime(timeline, startTime);
    if (!startingClip) {
      setPlaying(false);
      return;
    }
    playClipMedia(startingClip, startTime);

    const tick = () => {
      if (cancelled) return;
      const state = useTimelineStore.getState();
      const activeTimeline = state.timeline;
      if (!activeTimeline || !state.isPlaying) return;
      if (isSwitchingClipRef.current) {
        animationRef.current = requestAnimationFrame(tick);
        return;
      }
      const clip = clipAtProjectTime(activeTimeline, lastPlaybackTime.current);
      if (!clip) {
        setPlaying(false);
        return;
      }

      if (video.currentTime >= clip.sourceOut - 0.015) {
        const index = activeTimeline.videoTrack.clips.findIndex((item) => item.id === clip.id);
        const next = activeTimeline.videoTrack.clips[index + 1];
        if (!next) {
          lastPlaybackTime.current = activeTimeline.duration;
          playbackStoreTimeRef.current = activeTimeline.duration;
          setCurrentTime(activeTimeline.duration);
          setPlaying(false);
          return;
        }
        lastPlaybackTime.current = next.startTime;
        playClipMedia(next, next.startTime);
      } else {
        lastPlaybackTime.current = Math.min(clip.endTime, clip.startTime + Math.max(0, video.currentTime - clip.sourceIn));
      }
      playbackStoreTimeRef.current = lastPlaybackTime.current;
      setCurrentTime(lastPlaybackTime.current);
      animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelMediaOperations();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [cancelMediaOperations, isPlaying, playClipMedia, setCurrentTime, setPlaying, timeline]);

  const activeClip = timeline ? clipAtProjectTime(timeline, currentTime) : undefined;
  const activeClipIndex = activeClip
    ? timeline?.videoTrack.clips.findIndex((clip) => clip.id === activeClip.id) ?? -1
    : -1;
  const incomingTransition = activeClipIndex > 0
    ? timeline?.videoTrack.clips[activeClipIndex - 1]
    : undefined;
  const startTransitionType = timeline?.settings.startTransitionType || 'none';
  const startTransitionDuration = Math.max(0.05, timeline?.settings.startTransitionDuration || 0.35);
  const endTransitionType = timeline?.settings.endTransitionType || 'none';
  const endTransitionDuration = Math.max(0.05, timeline?.settings.endTransitionDuration || 0.35);
  const openingProgress = startTransitionType !== 'none' && currentTime < startTransitionDuration
    ? clamp(currentTime / startTransitionDuration, 0, 1)
    : 1;
  const closingProgress = timeline && endTransitionType !== 'none' && currentTime > timeline.duration - endTransitionDuration
    ? clamp((timeline.duration - currentTime) / endTransitionDuration, 0, 1)
    : 1;
  const edgeTransition = closingProgress < 1
    ? edgeTransitionStyle(endTransitionType, closingProgress)
    : edgeTransitionStyle(startTransitionType, openingProgress);
  const activeTexts = timeline?.textTrack.clips.filter((clip) => currentTime >= clip.startTime && currentTime <= clip.endTime) || [];
  const activeBroll = timeline?.brollTrack.clips.filter((clip) => currentTime >= clip.startTime && currentTime <= clip.endTime) || [];
  const effectiveTextKeyframes = useMemo(() => new Map(
    (timeline?.textTrack.clips || [])
      .filter((clip) => clip.kind === 'text')
      .map((clip) => [clip.id, resolveTextAnimationKeyframes(clip)] as const)
  ), [timeline?.textTrack.clips]);
  const rangeTargets = timeline ? getTimelineRangeTargets(timeline, rangeSelection) : { videoIds: [], brollIds: [], textIds: [], audio: false };
  const layout = timeline?.settings.layoutPreset || 'fit';
  const cellCount = LAYOUT_CELLS[layout];
  const videoCells = useMemo(() => Array.from({ length: cellCount }, (_, index) => index), [cellCount]);

  useEffect(() => {
    const clipId = activeClip?.id || '';
    const previousClipId = previousClipIdRef.current;
    previousClipIdRef.current = clipId;
    if (!previousClipId || !clipId || previousClipId === clipId || !incomingTransition || incomingTransition.transitionType === 'none') {
      setIsTransitioning(false);
      return;
    }

    setIsTransitioning(false);
    if (transitionFrameRef.current) cancelAnimationFrame(transitionFrameRef.current);
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
    transitionFrameRef.current = requestAnimationFrame(() => {
      setIsTransitioning(true);
      transitionTimerRef.current = window.setTimeout(
        () => setIsTransitioning(false),
        Math.max(100, (incomingTransition?.transitionDuration || .35) * 1000)
      );
    });
  }, [activeClip?.id, incomingTransition?.transitionDuration, incomingTransition?.transitionType]);

  if (!timeline || !activeClip) return (
    <div className="video-preview video-preview--empty">
      <div className="video-preview__empty-state">
        <Upload size={28} aria-hidden="true" />
        <strong>Empieza añadiendo contenido</strong>
        <span>Inserta un vídeo, imagen o archivo de audio desde tu equipo.</span>
        <button type="button" onClick={() => importInputRef.current?.click()}>
          <Upload size={16} /> Insertar archivo multimedia
        </button>
        <input
          ref={importInputRef}
          className="sr-only"
          type="file"
          multiple
          accept="image/*,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/ogg,audio/webm"
          onChange={async (event) => {
            const files = Array.from(event.target.files || []);
            if (files.length) await onImportFiles?.(files);
            event.target.value = '';
          }}
        />
      </div>
    </div>
  );

  const [ratioWidth, ratioHeight] = timeline.settings.aspectRatio.split(':').map(Number);
  const ratio = `${ratioWidth} / ${ratioHeight}`;
  const previewAspectClass = `video-preview__frame--${timeline.settings.aspectRatio.replace(':', '-')}`;
  // El texto de ayuda del recorte manual es largo: solo en 16:9 el fotograma
  // es lo bastante ancho para mostrarlo entero junto al cuadro de zoom sin
  // cortarlo. En el resto de formatos se muestra fuera del fotograma.
  const roiHintFitsInFrame = timeline.settings.aspectRatio === '16:9';
  const togglePlayback = () => setPlaying(!isPlaying);
  const seekBy = (delta: number) => setCurrentTime(currentTime + delta);
  const toggleFullscreen = () => {
    if (document.fullscreenElement === previewRef.current) {
      document.exitFullscreen().catch(() => undefined);
      return;
    }
    previewRef.current?.requestFullscreen?.().catch(() => undefined);
  };
  const togglePreviewMuted = () => {
    const next = !previewMutedRef.current;
    previewMutedRef.current = next;
    setPreviewMuted(next);
    if (videoRef.current) {
      videoRef.current.muted = timeline.audioTrack.mode !== 'keep' || next;
    }
  };
  const objectFit = layout === 'fill' ? 'cover' : timeline.settings.fitMode;
  const filter = `brightness(${1 + activeClip.brightness}) contrast(${activeClip.contrast}) saturate(${activeClip.saturation})`;
  const videoStyle = {
    objectFit,
    objectPosition: `${activeClip.focusX * 100}% ${activeClip.focusY * 100}%`,
    filter
  } as React.CSSProperties;
  // Función 4 — Corrección de color: CSS no tiene un filtro nativo de
  // "temperatura de color" equivalente al `colortemperature` de FFmpeg que
  // usa el export (ver server.js); se aproxima con una capa de color
  // (naranja=cálido, azul=frío) en mix-blend-mode 'overlay', que se acerca
  // visualmente sin pretender ser un cálculo por canal idéntico al backend
  // — la misma clase de aproximación que ya usa este componente para el
  // resto de la corrección de color (ver comentario de `filter` arriba).
  const temperatureOverlayStyle: React.CSSProperties | null = activeClip.temperature
    ? {
      position: 'absolute',
      inset: 0,
      background: activeClip.temperature > 0 ? '#ff9d42' : '#3d7bff',
      opacity: Math.min(1, Math.abs(activeClip.temperature) / 100) * 0.35,
      mixBlendMode: 'overlay',
      pointerEvents: 'none'
    }
    : null;

  // El recorte manual solo lo aplica el backend en 'fit'/'fill' (timelineRoiFilter
  // sustituye por completo al fitMode ahí; en el resto de diseños el roi se
  // ignora). Reproducimos la misma operación de crop+cover en CSS para que la
  // previsualización deje de mostrar el fotograma completo mientras el recorte
  // guardado en verdad ya recorta la exportación final.
  const roi = timeline.roi;
  const canPreviewRoi = layout === 'fit' || layout === 'fill';
  // Antes de que los metadatos del vídeo carguen (videoNaturalSize a 0,0),
  // usamos el tamaño del fotograma como aproximación en vez de bloquear el
  // recorte manual por completo hasta que el <video> dispare loadedmetadata.
  const effectiveNaturalSize = videoNaturalSize.width > 0 ? videoNaturalSize : frameSize;
  const roiVideoStyle = canPreviewRoi && roi && effectiveNaturalSize.width > 0 && frameSize.width > 0
    ? (() => {
        const roiWidthPx = roi.width * effectiveNaturalSize.width;
        const roiHeightPx = roi.height * effectiveNaturalSize.height;
        const scale = Math.max(frameSize.width / roiWidthPx, frameSize.height / roiHeightPx);
        const displayWidth = effectiveNaturalSize.width * scale;
        const displayHeight = effectiveNaturalSize.height * scale;
        const roiCenterX = (roi.x + roi.width / 2) * effectiveNaturalSize.width * scale;
        const roiCenterY = (roi.y + roi.height / 2) * effectiveNaturalSize.height * scale;
        return {
          position: 'absolute',
          left: 0,
          top: 0,
          width: `${displayWidth}px`,
          height: `${displayHeight}px`,
          maxWidth: 'none',
          transform: `translate(${(frameSize.width / 2 - roiCenterX).toFixed(2)}px, ${(frameSize.height / 2 - roiCenterY).toFixed(2)}px)`,
          objectFit: 'fill',
          filter
        } as React.CSSProperties;
      })()
    : null;

  // Rectángulo (en fracciones del fotograma) que realmente ocupa el vídeo
  // visible: si ya hay un roi, roiVideoStyle lo hace cubrir el fotograma
  // entero; si no, el ajuste contain/cover puede dejar barras negras que hay
  // que descontar para que arrastrar/hacer zoom apunte al vídeo real y no al
  // fotograma completo.
  const videoContentBox = (() => {
    if (roi || !frameSize.width || !frameSize.height || !effectiveNaturalSize.width || !effectiveNaturalSize.height) {
      return { x: 0, y: 0, width: 1, height: 1 };
    }
    const fitScale = objectFit === 'cover'
      ? Math.max(frameSize.width / effectiveNaturalSize.width, frameSize.height / effectiveNaturalSize.height)
      : Math.min(frameSize.width / effectiveNaturalSize.width, frameSize.height / effectiveNaturalSize.height);
    const contentWidth = effectiveNaturalSize.width * fitScale;
    const contentHeight = effectiveNaturalSize.height * fitScale;
    return {
      x: (frameSize.width - contentWidth) / 2 / frameSize.width,
      y: (frameSize.height - contentHeight) / 2 / frameSize.height,
      width: contentWidth / frameSize.width,
      height: contentHeight / frameSize.height
    };
  })();

  return (
    <section ref={previewRef} className="video-preview" aria-label="Previsualización del vídeo">
      <div className="video-preview__frame-wrap">
      <div
        ref={setFrameNode}
        className={`video-preview__frame ${previewAspectClass}`}
        style={{
          aspectRatio: ratio,
          '--fullscreen-frame-width': `calc(${ratioWidth / ratioHeight * 100}vh - ${ratioWidth / ratioHeight * 70}px)`
        } as React.CSSProperties}
        onPointerDown={(event) => {
          if (rectangleSelectionActive) return;
          const target = event.target as Element;
          if (target.closest('[data-transform-layer], .preview-text, .preview-transform-handle')) return;
          selectClip({ kind: 'video', id: activeClip.id, ids: [activeClip.id] });
        }}
      >
        <div
          className={`video-preview__media-grid video-preview__media-grid--${layout}${isTransitioning ? ` is-transitioning video-preview__transition--${incomingTransition?.transitionType || 'none'}` : ''}`}
          style={{
            '--transition-duration': `${incomingTransition?.transitionDuration || .35}s`,
            ...(!isTransitioning ? edgeTransition : {})
          } as React.CSSProperties}
        >
          {videoCells.map((cell) => (
            <video
              key={`${layout}-${cell}`}
              ref={cell === 0 ? videoRef : (node) => { secondaryVideoRefs.current[cell - 1] = node; }}
              playsInline
              muted={cell > 0}
              preload="auto"
              style={cell === 0 && roiVideoStyle ? roiVideoStyle : videoStyle}
              onClick={togglePlayback}
              onLoadedMetadata={cell === 0
                ? (event) => setVideoNaturalSize({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })
                : undefined}
            />
          ))}
        </div>
        {temperatureOverlayStyle && <div style={temperatureOverlayStyle} aria-hidden="true" />}
        <div className={`video-preview__frame-template video-preview__frame-template--${timeline.settings.framePreset}`} aria-hidden="true" />
        {externalAudioUrl && <audio ref={audioRef} src={externalAudioUrl} preload="auto" loop />}
        {timeline.musicTrack && <audio ref={musicRef} src={timeline.musicTrack.sourceUrl} preload="auto" loop />}
        {activeBroll.map((clip) => {
          // Función 1 — Keyframes: con 2+ keyframes, x/y/escala/opacidad/
          // rotación del clip pasan a ser el ESTADO ANIMADO en el instante
          // actual (relativo al inicio del clip, en ms) en vez de sus
          // campos estáticos — el arrastre en el lienzo se desactiva para
          // este elemento (se edita desde el panel, con los keyframes
          // seleccionados) para no crear ambigüedad sobre a cuál de los dos
          // sistemas (arrastre vs. keyframe) pertenece el cambio.
          const hasKeyframes = Boolean(clip.keyframes && clip.keyframes.length >= 2);
          const animated = hasKeyframes ? interpolateKeyframes(clip.keyframes, (currentTime - clip.startTime) * 1000) : null;
          const transform = transformDraft?.kind === 'broll' && transformDraft.id === clip.id
            ? transformDraft
            : { kind: 'broll' as const, id: clip.id, x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 };
          const boxX = animated ? animated.x : transform.x;
          const boxY = animated ? animated.y : transform.y;
          const boxWidth = animated ? clip.width * animated.scale : transform.width;
          const boxHeight = animated ? clip.height * animated.scale : transform.height;
          const boxOpacity = animated ? animated.opacity : clip.opacity;
          const boxRotation = animated ? animated.rotation : 0;
          const selected = (selection?.kind === 'broll' && selection.id === clip.id) || rangeTargets.brollIds.includes(clip.id);
          return (
            <div
              key={clip.id}
              data-transform-layer
              data-i18n-skip=""
              role="button"
              tabIndex={0}
              aria-label={`${t('Imagen')} ${clip.name}`}
              className={`video-preview__broll-layer${selected ? ' is-selected' : ''}`}
              style={{
                left: `${boxX * 100}%`,
                top: `${boxY * 100}%`,
                width: `${boxWidth * 100}%`,
                height: `${boxHeight * 100}%`,
                // La clase CSS ya centra con translate(-50%,-50%); si hay
                // rotación hay que repetirlo aquí porque un `transform`
                // inline sustituye por completo al de la hoja de estilos.
                ...(boxRotation ? { transform: `translate(-50%, -50%) rotate(${boxRotation}deg)` } : {})
              }}
              onPointerDown={(event) => {
                if (hasKeyframes) { selectClip({ kind: 'broll', id: clip.id }); return; }
                beginTransform(event, transform, 'move');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') selectClip({ kind: 'broll', id: clip.id });
              }}
            >
              <img
                src={clip.sourceUrl}
                alt=""
                // Función 3 — Capas: 'normal' se deja sin mix-blend-mode (evita
                // crear un nuevo contexto de apilamiento sin necesidad).
                style={{ opacity: boxOpacity, ...(clip.blendMode !== 'normal' ? { mixBlendMode: clip.blendMode } : {}) }}
                draggable={false}
              />
              {selected && !rangeSelection && !hasKeyframes && RESIZE_CORNERS.map((corner) => (
                <span
                  key={corner}
                  className={`preview-transform-handle preview-transform-handle--${corner}`}
                  onPointerDown={(event) => beginTransform(event, transform, 'resize', corner)}
                />
              ))}
            </div>
          );
        })}
        {timeline.settings.brandLogoUrl && <img className={`video-preview__logo video-preview__logo--${timeline.settings.brandLogoPosition}`} src={timeline.settings.brandLogoUrl} alt="" style={{ width: `${timeline.settings.brandLogoScale * 100}%` }} />}
        <div className="video-preview__text-layer" aria-live="off">
          {activeTexts.map((clip) => {
            // Función 1 — Keyframes: mismo criterio que en B-roll arriba
            // (arrastre en el lienzo desactivado mientras haya keyframes).
            const relativeTimeMs = (currentTime - clip.startTime) * 1000;
            const effectiveKeyframes = clip.kind === 'text' ? effectiveTextKeyframes.get(clip.id) : clip.keyframes;
            const hasKeyframes = Boolean(effectiveKeyframes && effectiveKeyframes.length >= 2);
            const hasManualKeyframes = Boolean(clip.keyframes && clip.keyframes.length >= 2);
            const transformLocked = hasManualKeyframes
              || (clip.kind === 'text' && isTextAnimationInProgress(clip, relativeTimeMs));
            // Durante la edición inline se muestra la transformación base:
            // un textarea transparente o fuera de pantalla sería imposible
            // de editar en el primer fotograma de una entrada.
            const animated = textEdit?.id !== clip.id && hasKeyframes
              ? interpolateKeyframes(effectiveKeyframes, relativeTimeMs)
              : null;
            const activeTransformDraft = transformDraft?.kind === 'text' && transformDraft.id === clip.id
              ? transformDraft
              : null;
            const transform = activeTransformDraft
              ? activeTransformDraft
              : {
                kind: 'text' as const,
                id: clip.id,
                x: animated ? animated.x : clip.x,
                y: animated ? animated.y : clip.y,
                width: clip.width,
                height: 0,
                scale: animated ? animated.scale : clip.scale
              };
            const baseTextOpacity = animated ? animated.opacity : 1;
            const textRotation = animated ? animated.rotation : 0;
            // Las frases libres se maquetan una sola vez con clip.scale y la
            // animación escala la capa completa, igual que el PNG de FFmpeg.
            // Así fade/slide/pop no cambian los saltos de línea. Durante un
            // resize directo sí usamos el borrador como tamaño tipográfico.
            const usesAnimatedTextLayer = clip.kind === 'text' && hasKeyframes && !activeTransformDraft;
            const textLayerScale = usesAnimatedTextLayer
              ? resolveTextLayerScale(transform.scale, clip.scale)
              : 1;
            const textFontScale = usesAnimatedTextLayer ? clip.scale : transform.scale;
            const hasTextLayerTransform = Math.abs(textRotation) > .0001 || Math.abs(textLayerScale - 1) > .0001;
            const selected = (selection?.kind === 'text' && selection.id === clip.id) || rangeTargets.textIds.includes(clip.id);
            // Aproximación en el lienzo del motor ASS real: cuando hay un
            // preset elegido, su color y tipografía sustituyen a los campos
            // libres de texto (que el ASS ignora). Como el editor no guarda
            // el tiempo real de cada palabra (solo inicio/fin de la frase),
            // el resaltado palabra a palabra usa una estimación proporcional
            // al largo de cada palabra (estimateWordTimings) para acercarse
            // al barrido karaoke exacto que FFmpeg produce al exportar.
            const isSubtitle = clip.kind === 'subtitle';
            const presetOption = getSubtitlePresetOption(clip.preset);
            // Los presets editoriales clásicos siguen siendo exclusivos de
            // subtítulos. Los cuatro materiales 3D sí se comparten con los
            // rótulos libres y se exportan como una capa PNG transparente.
            const materialPreset = presetOption.featured3d ? presetOption.value : null;
            const usesPreset = clip.preset !== 'none' && (isSubtitle || Boolean(materialPreset));
            const displayText = usesPreset && presetOption!.upperCase ? clip.text.toLocaleUpperCase(getIntlLocale()) : clip.text;
            const activeWordColor = usesPreset ? presetOption!.color : TEXT_COLORS[clip.color];
            const inactiveWordColor = usesPreset
              ? presetOption!.inactiveColor
              : (clip.color === 'blanco' ? '#AEB7C5' : '#FFFFFF');
            const words = isSubtitle ? estimateWordTimings(clip.text, clip.startTime, clip.endTime) : [];
            // El "Estilo" (contorno/caja/sombra) usa un contorno/sombra
            // genérico gris para las frases libres, pero para subtítulos con
            // preset activo debe verse con los colores propios del modelo
            // (igual que el contorno/sombra/caja que calcula resolvedRendering
            // en clipping-subtitles.js) para que cambiarlo tenga un efecto
            // visible y fiel al vídeo exportado.
            const subtitleRendering = isSubtitle
              ? resolveSubtitleRendering(clip.preset, clip.style, transform.scale)
              : null;
            const outputHeight = isSubtitle
              ? getOutputSize(timeline.settings.resolution, timeline.settings.aspectRatio)[1]
              : 1;
            const pixelsToCqh = (pixels: number) => `${pixels / outputHeight * 100}cqh`;
            const subtitleFade = isSubtitle
              ? Math.min(
                1,
                Math.max(0, (currentTime - clip.startTime) / .055),
                Math.max(0, (clip.endTime - currentTime) / .085)
              )
              : 1;
            const textOpacity = baseTextOpacity * subtitleFade;
            const subtitleStyleOverride: React.CSSProperties = isSubtitle && subtitleRendering ? {
              background: subtitleRendering.borderStyle === 3 ? `${presetOption.backColor}bd` : 'transparent',
              WebkitTextStroke: subtitleRendering.borderStyle === 1
                ? `${pixelsToCqh(subtitleRendering.outlineWidth)} ${presetOption.outlineColor}`
                : '0 transparent',
              textShadow: subtitleRendering.borderStyle === 1 && subtitleRendering.shadowDepth > 0
                ? `${pixelsToCqh(subtitleRendering.xShadow ?? subtitleRendering.shadowDepth)} ${pixelsToCqh(subtitleRendering.yShadow ?? subtitleRendering.shadowDepth)} 0 ${presetOption.shadowColor}a7`
                : 'none'
            } : {};
            const subtitleFaceStyle: React.CSSProperties = isSubtitle && subtitleRendering ? {
              display: 'block',
              letterSpacing: pixelsToCqh(subtitleRendering.spacing),
              transform: `rotate(${subtitleRendering.angle}deg) scale(${subtitleRendering.scaleX / 100}, ${subtitleRendering.scaleY / 100})`,
              transformOrigin: 'center center'
            } : {};
            return (
              <div
                key={clip.id}
                data-transform-layer
                data-i18n-skip=""
                role="button"
                tabIndex={0}
                aria-label={`${t('Frase')}: ${clip.text}`}
                className={`preview-text preview-text--${clip.style}${materialPreset && !isSubtitle ? ' preview-text--material' : ''}${selected ? ' is-selected' : ''}${textEdit?.id === clip.id ? ' is-editing' : ''}`}
                style={{
                  '--text-color': usesPreset ? presetOption.color : TEXT_COLORS[clip.color],
                  left: `${transform.x * 100}%`,
                  top: `${transform.y * 100}%`,
                  width: `${transform.width * 100}%`,
                  opacity: textOpacity,
                  // La clase preview-text ya centra con translate(-50%,-50%);
                  // un transform inline la sustituiría por completo, así que
                  // hay que repetirlo al añadir rotación o escala de capa.
                  ...(hasTextLayerTransform ? {
                    transform: `translate(-50%, -50%) rotate(${textRotation}deg) scale(${textLayerScale})`
                  } : {}),
                  // Text exports are sized from the video height. `cqh` keeps
                  // this preview on exactly the same scale, including 9:16.
                  fontSize: `${100 / TEXT_SIZE_DIVISORS[clip.size] * textFontScale * (subtitleRendering?.sizeMultiplier || 1)}cqh`,
                  fontFamily: usesPreset ? presetOption.cssFont : TEXT_FONT_FAMILIES[clip.font],
                  fontWeight: usesPreset ? presetOption.weight : TEXT_FONT_WEIGHTS[clip.font],
                  fontStyle: usesPreset && presetOption.italic ? 'italic' : 'normal',
                  ...subtitleStyleOverride
                } as React.CSSProperties}
                onPointerDown={(event) => {
                  if (transformLocked && textEdit?.id !== clip.id) { selectClip({ kind: 'text', id: clip.id }); return; }
                  if (textEdit?.id === clip.id) {
                    event.stopPropagation();
                    return;
                  }
                  beginTransform(event, transform, 'move');
                }}
                onDoubleClick={(event) => startTextEdit(event, clip)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') selectClip({ kind: 'text', id: clip.id });
                }}
              >
                {textEdit?.id === clip.id ? (
                  <textarea
                    ref={textEditorRef}
                    className="preview-text__editor"
                    rows={1}
                    maxLength={80}
                    value={textEdit.value}
                    aria-label={t('Editar frase')}
                    spellCheck={false}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      const value = event.currentTarget.value.slice(0, 80);
                      setTextEdit({ id: clip.id, value });
                      resizeTextEditor(event.currentTarget);
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        editCancelledRef.current = true;
                        event.currentTarget.blur();
                      } else if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                    onBlur={(event) => {
                      if (!editCancelledRef.current) {
                        const text = event.currentTarget.value.trim().slice(0, 80) || t('Nueva frase');
                        updateTextClip(clip.id, { text });
                      }
                      editCancelledRef.current = false;
                      setTextEdit(null);
                    }}
                  />
                ) : isSubtitle ? (
                  <span className="preview-text__words" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: '.25em', ...subtitleFaceStyle }}>
                    {words.map((word, index) => {
                      const wordText = usesPreset && presetOption!.upperCase ? word.text.toLocaleUpperCase(getIntlLocale()) : word.text;
                      // Solo la palabra que se está diciendo ahora mismo se
                      // ilumina; el resto (antes y después) se queda en el
                      // color base, igual que el motor ASS real (ver
                      // effectSpan en clipping-subtitles.js).
                      const frame = subtitleWordFrame(
                        clip.wordEffect,
                        currentTime,
                        word.start,
                        word.end,
                        subtitleRendering?.blur || 0
                      );
                      const wordColor = mixHexColors(inactiveWordColor, activeWordColor, frame.emphasis);
                      return (
                        <span
                          key={index}
                          data-text={materialPreset && clip.style !== 'box' ? wordText : undefined}
                          className={`preview-text__word${materialPreset && clip.style !== 'box' ? ` material-text material-text--${materialPreset} material-text--subtitle-ass` : ''}`}
                          style={{
                            '--subtitle-word-color': wordColor,
                            color: wordColor,
                            transform: `scale(${frame.scaleX}, ${frame.scaleY}) rotate(${frame.rotation}deg)`,
                            filter: `blur(${pixelsToCqh(frame.blur)})`,
                            ...(clip.wordEffect === 'flash' && subtitleRendering?.borderStyle === 1 ? {
                              WebkitTextStroke: `${pixelsToCqh(subtitleRendering.outlineWidth)} ${mixHexColors(
                                presetOption.outlineColor,
                                presetOption.shadowColor,
                                frame.outlineEmphasis
                              )}`
                            } : {}),
                            transformOrigin: 'center bottom'
                          } as React.CSSProperties}
                        >
                          {wordText}
                        </span>
                      );
                    })}
                  </span>
                ) : (
                  <span
                    data-text={materialPreset ? displayText : undefined}
                    className={materialPreset ? `material-text material-text--${materialPreset}` : undefined}
                    style={subtitleFaceStyle}
                  >
                    {displayText}
                  </span>
                )}
                {selected && !rangeSelection && !transformLocked && textEdit?.id !== clip.id && RESIZE_CORNERS.map((corner) => (
                  <span
                    key={corner}
                    className={`preview-transform-handle preview-transform-handle--${corner}`}
                    onPointerDown={(event) => beginTransform(event, transform, 'resize', corner)}
                  />
                ))}
              </div>
            );
          })}
        </div>
        {activeClip.trackingEnabled && <span className="video-preview__focus" style={{ left: `${activeClip.focusX * 100}%`, top: `${activeClip.focusY * 100}%` }} />}
        <RectangleSelectionOverlay active={rectangleSelectionActive} contentBox={videoContentBox} showHint={roiHintFitsInFrame} />
        {!isPlaying && <button className="video-preview__center-play" type="button" onClick={togglePlayback} aria-label="Reproducir"><Play size={24} fill="currentColor" /></button>}
      </div>
      {rectangleSelectionActive && !roiHintFitsInFrame && (
        <p className="video-preview__roi-hint-outside">{ROI_DRAG_HINT}</p>
      )}
      </div>

      <div className="video-preview__controls">
        <button type="button" onClick={() => seekBy(-1)} title="Retroceder 1 segundo" aria-label="Retroceder 1 segundo"><RotateCcw size={17} /></button>
        <button className="video-preview__primary-control" type="button" onClick={togglePlayback} aria-label={isPlaying ? 'Pausar' : 'Reproducir'}>{isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
        <button type="button" onClick={() => seekBy(1)} title="Avanzar 1 segundo" aria-label="Avanzar 1 segundo"><RotateCw size={17} /></button>
        <span>{formatTimecode(currentTime)} <small>/ {formatTimecode(timeline.duration)}</small></span>
        {rectangleSelectionActive && (
          <span className="video-preview__roi-zoom">
            <button type="button" onClick={() => zoomRectangleSelection(1 / 0.85)} aria-label="Alejar (achicar)" title="Alejar"><Minus size={15} /></button>
            <button type="button" onClick={() => zoomRectangleSelection(0.85)} aria-label="Acercar (agrandar)" title="Acercar"><Plus size={15} /></button>
          </span>
        )}
        <button
          type="button"
          className={previewMuted ? 'is-active' : ''}
          onClick={togglePreviewMuted}
          title={previewMuted ? 'Activar sonido de la previsualización' : 'Silenciar previsualización'}
          aria-label={previewMuted ? 'Activar sonido de la previsualización' : 'Silenciar previsualización'}
        >
          {previewMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
        <button type="button" onClick={toggleFullscreen} title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'} aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}>{isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
      </div>
    </section>
  );
}
