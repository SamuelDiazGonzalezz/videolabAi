import { NextResponse } from 'next/server';
import { deleteScript } from '../../../../lib/scripts';

export const runtime = 'nodejs';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!await deleteScript(id)) return NextResponse.json({ error: 'Guion no encontrado.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
