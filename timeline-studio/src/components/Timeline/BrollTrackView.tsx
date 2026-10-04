import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrollClip } from '../../types/timeline';
import { useTimelineRangeMoveStore } from '../../store/timelineRangeMoveStore';
import { useTimelineStore } from '../../store/timelineStore';
import { getTimelineRangeTargets } from '../../utils/timeline';
import { useTimelineRangeDrag } from './useTimelineRangeDrag';
import { useTimelineRangeMove } from './useTimelineRangeMove';
import { t, useUiLocale } from '../../i18n';
import { assignLanes, laneCountOf } from '../../utils/timelineLanes';

interface DragState {
  mode: 'move' | 'start' | 'end';
  pointerX: number;
  startTime: number;
  endTime: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// Función 3 — Capas superpuestas: cuando dos o más B-Roll se solapan en el
// tiempo, ya podían componerse en el lienzo (el orden del array decide el
// z-order), pero en la pista del timeline se dibujaban unos encima de otros
// en la misma fila, sin forma de distinguirlos ni de arrastrarlos por
// separado. `assignLanes` (utils/timelineLanes.ts) asigna a cada clip un
// "carril" (fila) para que el timeline SÍ muestre las capas apiladas
// verticalmente — el mismo cálculo lo reutiliza también Texto.
const LANE_HEIGHT = 38;

function BrollBlock({ clip, pixelsPerSecond, duration, lane, rangeSelected, previewDeltaSeconds, onRangeMoveStart }: {
  clip: BrollClip;
  pixelsPerSecond: number;
  duration: number;
  lane: number;
  rangeSelected: boolean;
  previewDeltaSeconds: number;
  onRangeMoveStart: (pointerId: number, clientX: number) => boolean;
}) {
  useUiLocale();
  const selection = useTimelineStore((state) => state.selection);
  const selectClip = useTimelineStore((state) => state.selectClip);
  const setCurrentTime = useTimelineStore((state) => state.setCurrentTime);
  const setPlaying = useTimelineStore((state) => state.setPlaying);
  const updateBrollClip = useTimelineStore((state) => state.updateBrollClip);
  const drag = useRef<DragState | null>(null);
  const [draft, setDraft] = useState<{ startTime: number; endTime: number } | null>(null);
  const timing = draft || clip;
  const selected = (selection?.kind === 'broll' && selection.id === clip.id) || rangeSelected;

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

  const finishDrag = useCallback((event: PointerEvent) => {
    const next = draftTiming(event.clientX);
    drag.current = null;
    setDraft(null);
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', finishDrag);
    window.removeEventListener('pointercancel', cancelDrag);
    if (next) {
      updateBrollClip(clip.id, next);
      setCurrentTime(next.startTime);
    }
  }, [clip.id, draftTiming, handleMove, setCurrentTime, updateBrollClip]);

  const cancelDrag = useCallback(() => {
    drag.current = null;
    setDraft(null);
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', finishDrag);
    window.removeEventListener('pointercancel', cancelDrag);
  }, [finishDrag, handleMove]);

  useEffect(() => cancelDrag, [cancelDrag]);

  const startDrag = (mode: DragState['mode']) => (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (mode === 'move' && rangeSelected && onRangeMoveStart(event.pointerId, event.clientX)) {
      return;
    }
    setPlaying(false);
    selectClip({ kind: 'broll', id: clip.id });
    setCurrentTime(clip.startTime);
    drag.current = {
      mode,
      pointerX: event.clientX,
      startTime: clip.startTime,
      endTime: clip.endTime
    };
    setDraft({ startTime: clip.startTime, endTime: clip.endTime });
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', cancelDrag);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-i18n-skip=""
      aria-label={`${t('Imagen')} ${clip.name}`}
      className={`broll-clip${selected ? ' is-selected' : ''}${rangeSelected && previewDeltaSeconds ? ' is-range-moving' : ''}`}
      style={{
        left: timing.startTime * pixelsPerSecond,
        width: Math.max(14, (timing.endTime - timing.startTime) * pixelsPerSecond),
        top: lane * LANE_HEIGHT + 3,
        bottom: 'auto',
        height: LANE_HEIGHT - 6,
        transform: rangeSelected ? `translate3d(${previewDeltaSeconds * pixelsPerSecond}px, 0, 0)` : undefined
      }}
      onPointerDown={startDrag('move')}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        selectClip({ kind: 'broll', id: clip.id });
        setCurrentTime(clip.startTime);
      }}
    >
      {!rangeSelected && <span className="broll-clip__handle broll-clip__handle--start" onPointerDown={startDrag('start')} />}
      <img src={clip.sourceUrl} alt="" draggable={false} />
      <span className="broll-clip__label">{clip.name}</span>
      {/* Función 1 — Keyframes: marcadores en forma de diamante en las
          posiciones (relativas al inicio del clip) donde hay keyframes. */}
      {clip.keyframes?.map((kf) => (
        <span key={kf.id} className="timeline-keyframe-marker" style={{ left: (kf.timeMs / 1000) * pixelsPerSecond }} title={`Keyframe ${(kf.timeMs / 1000).toFixed(2)}s`} />
      ))}
      {!rangeSelected && <span className="broll-clip__handle broll-clip__handle--end" onPointerDown={startDrag('end')} />}
    </div>
  );
}

export function BrollTrackView() {
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
  const rangeBrollIds = useMemo(() => new Set(rangeTargets.brollIds), [rangeTargets.brollIds]);
  if (!timeline) return null;
  const width = timeline.duration * pixelsPerSecond;
  const showRange = Boolean(rangeSelection?.tracks.includes('broll'));
  const rangeCanMove = Boolean(rangeTargets.videoIds.length || rangeTargets.brollIds.length || rangeTargets.textIds.length);
  const lanes = assignLanes(timeline.brollTrack.clips);
  const height = laneCountOf(lanes) * LANE_HEIGHT;

  return (
    <div
      className={`timeline-track timeline-track--broll${showRange ? ' is-range-selected' : ''}`}
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
      {timeline.brollTrack.clips.map((clip) => (
        <BrollBlock
          key={clip.id}
          clip={clip}
          pixelsPerSecond={pixelsPerSecond}
          duration={timeline.duration}
          lane={lanes.get(clip.id) || 0}
          rangeSelected={rangeBrollIds.has(clip.id)}
          previewDeltaSeconds={rangeMoveDelta}
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
