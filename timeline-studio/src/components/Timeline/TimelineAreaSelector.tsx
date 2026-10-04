import { useEffect, useRef, useState } from 'react';
import type { TimelineTrackKind } from '../../types/timeline';
import { useTimelineStore } from '../../store/timelineStore';

interface Area { left: number; top: number; width: number; height: number; }

function trackKind(element: Element): TimelineTrackKind | null {
  if (element.classList.contains('timeline-track--video')) return 'video';
  if (element.classList.contains('timeline-track--broll')) return 'broll';
  if (element.classList.contains('timeline-track--audio')) return 'audio';
  if (element.classList.contains('timeline-track--text')) return 'text';
  return null;
}

/**
 * A non-intercepting marquee: it starts only on empty timeline space, leaving
 * clips, captions, waveforms and transition controls free for their own drags.
 */
export function TimelineAreaSelector({ active, pixelsPerSecond }: { active: boolean; pixelsPerSecond: number }) {
  const timeline = useTimelineStore((state) => state.timeline);
  const setRangeSelection = useTimelineStore((state) => state.setRangeSelection);
  const overlayRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const [area, setArea] = useState<Area | null>(null);

  useEffect(() => {
    if (!active || !timeline) return;
    const isInteractive = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest(
      'button, input, .timeline-playhead, .timeline-range-overlay, .text-clip, .broll-clip, .video-transition-marker, .timeline-audio-wave, .timeline-audio-name, canvas'
    ));
    const update = (event: PointerEvent) => {
      const start = startRef.current;
      const overlay = overlayRef.current;
      if (!start || !overlay || event.pointerId !== start.pointerId) return;
      const overlayBounds = overlay.getBoundingClientRect();
      const x = event.clientX - overlayBounds.left;
      const y = event.clientY - overlayBounds.top;
      setArea({ left: Math.min(start.x, x), top: Math.min(start.y, y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) });
      const top = Math.min(start.y + overlayBounds.top, event.clientY);
      const bottom = Math.max(start.y + overlayBounds.top, event.clientY);
      const tracks = [...overlay.parentElement!.querySelectorAll('.timeline-track')]
        .filter((element) => {
          const bounds = element.getBoundingClientRect();
          return top < bounds.bottom && bottom > bounds.top;
        })
        .map(trackKind)
        .filter((kind): kind is TimelineTrackKind => Boolean(kind));
      const firstTrack = overlay.parentElement!.querySelector<HTMLElement>('.timeline-track');
      if (!firstTrack) return;
      const trackLeft = firstTrack.getBoundingClientRect().left;
      setRangeSelection(
        (Math.min(start.x + overlayBounds.left, event.clientX) - trackLeft) / pixelsPerSecond,
        (Math.max(start.x + overlayBounds.left, event.clientX) - trackLeft) / pixelsPerSecond,
        tracks,
        { contained: true }
      );
    };
    const end = (event: PointerEvent) => {
      if (!startRef.current || event.pointerId !== startRef.current.pointerId) return;
      update(event);
      startRef.current = null;
      setArea(null);
    };
    const start = (event: PointerEvent) => {
      const overlay = overlayRef.current;
      if (event.button !== 0 || !overlay || isInteractive(event.target)) return;
      const bounds = overlay.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
      event.preventDefault();
      event.stopPropagation();
      startRef.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top, pointerId: event.pointerId };
      setArea({ left: startRef.current.x, top: startRef.current.y, width: 0, height: 0 });
    };
    window.addEventListener('pointerdown', start, true);
    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerdown', start, true);
      window.removeEventListener('pointermove', update);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [active, pixelsPerSecond, setRangeSelection, timeline]);

  if (!active || !timeline) return null;
  return <div ref={overlayRef} className={`timeline-area-selector${area ? ' is-selecting' : ''}`} aria-label="Selector de área de la línea de tiempo">
    {area && <span className="timeline-area-selector__marquee" style={{ left: area.left, top: area.top, width: area.width, height: area.height }} />}
  </div>;
}
