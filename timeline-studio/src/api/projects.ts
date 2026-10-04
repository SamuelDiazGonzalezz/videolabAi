import { auth } from '../firebase';
import type { SerializedTimeline, TextClip } from '../types/timeline';

export interface CloudProject {
  id: string;
  title: string;
  videoUrl?: string;
  videoStorageKey?: string;
  coverUrl?: string;
  coverStorageKey?: string;
  audioUrl?: string;
  audioStorageKey?: string;
  duration: number;
  editorState?: SerializedTimeline;
  clips?: Array<{
    videoUrl?: string;
    storageKey?: string;
    imageUrl?: string;
    imageStorageKey?: string;
  }>;
}

interface StoredProjectClip {
  id?: string;
  sourceUrl?: string;
  storageKey?: string;
  imageUrl?: string;
  imageStorageKey?: string;
}

class R2ProjectApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'R2ProjectApiError';
    this.status = status;
  }
}

export function isMissingCloudProjectError(reason: unknown): boolean {
  return reason instanceof R2ProjectApiError && reason.status === 404;
}

async function r2ProjectApi(path: string, body: Record<string, unknown> = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Inicia sesión para gestionar el proyecto.');
  const response = await fetch(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new R2ProjectApiError(data.error || 'No se pudo acceder al proyecto en R2.', response.status);
  return data;
}

export async function resolveStoredMediaUrl(storageKey: string): Promise<string> {
  const key = String(storageKey || '').trim().slice(0, 300);
  if (!key) return '';
  const result = await r2ProjectApi('/api/r2/projects/resolve', { assetStorageKeys: [key] });
  return String(result.assetUrls?.[key] || '');
}

export async function resolveStoredMediaProxyUrl(storageKey: string): Promise<string> {
  const key = String(storageKey || '').trim().slice(0, 300);
  const user = auth.currentUser;
  if (!key || !user) return '';
  const response = await fetch(`/api/r2/objects?proxy=1&key=${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    cache: 'no-store'
  });
  const result = await response.json().catch(() => ({}));
  return response.ok ? String(result.proxyUrl || '') : '';
}

// Cambia recursivamente cada URL de recurso guardada por su versión recién
// firmada, mire donde mire dentro del proyecto: clips de vídeo, pista de
// audio, B-roll, logo de marca y la propia biblioteca multimedia.
//
// Antes solo se reescribían las rutas locales `/generated/...`, y eso dejaba
// el proyecto roto al reabrirlo: en cuanto se guarda una vez, todas esas
// rutas pasan a ser URLs firmadas de R2 que caducan a los 15 minutos. Al
// abrir el proyecto en otro dispositivo (o un rato después) esas URLs ya no
// servían y el multimedia aparecía vacío o no cargaba, porque ninguna de
// ellas volvía a firmarse.
function replaceAssetUrls<T>(value: T, replacements: Record<string, string>): T {
  if (typeof value === 'string') return (replacements[value] || value) as T;
  if (Array.isArray(value)) return value.map((item) => replaceAssetUrls(item, replacements)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, replaceAssetUrls(item, replacements)])
    ) as T;
  }
  return value;
}

export async function loadCloudProject(_userId: string, projectId: string): Promise<CloudProject | null> {
  // Se pide solo este proyecto. Antes se listaban todos los del usuario para
  // quedarse con uno, lo que obligaba a descargar el estado completo de cada
  // proyecto de la cuenta cada vez que se abría el editor.
  const result = await r2ProjectApi('/api/r2/projects/get', { projectId });
  const project = (result.project || null) as CloudProject | null;
  if (!project) return null;
  const raw = project as CloudProject & Record<string, unknown>;
  const state = raw.editorState as SerializedTimeline | undefined;
  const projectClips = Array.isArray(raw.clips) ? raw.clips : [];
  const stateClips = (Array.isArray(state?.clips) ? state.clips : []) as StoredProjectClip[];
  const assetKeys = [...new Set([
    ...(state?.mediaAssets?.map((asset) => asset.storageKey) || []),
    ...stateClips.flatMap((clip) => [clip.storageKey, clip.imageStorageKey]),
    ...projectClips.flatMap((clip) => [clip.storageKey, clip.imageStorageKey]),
    // B-roll, pista de audio y logo de marca: medios que no tienen por qué
    // estar en la biblioteca pero que también hay que volver a firmar.
    ...(state?.brollClips?.map((clip) => clip.storageKey) || []),
    state?.audio?.externalStorageKey,
    state?.settings?.brandLogoStorageKey,
    // Función 6 — pista de música independiente.
    state?.musicTrack?.storageKey
  ].filter((key): key is string => Boolean(key)))];
  const assetChunks: string[][] = [];
  for (let index = 0; index < assetKeys.length; index += 80) assetChunks.push(assetKeys.slice(index, index + 80));
  const [resolvedPrincipal, ...resolvedAssets] = await Promise.all([
    r2ProjectApi('/api/r2/projects/resolve', {
    videoStorageKey: raw.videoStorageKey,
    coverStorageKey: raw.coverStorageKey,
    audioStorageKey: raw.audioStorageKey,
    subtitleStorageKey: raw.subtitleStorageKey,
    transcriptStorageKey: raw.transcriptStorageKey
    }),
    ...assetChunks.map((assetStorageKeys) => r2ProjectApi('/api/r2/projects/resolve', { assetStorageKeys }))
  ]);
  const resolved = {
    ...resolvedPrincipal,
    assetUrls: Object.assign({}, resolvedPrincipal.assetUrls || {}, ...resolvedAssets.map((result) => result.assetUrls || {}))
  };
  const replacements: Record<string, string> = {};
  for (const field of ['videoUrl', 'coverUrl', 'audioUrl'] as const) {
    const previous = raw[field];
    const fresh = resolved[field];
    if (typeof previous === 'string' && previous && typeof fresh === 'string' && fresh) replacements[previous] = fresh;
  }
  for (const asset of state?.mediaAssets || []) {
    const fresh = asset.storageKey ? resolved.assetUrls?.[asset.storageKey] : '';
    if (asset.url && fresh) replacements[asset.url] = fresh;
  }
  for (const clip of projectClips) {
    const freshVideo = clip.storageKey ? resolved.assetUrls?.[clip.storageKey] : '';
    const freshImage = clip.imageStorageKey ? resolved.assetUrls?.[clip.imageStorageKey] : '';
    if (clip.videoUrl && freshVideo) replacements[clip.videoUrl] = freshVideo;
    if (clip.imageUrl && freshImage) replacements[clip.imageUrl] = freshImage;
  }
  for (const clip of stateClips) {
    const freshVideo = clip.storageKey ? resolved.assetUrls?.[clip.storageKey] : '';
    const freshImage = clip.imageStorageKey ? resolved.assetUrls?.[clip.imageStorageKey] : '';
    if (clip.sourceUrl && freshVideo) replacements[clip.sourceUrl] = freshVideo;
    if (clip.imageUrl && freshImage) replacements[clip.imageUrl] = freshImage;
  }
  for (const clip of state?.brollClips || []) {
    const fresh = clip.storageKey ? resolved.assetUrls?.[clip.storageKey] : '';
    if (clip.sourceUrl && fresh) replacements[clip.sourceUrl] = fresh;
  }
  const freshAudio = state?.audio?.externalStorageKey ? resolved.assetUrls?.[state.audio.externalStorageKey] : '';
  if (state?.audio?.externalUrl && freshAudio) replacements[state.audio.externalUrl] = freshAudio;
  const freshLogo = state?.settings?.brandLogoStorageKey ? resolved.assetUrls?.[state.settings.brandLogoStorageKey] : '';
  if (state?.settings?.brandLogoUrl && freshLogo) replacements[state.settings.brandLogoUrl] = freshLogo;
  const freshMusic = state?.musicTrack?.storageKey ? resolved.assetUrls?.[state.musicTrack.storageKey] : '';
  if (state?.musicTrack?.sourceUrl && freshMusic) replacements[state.musicTrack.sourceUrl] = freshMusic;
  if (state) {
    const hydratedState = replaceAssetUrls(state, replacements);
    hydratedState.mediaAssets = (hydratedState.mediaAssets || []).map((asset) => {
      const fresh = asset.storageKey ? resolved.assetUrls?.[asset.storageKey] : '';
      return fresh ? { ...asset, url: fresh } : asset;
    });
    hydratedState.clips = hydratedState.clips.map((serializedClip) => {
      const clip = serializedClip as typeof serializedClip & StoredProjectClip;
      const freshVideo = clip.storageKey ? resolved.assetUrls?.[clip.storageKey] : '';
      const freshImage = clip.imageStorageKey ? resolved.assetUrls?.[clip.imageStorageKey] : '';
      return {
        ...serializedClip,
        ...(freshVideo ? { sourceUrl: freshVideo } : {}),
        ...(freshImage ? { imageUrl: freshImage } : {})
      };
    });
    raw.editorState = hydratedState;
  }
  raw.clips = projectClips.map((clip) => ({
    ...clip,
    ...(clip.storageKey && resolved.assetUrls?.[clip.storageKey] ? { videoUrl: resolved.assetUrls[clip.storageKey] } : {}),
    ...(clip.imageStorageKey && resolved.assetUrls?.[clip.imageStorageKey] ? { imageUrl: resolved.assetUrls[clip.imageStorageKey] } : {})
  }));
  return { ...raw, ...resolved } as CloudProject;
}

interface SaveProjectChanges {
  title?: string;
  videoUrl?: string;
  videoStorageKey?: string;
  coverUrl?: string;
  coverStorageKey?: string;
  duration?: number;
  editorState: SerializedTimeline;
  textOverlays?: TextClip[];
}

export interface CloudProjectRenderChanges {
  videoUrl: string;
  videoStorageKey?: string;
  coverUrl?: string;
  coverStorageKey?: string;
  duration: number;
}

// El render ya ha sido respaldado en R2 por el servidor. Al terminar solo
// hay que enlazar esas claves en el manifiesto existente: volver a pasar por
// /persist recorrería y podría resubir todos los medios del editor, además de
// sobrescribir con una instantánea antigua los cambios hechos durante el
// render.
export async function saveCloudProjectRender(projectId: string, changes: CloudProjectRenderChanges): Promise<void> {
  const id = String(projectId || '').trim();
  if (!id) throw new Error('El proyecto no tiene un identificador válido.');
  await r2ProjectApi('/api/r2/projects/save', {
    requireExisting: true,
    project: {
      id,
      type: 'VÍDEO',
      // Los vacíos son intencionados: una nueva exportación sin portada (o
      // una respuesta compatible sin storageKey) debe retirar las referencias
      // antiguas, no hacer que el manifiesto siga apuntando al render previo.
      videoUrl: changes.videoUrl || '',
      videoStorageKey: changes.videoStorageKey || '',
      coverUrl: changes.coverUrl || '',
      coverStorageKey: changes.coverStorageKey || '',
      ...(Number.isFinite(changes.duration) ? { duration: changes.duration } : {})
    }
  });
}

// Todo archivo al que apunte el proyecto y siga viviendo en el disco local
// del servidor (/generated/...) tiene que subirse a R2 al guardar; si no, al
// reabrir el proyecto en otro dispositivo ese archivo no existe y la pista
// aparece vacía. La biblioteca (`mediaAssets`) cubre el caso normal, pero un
// recurso puede acabar en la línea de tiempo sin pasar por ella (proyectos
// antiguos, un vídeo abierto directamente desde una URL de entrada, un logo
// heredado...). Aquí se recogen también esos para no dejar ninguno fuera.
type PersistableMedia = { url: string; type: 'image' | 'video' | 'audio' };

function collectTimelineMedia(state: SerializedTimeline): PersistableMedia[] {
  const found: PersistableMedia[] = [];
  const add = (url: unknown, type: PersistableMedia['type']) => {
    if (typeof url === 'string' && url) found.push({ url, type });
  };
  add(state.sourceUrl, 'video');
  for (const clip of state.clips || []) add(clip.sourceUrl, 'video');
  for (const clip of state.brollClips || []) add(clip.sourceUrl, 'image');
  add(state.audio?.externalUrl, 'audio');
  add(state.settings?.brandLogoUrl, 'image');
  add(state.musicTrack?.sourceUrl, 'audio');
  return found;
}

export async function saveCloudProject(_userId: string, projectId: string, changes: SaveProjectChanges): Promise<void> {
  const assets = changes.editorState.mediaAssets || [];
  const assetUrls = new Set(assets.map((asset) => asset.url));
  // Medios referenciados por la línea de tiempo que no están en la
  // biblioteca: se persisten igualmente, detrás de los assets para no alterar
  // el emparejamiento por índice de `stored.clips`.
  const extraMedia: PersistableMedia[] = [];
  for (const media of collectTimelineMedia(changes.editorState)) {
    if (assetUrls.has(media.url)) continue;
    assetUrls.add(media.url);
    extraMedia.push(media);
  }
  const persistables: PersistableMedia[] = [
    ...assets.map((asset) => ({ url: asset.url, type: asset.type })),
    ...extraMedia
  ];
  const stored = await r2ProjectApi('/api/r2/projects/persist', {
    projectId,
    media: {
      video: { url: changes.videoUrl, key: changes.videoStorageKey },
      cover: { url: changes.coverUrl, key: changes.coverStorageKey },
      subtitle: {}, transcript: {},
      clips: persistables.map((media, index) => {
        const key = index < assets.length ? assets[index].storageKey : undefined;
        return media.type === 'image'
          ? { imageUrl: media.url, imageStorageKey: key }
          : { videoUrl: media.url, storageKey: key };
      })
    }
  });
  const storedUrlFor = (media: PersistableMedia, index: number) => {
    const storedAsset = stored.clips?.[index] || {};
    const storageKey = media.type === 'image' ? storedAsset.imageStorageKey : storedAsset.storageKey;
    const url = media.type === 'image' ? storedAsset.imageUrl : storedAsset.videoUrl;
    return storageKey && url ? { storageKey, url } : null;
  };
  const savedAssets = assets.map((asset, index) => {
    const saved = storedUrlFor({ url: asset.url, type: asset.type }, index);
    return saved ? { ...asset, ...saved } : asset;
  });
  const replacements: Record<string, string> = {};
  // Clave de R2 de cada medio, indexada por su URL ORIGINAL (la que tiene el
  // estado antes de reescribirlo). Permite anotar la clave junto a cada
  // referencia para poder volver a firmarla al reabrir el proyecto.
  const keyByOriginalUrl: Record<string, string> = {};
  assets.forEach((asset, index) => {
    const saved = savedAssets[index];
    replacements[asset.url] = saved?.url || asset.url;
    if (saved?.storageKey) keyByOriginalUrl[asset.url] = saved.storageKey;
  });
  extraMedia.forEach((media, offset) => {
    const saved = storedUrlFor(media, assets.length + offset);
    if (!saved) return;
    replacements[media.url] = saved.url;
    keyByOriginalUrl[media.url] = saved.storageKey;
  });
  const nextState = replaceAssetUrls({ ...changes.editorState, mediaAssets: savedAssets }, replacements);
  // Sin esta anotación, un medio que no esté en la biblioteca (el audio, el
  // logo de marca, un clip heredado) quedaba guardado con una URL firmada y
  // sin ninguna pista de a qué objeto de R2 pertenece: al reabrir el proyecto
  // esa URL ya había caducado y no había forma de volver a firmarla.
  const original = changes.editorState;
  nextState.clips = nextState.clips.map((clip, index) => {
    const storageKey = keyByOriginalUrl[original.clips?.[index]?.sourceUrl || ''];
    return storageKey ? { ...clip, storageKey } : clip;
  });
  if (nextState.brollClips) {
    nextState.brollClips = nextState.brollClips.map((clip, index) => {
      const storageKey = keyByOriginalUrl[original.brollClips?.[index]?.sourceUrl || ''];
      return storageKey ? { ...clip, storageKey } : clip;
    });
  }
  const audioKey = keyByOriginalUrl[original.audio?.externalUrl || ''];
  if (audioKey) nextState.audio = { ...nextState.audio, externalStorageKey: audioKey };
  const logoKey = keyByOriginalUrl[original.settings?.brandLogoUrl || ''];
  if (logoKey) nextState.settings = { ...nextState.settings, brandLogoStorageKey: logoKey };
  const musicKey = keyByOriginalUrl[original.musicTrack?.sourceUrl || ''];
  if (musicKey && nextState.musicTrack) nextState.musicTrack = { ...nextState.musicTrack, storageKey: musicKey };
  const primaryAsset = savedAssets.find((asset) => asset.type === 'video' && asset.url === nextState.sourceUrl)
    || savedAssets.find((asset, index) => asset.type === 'video' && assets[index]?.url === changes.editorState.sourceUrl);
  const savedVideoUrl = stored.videoUrl || changes.videoUrl || primaryAsset?.url || '';
  const savedVideoStorageKey = stored.videoStorageKey || changes.videoStorageKey || primaryAsset?.storageKey || '';
  const savedCoverUrl = stored.coverUrl || changes.coverUrl || '';
  const savedCoverStorageKey = stored.coverStorageKey || changes.coverStorageKey || '';
  // `stored.clips` describe la persistencia temporal de mediaAssets. No son
  // los clips semánticos del proyecto (en un storyboard contienen además
  // narración, duración e imageStorageKey), por lo que no deben sobrescribir
  // el array `clips` que ya guarda el manifiesto.
  const { clips: _storedAssets, ...storedPrincipal } = stored;
  await r2ProjectApi('/api/r2/projects/save', {
    project: {
      id: projectId,
      ...storedPrincipal,
      // Etiqueta de la tarjeta en "Proyectos recientes" del menú principal.
      // Sin ella, los proyectos creados aquí salían con la insignia azul vacía.
      type: 'VÍDEO',
      ...(changes.title != null ? { title: changes.title.slice(0, 120) } : {}),
      ...(savedVideoUrl ? { videoUrl: savedVideoUrl } : {}),
      ...(savedVideoStorageKey ? { videoStorageKey: savedVideoStorageKey } : {}),
      ...(savedCoverUrl ? { coverUrl: savedCoverUrl } : {}),
      ...(savedCoverStorageKey ? { coverStorageKey: savedCoverStorageKey } : {}),
      ...(changes.duration != null ? { duration: changes.duration } : {}),
      editorState: nextState,
      ...(changes.textOverlays ? { textOverlays: changes.textOverlays } : {})
    }
  });
}
