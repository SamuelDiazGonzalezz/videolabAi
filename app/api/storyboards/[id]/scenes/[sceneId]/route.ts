import { fluxFetch } from '../../../../../../lib/fluxFetch';
import { NextResponse } from 'next/server';
import { readSceneImage, saveSceneEdit, undoSceneEdit } from '../../../../../../lib/storyboards';
import { generateLocally, waitForLocalFlux } from '../../../../../../lib/fluxClient';
import { getStyle, MONOS_STYLE_ID, referenceFilesForGeneration } from '../../../../../../lib/references';
import { promptFromDescription } from '../../../../../../lib/scenePrompts';
import { artTypeById } from '../../../../../../lib/artTypes';

export const runtime = 'nodejs';
export const maxDuration = 600;

const FLUX_BASE = (process.env.LOCAL_FLUX_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');

// POST { instruction } arregla la escena: el director decide entre retocar la
// imagen actual o redibujarla corregida; POST { action: 'undo' } vuelve a la
// versión anterior; POST { action: 'regenerate', description } la rehace con otro prompt.
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
      const files = await referenceFilesForGeneration(style.id);
      const prompt = promptFromDescription(style, description, current.record.plan || null, files.length > 0, style.kind === 'monos' ? '' : artTypeById(current.record.artType).prompt);
      const source = await generateLocally(prompt, current.record.aspectRatio, Math.floor(Math.random() * 2_000_000_000), files, { whiteBackground: style.kind === 'white' });
      if (!source) return NextResponse.json({ error: 'El modelo no devolvió una imagen.' }, { status: 502 });
      const image = await saveSceneEdit(id, sceneId, source, { instruction: 'Regenerada con un prompt nuevo', applied: description }, { description, prompt });
      return NextResponse.json({ image });
    }
    const instruction = String(body.instruction || '').trim().slice(0, 600);
    if (!instruction) return NextResponse.json({ error: 'Escribe qué quieres cambiar en la imagen.' }, { status: 400 });
    const current = await readSceneImage(id, sceneId);
    if (!current) return NextResponse.json({ error: 'No se encontró la escena.' }, { status: 404 });
    // Si FLUX se está reiniciando, se espera un poco antes de dar error.
    try { await waitForLocalFlux(undefined, 2 * 60_000); } catch {
      return NextResponse.json({ error: 'El generador de imágenes (FLUX) no está en marcha. Arranca la app con npm run dev y espera a que cargue el modelo.' }, { status: 503 });
    }
    const description = current.scene.description || current.record.plan?.scenes?.[sceneId - 1] || current.scene.caption || '';
    // 1) El director interpreta la petición (un problema descrito o una orden)
    //    y decide: retoque local sobre la imagen o redibujar la escena corregida.
    const fixResponse = await fluxFetch(`${FLUX_BASE}/edit-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: instruction, description }),
      signal: AbortSignal.timeout(5 * 60_000),
    }).catch(() => null);
    const fix = fixResponse?.ok ? await fixResponse.json().catch(() => null) as { problem?: string; mode?: string; instruction?: string; description?: string } | null : null;

    // 2a) Cambios de estructura (posición, anatomía, personajes fundidos…):
    //     editar apenas los corrige, así que se redibuja con la descripción corregida.
    if (fix?.mode === 'regenerate' && fix.description) {
      const style = await getStyle(current.record.style) || await getStyle(MONOS_STYLE_ID);
      if (!style) return NextResponse.json({ error: 'El estilo del storyboard ya no existe.' }, { status: 400 });
      const files = await referenceFilesForGeneration(style.id);
      const prompt = promptFromDescription(style, fix.description, current.record.plan || null, files.length > 0, style.kind === 'monos' ? '' : artTypeById(current.record.artType).prompt);
      const source = await generateLocally(prompt, current.record.aspectRatio, Math.floor(Math.random() * 2_000_000_000), files, { whiteBackground: style.kind === 'white' });
      if (!source) return NextResponse.json({ error: 'El modelo no devolvió una imagen.' }, { status: 502 });
      const image = await saveSceneEdit(id, sceneId, source, { instruction, applied: `Redibujada: ${fix.problem || fix.description}` }, { description: fix.description, prompt });
      return NextResponse.json({ image, mode: 'regenerate', problem: fix.problem || '' });
    }

    // 2b) Retoque local: la imagen actual es la referencia y se mantiene el resto.
    const form = new FormData();
    form.append('instruction', fix?.instruction || instruction);
    form.append('planned', fix?.instruction ? '1' : '0');
    form.append('context', description);
    form.append('seed', String(Math.floor(Math.random() * 2_000_000_000)));
    const editStyle = await getStyle(current.record.style);
    if (editStyle?.kind === 'white') form.append('white_background', '1');
    form.append('image', new Blob([new Uint8Array(current.bytes)], { type: 'image/png' }), current.scene.filename);
    const response = await fluxFetch(`${FLUX_BASE}/edit`, { method: 'POST', body: form, signal: AbortSignal.timeout(10 * 60_000) }).catch(() => null);
    if (!response) return NextResponse.json({ error: 'El modelo local no responde. Arranca la app con npm run dev y espera a que cargue.' }, { status: 503 });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.dataUrl) return NextResponse.json({ error: data.detail || 'El modelo no pudo editar la imagen.' }, { status: 502 });
    const image = await saveSceneEdit(id, sceneId, data.dataUrl, { instruction, applied: String(data.instruction || '') });
    return NextResponse.json({ image, mode: 'edit', problem: fix?.problem || '' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo editar la escena.' }, { status: 400 });
  }
}
