import { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Volume2, VolumeX } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { useTimelineRangeDrag } from './useTimelineRangeDrag';
import { resolveStoredMediaProxyUrl } from '../../api/projects';
import { createWaveformErrorFallback } from '../../utils/r2Fallback';

interface AudioTrackViewProps {
  externalAudioUrl?: string;
}

export function AudioTrackView({ externalAudioUrl = '' }: AudioTrackViewProps) {
  const timeline = useTimelineStore((state) => state.timeline);
  const currentTime = useTimelineStore((state) => state.currentTime);
  const pixelsPerSecond = useTimelineStore((state) => state.pixelsPerSecond);
  const rangeSelection = useTimelineStore((state) => state.rangeSelection);
  const containerRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<WaveSurfer | null>(null);
  const audio = timeline?.audioTrack;
  const source = audio?.mode === 'replace' ? externalAudioUrl : audio?.sourceUrl;
  const rangeDrag = useTimelineRangeDrag(pixelsPerSecond);

  useEffect(() => {
    if (!containerRef.current || !source) return;
    const wave = WaveSurfer.create({
      container: containerRef.current,
      height: 42,
      waveColor: '#33466f',
      progressColor: '#4d8ff7',
      cursorWidth: 0,
      interact: false,
      normalize: true,
      url: source
    });
    waveRef.current = wave;
    // Si la URL firmada de R2 falla al pedirse por `fetch` (caducada o
    // bloqueada por CORS), WaveSurfer no puede decodificar la forma de
    // onda y antes se quedaba en blanco sin ningún aviso — reintenta una
    // vez a través del proxy propio del servidor.
    wave.on('error', createWaveformErrorFallback(wave, source, resolveStoredMediaProxyUrl));
    return () => {
      wave.destroy();
      waveRef.current = null;
    };
  }, [source]);

  useEffect(() => {
    if (waveRef.current && waveRef.current.getDuration() > 0 && timeline?.duration) {
      waveRef.current.seekTo(Math.min(1, currentTime / timeline.duration));
    }
  }, [currentTime, timeline?.duration]);

  if (!timeline || !audio) return null;
  const width = timeline.duration * pixelsPerSecond;
  const muted = audio.mode === 'mute' || (audio.mode === 'replace' && !externalAudioUrl);
  const showRange = Boolean(rangeSelection?.tracks.includes('audio'));

  return (
    <div
      className={`timeline-track timeline-track--audio${muted ? ' is-muted' : ''}${showRange ? ' is-range-selected' : ''}`}
      style={{ width }}
      onPointerDown={rangeDrag.handlePointerDown}
      onPointerMove={rangeDrag.handlePointerMove}
      onPointerUp={rangeDrag.handlePointerUp}
      onPointerCancel={rangeDrag.handlePointerCancel}
    >
      <div ref={containerRef} className="timeline-audio-wave" />
      <span className="timeline-audio-name">
        {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        {audio.mode === 'replace'
          ? (audio.externalName ? <span data-i18n-skip="">{audio.externalName}</span> : 'Selecciona un audio')
          : audio.mode === 'mute' ? 'Audio silenciado' : 'Audio original'}
      </span>
      {showRange && rangeSelection && (
        <div
          className="timeline-range-overlay"
          style={{
            left: rangeSelection.startTime * pixelsPerSecond,
            width: Math.max(2, (rangeSelection.endTime - rangeSelection.startTime) * pixelsPerSecond)
          }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
