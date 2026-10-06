import { NextResponse } from 'next/server';
import { updateStoryboardMap } from '../../../../../lib/storyboards';

export const runtime = 'nodejs';

// Guarda la disposición del mapa de nodos: posiciones, conexiones y notas.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const raw = JSON.stringify(body.mapState ?? null);
  if (!body.mapState || typeof body.mapState !== 'object' || raw.length > 2_000_000) {
    return NextResponse.json({ error: 'Mapa no válido.' }, { status: 400 });
  }
  if (!await updateStoryboardMap(id, body.mapState)) return NextResponse.json({ error: 'Storyboard no encontrado.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
