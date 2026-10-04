import { NextResponse } from 'next/server';
import { startRenderJob, type LocalRenderPayload } from '../../../lib/timelineRender';
import { getStoryboard } from '../../../lib/storyboards';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null) as LocalRenderPayload | null;
  if (!payload || typeof payload !== 'object') return NextResponse.json({ error: 'Datos de exportación no válidos.' }, { status: 400 });
  if (!await getStoryboard(String(payload.storyboardId || ''))) return NextResponse.json({ error: 'Storyboard no encontrado.' }, { status: 404 });
  if (!Number.isFinite(payload.duration) || payload.duration <= 0) return NextResponse.json({ error: 'El timeline está vacío.' }, { status: 400 });
  for (const key of ['videoClips', 'broll', 'overlays', 'subtitles'] as const) {
    if (!Array.isArray(payload[key])) payload[key] = [];
  }
  return NextResponse.json(startRenderJob(payload), { status: 202 });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
