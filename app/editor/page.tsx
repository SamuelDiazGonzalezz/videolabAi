'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import './editor.css';

// El editor (timeline-studio) se abre a pantalla completa, sin marco ni barra
// propia: tiene su propio botón para volver a Video Lab Ai.
function EditorRedirect() {
  const params = useSearchParams();
  const storyboardId = params.get('storyboardId') || '';
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_TIMELINE_URL || 'http://localhost:5173';
    const url = new URL(base);
    url.searchParams.set('local', '1');
    url.searchParams.set('apiBase', window.location.origin);
    if (storyboardId) url.searchParams.set('storyboardId', storyboardId);
    window.location.replace(url.toString());
  }, [storyboardId]);
  return <main className="editor-shell"><div className="editor-shell__loading">Abriendo el editor…</div></main>;
}

export default function EditorPage() {
  return <Suspense fallback={<main className="editor-shell"><div className="editor-shell__loading">Abriendo el editor…</div></main>}><EditorRedirect /></Suspense>;
}
