import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Biblioteca de estilos y referencias, guardada en data/references. Cada
// estilo tiene sus propias imágenes, que son las que se envían a FLUX al
// generar con él:
//  - "Monos" (integrado): las ilustraciones de public/references/monos y un
//    reparto fijo de pilotos y coches.
//  - "En blanco" (integrado): sin referencias ni reparto; el director (Qwen3)
//    decide estilo y personajes a partir del guion.
//  - Estilos propios creados por el usuario, con sus imágenes y una nota de estilo.
// Los originales de public/ no se tocan, así que Monos siempre se puede restaurar.

export type StyleKind = 'monos' | 'free' | 'white' | 'custom';

export type ReferenceStyle = {
  id: string;
  name: string;
  description: string;
  kind: StyleKind;
  builtin: boolean;
  createdAt: string;
};

export type ReferenceImage = {
  id: string;
  styleId: string;
  filename: string;
  label: string;
  /** Nombre del archivo original: el servidor FLUX lo usa para tapar carteles con texto. */
  sourceName: string;
  createdAt: string;
  url: string;
};

type StoredReference = Omit<ReferenceImage, 'url'>;
type Manifest = { version: 2; styles: ReferenceStyle[]; references: StoredReference[] };

export const MONOS_STYLE_ID = 'monos';
export const BLANK_STYLE_ID = 'blank';
export const WHITE_STYLE_ID = 'white';

const BUILTIN_STYLES: ReferenceStyle[] = [
  {
    id: MONOS_STYLE_ID,
    name: 'Monos',
    description: 'Monos grises, pilotos de carreras y coches rojos con dibujo plano y contorno grueso.',
    kind: 'monos',
    builtin: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: BLANK_STYLE_ID,
    name: 'En blanco',
    description: 'Sin referencias ni personajes fijos: el director elige estilo, personajes y mundo según el guion.',
    kind: 'free',
    builtin: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: WHITE_STYLE_ID,
    name: 'Fondo blanco',
    description: 'Vídeos educativos: objetos y personajes aislados sobre fondo blanco puro, sin paisaje. Admite referencias opcionales para fijar el dibujo.',
    kind: 'white',
    builtin: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

const ROOT = path.join(process.cwd(), 'data', 'references');
const MANIFEST = path.join(ROOT, 'manifest.json');
const SEED_DIR = path.join(process.cwd(), 'public', 'references', 'monos');
const SEED_LABELS: Record<string, string> = {
  'monos-01.png': 'Personaje principal',
  'monos-02.png': 'Carrera y coche',
  'monos-03.png': 'Segundo personaje',
  'monos-04.png': 'Escena de historia',
  'monos-05.png': 'Acción y fondo',
};
const EXTENSIONS: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
export const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;
/** Más referencias no mejoran el estilo y multiplican la memoria de vídeo que usa FLUX. */
export const MAX_ACTIVE_REFERENCES = 8;

const withUrl = (item: StoredReference): ReferenceImage => ({ ...item, url: `/api/references/${item.id}` });

async function writeManifest(manifest: Manifest) {
  await mkdir(ROOT, { recursive: true });
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
}

async function seedFiles(existing: Set<string>) {
  const files = (await readdir(SEED_DIR).catch(() => [] as string[])).filter((name) => /\.(png|jpe?g|webp)$/i.test(name)).sort();
  const added: StoredReference[] = [];
  for (const name of files) {
    if (existing.has(name)) continue;
    const id = randomUUID();
    const filename = `${id}${path.extname(name).toLowerCase()}`;
    await copyFile(path.join(SEED_DIR, name), path.join(ROOT, filename));
    added.push({ id, styleId: MONOS_STYLE_ID, filename, label: SEED_LABELS[name] || name.replace(/\.[^.]+$/, ''), sourceName: name, createdAt: new Date().toISOString() });
  }
  return added;
}

// Los estilos integrados siempre existen, aunque el manifiesto sea antiguo.
function withBuiltins(styles: ReferenceStyle[]) {
  const custom = styles.filter((style) => !BUILTIN_STYLES.some((builtin) => builtin.id === style.id));
  return [...BUILTIN_STYLES, ...custom];
}

async function readManifest(): Promise<Manifest> {
  let raw: { version?: number; styles?: ReferenceStyle[]; references?: Partial<StoredReference>[] } | null = null;
  try {
    raw = JSON.parse(await readFile(MANIFEST, 'utf8'));
  } catch { /* primera vez */ }
  if (raw && Array.isArray(raw.references)) {
    // v1 no tenía estilos: todas sus referencias eran de Monos.
    const references = raw.references.map((reference) => ({ ...reference, styleId: reference.styleId || MONOS_STYLE_ID }) as StoredReference);
    const manifest: Manifest = { version: 2, styles: withBuiltins(Array.isArray(raw.styles) ? raw.styles : []), references };
    if (raw.version !== 2) await writeManifest(manifest);
    return manifest;
  }
  await mkdir(ROOT, { recursive: true });
  const manifest: Manifest = { version: 2, styles: withBuiltins([]), references: await seedFiles(new Set()) };
  await writeManifest(manifest);
  return manifest;
}

export async function listLibrary() {
  const manifest = await readManifest();
  return { styles: manifest.styles, references: manifest.references.map(withUrl) };
}

export async function getStyle(id: string) {
  return (await readManifest()).styles.find((style) => style.id === id) || null;
}

export async function createStyle(input: { name: string; description: string }) {
  const name = input.name.trim().slice(0, 40);
  if (!name) throw new Error('Ponle un nombre al estilo.');
  const manifest = await readManifest();
  if (manifest.styles.some((style) => style.name.toLowerCase() === name.toLowerCase())) throw new Error('Ya existe un estilo con ese nombre.');
  const style: ReferenceStyle = { id: randomUUID(), name, description: input.description.trim().slice(0, 400), kind: 'custom', builtin: false, createdAt: new Date().toISOString() };
  manifest.styles.push(style);
  await writeManifest(manifest);
  return style;
}

export async function updateStyle(id: string, input: { name?: string; description?: string }) {
  const manifest = await readManifest();
  const style = manifest.styles.find((item) => item.id === id);
  if (!style || style.builtin) throw new Error('Solo se pueden editar los estilos propios.');
  if (input.name?.trim()) style.name = input.name.trim().slice(0, 40);
  if (input.description !== undefined) style.description = input.description.trim().slice(0, 400);
  await writeManifest(manifest);
  return style;
}

/** Borra un estilo propio y todas sus imágenes. */
export async function deleteStyle(id: string) {
  const manifest = await readManifest();
  const style = manifest.styles.find((item) => item.id === id);
  if (!style || style.builtin) throw new Error('Los estilos integrados no se pueden eliminar.');
  const removed = manifest.references.filter((reference) => reference.styleId === id);
  manifest.styles = manifest.styles.filter((item) => item.id !== id);
  manifest.references = manifest.references.filter((reference) => reference.styleId !== id);
  await writeManifest(manifest);
  await Promise.all(removed.map((reference) => rm(path.join(ROOT, reference.filename), { force: true })));
}

export async function addReference(input: { styleId: string; bytes: Buffer; type: string; name: string }) {
  const extension = EXTENSIONS[input.type];
  if (!extension) throw new Error('Formato no compatible. Usa PNG, JPG o WEBP.');
  if (input.bytes.length > MAX_REFERENCE_BYTES) throw new Error('La imagen supera los 12 MB.');
  const manifest = await readManifest();
  const style = manifest.styles.find((item) => item.id === input.styleId);
  if (!style) throw new Error('El estilo no existe.');
  if (style.kind === 'free') throw new Error('«En blanco» no usa referencias: crea un estilo propio para añadir imágenes.');
  const id = randomUUID();
  const filename = `${id}${extension}`;
  await writeFile(path.join(ROOT, filename), input.bytes);
  const label = input.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 60) || 'Referencia';
  const item: StoredReference = { id, styleId: style.id, filename, label, sourceName: path.basename(input.name).slice(0, 120), createdAt: new Date().toISOString() };
  manifest.references.push(item);
  await writeManifest(manifest);
  return withUrl(item);
}

export async function removeReference(id: string) {
  const manifest = await readManifest();
  const item = manifest.references.find((reference) => reference.id === id);
  if (!item) return false;
  manifest.references = manifest.references.filter((reference) => reference.id !== id);
  await writeManifest(manifest);
  await rm(path.join(ROOT, item.filename), { force: true });
  return true;
}

/** Restaura las 5 ilustraciones Monos originales (sin borrar las añadidas). */
export async function restoreDefaultReferences() {
  const manifest = await readManifest();
  const present = new Set(manifest.references.filter((reference) => reference.styleId === MONOS_STYLE_ID).map((reference) => reference.sourceName));
  manifest.references.push(...await seedFiles(present));
  await writeManifest(manifest);
}

export async function readReference(id: string) {
  const item = (await readManifest()).references.find((reference) => reference.id === id);
  if (!item) return null;
  const bytes = await readFile(path.join(ROOT, item.filename)).catch(() => null);
  if (!bytes) return null;
  const type = Object.entries(EXTENSIONS).find(([, extension]) => item.filename.endsWith(extension))?.[0] || 'image/png';
  return { bytes, type, item };
}

/** Referencias del estilo que se envían a FLUX, como archivos con su nombre original. */
export async function referenceFilesForGeneration(styleId: string): Promise<File[]> {
  const references = (await readManifest()).references.filter((reference) => reference.styleId === styleId).slice(0, MAX_ACTIVE_REFERENCES);
  const files: File[] = [];
  for (const reference of references) {
    const loaded = await readReference(reference.id);
    if (loaded) files.push(new File([new Uint8Array(loaded.bytes)], reference.sourceName || reference.filename, { type: loaded.type }));
  }
  return files;
}
