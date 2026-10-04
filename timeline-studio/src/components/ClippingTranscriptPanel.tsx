import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Search, X } from 'lucide-react';
import { useTimelineStore } from '../store/timelineStore';
import { formatTimecode } from '../utils/timeline';
import './ClippingTranscriptPanel.css';

export interface ClippingTranscriptToken {
  text: string;
  startTime: number;
  endTime: number;
  speaker?: string;
}

export interface ClippingTranscriptCue {
  text: string;
  startTime: number;
  endTime: number;
}

interface TranscriptSegment {
  id: string;
  startTime: number;
  endTime: number;
  speaker?: string;
  tokens: ClippingTranscriptToken[];
}

interface ClippingTranscriptPanelProps {
  transcriptWords: ClippingTranscriptToken[];
  subtitleCues: ClippingTranscriptCue[];
  plainTranscript?: string;
  isLoadingTranscript?: boolean;
}

const MAX_WORDS_PER_SEGMENT = 18;
const MAX_SEGMENT_CHARACTERS = 118;

function cleanTokenText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function joinsWithoutLeadingSpace(value: string): boolean {
  return /^[,.;:!?…%)}\]\u00bb]/.test(value);
}

function tokenPrefix(tokens: ClippingTranscriptToken[], index: number): string {
  if (index === 0 || joinsWithoutLeadingSpace(tokens[index].text)) return '';
  return ' ';
}

function segmentText(segment: TranscriptSegment): string {
  return segment.tokens.reduce((text, token, index) => `${text}${tokenPrefix(segment.tokens, index)}${token.text}`, '');
}

function validToken(token: ClippingTranscriptToken): boolean {
  return Boolean(cleanTokenText(token.text))
    && Number.isFinite(token.startTime)
    && Number.isFinite(token.endTime)
    && token.endTime > token.startTime;
}

function transcriptSegmentsFromWords(words: ClippingTranscriptToken[]): TranscriptSegment[] {
  const sortedWords = words
    .map((word) => ({ ...word, text: cleanTokenText(word.text) }))
    .filter(validToken)
    .sort((left, right) => left.startTime - right.startTime)
    .slice(0, 1_500);
  const segments: TranscriptSegment[] = [];
  let current: ClippingTranscriptToken[] = [];

  const pushCurrent = () => {
    if (!current.length) return;
    segments.push({
      id: `word-segment-${segments.length + 1}`,
      startTime: current[0].startTime,
      endTime: current[current.length - 1].endTime,
      speaker: current[0].speaker,
      tokens: current
    });
    current = [];
  };

  for (const word of sortedWords) {
    const previous = current[current.length - 1];
    const currentCharacters = current.reduce((total, item, index) => total + item.text.length + (index ? 1 : 0), 0);
    // Un cambio de hablante siempre abre un fragmento nuevo, aunque no haya
    // pausa ni se alcance el límite de palabras: un fragmento nunca mezcla a
    // dos personas distintas.
    const needsNewSegment = Boolean(previous) && (
      word.startTime - previous.endTime > .8
      || current.length >= MAX_WORDS_PER_SEGMENT
      || currentCharacters + word.text.length + 1 > MAX_SEGMENT_CHARACTERS
      || word.speaker !== previous.speaker
    );
    if (needsNewSegment) pushCurrent();
    current.push(word);
    if (/[.!?…]$/.test(word.text) && current.length >= 5) pushCurrent();
  }
  pushCurrent();
  return segments;
}

function transcriptSegmentsFromCues(cues: ClippingTranscriptCue[]): TranscriptSegment[] {
  return cues
    .map((cue) => ({ ...cue, text: cleanTokenText(cue.text) }))
    .filter((cue) => Boolean(cue.text) && Number.isFinite(cue.startTime) && Number.isFinite(cue.endTime) && cue.endTime > cue.startTime)
    .sort((left, right) => left.startTime - right.startTime)
    .slice(0, 500)
    .map((cue, index) => ({
      id: `cue-segment-${index + 1}`,
      startTime: cue.startTime,
      endTime: cue.endTime,
      tokens: [{ text: cue.text, startTime: cue.startTime, endTime: cue.endTime }]
    }));
}

function transcriptSegmentsFromPlainText(value: string): TranscriptSegment[] {
  const text = cleanTokenText(value);
  return text ? [{
    id: 'plain-transcript',
    startTime: 0,
    endTime: 12 * 60 * 60,
    tokens: [{ text, startTime: 0, endTime: 12 * 60 * 60 }]
  }] : [];
}

function isActiveAt(time: number, startTime: number, endTime: number): boolean {
  return time >= startTime && time < endTime;
}

export function ClippingTranscriptPanel({
  transcriptWords,
  subtitleCues,
  plainTranscript = '',
  isLoadingTranscript = false
}: ClippingTranscriptPanelProps) {
  const currentTime = useTimelineStore((state) => state.currentTime);
  const setCurrentTime = useTimelineStore((state) => state.setCurrentTime);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const segmentNodes = useRef(new Map<string, HTMLButtonElement>());
  const lastScrolledSegmentId = useRef('');

  const segments = useMemo(
    () => transcriptWords.length
      ? transcriptSegmentsFromWords(transcriptWords)
      : subtitleCues.length
        ? transcriptSegmentsFromCues(subtitleCues)
        : transcriptSegmentsFromPlainText(plainTranscript),
    [plainTranscript, subtitleCues, transcriptWords]
  );
  // Etiqueta cada identificador de hablante (p. ej. "SPEAKER_00") con un
  // nombre legible en el orden en que aparece por primera vez, en vez de
  // mostrarle al usuario el identificador crudo de la diarización.
  const speakerLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const segment of segments) {
      if (segment.speaker && !labels.has(segment.speaker)) {
        labels.set(segment.speaker, `Hablante ${labels.size + 1}`);
      }
    }
    return labels;
  }, [segments]);
  const hasSynchronizedTimings = Boolean(transcriptWords.length || subtitleCues.length);
  const activeSegmentId = useMemo(
    () => hasSynchronizedTimings
      ? segments.find((segment) => isActiveAt(currentTime, segment.startTime, segment.endTime))?.id || ''
      : '',
    [currentTime, hasSynchronizedTimings, segments]
  );
  const visibleSegments = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(document.documentElement.lang || 'es');
    return normalizedQuery
      ? segments.filter((segment) => segmentText(segment).toLocaleLowerCase(document.documentElement.lang || 'es').includes(normalizedQuery))
      : segments;
  }, [query, segments]);

  useEffect(() => {
    if (!activeSegmentId || activeSegmentId === lastScrolledSegmentId.current) return;
    lastScrolledSegmentId.current = activeSegmentId;
    segmentNodes.current.get(activeSegmentId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeSegmentId]);

  return (
    <aside className="clip-transcript-panel" aria-label="Transcripción del clip">
      <header className="clip-transcript-panel__header">
        <div>
          <span className="clip-transcript-panel__icon"><FileText size={15} /></span>
          <span>
            <strong>Transcripción</strong>
            <small>{isLoadingTranscript ? 'Cargando transcripción…' : segments.length ? hasSynchronizedTimings ? `${segments.length} fragmentos sincronizados` : 'Transcripción del proyecto' : 'Texto del clip'}</small>
          </span>
        </div>
        <button
          type="button"
          className={searchOpen ? 'is-active' : ''}
          onClick={() => setSearchOpen((isOpen) => !isOpen)}
          aria-label={searchOpen ? 'Cerrar búsqueda' : 'Buscar en la transcripción'}
          title={searchOpen ? 'Cerrar búsqueda' : 'Buscar'}
        >
          {searchOpen ? <X size={15} /> : <Search size={15} />}
        </button>
      </header>

      {searchOpen && (
        <label className="clip-transcript-panel__search">
          <Search size={14} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar en el clip"
          />
        </label>
      )}

      <div className="clip-transcript-panel__hint">
        {isLoadingTranscript
          ? 'Recuperando la transcripción del clip…'
          : hasSynchronizedTimings
            ? 'Haz clic en un fragmento para ir a ese momento del vídeo.'
            : plainTranscript
              ? 'Transcripción recuperada del proyecto.'
              : 'La transcripción aparecerá aquí cuando esté disponible.'}
      </div>

      <div className="clip-transcript-panel__content">
        {visibleSegments.length ? visibleSegments.map((segment) => {
          const active = activeSegmentId === segment.id;
          return (
            <button
              key={segment.id}
              ref={(node) => {
                if (node) segmentNodes.current.set(segment.id, node);
                else segmentNodes.current.delete(segment.id);
              }}
              type="button"
              className={`clip-transcript-segment${active ? ' is-active' : ''}`}
              onClick={() => setCurrentTime(segment.startTime)}
              aria-current={active ? 'true' : undefined}
            >
              <time>{formatTimecode(segment.startTime, false)}</time>
              {segment.speaker && speakerLabels.has(segment.speaker) && (
                <strong className="clip-transcript-segment__speaker">{speakerLabels.get(segment.speaker)}</strong>
              )}
              <span className="clip-transcript-segment__text" data-i18n-skip="">
                {segment.tokens.map((token, index) => (
                  <span
                    key={`${segment.id}-${index}`}
                    className={isActiveAt(currentTime, token.startTime, token.endTime) ? 'is-current-word' : undefined}
                  >
                    {tokenPrefix(segment.tokens, index)}{token.text}
                  </span>
                ))}
              </span>
            </button>
          );
        }) : (
          <div className="clip-transcript-panel__empty">
            <strong>{isLoadingTranscript ? 'Cargando transcripción' : query ? 'No hay coincidencias' : 'No hay transcripción disponible'}</strong>
            <p>{isLoadingTranscript ? 'Leyendo el texto guardado con este proyecto.' : query ? 'Prueba con otra palabra.' : 'Cuando el clip tenga transcripción, aparecerá aquí sincronizada con el vídeo.'}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
