import { useCallback, useEffect, useRef } from 'react';
import { useTimelineRangeMoveStore } from '../../store/timelineRangeMoveStore';
import { useTimelineStore } from '../../store/timelineStore';
import { planTimelineRangeMove } from '../../utils/timelineRangeMove';

const DRAG_THRESHOLD_PX = 4;

interface ActiveRangeMove {
  pointerId: number;
  startClientX: number;
  moved: boolean;
  cleanup: () => void;
}

export function useTimelineRangeMove(pixelsPerSecond: number) {
  const activeMove = useRef<ActiveRangeMove | null>(null);

  const cancelActiveMove = useCallback(() => {
    const active = activeMove.current;
    if (!active) return;
    active.cleanup();
    activeMove.current = null;
    useTimelineRangeMoveStore.getState().reset();
  }, []);

  useEffect(() => cancelActiveMove, [cancelActiveMove]);

  const startRangeMove = useCallback((pointerId: number, clientX: number) => {
    const state = useTimelineStore.getState();
    const { timeline, rangeSelection } = state;
    if (!timeline || !rangeSelection || pixelsPerSecond <= 0 || activeMove.current) return false;
    if (useTimelineRangeMoveStore.getState().active) return false;
    if (!planTimelineRangeMove(timeline, rangeSelection, 0)) return false;

    state.setPlaying(false);
    useTimelineRangeMoveStore.getState().begin();

    const removeListeners = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishRangeMove);
      window.removeEventListener('pointercancel', cancelRangeMove);
    };

    const planForClientX = (nextClientX: number) => planTimelineRangeMove(
      timeline,
      rangeSelection,
      (nextClientX - clientX) / pixelsPerSecond
    );

    const handlePointerMove = (event: PointerEvent) => {
      const active = activeMove.current;
      if (!active || event.pointerId !== active.pointerId) return;
      if (!active.moved && Math.abs(event.clientX - active.startClientX) < DRAG_THRESHOLD_PX) return;
      active.moved = true;
      const plan = planForClientX(event.clientX);
      if (plan) useTimelineRangeMoveStore.getState().update(plan.previewDeltaSeconds);
    };

    const finishRangeMove = (event: PointerEvent) => {
      const active = activeMove.current;
      if (!active || event.pointerId !== active.pointerId) return;
      const plan = active.moved ? planForClientX(event.clientX) : null;
      active.cleanup();
      activeMove.current = null;
      useTimelineRangeMoveStore.getState().reset();
      if (plan && Math.abs(plan.deltaSeconds) >= 0.001) {
        // One store action means one undo-history entry for the whole linked move.
        useTimelineStore.getState().moveRangeSelection(plan.deltaSeconds);
      }
    };

    const cancelRangeMove = (event: PointerEvent) => {
      const active = activeMove.current;
      if (!active || event.pointerId !== active.pointerId) return;
      cancelActiveMove();
    };

    activeMove.current = {
      pointerId,
      startClientX: clientX,
      moved: false,
      cleanup: removeListeners
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishRangeMove);
    window.addEventListener('pointercancel', cancelRangeMove);
    return true;
  }, [cancelActiveMove, pixelsPerSecond]);

  return startRangeMove;
}
