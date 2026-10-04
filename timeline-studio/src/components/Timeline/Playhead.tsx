import { useRef } from 'react';
import { useTimelineStore } from '../../store/timelineStore';

export function Playhead() {
  const currentTime = useTimelineStore((state) => state.currentTime);
  const pixelsPerSecond = useTimelineStore((state) => state.pixelsPerSecond);
  const setCurrentTime = useTimelineStore((state) => state.setCurrentTime);
  const setPlaying = useTimelineStore((state) => state.setPlaying);
  const timeline = useTimelineStore((state) => state.timeline);
  const dragging = useRef(false);
  if (!timeline) return null;

  const update = (event: React.PointerEvent) => {
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    setCurrentTime((event.clientX - bounds.left) / pixelsPerSecond);
  };

  return (
    <div
      className="timeline-playhead"
      style={{ left: currentTime * pixelsPerSecond }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // The area selector listens globally in capture phase.  Keep this
        // interaction isolated so dragging the playhead seeks rather than
        // starting a range selection.
        event.preventDefault();
        event.stopPropagation();
        dragging.current = true;
        setPlaying(false);
        event.currentTarget.setPointerCapture(event.pointerId);
        update(event);
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        event.preventDefault();
        update(event);
      }}
      onPointerUp={(event) => {
        if (!dragging.current) return;
        dragging.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => { dragging.current = false; }}
    >
      <div className="timeline-playhead__handle" />
    </div>
  );
}
