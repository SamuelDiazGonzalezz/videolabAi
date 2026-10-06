import { fluxFetch } from '../../../../lib/fluxFetch';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 600;

const FLUX_BASE = (process.env.LOCAL_FLUX_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');

// Retransmite al navegador, trozo a trozo, el guion que va escribiendo Qwen3
// en el servidor local (el mismo modelo que hace de director de escenas).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const idea = String(body.idea || '').trim().slice(0, 4000);
  if (!idea) return NextResponse.json({ error: 'Escribe una idea o un texto de partida.' }, { status: 400 });
  try {
    const health = await fetch(`${FLUX_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok) throw new Error();
  } catch {
    return NextResponse.json({ error: 'El modelo local no está arrancado o todavía está cargando. Inicia la app con npm run dev y espera 1-2 minutos.' }, { status: 503 });
  }
  const upstream = await fluxFetch(`${FLUX_BASE}/write-script`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idea, seconds: Number(body.seconds) || 60, tone: String(body.tone || 'narrativo') }),
    signal: request.signal,
  }).catch(() => null);
  if (!upstream?.ok || !upstream.body) {
    return NextResponse.json({ error: 'El modelo local no pudo escribir el guion.' }, { status: 502 });
  }
  return new Response(upstream.body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' },
  });
}
