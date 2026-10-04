import { NextResponse } from 'next/server';
import { createStoryboard, listStoryboards } from '../../../lib/storyboards';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ storyboards: await listStoryboards() }, {
    headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const script = String(body.script || '').trim();
  if (!script) return NextResponse.json({ error: 'El guion es obligatorio.' }, { status: 400 });
  const aspectRatio = body.aspectRatio === '16:9' ? '16:9' : '9:16';
  const intervalSeconds = Math.min(10, Math.max(2, Number(body.intervalSeconds || 4)));
  const record = await createStoryboard({ script, aspectRatio, intervalSeconds, style: 'monos' });
  return NextResponse.json(record, { status: 201, headers: { 'Access-Control-Allow-Origin': '*' } });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
