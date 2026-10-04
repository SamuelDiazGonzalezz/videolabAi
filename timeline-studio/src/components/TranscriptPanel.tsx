import { useMemo, useState } from 'react';
import { Download, FileText, Filter, Plus, Search, Sparkles } from 'lucide-react';
import { useTimelineStore } from '../store/timelineStore';
import { formatTimecode } from '../utils/timeline';
import { fitTextAnimationDurations } from '../utils/textAnimations';
import './TranscriptPanel.css';

interface TranscriptPanelProps {
  onAddText: () => void;
  onAddSubtitle: () => void;
  onTranscribe?: () => void;
  isTranscribing?: boolean;
  hasTranscript?: boolean;
  onShowTranscript?: () => void;
}

export function TranscriptPanel({ onAddText, onAddSubtitle, onTranscribe, isTranscribing, hasTranscript, onShowTranscript }: TranscriptPanelProps) {
  const timeline = useTimelineStore((state) => state.timeline);
  const currentTime = useTimelineStore((state) => state.currentTime);
  const selection = useTimelineStore((state) => state.selection);
  const setCurrentTime = useTimelineStore((state) => state.setCurrentTime);
  const selectClip = useTimelineStore((state) => state.selectClip);
  const updateTextClip = useTimelineStore((state) => state.updateTextClip);
  const updateAudioTrack = useTimelineStore((state) => state.updateAudioTrack);
  const setVideoClipBounds = useTimelineStore((state) => state.setVideoClipBounds);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [currentOnly, setCurrentOnly] = useState(false);

  const phrases = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(document.documentElement.lang || 'es');
    return [...(timeline?.textTrack.clips || [])]
      .sort((a, b) => a.startTime - b.startTime)
      .filter((clip) => !normalized || clip.text.toLocaleLowerCase(document.documentElement.lang || 'es').includes(normalized))
      .filter((clip) => !currentOnly || (currentTime >= clip.startTime && currentTime <= clip.endTime));
  }, [currentOnly, currentTime, query, timeline?.textTrack.clips]);

  if (!timeline) return <aside className="transcript-panel" />;

  const extendCurrentClip = () => {
    const selectedClip = selection?.kind === 'video'
      ? timeline.videoTrack.clips.find((clip) => clip.id === selection.id)
      : timeline.videoTrack.clips.find((clip) => currentTime >= clip.startTime && currentTime <= clip.endTime);
    if (!selectedClip) return;
    setVideoClipBounds(
      selectedClip.id,
      selectedClip.sourceIn,
      Math.min(selectedClip.sourceDuration, selectedClip.sourceOut + 1)
    );
  };

  const downloadTranscript = () => {
    const content = [...timeline.textTrack.clips]
      .sort((a, b) => a.startTime - b.startTime)
      .map((clip) => `[${formatTimecode(clip.startTime, false)}] ${clip.text}`)
      .join('\n');
    const url = URL.createObjectURL(new Blob([content || 'Sin frases'], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'transcripcion-vidreum.txt';
    link.style.display = 'none';
    document.body.append(link);
    link.click();
    window.setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 30000);
  };

  const selectPhrase = (clip: (typeof timeline.textTrack.clips)[number]) => {
    const entranceMs = clip.kind === 'text' ? fitTextAnimationDurations(clip).entranceMs : 0;
    // Una entrada comienza fuera del lienzo o transparente. Saltar a un
    // punto intermedio deja claro qué frase se ha seleccionado sin dar la
    // impresión de que desapareció del editor.
    setCurrentTime(clip.startTime + entranceMs * .55 / 1000);
    selectClip({ kind: 'text', id: clip.id });
  };

  return (
    <aside className="transcript-panel" aria-label="Transcripción y frases">
      <div className="transcript-panel__topline">
        <button
          type="button"
          className={timeline.audioTrack.cleanup ? 'is-active' : ''}
          onClick={() => updateAudioTrack({ cleanup: !timeline.audioTrack.cleanup })}
        >
          <Sparkles size={14} /> Limpieza de audio
        </button>
        <div>
          <button type="button" onClick={() => setSearchOpen((value) => !value)} title="Buscar" aria-label="Buscar"><Search size={16} /></button>
          <button type="button" className={currentOnly ? 'is-active' : ''} onClick={() => setCurrentOnly((value) => !value)} title="Mostrar frase actual" aria-label="Filtrar"><Filter size={16} /></button>
          <button type="button" onClick={downloadTranscript} title="Descargar transcripción" aria-label="Descargar transcripción"><Download size={16} /></button>
        </div>
      </div>

      {searchOpen && (
        <label className="transcript-panel__search">
          <Search size={14} />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar en las frases" />
        </label>
      )}

      <div className="transcript-panel__actions">
        <button type="button" onClick={extendCurrentClip}>+ Extender un clip</button>
        <button type="button" onClick={onAddText}><Plus size={13} /> Añadir texto</button>
        <button type="button" onClick={onAddSubtitle}><Plus size={13} /> Añadir subtítulo</button>
        {hasTranscript ? (
          <button type="button" onClick={onShowTranscript}><FileText size={13} /> Ver transcripción</button>
        ) : onTranscribe ? (
          <button type="button" onClick={onTranscribe} disabled={isTranscribing}>
            <FileText size={13} /> {isTranscribing ? 'Transcribiendo…' : 'Transcribir vídeo'}
          </button>
        ) : null}
      </div>

      <div className="transcript-panel__copy">
        {phrases.length ? phrases.map((clip) => (
          <article
            key={clip.id}
            className={`transcript-phrase${selection?.kind === 'text' && selection.id === clip.id ? ' is-selected' : ''}`}
            onClick={() => selectPhrase(clip)}
          >
            <textarea
              rows={2}
              maxLength={80}
              value={clip.text}
              aria-label="Contenido de la frase"
              onClick={(event) => {
                event.stopPropagation();
                selectPhrase(clip);
              }}
              onFocus={() => selectPhrase(clip)}
              onChange={(event) => updateTextClip(clip.id, { text: event.target.value })}
            />
            <span>{(clip.endTime - clip.startTime).toFixed(2)}s</span>
          </article>
        )) : (
          <div className="transcript-panel__empty">
            <strong>No hay frases todavía</strong>
            <p>Añade texto para crear subtítulos o rótulos sincronizados.</p>
            <button type="button" onClick={onAddText}><Plus size={14} /> Crear primera frase</button>
          </div>
        )}
      </div>
    </aside>
  );
}
