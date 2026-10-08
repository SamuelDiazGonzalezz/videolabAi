import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type StoredScene = {
  sceneId: number;
  time: string;
  prompt: string;
  url: string;
  caption: string;
  filename: string;
  /** Descripción visual (inglés) usada para la imagen: editable desde el mapa de nodos. */
  description?: string;
  /** Archivos de cada versión de la escena, del original a la actual (ediciones con IA). */
  versions?: string[];
  /** Instrucción de cada edición, en el mismo orden que versions[1..]. */
  edits?: { instruction: string; applied: string; at: string }[];
};

export type StoryboardRecord = {
  id: string;
  title: string;
  script: string;
  aspectRatio: '9:16' | '16:9';
  intervalSeconds: number;
  /** Id del estilo de referencias usado (monos, blank o uno propio). */
  style: string;
  styleName?: string;
  /** Tipo de imagen elegido (dibujo, anime, realista…); ver lib/artTypes.ts. */
  artType?: string;
  status: 'generating' | 'complete' | 'error';
  createdAt: string;
  updatedAt: string;
  folder: string;
  images: StoredScene[];
  audioUrl?: string;
  audioFilename?: string;
  voiceId?: string;
  voiceName?: string;
  voiceError?: string;
  alignment?: unknown;
  editorState?: unknown;
  /** Disposición del mapa de nodos (posiciones, conexiones y notas). */
  mapState?: unknown;
  /** Biblia visual y descripción por escena que escribió el director local (Qwen3). */
  plan?: { bible: Record<string, unknown>; scenes: string[] };
};

const ROOT = path.join(process.cwd(), 'data', 'storyboards');

export function storyboardsRoot() {
  return ROOT;
}

export function isSafeStoryboardId(value: string) {
  return /^[0-9a-f-]{20,50}$/i.test(value);
}

// Kept separate from the route handlers so every write uses the same folder layout.
async function writeRecord(record: StoryboardRecord) {
  await mkdir(path.join(ROOT, record.id), { recursive: true });
  await writeFile(path.join(ROOT, record.id, 'storyboard.json'), JSON.stringify(record, null, 2), 'utf8');
}

function titleFromScript(script: string) {
  const firstSentence = script.split(/[.!?]/)[0]?.trim() || 'Storyboard';
  return firstSentence.slice(0, 72) || 'Storyboard';
}

export async function createStoryboard(input: {
  script: string;
  aspectRatio: '9:16' | '16:9';
  intervalSeconds: number;
  style: string;
  styleName?: string;
  artType?: string;
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const record: StoryboardRecord = {
    id,
    title: titleFromScript(input.script),
    script: input.script,
    aspectRatio: input.aspectRatio,
    intervalSeconds: input.intervalSeconds,
    style: input.style,
    styleName: input.styleName,
    artType: input.artType,
    status: 'generating',
    createdAt: now,
    updatedAt: now,
    folder: path.join('data', 'storyboards', id),
    images: [],
  };
  await writeRecord(record);
  return record;
}

export async function getStoryboard(id: string) {
  if (!isSafeStoryboardId(id)) return null;
  try {
    const raw = await readFile(path.join(ROOT, id, 'storyboard.json'), 'utf8');
    return JSON.parse(raw) as StoryboardRecord;
  } catch {
    return null;
  }
}

export async function listStoryboards() {
  await mkdir(ROOT, { recursive: true });
  const entries = await readdir(ROOT, { withFileTypes: true });
  const records = await Promise.all(
    entries.filter((entry) => entry.isDirectory() && isSafeStoryboardId(entry.name)).map((entry) => getStoryboard(entry.name)),
  );
  return records.filter((record): record is StoryboardRecord => Boolean(record)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function assetBuffer(source: string) {
  if (source.startsWith('data:')) {
    const comma = source.indexOf(',');
    if (comma < 0) throw new Error('La imagen generada no tiene un formato válido.');
    return Buffer.from(source.slice(comma + 1), 'base64');
  }
  const response = await fetch(source, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`No se pudo descargar la escena generada (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

export async function saveStoryboardScene(
  id: string,
  scene: Omit<StoredScene, 'url' | 'filename'>,
  source: string,
) {
  const record = await getStoryboard(id);
  if (!record) throw new Error('No se encontró la carpeta del storyboard.');
  const filename = `scene-${String(scene.sceneId).padStart(2, '0')}.png`;
  const folder = path.join(ROOT, id);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, filename), await assetBuffer(source));
  const stored: StoredScene = { ...scene, filename, url: `/api/storyboards/${id}/${filename}` };
  const images = [...record.images.filter((item) => item.sceneId !== scene.sceneId), stored].sort((a, b) => a.sceneId - b.sceneId);
  await writeRecord({ ...record, images, updatedAt: new Date().toISOString() });
  return stored;
}

export async function saveStoryboardPlan(id: string, plan: NonNullable<StoryboardRecord['plan']>) {
  const record = await getStoryboard(id);
  if (!record) return;
  await writeRecord({ ...record, plan, updatedAt: new Date().toISOString() });
}

export async function updateStoryboardStatus(id: string, status: StoryboardRecord['status']) {
  const record = await getStoryboard(id);
  if (!record) return;
  await writeRecord({ ...record, status, updatedAt: new Date().toISOString() });
}

export async function saveStoryboardAudio(input: {
  id: string;
  bytes: Uint8Array;
  voiceId: string;
  voiceName?: string;
  alignment?: unknown;
}) {
  const record = await getStoryboard(input.id);
  if (!record) throw new Error('No se encontró la carpeta del storyboard.');
  const folder = path.join(ROOT, input.id);
  const audioFilename = 'narration.mp3';
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, audioFilename), input.bytes);
  if (input.alignment !== undefined) {
    await writeFile(path.join(folder, 'narration-alignment.json'), JSON.stringify(input.alignment, null, 2), 'utf8');
  }
  // Una voz nueva cambia todos los tiempos: el timeline se vuelve a montar
  // sincronizado con ella en vez de conservar posiciones del audio anterior.
  const { editorState: _previousEditorState, ...rest } = record;
  const next: StoryboardRecord = {
    ...rest,
    // ?v= evita que el editor reproduzca una narración anterior desde la caché.
    audioUrl: `/api/storyboards/${input.id}/${audioFilename}?v=${Date.now()}`,
    audioFilename,
    voiceId: input.voiceId,
    voiceName: input.voiceName || input.voiceId,
    voiceError: undefined,
    alignment: input.alignment,
    updatedAt: new Date().toISOString(),
  };
  await writeRecord(next);
  return next;
}

export async function saveStoryboardVoiceError(id: string, voiceId: string, error: string) {
  const record = await getStoryboard(id);
  if (!record) return;
  await writeRecord({
    ...record,
    voiceId,
    voiceError: error.slice(0, 500),
    updatedAt: new Date().toISOString(),
  });
}

export async function updateStoryboardEditor(id: string, editorState: unknown, title?: string) {
  const record = await getStoryboard(id);
  if (!record) return null;
  const next = {
    ...record,
    ...(title ? { title: title.slice(0, 120) } : {}),
    editorState,
    updatedAt: new Date().toISOString(),
  } satisfies StoryboardRecord;
  await writeRecord(next);
  return next;
}

const ASSET_NAME = /^(?:scene-[0-9]{2,4}(?:-v[0-9]{1,3})?\.png|narration\.mp3|narration-alignment\.json|export-[0-9]{8}-[0-9]{6}\.mp4)$/i;

export function storyboardAssetPath(id: string, filename: string) {
  if (!isSafeStoryboardId(id) || !ASSET_NAME.test(filename)) return null;
  return path.join(ROOT, id, filename);
}

export async function readStoryboardAsset(id: string, filename: string) {
  if (!storyboardAssetPath(id, filename)) return null;
  try {
    return await readFile(path.join(ROOT, id, filename));
  } catch {
    return null;
  }
}

export async function storyboardExists(id: string) {
  if (!isSafeStoryboardId(id)) return false;
  try {
    return (await stat(path.join(ROOT, id))).isDirectory();
  } catch {
    return false;
  }
}

/** Borra la carpeta completa: escenas, narración, alineamiento, montaje y vídeos exportados. */
export async function deleteStoryboard(id: string) {
  if (!isSafeStoryboardId(id) || !await storyboardExists(id)) return false;
  await rm(path.join(ROOT, id), { recursive: true, force: true });
  return true;
}

// --- Ediciones de escenas -------------------------------------------------
// Cada edición se guarda como scene-XX-vN.png (las PNG se sirven como
// inmutables, así que un nombre nuevo evita ver la versión vieja en caché) y el
// montaje guardado del editor pasa a apuntar a la versión actual.

function sceneUrl(id: string, filename: string) {
  return `/api/storyboards/${id}/${filename}`;
}

function swapEditorImage(editorState: unknown, id: string, from: string, to: string) {
  if (!editorState) return editorState;
  const json = JSON.stringify(editorState).split(sceneUrl(id, from)).join(sceneUrl(id, to));
  return JSON.parse(json);
}

export async function readSceneImage(id: string, sceneId: number) {
  const record = await getStoryboard(id);
  const scene = record?.images.find((item) => item.sceneId === sceneId);
  if (!record || !scene) return null;
  const bytes = await readFile(path.join(ROOT, id, scene.filename)).catch(() => null);
  return bytes ? { record, scene, bytes } : null;
}

export async function saveSceneEdit(id: string, sceneId: number, source: string, edit: { instruction: string; applied: string }, patch: Partial<Pick<StoredScene, 'description' | 'prompt'>> = {}) {
  const record = await getStoryboard(id);
  const scene = record?.images.find((item) => item.sceneId === sceneId);
  if (!record || !scene) throw new Error('No se encontró la escena.');
  const versions = scene.versions?.length ? [...scene.versions] : [scene.filename];
  const base = `scene-${String(sceneId).padStart(2, '0')}`;
  let version = versions.length + 1;
  while (versions.includes(`${base}-v${version}.png`)) version += 1;
  const filename = `${base}-v${version}.png`;
  await writeFile(path.join(ROOT, id, filename), await assetBuffer(source));
  const updated: StoredScene = {
    ...scene,
    ...patch,
    filename,
    url: sceneUrl(id, filename),
    versions: [...versions, filename],
    edits: [...(scene.edits || []), { ...edit, at: new Date().toISOString() }],
  };
  await writeRecord({
    ...record,
    images: record.images.map((item) => item.sceneId === sceneId ? updated : item),
    editorState: swapEditorImage(record.editorState, id, scene.filename, filename),
    updatedAt: new Date().toISOString(),
  });
  return updated;
}

/** Vuelve a la versión anterior de la escena y borra la edición descartada. */
export async function undoSceneEdit(id: string, sceneId: number) {
  const record = await getStoryboard(id);
  const scene = record?.images.find((item) => item.sceneId === sceneId);
  if (!record || !scene) throw new Error('No se encontró la escena.');
  const versions = scene.versions || [scene.filename];
  if (versions.length < 2) throw new Error('Esta escena no tiene ediciones que deshacer.');
  const discarded = versions[versions.length - 1];
  const previous = versions[versions.length - 2];
  const updated: StoredScene = {
    ...scene,
    filename: previous,
    url: sceneUrl(id, previous),
    versions: versions.slice(0, -1),
    edits: (scene.edits || []).slice(0, -1),
  };
  await writeRecord({
    ...record,
    images: record.images.map((item) => item.sceneId === sceneId ? updated : item),
    editorState: swapEditorImage(record.editorState, id, discarded, previous),
    updatedAt: new Date().toISOString(),
  });
  if (discarded !== scene.versions?.[0]) await rm(path.join(ROOT, id, discarded), { force: true });
  return updated;
}

export async function updateStoryboardMap(id: string, mapState: unknown) {
  const record = await getStoryboard(id);
  if (!record) return false;
  await writeRecord({ ...record, mapState, updatedAt: new Date().toISOString() });
  return true;
}
