import { NextResponse } from 'next/server';
import { readReference, removeReference } from '../../../../lib/references';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reference = await readReference(id);
  if (!reference) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(new Uint8Array(reference.bytes), { headers: { 'Content-Type': reference.type, 'Cache-Control': 'public, max-age=31536000, immutable' } });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!await removeReference(id)) return NextResponse.json({ error: 'Referencia no encontrada.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
