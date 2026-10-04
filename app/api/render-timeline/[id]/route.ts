import { NextResponse } from 'next/server';
import { cancelRenderJob, getRenderJob } from '../../../../lib/timelineRender';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getRenderJob(id);
  if (!job) return NextResponse.json({ error: 'Exportación no encontrada.' }, { status: 404 });
  return NextResponse.json(job, { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!cancelRenderJob(id)) return NextResponse.json({ error: 'Exportación no encontrada.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
