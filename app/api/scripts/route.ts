import { NextResponse } from 'next/server';
import { listScripts, saveScript } from '../../../lib/scripts';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ scripts: await listScripts() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  try {
    const script = await saveScript({
      title: String(body.title || ''),
      idea: String(body.idea || ''),
      body: String(body.body || ''),
      seconds: Number(body.seconds) || 0,
      tone: String(body.tone || ''),
    });
    return NextResponse.json({ script });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo guardar el guion.' }, { status: 400 });
  }
}
