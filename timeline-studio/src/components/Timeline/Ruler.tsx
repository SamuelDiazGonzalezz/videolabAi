import { useTimelineStore } from '../../store/timelineStore';

function formatTick(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function Ruler() {
  const timeline = useTimelineStore((state) => state.timeline);
  const pixelsPerSecond = useTimelineStore((state) => state.pixelsPerSecond);
  if (!timeline) return null;

  // Un tick cada segundo si hay espacio, si no cada 5s.
  const tickStep = pixelsPerSecond >= 60 ? 1 : pixelsPerSecond >= 25 ? 5 : 10;
  const ticks: number[] = [];
  for (let t = 0; t <= timeline.duration; t += tickStep) ticks.push(t);

  return (
    <div className="timeline-ruler" style={{ width: timeline.duration * pixelsPerSecond }}>
      {ticks.map((t) => (
        <div key={t} className="timeline-ruler__tick" style={{ left: t * pixelsPerSecond }}>
          <span>{formatTick(t)}</span>
        </div>
      ))}
    </div>
  );
}
