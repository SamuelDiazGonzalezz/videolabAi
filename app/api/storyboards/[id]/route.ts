import { NextResponse } from 'next/server';
import { deleteStoryboard, getStoryboard } from '../../../../lib/storyboards';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await getStoryboard(id);
  if (!record) return NextResponse.json({ error: 'Storyboard no encontrado.' }, { status: 404 });
  return NextResponse.json(record, { headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!await deleteStoryboard(id)) return NextResponse.json({ error: 'Storyboard no encontrado.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
