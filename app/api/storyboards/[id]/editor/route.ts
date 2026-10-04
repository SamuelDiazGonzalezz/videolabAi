import { NextResponse } from 'next/server';
import { updateStoryboardEditor } from '../../../../../lib/storyboards';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (!body.editorState || typeof body.editorState !== 'object') {
    return NextResponse.json({ error: 'Falta el estado del editor.' }, { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });
  }
  const record = await updateStoryboardEditor(id, body.editorState, String(body.title || ''));
  if (!record) return NextResponse.json({ error: 'Storyboard no encontrado.' }, { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
  return NextResponse.json(record, { headers: { 'Access-Control-Allow-Origin': '*' } });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
