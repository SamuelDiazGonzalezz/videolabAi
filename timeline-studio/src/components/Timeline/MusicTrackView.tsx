import { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Music2, X } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { resolveStoredMediaProxyUrl } from '../../api/projects';
import { createWaveformErrorFallback } from '../../utils/r2Fallback';

// Función 6 — Editor de audio por capas: fila de la pista de música,
// independiente de la voz (AudioTrackView). Reutiliza WaveSurfer.js igual
// que la pista de voz; las regiones de ducking se dibujan encima como
// bandas resaltadas (marcadas a mano desde el panel "Audio").

export function MusicTrackView() {
  const timeline = useTimelineStore((state) => state.timeline);
  const pixelsPerSecond = useTimelineStore((state) => state.pixelsPerSecond);
  const removeDuckingRegion = useTimelineStore((state) => state.removeDuckingRegion);
  const containerRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<WaveSurfer | null>(null);
  const music = timeline?.musicTrack;

  useEffect(() => {
    if (!containerRef.current || !music?.sourceUrl) return;
    const wave = WaveSurfer.create({
      container: containerRef.current,
      height: 34,
      waveColor: '#3f6b3f',
      progressColor: '#57c25c',
      cursorWidth: 0,
      interact: false,
      normalize: true,
      url: music.sourceUrl
    });
    waveRef.current = wave;
    // Igual fallback que AudioTrackView: si la URL firmada de R2 falla al
    // pedirse por `fetch`, reintenta una vez a través del proxy del servidor.
    wave.on('error', createWaveformErrorFallback(wave, music.sourceUrl, resolveStoredMediaProxyUrl));
    return () => {
      wave.destroy();
      waveRef.current = null;
    };
  }, [music?.sourceUrl]);

  if (!timeline) return null;
  const width = timeline.duration * pixelsPerSecond;

  if (!music) {
    return (
      <div className="timeline-track timeline-track--music timeline-track--music-empty" style={{ width }}>
        <span className="timeline-audio-name"><Music2 size={13} /> Sin música — añádela desde el panel Audio</span>
      </div>
    );
  }

  return (
    <div className="timeline-track timeline-track--music" style={{ width }}>
      <div
        className="timeline-music-clip"
        style={{
          left: music.startTime * pixelsPerSecond,
          width: Math.max(14, (music.endTime - music.startTime) * pixelsPerSecond)
        }}
      >
        <div ref={containerRef} className="timeline-audio-wave" />
        <span className="timeline-audio-name" data-i18n-skip=""><Music2 size={12} /> {music.name}</span>
      </div>
      {music.duckingEnabled && music.duckingRegions.map((region) => (
        <div
          key={region.id}
          className="timeline-ducking-region"
          style={{ left: region.startTime * pixelsPerSecond, width: Math.max(2, (region.endTime - region.startTime) * pixelsPerSecond) }}
          title="Tramo de voz — la música baja de volumen aquí"
        >
          <button type="button" onClick={() => removeDuckingRegion(region.id)} aria-label="Quitar este tramo de voz"><X size={10} /></button>
        </div>
      ))}
    </div>
  );
}
