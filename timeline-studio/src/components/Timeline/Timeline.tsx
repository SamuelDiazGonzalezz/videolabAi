import { useEffect, useRef } from 'react';
import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  EyeOff,
  Pause,
  Play,
  Scissors,
  Trash2,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { t, useUiLocale } from '../../i18n';
import { formatTimecode } from '../../utils/timeline';
import { Ruler } from './Ruler';
import { VideoTrackView } from './VideoTrackView';
import { AudioTrackView } from './AudioTrackView';
import { MusicTrackView } from './MusicTrackView';
import { TextTrackView } from './TextTrackView';
import { BrollTrackView } from './BrollTrackView';
import { Playhead } from './Playhead';
import { TimelineAreaSelector } from './TimelineAreaSelector';
import './Timeline.css';

interface TimelineProps {
  clipboardCount: number;
  clipboardActionsDisabled?: boolean;
  externalAudioUrl?: string;
  onCopySelection: () => number;
  onPasteClipboard: () => number;
  onDuplicateSelection: () => number;
  onHide?: () => void;
  selectedTransitionClipId?: string | null;
  onEditTransition?: (clipId: string) => void;
}

export function Timeline({
  clipboardCount,
  clipboardActionsDisabled = false,
  externalAudioUrl = '',
  onCopySelection,
  onPasteClipboard,
  onDuplicateSelection,
  onHide,
  selectedTransitionClipId,
  onEditTransition
}: TimelineProps) {
  const locale = useUiLocale();
  const timeline = useTimelineStore((state) => state.timeline);
  const currentTime = useTimelineStore((state) => state.currentTime);
  const isPlaying = useTimelineStore((state) => state.isPlaying);
  const pixelsPerSecond = useTimelineStore((state) => state.pixelsPerSecond);
  const selection = useTimelineStore((state) => state.selection);
  const rangeSelection = useTimelineStore((state) => state.rangeSelection);
  const togglePlaying = useTimelineStore((state) => state.togglePlaying);
  const setZoom = useTimelineStore((state) => state.setZoom);
  const zoomBy = useTimelineStore((state) => state.zoomBy);
  const splitVideoClipAtPlayhead = useTimelineStore((state) => state.splitVideoClipAtPlayhead);
  const removeSelection = useTimelineStore((state) => state.removeSelection);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pasteLabel = clipboardCount > 0
    ? locale === 'en'
      ? `Paste ${clipboardCount} item${clipboardCount === 1 ? '' : 's'}`
      : `Pegar ${clipboardCount} elemento${clipboardCount === 1 ? '' : 's'}`
    : t('Pegar');

  useEffect(() => {
    if (!isPlaying || !scrollRef.current) return;
    const playhead = currentTime * pixelsPerSecond;
    const viewStart = scrollRef.current.scrollLeft;
    const viewEnd = viewStart + scrollRef.current.clientWidth;
    if (playhead > viewEnd - 90) scrollRef.current.scrollLeft = playhead - scrollRef.current.clientWidth * 0.35;
  }, [currentTime, isPlaying, pixelsPerSecond]);

  if (!timeline) return <div id="timeline-editor-timeline" className="timeline timeline--empty">Preparando la línea de tiempo…</div>;

  return (
    <section id="timeline-editor-timeline" className="timeline" aria-label="Línea de tiempo">
      <div className="timeline__toolbar">
        <button type="button" onClick={onHide} title="Ocultar línea de tiempo"><EyeOff size={15} /><span>Ocultar línea de tiempo</span></button>
        <span className="timeline__separator" />
        <button type="button" className="timeline__play" onClick={togglePlaying} title={isPlaying ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'}>
          {isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
        <span className="timeline__timecode">{formatTimecode(currentTime)} <small>/ {formatTimecode(timeline.duration)}</small></span>
        <span className="timeline__separator" />
        <button type="button" onClick={splitVideoClipAtPlayhead} title="Dividir en el cabezal (S)">
          <Scissors size={15} /> <span>Dividir</span>
        </button>
        <button type="button" onClick={removeSelection} disabled={!selection && !rangeSelection} title="Eliminar selección (Supr)">
          <Trash2 size={15} /> <span>Eliminar</span>
        </button>
        <span className="timeline__separator" />
        <div className="timeline__clipboard-actions" role="group" aria-label={t('Acciones de selección')}>
          <button
            type="button"
            onClick={() => onCopySelection()}
            disabled={clipboardActionsDisabled || (!selection && !rangeSelection)}
            title={t('Copiar selección (Ctrl/Cmd+C)')}
            aria-label={t('Copiar selección')}
            aria-keyshortcuts="Control+C Meta+C"
          >
            <Copy size={15} /> <span>{t('Copiar')}</span>
          </button>
          <button
            type="button"
            onClick={() => onPasteClipboard()}
            disabled={clipboardActionsDisabled || clipboardCount < 1}
            title={`${pasteLabel} (Ctrl/Cmd+V)`}
            aria-label={pasteLabel}
            aria-keyshortcuts="Control+V Meta+V"
          >
            <ClipboardPaste size={15} /> <span>{t('Pegar')}</span>
          </button>
          <button
            type="button"
            onClick={() => onDuplicateSelection()}
            disabled={clipboardActionsDisabled || (!selection && !rangeSelection)}
            title={t('Duplicar selección (Ctrl/Cmd+D)')}
            aria-label={t('Duplicar selección')}
            aria-keyshortcuts="Control+D Meta+D"
          >
            <CopyPlus size={15} /> <span>{t('Duplicar')}</span>
          </button>
        </div>
        <div className="timeline__zoom">
          <button type="button" onClick={() => zoomBy(0.8)} title="Alejar" aria-label="Alejar"><ZoomOut size={15} /></button>
          <input
            type="range"
            min="24"
            max="260"
            value={pixelsPerSecond}
            onChange={(event) => setZoom(Number(event.target.value))}
            aria-label="Zoom de la línea de tiempo"
          />
          <button type="button" onClick={() => zoomBy(1.25)} title="Acercar" aria-label="Acercar"><ZoomIn size={15} /></button>
          <span>{Math.round(pixelsPerSecond)} px/s</span>
        </div>
      </div>

      <div className="timeline__scroll" ref={scrollRef}>
        <div className="timeline__tracks">
          <Ruler />
          <div className="timeline__track-row">
            <VideoTrackView
              selectedTransitionClipId={selectedTransitionClipId}
              onEditTransition={onEditTransition}
            />
          </div>
          <div className="timeline__track-row">
            <BrollTrackView />
          </div>
          <div className="timeline__track-row">
            <AudioTrackView externalAudioUrl={externalAudioUrl} />
          </div>
          <div className="timeline__track-row">
            <MusicTrackView />
          </div>
          <div className="timeline__track-row">
            <TextTrackView />
          </div>
          <Playhead />
          <TimelineAreaSelector active pixelsPerSecond={pixelsPerSecond} />
        </div>
      </div>
    </section>
  );
}
