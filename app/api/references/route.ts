import { NextResponse } from 'next/server';
import {
  addReference,
  createStyle,
  deleteStyle,
  listLibrary,
  MAX_ACTIVE_REFERENCES,
  MONOS_STYLE_ID,
  restoreDefaultReferences,
  updateStyle,
} from '../../../lib/references';

export const runtime = 'nodejs';

async function library(extra: Record<string, unknown> = {}, status = 200) {
  return NextResponse.json({ ...await listLibrary(), maxActive: MAX_ACTIVE_REFERENCES, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET() {
  return library();
}

// multipart con "styleId" y uno o varios "files" para añadir imágenes, o JSON
// con una acción: restore | createStyle | updateStyle | deleteStyle.
export async function POST(request: Request) {
  if ((request.headers.get('content-type') || '').includes('application/json')) {
    const body = await request.json().catch(() => ({}));
    try {
      if (body.action === 'restore') await restoreDefaultReferences();
      else if (body.action === 'createStyle') return library({ created: await createStyle({ name: String(body.name || ''), description: String(body.description || '') }) });
      else if (body.action === 'updateStyle') await updateStyle(String(body.id || ''), { name: body.name, description: body.description });
      else if (body.action === 'deleteStyle') await deleteStyle(String(body.id || ''));
      else return NextResponse.json({ error: 'Acción no válida.' }, { status: 400 });
    } catch (error) {
      return library({ error: error instanceof Error ? error.message : 'No se pudo completar la acción.' }, 400);
    }
    return library();
  }
  const form = await request.formData().catch(() => null);
  const styleId = String(form?.get('styleId') || MONOS_STYLE_ID);
  const files = form?.getAll('files').filter((item): item is File => typeof item !== 'string' && item.size > 0) || [];
  if (!files.length) return NextResponse.json({ error: 'No se recibió ninguna imagen.' }, { status: 400 });
  const errors: string[] = [];
  for (const file of files.slice(0, 20)) {
    try {
      await addReference({ styleId, bytes: Buffer.from(await file.arrayBuffer()), type: file.type, name: file.name });
    } catch (error) {
      errors.push(`${file.name}: ${error instanceof Error ? error.message : 'no se pudo guardar'}`);
    }
  }
  return library({ errors }, errors.length === files.length ? 400 : 200);
}
