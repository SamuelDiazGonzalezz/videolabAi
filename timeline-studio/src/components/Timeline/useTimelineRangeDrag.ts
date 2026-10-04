import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { TimelineTrackKind } from '../../types/timeline';
import { useTimelineStore } from '../../store/timelineStore';

const RANGE_DRAG_THRESHOLD = 4;
const ALL_TIMELINE_TRACKS: TimelineTrackKind[] = ['video', 'broll', 'audio', 'text'];

interface RangeDragState {
  pointerId: number;
  startTime: number;
  moved: boolean;
}

export function useTimelineRangeDrag(pixelsPerSecond: number) {
  const dragRef = useRef<RangeDragState | null>(null);
  const setRangeSelection = useTimelineStore((state) => state.setRangeSelection);
  const selectClip = useTimelineStore((state) => state.selectClip);
  const setCurrentTime = useTimelineStore((state) => state.setCurrentTime);

  const timeAtPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const duration = useTimelineStore.getState().timeline?.duration ?? 0;
    const time = (event.clientX - bounds.left) / pixelsPerSecond;
    return Math.max(0, Math.min(time, duration));
  }, [pixelsPerSecond]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { pointerId: event.pointerId, startTime: timeAtPointer(event), moved: false };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The window-level pointer events still complete a normal mouse interaction.
    }
  }, [timeAtPointer]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const currentTime = timeAtPointer(event);
    if (!drag.moved && Math.abs(currentTime - drag.startTime) * pixelsPerSecond > RANGE_DRAG_THRESHOLD) {
      drag.moved = true;
    }
    if (drag.moved) setRangeSelection(drag.startTime, currentTime, ALL_TIMELINE_TRACKS);
  }, [pixelsPerSecond, setRangeSelection, timeAtPointer]);

  const finishPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancelled) {
      if (drag.moved) useTimelineStore.getState().clearRangeSelection();
      return;
    }
    const currentTime = timeAtPointer(event);
    if (drag.moved) {
      setRangeSelection(drag.startTime, currentTime, ALL_TIMELINE_TRACKS);
      return;
    }
    selectClip(null);
    setCurrentTime(drag.startTime);
  }, [selectClip, setCurrentTime, setRangeSelection, timeAtPointer]);

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp: (event: ReactPointerEvent<HTMLDivElement>) => finishPointer(event),
    handlePointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => finishPointer(event, true)
  };
}
