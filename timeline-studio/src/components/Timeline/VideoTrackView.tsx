import Konva from 'konva';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Group, Image as KonvaImage, Layer, Rect, Stage, Text } from 'react-konva';
import { transitionLabel } from '../../constants/transitions';
import type { VideoClip } from '../../types/timeline';
import { useTimelineRangeMoveStore } from '../../store/timelineRangeMoveStore';
import { useTimelineStore } from '../../store/timelineStore';
import { getTimelineRangeTargets } from '../../utils/timeline';
import { useTimelineRangeMove } from './useTimelineRangeMove';

const TRACK_HEIGHT = 62;
const HANDLE_WIDTH = 9;
const RANGE_HANDLE_WIDTH = 5;
const RANGE_DRAG_THRESHOLD = 4;

type PointerEventObject = Konva.KonvaEventObject<PointerEvent>;

interface RangeDragState {
  start: number;
  current: number;
  moved: boolean;
  additive: boolean;
  pointerId: number;
  container: HTMLDivElement;
}

function useHtmlImage(src: string): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    const img = new window.Image();
    img.src = src;
    img.onload = () => { if (!cancelled) setImage(img); };
    return () => { cancelled = true; };
  }, [src]);
  return image;
}

function Thumbnail({ src, x, width }: { src: string; x: number; width: number }) {
  const image = useHtmlImage(src);
  if (!image) return null;
  return <KonvaImage image={image} x={x} y={0} width={width + 1} height={TRACK_HEIGHT} listening={false} />;
}

interface ClipViewProps {
  clip: VideoClip;
  clipIndex: number;
  pixelsPerSecond: number;
  selected: boolean;
  grouped: boolean;
  previewOffsetX: number;
  onRangeSelectionStart: (event: PointerEventObject) => void;
}

function ClipView({ clip, clipIndex, pixelsPerSecond, selected, grouped, previewOffsetX, onRangeSelectionStart }: ClipViewProps) {
  const setVideoClipBounds = useTimelineStore((state) => state.setVideoClipBounds);
  const selectClip = useTimelineStore((state) => state.selectClip);
  const width = Math.max(18, (clip.endTime - clip.startTime) * pixelsPerSecond);
  const x = clip.startTime * pixelsPerSecond;
  const allFrames = clip.thumbnails;
  const firstFrame = Math.floor((clip.sourceIn / clip.sourceDuration) * allFrames.length);
  const lastFrame = Math.max(firstFrame + 1, Math.ceil((clip.sourceOut / clip.sourceDuration) * allFrames.length));
  const frames = allFrames.slice(firstFrame, lastFrame);
  const visibleFrames = frames.length ? frames : allFrames.slice(0, 1);
  const frameWidth = width / Math.max(1, visibleFrames.length);

  const startRangeSelection = (event: PointerEventObject) => {
    event.cancelBubble = true;
    onRangeSelectionStart(event);
  };

  const stopRangeSelection = (event: PointerEventObject) => {
    event.cancelBubble = true;
  };

  const handleTrimEnd = (edge: 'start' | 'end') => (event: Konva.KonvaEventObject<DragEvent>) => {
    event.cancelBubble = true;
    const nodeX = event.target.x();
    if (edge === 'start') {
      setVideoClipBounds(clip.id, clip.sourceIn + nodeX / pixelsPerSecond, clip.sourceOut);
    } else {
      const delta = (nodeX - (width - HANDLE_WIDTH)) / pixelsPerSecond;
      setVideoClipBounds(clip.id, clip.sourceIn, clip.sourceOut + delta);
    }
  };

  const showTrimHandles = !grouped;
  const showIndividualSelection = selected;

  return (
    <Group x={x + previewOffsetX} y={0} onPointerDown={startRangeSelection}>
      <Rect width={width} height={TRACK_HEIGHT} fill="#101b33" cornerRadius={5} />
      <Group clipFunc={(context) => context.rect(0, 0, width, TRACK_HEIGHT)}>
        {visibleFrames.map((src, index) => (
          <Thumbnail key={`${src}-${index}`} src={src} x={index * frameWidth} width={frameWidth} />
        ))}
        <Rect width={width} height={TRACK_HEIGHT} fill="rgba(4, 10, 23, 0.18)" listening={false} />
      </Group>
      <Rect
        x={1}
        y={1}
        width={Math.max(0, width - 2)}
        height={TRACK_HEIGHT - 2}
        stroke={showIndividualSelection ? '#ffffff' : '#24519a'}
        strokeWidth={showIndividualSelection ? 2 : 1}
        cornerRadius={5}
        listening={false}
        shadowColor={showIndividualSelection ? '#ffffff' : '#0f4aa8'}
        shadowBlur={showIndividualSelection ? 10 : 0}
      />
      <Rect x={5} y={5} width={24} height={18} fill="rgba(3, 7, 16, 0.82)" cornerRadius={4} listening={false} />
      <Text x={5} y={8} width={24} text={String(clipIndex + 1)} fill="#ffffff" fontSize={10} align="center" listening={false} />
      <Rect
        name="trim-handle"
        width={HANDLE_WIDTH}
        height={TRACK_HEIGHT}
        fill="#f4f5f7"
        opacity={showTrimHandles ? (selected ? 1 : 0.72) : 0}
        cornerRadius={[5, 0, 0, 5]}
        draggable={showTrimHandles}
        listening={showTrimHandles}
        onPointerDown={stopRangeSelection}
        dragBoundFunc={(position) => ({
          x: Math.max(-clip.sourceIn * pixelsPerSecond, Math.min(position.x, width - HANDLE_WIDTH - 0.2 * pixelsPerSecond)),
          y: 0
        })}
        onDragStart={() => selectClip({ kind: 'video', id: clip.id, ids: [clip.id] })}
        onDragEnd={handleTrimEnd('start')}
      />
      <Rect
        name="trim-handle"
        x={width - HANDLE_WIDTH}
        width={HANDLE_WIDTH}
        height={TRACK_HEIGHT}
        fill="#f4f5f7"
        opacity={showTrimHandles ? (selected ? 1 : 0.72) : 0}
        cornerRadius={[0, 5, 5, 0]}
        draggable={showTrimHandles}
        listening={showTrimHandles}
        onPointerDown={stopRangeSelection}
        dragBoundFunc={(position) => ({
          x: Math.max(HANDLE_WIDTH, Math.min(
            position.x,
            width - HANDLE_WIDTH + (clip.sourceDuration - clip.sourceOut) * pixelsPerSecond
          )),
          y: 0
        })}
        onDragStart={() => selectClip({ kind: 'video', id: clip.id, ids: [clip.id] })}
        onDragEnd={handleTrimEnd('end')}
      />
    </Group>
  );
}

interface VideoTrackViewProps {
  selectedTransitionClipId?: string | null;
  onEditTransition?: (clipId: string) => void;
}

export function VideoTrackView({ selectedTransitionClipId, onEditTransition }: VideoTrackViewProps) {
  const timeline = useTimelineStore((state) => state.timeline);
  const pixelsPerSecond = useTimelineStore((state) => state.pixelsPerSecond);
  const selection = useTimelineStore((state) => state.selection);
  const rangeSelection = useTimelineStore((state) => state.rangeSelection);
  const selectClip = useTimelineStore((state) => state.selectClip);
  const toggleVideoClipSelection = useTimelineStore((state) => state.toggleVideoClipSelection);
  const setRangeSelection = useTimelineStore((state) => state.setRangeSelection);
  const clearRangeSelection = useTimelineStore((state) => state.clearRangeSelection);
  const setCurrentTime = useTimelineStore((state) => state.setCurrentTime);
  const setPlaying = useTimelineStore((state) => state.setPlaying);
  const startTimelineRangeMove = useTimelineRangeMove(pixelsPerSecond);
  const rangeMoveActive = useTimelineRangeMoveStore((state) => state.active);
  const rangeMoveDelta = useTimelineRangeMoveStore((state) => state.deltaSeconds);
  const width = useMemo(() => Math.max(1, (timeline?.duration || 0) * pixelsPerSecond), [timeline?.duration, pixelsPerSecond]);
  const firstVideoClip = timeline?.videoTrack.clips[0];
  const lastVideoClip = timeline?.videoTrack.clips[timeline.videoTrack.clips.length - 1];
  const edgeMarkerInset = Math.min(11, width / 3);
  const startTransitionX = firstVideoClip
    ? firstVideoClip.startTime * pixelsPerSecond + edgeMarkerInset
    : 0;
  const endTransitionX = lastVideoClip
    ? lastVideoClip.endTime * pixelsPerSecond - edgeMarkerInset
    : width;
  const [dragRange, setDragRange] = useState<{ start: number; current: number } | null>(null);
  const dragStateRef = useRef<RangeDragState | null>(null);

  const clampTrackX = useCallback((x: number) => Math.max(0, Math.min(x, width)), [width]);

  const finalizeDrag = useCallback((endX: number) => {
    const state = dragStateRef.current;
    if (!state || !timeline) return;
    dragStateRef.current = null;
    setDragRange(null);
    const finalX = clampTrackX(endX);
    if (!state.moved) {
      const clickedClip = timeline.videoTrack.clips.find((clip, index, clips) => {
        const start = clip.startTime * pixelsPerSecond;
        const end = clip.endTime * pixelsPerSecond;
        return state.start >= start && (state.start < end || index === clips.length - 1);
      });
      if (clickedClip) {
        if (state.additive) toggleVideoClipSelection(clickedClip.id);
        else selectClip({ kind: 'video', id: clickedClip.id, ids: [clickedClip.id] });
      } else if (!state.additive) {
        selectClip(null);
      }
      setCurrentTime(state.start / pixelsPerSecond);
      return;
    }
    setRangeSelection(state.start / pixelsPerSecond, finalX / pixelsPerSecond, ['video', 'broll', 'audio', 'text']);
  }, [clampTrackX, pixelsPerSecond, selectClip, setCurrentTime, setRangeSelection, timeline, toggleVideoClipSelection]);

  useEffect(() => {
    const finishOutsideStage = (event: PointerEvent) => {
      const state = dragStateRef.current;
      if (!state) return;
      const bounds = state.container.getBoundingClientRect();
      finalizeDrag(event.clientX - bounds.left);
    };
    const cancelRangeSelection = () => {
      const wasMoving = dragStateRef.current?.moved;
      dragStateRef.current = null;
      setDragRange(null);
      if (wasMoving) clearRangeSelection();
    };
    window.addEventListener('pointerup', finishOutsideStage);
    window.addEventListener('pointercancel', cancelRangeSelection);
    return () => {
      window.removeEventListener('pointerup', finishOutsideStage);
      window.removeEventListener('pointercancel', cancelRangeSelection);
    };
  }, [clearRangeSelection, finalizeDrag]);

  if (!timeline) return null;

  const handlePointerDown = (event: PointerEventObject) => {
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();
    const container = stage?.container();
    if (!pointer || !container) return;
    const start = clampTrackX(pointer.x);
    try {
      container.setPointerCapture(event.evt.pointerId);
    } catch {
      // The global pointer-up fallback finalizes a range when capture is unavailable.
    }
    dragStateRef.current = {
      start,
      current: start,
      moved: false,
      additive: event.evt.ctrlKey || event.evt.metaKey,
      pointerId: event.evt.pointerId,
      container
    };
    setDragRange({ start, current: start });
  };

  const handlePointerMove = (event: PointerEventObject) => {
    const state = dragStateRef.current;
    if (!state) return;
    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) return;
    const current = clampTrackX(pointer.x);
    state.current = current;
    if (!state.moved && Math.abs(current - state.start) > RANGE_DRAG_THRESHOLD) {
      state.moved = true;
    }
    if (state.moved) setRangeSelection(state.start / pixelsPerSecond, current / pixelsPerSecond, ['video', 'broll', 'audio', 'text']);
    setDragRange({ start: state.start, current });
  };

  const handlePointerUp = (event: PointerEventObject) => {
    const state = dragStateRef.current;
    if (state?.container.hasPointerCapture(state.pointerId)) state.container.releasePointerCapture(state.pointerId);
    const pointer = event.target.getStage()?.getPointerPosition();
    finalizeDrag(pointer ? pointer.x : dragStateRef.current?.current ?? 0);
  };

  const cancelRangeSelection = () => {
    const state = dragStateRef.current;
    if (state?.container.hasPointerCapture(state.pointerId)) state.container.releasePointerCapture(state.pointerId);
    if (state?.moved) clearRangeSelection();
    dragStateRef.current = null;
    setDragRange(null);
  };

  const rangeTargets = rangeSelection ? getTimelineRangeTargets(timeline, rangeSelection) : null;
  const selectedVideoIds = rangeTargets
    ? rangeTargets.videoIds
    : selection?.kind === 'video'
      ? selection.ids
      : [];
  const rangeVideoIds = new Set(rangeTargets?.videoIds || []);
  const selectedGroupClipIndexes = timeline.videoTrack.clips.reduce<number[]>((indexes, clip, index) => {
    if (selectedVideoIds.includes(clip.id)) indexes.push(index);
      return indexes;
  }, []);
  const isContiguousGroupSelection = selectedGroupClipIndexes.length > 1
    && selectedGroupClipIndexes.every((index, position) => position === 0 || index === selectedGroupClipIndexes[position - 1] + 1);
  const rangeCanMove = Boolean(rangeTargets
    && (rangeTargets.videoIds.length || rangeTargets.brollIds.length || rangeTargets.textIds.length));
  const showRange = Boolean(rangeSelection?.tracks.includes('video'));
  const rangeMoveOffsetX = rangeMoveDelta * pixelsPerSecond;

  const startGroupMove = (event: PointerEventObject) => {
    if (!rangeCanMove || event.evt.button !== 0) return;
    if (!startTimelineRangeMove(event.evt.pointerId, event.evt.clientX)) return;
    event.cancelBubble = true;
    event.evt.preventDefault();
  };

  const startClipInteraction = (rangeSelected: boolean) => (event: PointerEventObject) => {
    if (rangeSelected && rangeCanMove && event.evt.button === 0) {
      if (startTimelineRangeMove(event.evt.pointerId, event.evt.clientX)) {
        event.cancelBubble = true;
        event.evt.preventDefault();
        return;
      }
    }
    handlePointerDown(event);
  };

  return (
    <div className="timeline-track timeline-track--video" style={{ width }}>
      <div className="video-transition-lane" aria-label="Transiciones entre clips">
        {firstVideoClip && <div
          className={`video-transition-marker video-transition-marker--edge video-transition-marker--start${timeline.settings.startTransitionType === 'none' ? '' : ' is-active'}${selectedTransitionClipId === '__timeline-start__' ? ' is-selected' : ''}`}
          style={{ left: startTransitionX }}
        >
          <button
            type="button"
            className="video-transition-marker__button"
            title={`${transitionLabel(timeline.settings.startTransitionType)} al principio del vídeo`}
            aria-label="Editar transición de entrada"
            onClick={(event) => {
              event.stopPropagation();
              setPlaying(false);
              setCurrentTime(0);
              onEditTransition?.('__timeline-start__');
            }}
          >
            <span className="video-transition-marker__icon"><Sparkles size={12} /></span>
          </button>
        </div>}
        {timeline.videoTrack.clips.slice(0, -1).map((clip, index) => {
          const markerX = clip.endTime * pixelsPerSecond;
          const isSelected = selectedTransitionClipId === clip.id;
          return (
            <div
              key={`transition-${clip.id}`}
              className={`video-transition-marker${clip.transitionType === 'none' ? '' : ' is-active'}${isSelected ? ' is-selected' : ''}`}
              style={{ left: markerX }}
            >
              <button
                type="button"
                className="video-transition-marker__button"
                title={`${transitionLabel(clip.transitionType)} entre los clips ${index + 1} y ${index + 2}`}
                aria-label={`Editar transición entre los clips ${index + 1} y ${index + 2}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setPlaying(false);
                  setCurrentTime(clip.endTime);
                  onEditTransition?.(clip.id);
                }}
              >
                <span className="video-transition-marker__icon"><Sparkles size={12} /></span>
              </button>
            </div>
          );
        })}
        {lastVideoClip && <div
          className={`video-transition-marker video-transition-marker--edge video-transition-marker--end${timeline.settings.endTransitionType === 'none' ? '' : ' is-active'}${selectedTransitionClipId === '__timeline-end__' ? ' is-selected' : ''}`}
          style={{ left: endTransitionX }}
        >
          <button
            type="button"
            className="video-transition-marker__button"
            title={`${transitionLabel(timeline.settings.endTransitionType)} al final del vídeo`}
            aria-label="Editar transición de salida"
            onClick={(event) => {
              event.stopPropagation();
              setPlaying(false);
              setCurrentTime(timeline.duration);
              onEditTransition?.('__timeline-end__');
            }}
          >
            <span className="video-transition-marker__icon"><Sparkles size={12} /></span>
          </button>
        </div>}
      </div>
      <div className="video-track-stage">
        <Stage
          width={width}
          height={TRACK_HEIGHT}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={cancelRangeSelection}
        >
          <Layer>
            {timeline.videoTrack.clips.map((clip, index) => (
              <ClipView
                key={clip.id}
                clip={clip}
                clipIndex={index}
                pixelsPerSecond={pixelsPerSecond}
                selected={selectedVideoIds.includes(clip.id)}
                grouped={(Boolean(rangeSelection) || isContiguousGroupSelection) && selectedVideoIds.includes(clip.id)}
                previewOffsetX={rangeVideoIds.has(clip.id) ? rangeMoveOffsetX : 0}
                onRangeSelectionStart={startClipInteraction(rangeVideoIds.has(clip.id))}
              />
            ))}
            {showRange && rangeSelection && (
              <Group x={rangeMoveOffsetX} onPointerDown={startGroupMove}>
                <Rect
                  x={rangeSelection.startTime * pixelsPerSecond + 1}
                  y={2}
                  width={Math.max(0, (rangeSelection.endTime - rangeSelection.startTime) * pixelsPerSecond - 2)}
                  height={TRACK_HEIGHT - 4}
                  fill="rgba(127, 183, 255, 0.13)"
                  stroke="#f4f7ff"
                  strokeWidth={2}
                  cornerRadius={5}
                  shadowColor="#c7e0ff"
                  shadowBlur={rangeMoveActive ? 14 : 10}
                  cursor={rangeMoveActive ? 'grabbing' : rangeCanMove ? 'grab' : 'default'}
                  listening={rangeCanMove}
                />
                <Rect
                  x={rangeSelection.startTime * pixelsPerSecond}
                  y={2}
                  width={RANGE_HANDLE_WIDTH}
                  height={TRACK_HEIGHT - 4}
                  fill="#f4f7ff"
                  cornerRadius={[5, 0, 0, 5]}
                  listening={false}
                />
                <Rect
                  x={rangeSelection.endTime * pixelsPerSecond - RANGE_HANDLE_WIDTH}
                  y={2}
                  width={RANGE_HANDLE_WIDTH}
                  height={TRACK_HEIGHT - 4}
                  fill="#f4f7ff"
                  cornerRadius={[0, 5, 5, 0]}
                  listening={false}
                />
              </Group>
            )}
            {dragRange && (
              <Rect
                x={Math.min(dragRange.start, dragRange.current)}
                y={2}
                width={Math.abs(dragRange.current - dragRange.start)}
                height={TRACK_HEIGHT - 4}
                fill="rgba(89, 161, 255, 0.19)"
                stroke="#9dccff"
                strokeWidth={1}
                dash={[5, 4]}
                cornerRadius={4}
                listening={false}
              />
            )}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
