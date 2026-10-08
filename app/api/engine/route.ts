import { NextResponse } from 'next/server';
import { FLUX_BASE } from '../../../lib/fluxClient';

export const runtime = 'nodejs';

// Estado del servidor de imágenes local, para mostrar el modelo cargado.
export async function GET() {
  try {
    const response = await fetch(`${FLUX_BASE}/health`, { signal: AbortSignal.timeout(2500), cache: 'no-store' });
    const health = await response.json();
    return NextResponse.json({ online: Boolean(health.ok), model: String(health.model || ''), fp8: Boolean(health.fp8) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ online: false, model: '', fp8: false }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
