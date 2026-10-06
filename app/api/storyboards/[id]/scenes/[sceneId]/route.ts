import { fluxFetch } from '../../../../../../lib/fluxFetch';
import { NextResponse } from 'next/server';
import { readSceneImage, saveSceneEdit, undoSceneEdit } from '../../../../../../lib/storyboards';
import { generateLocally, waitForLocalFlux } from '../../../../../../lib/fluxClient';
import { getStyle, MONOS_STYLE_ID, referenceFilesForGeneration } from '../../../../../../lib/references';
import { promptFromDescription } from '../../../../../../lib/scenePrompts';

export const runtime = 'nodejs';
export const maxDuration = 600;

const FLUX_BASE = (process.env.LOCAL_FLUX_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');

// POST { instruction } edita la escena con FLUX (la imagen actual es la
// referencia); POST { action: 'undo' } vuelve a la versión anterior.
export async function POST(request: Request, { params }: { params: Promise<{ id: string; sceneId: string }> }) {
  const { id, sceneId: rawSceneId } = await params;
  const sceneId = Number(rawSceneId);
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === 'undo') return NextResponse.json({ image: await undoSceneEdit(id, sceneId) });
    // Regenerar desde el mapa de nodos con la descripción (prompt) editada.
    if (body.action === 'regenerate') {
      const description = String(body.description || '').trim().slice(0, 1500);
      if (!description) return NextResponse.json({ error: 'El prompt está vacío.' }, { status: 400 });
      const current = await readSceneImage(id, sceneId);
      if (!current) return NextResponse.json({ error: 'No se encontró la escena.' }, { status: 404 });
      const style = await getStyle(current.record.style) || await getStyle(MONOS_STYLE_ID);
      if (!style) return NextResponse.json({ error: 'El estilo del storyboard ya no existe.' }, { status: 400 });
      await waitForLocalFlux();
      const prompt = promptFromDescription(style, description, current.record.plan || null);
      const files = await referenceFilesForGeneration(style.id);
      const source = await generateLocally(prompt, current.record.aspectRatio, Math.floor(Math.random() * 2_000_000_000), files);
      if (!source) return NextResponse.json({ error: 'El modelo no devolvió una imagen.' }, { status: 502 });
      const image = await saveSceneEdit(id, sceneId, source, { instruction: 'Regenerada con un prompt nuevo', applied: description }, { description, prompt });
      return NextResponse.json({ image });
    }
    const instruction = String(body.instruction || '').trim().slice(0, 600);
    if (!instruction) return NextResponse.json({ error: 'Escribe qué quieres cambiar en la imagen.' }, { status: 400 });
    const current = await readSceneImage(id, sceneId);
    if (!current) return NextResponse.json({ error: 'No se encontró la escena.' }, { status: 404 });
    const plan = current.record.plan?.scenes?.[sceneId - 1];
    const form = new FormData();
    form.append('instruction', instruction);
    form.append('context', plan || current.scene.caption || '');
    form.append('seed', String(Math.floor(Math.random() * 2_000_000_000)));
    form.append('image', new Blob([new Uint8Array(current.bytes)], { type: 'image/png' }), current.scene.filename);
    const response = await fluxFetch(`${FLUX_BASE}/edit`, { method: 'POST', body: form, signal: AbortSignal.timeout(10 * 60_000) }).catch(() => null);
    if (!response) return NextResponse.json({ error: 'El modelo local no responde. Arranca la app con npm run dev y espera a que cargue.' }, { status: 503 });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.dataUrl) return NextResponse.json({ error: data.detail || 'El modelo no pudo editar la imagen.' }, { status: 502 });
    const image = await saveSceneEdit(id, sceneId, data.dataUrl, { instruction, applied: String(data.instruction || '') });
    return NextResponse.json({ image });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo editar la escena.' }, { status: 400 });
  }
}
