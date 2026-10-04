import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TextClip } from '../../types/timeline';
import { useTimelineRangeMoveStore } from '../../store/timelineRangeMoveStore';
import { useTimelineStore } from '../../store/timelineStore';
import { getTimelineRangeTargets } from '../../utils/timeline';
import { useTimelineRangeDrag } from './useTimelineRangeDrag';
import { useTimelineRangeMove } from './useTimelineRangeMove';
import { assignLanes, laneCountOf } from '../../utils/timelineLanes';
import { fitTextAnimationDurations } from '../../utils/textAnimations';

interface DragState {
  mode: 'move' | 'start' | 'end';
  pointerX: number;
  startTime: number;
  endTime: number;
}

// Igual que en B-Roll (Función 3): cuando dos frases se solapan en el
// tiempo, se dibujan en carriles (filas) distintos en vez de amontonarse.
const LANE_HEIGHT = 34;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const TextBlock = memo(function TextBlock({
  clip,
  pixelsPerSecond,
  duration,
  lane,
  rangeSelected,
  previewDeltaSeconds,
  onRangeMoveStart
}: {
  clip: TextClip;
  pixelsPerSecond: number;
  duration: number;
  lane: number;
  rangeSelected: boolean;
  previewDeltaSeconds: number;
  onRangeMoveStart: (pointerId: number, clientX: number) => boolean;
}) {
  const selection = useTimelineStore((state) => state.selection);
  const selectClip = useTimelineStore((state) => state.selectClip);
  const setTextClipTiming = useTimelineStore((state) => state.setTextClipTiming);
  const drag = useRef<DragState | null>(null);
  const [draft, setDraft] = useState<{ startTime: number; endTime: number } | null>(null);
  const timing = draft || clip;
  const left = timing.startTime * pixelsPerSecond;
  const width = Math.max(12, (timing.endTime - timing.startTime) * pixelsPerSecond);
  const selected = (selection?.kind === 'text' && selection.id === clip.id) || rangeSelected;
  const animationDurations = clip.kind === 'text'
    ? fitTextAnimationDurations({ ...clip, startTime: timing.startTime, endTime: timing.endTime })
    : { entranceMs: 0, exitMs: 0 };

  const draftTiming = useCallback((clientX: number) => {
    if (!drag.current) return null;
    const delta = (clientX - drag.current.pointerX) / pixelsPerSecond;
    const clipDuration = drag.current.endTime - drag.current.startTime;
    if (drag.current.mode === 'move') {
      const startTime = clamp(drag.current.startTime + delta, 0, duration - clipDuration);
      return { startTime, endTime: startTime + clipDuration };
    }
    if (drag.current.mode === 'start') {
      return {
        startTime: clamp(drag.current.startTime + delta, 0, drag.current.endTime - 0.2),
        endTime: drag.current.endTime
      };
    }
    return {
      startTime: drag.current.startTime,
      endTime: clamp(drag.current.endTime + delta, drag.current.startTime + 0.2, duration)
    };
  }, [duration, pixelsPerSecond]);

  const handleMove = useCallback((event: PointerEvent) => {
    const next = draftTiming(event.clientX);
    if (next) setDraft(next);
  }, [draftTiming]);

  const handleEnd = useCallback(function finishDrag(event: PointerEvent) {
    const next = draftTiming(event.clientX);
    drag.current = null;
    setDraft(null);
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', finishDrag);
    if (next) setTextClipTiming(clip.id, next.startTime, next.endTime);
  }, [clip.id, draftTiming, handleMove, setTextClipTiming]);

  useEffect(() => () => {
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleEnd);
  }, [handleEnd, handleMove]);

  const startDrag = (mode: DragState['mode']) => (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (mode === 'move' && rangeSelected && onRangeMoveStart(event.pointerId, event.clientX)) {
      return;
    }
    selectClip({ kind: 'text', id: clip.id });
    drag.current = { mode, pointerX: event.clientX, startTime: clip.startTime, endTime: clip.endTime };
    setDraft({ startTime: clip.startTime, endTime: clip.endTime });
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
  };

  return (
    <div
      className={`text-clip${clip.kind === 'subtitle' ? ' text-clip--subtitle' : ''}${selected ? ' text-clip--selected' : ''}${rangeSelected && previewDeltaSeconds ? ' is-range-moving' : ''}`}
      style={{
        left,
        width,
        top: lane * LANE_HEIGHT + 4,
        bottom: 'auto',
        height: LANE_HEIGHT - 8,
        transform: rangeSelected ? `translate3d(${previewDeltaSeconds * pixelsPerSecond}px, 0, 0)` : undefined
      }}
      onPointerDown={startDrag('move')}
    >
      {!rangeSelected && <span className="text-clip__handle text-clip__handle--start" onPointerDown={startDrag('start')} />}
      {animationDurations.entranceMs > 0 && (
        <span className="text-clip__animation-zone text-clip__animation-zone--entrance" style={{ width: Math.min(width, animationDurations.entranceMs / 1000 * pixelsPerSecond) }} aria-hidden="true" />
      )}
      {animationDurations.exitMs > 0 && (
        <span className="text-clip__animation-zone text-clip__animation-zone--exit" style={{ width: Math.min(width, animationDurations.exitMs / 1000 * pixelsPerSecond) }} aria-hidden="true" />
      )}
      {clip.text
        ? <span className="text-clip__label" data-i18n-skip="">{clip.text}</span>
        : <span className="text-clip__label">Texto</span>}
      {/* Función 1 — Keyframes: marcadores en forma de diamante en las
          posiciones (relativas al inicio del clip) donde hay keyframes. */}
      {clip.keyframes?.map((kf) => (
        <span key={kf.id} className="timeline-keyframe-marker" style={{ left: (kf.timeMs / 1000) * pixelsPerSecond }} title={`Keyframe ${(kf.timeMs / 1000).toFixed(2)}s`} />
      ))}
      {!rangeSelected && <span className="text-clip__handle text-clip__handle--end" onPointerDown={startDrag('end')} />}
    </div>
  );
});

export function TextTrackView() {
  const timeline = useTimelineStore((state) => state.timeline);
  const pixelsPerSecond = useTimelineStore((state) => state.pixelsPerSecond);
  const rangeSelection = useTimelineStore((state) => state.rangeSelection);
  const rangeDrag = useTimelineRangeDrag(pixelsPerSecond);
  const startRangeMove = useTimelineRangeMove(pixelsPerSecond);
  const rangeMoveActive = useTimelineRangeMoveStore((state) => state.active);
  const rangeMoveDelta = useTimelineRangeMoveStore((state) => state.deltaSeconds);
  const rangeTargets = useMemo(() => timeline && rangeSelection
    ? getTimelineRangeTargets(timeline, rangeSelection)
    : { videoIds: [], brollIds: [], textIds: [], audio: false }, [rangeSelection, timeline]);
  const rangeTextIds = useMemo(() => new Set(rangeTargets.textIds), [rangeTargets.textIds]);
  if (!timeline) return null;
  const width = timeline.duration * pixelsPerSecond;
  const showRange = Boolean(rangeSelection?.tracks.includes('text'));
  const rangeCanMove = Boolean(rangeTargets.videoIds.length || rangeTargets.brollIds.length || rangeTargets.textIds.length);
  const lanes = assignLanes(timeline.textTrack.clips);
  const height = laneCountOf(lanes) * LANE_HEIGHT;

  return (
    <div
      className={`timeline-track timeline-track--text${showRange ? ' is-range-selected' : ''}`}
      style={{ width, height }}
      onPointerDownCapture={(event) => {
        if (!event.shiftKey) return;
        event.stopPropagation();
        rangeDrag.handlePointerDown(event);
      }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return;
        rangeDrag.handlePointerDown(event);
      }}
      onPointerMove={rangeDrag.handlePointerMove}
      onPointerUp={rangeDrag.handlePointerUp}
      onPointerCancel={rangeDrag.handlePointerCancel}
    >
      {timeline.textTrack.clips.map((clip) => (
        <TextBlock
          key={clip.id}
          clip={clip}
          pixelsPerSecond={pixelsPerSecond}
          duration={timeline.duration}
          lane={lanes.get(clip.id) || 0}
          rangeSelected={rangeTextIds.has(clip.id)}
          previewDeltaSeconds={rangeTextIds.has(clip.id) ? rangeMoveDelta : 0}
          onRangeMoveStart={startRangeMove}
        />
      ))}
      {showRange && rangeSelection && (
        <div
          className={`timeline-range-overlay${rangeCanMove ? ' timeline-range-overlay--movable' : ''}${rangeMoveActive ? ' is-moving' : ''}`}
          style={{
            left: rangeSelection.startTime * pixelsPerSecond,
            width: Math.max(2, (rangeSelection.endTime - rangeSelection.startTime) * pixelsPerSecond),
            transform: `translate3d(${rangeMoveDelta * pixelsPerSecond}px, 0, 0)`
          }}
          title={rangeCanMove ? 'Arrastrar selecci\u00f3n temporal' : undefined}
          onPointerDown={(event) => {
            if (event.button !== 0 || !rangeCanMove) return;
            if (!startRangeMove(event.pointerId, event.clientX)) return;
            event.preventDefault();
            event.stopPropagation();
          }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
