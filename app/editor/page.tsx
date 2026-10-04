'use client';

import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import './editor.css';

function EditorFrame() {
  const params = useSearchParams();
  const storyboardId = params.get('storyboardId') || '';
  // window.location solo existe en el cliente; durante el SSR el iframe todavía no se pinta.
  const [editorUrl, setEditorUrl] = useState('');
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_TIMELINE_URL || 'http://localhost:5173';
    const url = new URL(base);
    url.searchParams.set('local', '1');
    url.searchParams.set('apiBase', window.location.origin);
    if (storyboardId) url.searchParams.set('storyboardId', storyboardId);
    setEditorUrl(url.toString());
  }, [storyboardId]);

  if (!editorUrl) return <main className="editor-shell"><div className="editor-shell__loading">Preparando el editor…</div></main>;
  return <main className="editor-shell"><header className="editor-shell__bar"><a href="/" className="editor-shell__back"><ArrowLeft size={16} /> Volver a RacingMonos</a><div><b>RacingMonos Timeline</b><span>Editor local · imágenes, subtítulos y voz</span></div><a href={editorUrl} target="_blank" rel="noreferrer" className="editor-shell__open">Abrir en otra pestaña <ExternalLink size={14} /></a></header><iframe className="editor-shell__frame" src={editorUrl} title="Editor de vídeo RacingMonos" allow="autoplay; fullscreen" /></main>;
}

export default function EditorPage() {
  return <Suspense fallback={<main className="editor-shell"><div className="editor-shell__loading">Preparando el editor…</div></main>}><EditorFrame /></Suspense>;
}
