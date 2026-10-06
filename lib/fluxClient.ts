import { fluxFetch } from './fluxFetch';

// Cliente del servidor FLUX local (local_flux/server.py).

export type Ratio = '9:16' | '16:9';

export const FLUX_BASE = (process.env.LOCAL_FLUX_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');

// FLUX tarda 1-2 minutos en cargar el modelo en la GPU: si se pulsa Generar
// justo después de arrancar, se espera en vez de fallar con "fetch failed".
export async function waitForLocalFlux(onWaiting?: () => Promise<void> | void) {
  const deadline = Date.now() + 6 * 60_000;
  let notified = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${FLUX_BASE}/health`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return;
    } catch { /* todavía no responde */ }
    if (!notified) { notified = true; await onWaiting?.(); }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`El generador de imágenes FLUX no responde en ${FLUX_BASE}. Arranca la app con start-local.ps1 o npm run dev (que lo inician) y espera a que cargue el modelo.`);
}

export async function generateLocally(prompt: string, aspectRatio: Ratio, seed: number, files: File[]) {
  const base = FLUX_BASE;
  const payload = new FormData();
  const size = sizeFor(aspectRatio);
  payload.append('prompt', prompt);
  payload.append('width', String(size.width));
  payload.append('height', String(size.height));
  payload.append('seed', String(seed));
  // Solo se usan las referencias de la biblioteca (editable desde la web), no las fijas del servidor.
  payload.append('use_defaults', '0');
  for (const file of files) payload.append('references', new Blob([await file.arrayBuffer()], { type: file.type }), file.name);
  const response = await fluxFetch(`${base.replace(/\/$/, '')}/generate`, { method: 'POST', body: payload, signal: AbortSignal.timeout(10 * 60_000) });
  if (!response.ok) throw new Error(`El generador local respondió ${response.status}. Arranca local_flux/server.py.`);
  const data: any = await response.json();
  return data.dataUrl || data.url || '';
}

export function sizeFor(ratio: Ratio) {
  return ratio === '9:16' ? { width: 768, height: 1344 } : { width: 1344, height: 768 };
}

