'use client';

import { ChangeEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  Archive,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Download,
  FileImage,
  Film,
  FolderOpen,
  FolderPlus,
  Images,
  LayoutGrid,
  Loader2,
  Menu,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Palette,
  Copy,
  FileText,
  PenLine,
  Square,
  BookmarkPlus,
  BookOpen,
  Swords,
  Smile,
  GraduationCap,
  Ghost,
  Baby,
  Timer,
  Zap,
  Clapperboard,
  Network,
  Lock,
  Camera,
  Leaf,
  Highlighter,
  Brush,
  Droplets,
  Box,
  Grid3x3,
  Scissors,
  PenTool,
  Shapes,
  Paintbrush,
  Frown,
  Pencil,
  Wand2,
  Undo2,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  WandSparkles,
  X,
  ZoomIn,
} from 'lucide-react';
import { ELEVENLABS_VOICES, type VoiceOption } from '../lib/voices';
import { ART_TYPES } from '../lib/artTypes';
import { NodeMap, type MapImage, type MapState } from './components/NodeMap';

type GeneratedImage = {
  sceneId: number;
  time: string;
  prompt: string;
  url: string;
  caption: string;
  filename?: string;
  versions?: string[];
  edits?: { instruction: string; applied: string; at: string }[];
  description?: string;
};

type GenerationProgress = {
  current: number;
  total: number;
  status: 'idle' | 'generating' | 'complete' | 'error';
  caption?: string;
};

type VoiceState = { status: 'idle' | 'generating' | 'ready' | 'error'; name?: string; error?: string };

type StoryboardRecord = {
  id: string;
  title: string;
  script: string;
  aspectRatio: '9:16' | '16:9';
  intervalSeconds: number;
  style: string;
  status: 'generating' | 'complete' | 'error';
  createdAt: string;
  updatedAt: string;
  folder: string;
  images: GeneratedImage[];
  audioUrl?: string;
  voiceName?: string;
  voiceError?: string;
  styleName?: string;
  mapState?: unknown;
  plan?: { bible?: Record<string, unknown>; scenes?: string[] };
};

type Section = 'create' | 'explore' | 'assets' | 'scripts' | 'saved-scripts' | 'elements';

// Máximo que ElevenLabs (eleven_multilingual_v2) narra en una sola petición.
const SCRIPT_LIMIT = 10000;
const HERO_IMAGE = '/references/monos/monos-05.png';
const DEFAULT_REFERENCES = [
  { src: '/references/monos/monos-01.png', label: 'Personaje principal' },
  { src: '/references/monos/monos-02.png', label: 'Carrera y coche' },
  { src: '/references/monos/monos-03.png', label: 'Segundo personaje' },
  { src: '/references/monos/monos-04.png', label: 'Escena de historia' },
  { src: '/references/monos/monos-05.png', label: 'Acción y fondo' },
];

function estimateSceneCount(script: string, interval: number) {
  const targetWords = Math.max(8, Math.round(interval * 2.45));
  const sentences = script.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [];
  let total = 0;
  let currentWords = 0;
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean).length;
    if (words > targetWords * 1.45) {
      if (currentWords) total += 1;
      total += Math.max(1, Math.ceil(words / targetWords));
      currentWords = 0;
    } else if (currentWords && currentWords + words > targetWords * 1.25) {
      total += 1;
      currentWords = words;
    } else {
      currentWords += words;
    }
  }
  if (currentWords) total += 1;
  return Math.max(1, total);
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short' }).format(new Date(value));
  } catch {
    return 'Reciente';
  }
}

// Modelo de imágenes que tiene cargado el servidor local (se consulta cada 15 s).
function EngineStatus() {
  const [engine, setEngine] = useState<{ online: boolean; model: string; fp8: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const check = () => fetch('/api/engine', { cache: 'no-store' }).then((response) => response.json()).then((data) => { if (!cancelled) setEngine(data); }).catch(() => {});
    check();
    const timer = window.setInterval(check, 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  const name = engine?.model ? engine.model.split('/').pop()!.replace(/-/g, ' ').replace(/^FLUX\.2 klein/i, 'FLUX.2 Klein') : 'Comprobando…';
  return <div className="local-engine"><span className={engine?.online === false ? 'offline-dot' : 'online-dot'} /><div><b>GPU local</b><small>{engine?.online === false ? 'Motor apagado' : `${name}${engine?.fp8 ? ' · FP8' : ''}`}</small></div><ChevronDown size={13} /></div>;
}

function Sidebar({ active, onChange, savedCount, scriptCount }: { active: Section; onChange: (section: Section) => void; savedCount: number; scriptCount: number }) {
  const items: Array<{ id: Section; label: string; icon: typeof Sparkles }> = [
    { id: 'create', label: 'Crear', icon: Sparkles },
    { id: 'explore', label: 'Explorar', icon: LayoutGrid },
    { id: 'assets', label: 'Assets', icon: FolderOpen },
    { id: 'scripts', label: 'Guiones', icon: PenLine },
    { id: 'elements', label: 'Elementos', icon: Images },
  ];
  return (
    <aside className="sidebar">
      <div className="sidebar-brand"><span className="brand-mark">VL</span><div><b>Video Lab Ai</b><small>STUDIO</small></div></div>
      <button type="button" className="new-project" onClick={() => onChange('create')}><Plus size={15} /> Nuevo storyboard</button>
      <nav className="sidebar-nav" aria-label="Navegación principal">
        {items.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={active === id ? 'active' : ''} onClick={() => onChange(id)}><Icon size={16} /><span>{label}</span>{id === 'assets' && savedCount > 0 && <em>{savedCount}</em>}</button>)}
      </nav>
      <div className="sidebar-divider" />
      <div className="sidebar-label">Sesiones generativas</div>
      <button type="button" className={`session-link${active === 'explore' ? ' active' : ''}`} onClick={() => onChange('explore')}><span className="session-dot" /><span>Mis storyboards</span><small>{savedCount}</small></button><button type="button" className={`session-link${active === 'saved-scripts' ? ' active' : ''}`} onClick={() => onChange('saved-scripts')}><span className="session-dot" /><span>Guiones guardados</span><small>{scriptCount}</small></button>
      <div className="sidebar-bottom">
        <EngineStatus />
        <button type="button" className="user-row"><span className="user-avatar">SM</span><span>Samuel</span><MoreHorizontal size={15} /></button>
      </div>
    </aside>
  );
}

function TopBar({ active, onMenu }: { active: Section; onMenu: () => void }) {
  const labels: Record<Section, string> = { create: 'Crear', explore: 'Explorar', assets: 'Assets', scripts: 'Guiones', 'saved-scripts': 'Guiones guardados', elements: 'Elementos' };
  return <header className="topbar"><button type="button" className="mobile-menu" onClick={onMenu} aria-label="Abrir menú"><Menu size={18} /></button><div className="crumb"><span>Workspace</span><ChevronDown size={13} /><b>{labels[active]}</b></div><div className="topbar-actions"><button type="button" className="icon-button" aria-label="Buscar"><Search size={16} /></button><button type="button" className="icon-button" aria-label="Ayuda"><CircleHelp size={16} /></button><button type="button" className="icon-button" aria-label="Ajustes"><Settings2 size={16} /></button><span className="top-avatar">SM</span></div></header>;
}

function Showcase({ onCreate }: { onCreate: () => void }) {
  return <section className="showcase">
    <div className="showcase-intro"><span className="eyebrow">VIDEO LAB AI / IMAGE LAB</span><h1>Ideas que se convierten<br /><i>en escenas.</i></h1><p>Genera una secuencia coherente desde tu guion, con personajes y trazo bloqueados.</p><button type="button" className="showcase-cta" onClick={onCreate}><Sparkles size={14} /> Empezar a crear <ArrowUpRight size={14} /></button></div>
    <div className="showcase-tiles">
      <button type="button" className="showcase-tile showcase-feature" onClick={onCreate}><img src={HERO_IMAGE} alt="Visual principal de Video Lab Ai" /><span className="tile-shade" /><div className="tile-copy"><b>Monos / Visual base</b><small>Estilo protegido para cada escena</small></div><ArrowUpRight className="tile-arrow" size={16} /></button>
      <button type="button" className="showcase-tile" onClick={onCreate}><img src={DEFAULT_REFERENCES[1].src} alt="Referencia de carrera" /><span className="tile-shade" /><div className="tile-copy"><b>Race day</b><small>Referencia de composición</small></div></button>
      <button type="button" className="showcase-tile" onClick={onCreate}><img src={DEFAULT_REFERENCES[3].src} alt="Referencia de historia" /><span className="tile-shade" /><div className="tile-copy"><b>Story frames</b><small>Una imagen cada 3–4 s</small></div></button>
    </div>
  </section>;
}

type ReferenceItem = { id: string; styleId: string; label: string; url: string; sourceName: string };
type StyleKind = 'monos' | 'free' | 'white' | 'custom';
type ReferenceStyle = { id: string; name: string; description: string; kind: StyleKind; builtin: boolean };

const STYLE_STORAGE_KEY = 'videolab.styleId';

// Biblioteca de estilos y referencias (data/references). Cada estilo tiene sus
// propias imágenes; al generar se envían a FLUX solo las del estilo elegido.
function useReferenceLibrary() {
  const [styles, setStyles] = useState<ReferenceStyle[]>([]);
  const [references, setReferences] = useState<ReferenceItem[]>([]);
  const [maxActive, setMaxActive] = useState(8);
  const [loaded, setLoaded] = useState(false);
  const [styleId, setStyleIdState] = useState('monos');
  const setStyleId = (id: string) => { setStyleIdState(id); try { localStorage.setItem(STYLE_STORAGE_KEY, id); } catch {} };
  const apply = (data: { styles?: ReferenceStyle[]; references?: ReferenceItem[]; maxActive?: number }) => {
    if (Array.isArray(data.styles)) {
      setStyles(data.styles);
      // Si el estilo elegido se borró, se vuelve a Monos.
      setStyleIdState((current) => data.styles!.some((style) => style.id === current) ? current : 'monos');
    }
    if (Array.isArray(data.references)) setReferences(data.references);
    if (data.maxActive) setMaxActive(data.maxActive);
  };
  const call = async (body: Record<string, unknown>) => {
    const response = await fetch('/api/references', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    apply(data);
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la acción.');
    return data;
  };
  useEffect(() => {
    try { const stored = localStorage.getItem(STYLE_STORAGE_KEY); if (stored) setStyleIdState(stored); } catch {}
    fetch('/api/references', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : {})
      .then(apply)
      .catch(() => { /* el servidor puede estar arrancando */ })
      .finally(() => setLoaded(true));
  }, []);
  const add = async (files: File[], targetStyleId: string) => {
    const form = new FormData();
    form.append('styleId', targetStyleId);
    files.forEach((file) => form.append('files', file));
    const response = await fetch('/api/references', { method: 'POST', body: form });
    const data = await response.json().catch(() => ({}));
    apply(data);
    const errors: string[] = Array.isArray(data.errors) ? data.errors : [];
    if (!response.ok && !errors.length) errors.push(data.error || 'No se pudieron añadir las imágenes.');
    return errors;
  };
  const remove = async (id: string) => {
    const response = await fetch(`/api/references/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('No se pudo eliminar la referencia.');
    setReferences((current) => current.filter((reference) => reference.id !== id));
  };
  const restore = () => call({ action: 'restore' });
  const createStyle = async (name: string, description: string) => (await call({ action: 'createStyle', name, description })).created as ReferenceStyle;
  const updateStyle = (id: string, description: string) => call({ action: 'updateStyle', id, description });
  const deleteStyle = (id: string) => call({ action: 'deleteStyle', id });
  const style = styles.find((item) => item.id === styleId) || styles[0] || null;
  const styleReferences = references.filter((reference) => reference.styleId === style?.id);
  return { styles, references, maxActive, loaded, styleId: style?.id || styleId, style, styleReferences, setStyleId, add, remove, restore, createStyle, updateStyle, deleteStyle };
}

type ReferenceLibrary = ReturnType<typeof useReferenceLibrary>;

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', handler); document.body.style.overflow = previousOverflow; };
  }, [onClose]);
}

function styleHint(style: ReferenceStyle | null) {
  if (!style) return 'Cargando estilos…';
  if (style.kind === 'free') return 'El director decide libremente el estilo de dibujo, los personajes y el mundo según tu guion.';
  if (style.kind === 'white') return 'Vídeos educativos: cada frase se ilustra con objetos o personajes aislados sobre fondo blanco puro, sin paisaje. Las referencias son opcionales.';
  return style.description || 'Estilo propio: FLUX copia el trazo y los colores de sus referencias.';
}

function StylePicker({ library, onEdit }: { library: ReferenceLibrary; onEdit: () => void }) {
  return <div className="style-picker"><div className="control-heading"><span><Palette size={12} /> Estilo</span><small>{library.styles.length} tipos</small></div><div className="style-chips">{library.styles.map((style) => <button type="button" key={style.id} className={library.styleId === style.id ? 'selected' : ''} onClick={() => library.setStyleId(style.id)}>{style.name}{style.kind === 'free' && <em>libre</em>}{style.kind === 'white' && <em>educativo</em>}</button>)}<button type="button" className="style-chip-add" onClick={onEdit} title="Crear o editar estilos"><Plus size={12} /></button></div><small className="control-help">{styleHint(library.style)}</small></div>;
}

function ReferencePicker({ library, onEdit }: { library: ReferenceLibrary; onEdit: () => void }) {
  const { styleReferences: references, maxActive, style } = library;
  if (style?.kind === 'free') return null;
  const visible = references.slice(0, 6);
  const hidden = references.length - visible.length;
  return <div className="reference-picker"><div className="control-heading"><span>Referencias · {style?.name || ''}</span><small>{references.length ? `${Math.min(references.length, maxActive)} activas` : 'ninguna'}</small></div><div className="reference-row">{visible.map((reference) => <div className="reference-thumb locked" key={reference.id} title={reference.label}><img src={reference.url} alt={reference.label} /><span><Check size={9} /></span></div>)}{hidden > 0 && <div className="reference-thumb reference-more">+{hidden}</div>}<button type="button" className="reference-edit" onClick={onEdit}><Pencil size={12} /> Editar</button></div><small className="control-help">{references.length ? 'Las referencias mantienen el mismo trazo y los mismos personajes en todas las escenas.' : library.loaded ? 'Este estilo aún no tiene imágenes: FLUX dibujará solo a partir del texto. Pulsa Editar para añadirlas.' : 'Cargando referencias…'}</small></div>;
}

function ReferenceManager({ library, initialFilter, onClose }: { library: ReferenceLibrary; initialFilter: string; onClose: () => void }) {
  const [filter, setFilter] = useState(initialFilter);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [confirmStyleDelete, setConfirmStyleDelete] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  useEscape(onClose);
  const { styles, references, maxActive } = library;
  const active = styles.find((style) => style.id === filter) || null;
  const visible = filter === 'all' ? references : references.filter((reference) => reference.styleId === filter);
  const styleName = (id: string) => styles.find((style) => style.id === id)?.name || '';
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try { await task(); setErrors([]); } catch (error) { setErrors([error instanceof Error ? error.message : 'No se pudo completar la acción.']); }
    setBusy(false);
  };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length || !active) return;
    setBusy(true);
    setErrors(await library.add(files, active.id).catch((error) => [error instanceof Error ? error.message : 'No se pudieron añadir las imágenes.']));
    setBusy(false);
  };
  const createStyle = () => run(async () => {
    const style = await library.createStyle(newName, newDescription);
    setCreating(false);
    setNewName('');
    setNewDescription('');
    if (style) { setFilter(style.id); library.setStyleId(style.id); }
  });
  const deleteStyle = () => run(async () => {
    if (!active) return;
    await library.deleteStyle(active.id);
    setConfirmStyleDelete(false);
    setFilter('all');
  });
  const countFor = (id: string) => references.filter((reference) => reference.styleId === id).length;
  const activeIndexById = new Map<string, number>();
  styles.forEach((style) => references.filter((reference) => reference.styleId === style.id).forEach((reference, index) => activeIndexById.set(reference.id, index)));
  return <div className="image-modal-backdrop" role="presentation" onClick={onClose}><div className="reference-manager" role="dialog" aria-modal="true" aria-labelledby="referenceManagerTitle" onClick={(event) => event.stopPropagation()}>
    <header className="reference-manager__head"><div><span className="eyebrow">ESTILOS</span><h2 id="referenceManagerTitle">Tipos y referencias</h2><p>Cada estilo tiene sus propias imágenes. FLUX copia su trazo, colores y personajes; en «En blanco» no hay referencias y el director tiene total libertad.</p></div><button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></header>
    <div className="reference-filters" role="tablist" aria-label="Filtrar por estilo">
      <button type="button" role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>Todos <small>{references.length}</small></button>
      {styles.map((style) => <button type="button" role="tab" key={style.id} aria-selected={filter === style.id} className={filter === style.id ? 'selected' : ''} onClick={() => { setFilter(style.id); setConfirmStyleDelete(false); }}>{style.name} <small>{style.kind === 'free' ? 'libre' : countFor(style.id)}</small></button>)}
      <button type="button" className="reference-filters__new" onClick={() => setCreating((value) => !value)}><Plus size={12} /> Nuevo estilo</button>
    </div>
    {creating && <div className="style-form"><input value={newName} maxLength={40} onChange={(event) => setNewName(event.target.value)} placeholder="Nombre del estilo (p. ej. Acuarela infantil)" autoFocus /><textarea value={newDescription} maxLength={400} onChange={(event) => setNewDescription(event.target.value)} placeholder="Nota de estilo opcional para el director: técnica, colores, tipo de personajes…" /><div><button type="button" className="quiet-action" onClick={() => setCreating(false)} disabled={busy}>Cancelar</button><button type="button" className="editor-action" onClick={createStyle} disabled={busy || !newName.trim()}>{busy ? <Loader2 size={13} className="spin" /> : <Check size={13} />} Crear estilo</button></div></div>}
    {errors.length > 0 && <div className="error-box">{errors.join(' · ')}</div>}
    {active && <div className="style-summary"><div><b>{active.name}</b><p>{styleHint(active)}</p></div>{!active.builtin && (confirmStyleDelete
      ? <div className="style-summary__confirm"><span>{countFor(active.id) ? `¿Eliminar el estilo y ${countFor(active.id) === 1 ? 'su imagen' : `sus ${countFor(active.id)} imágenes`}?` : '¿Eliminar este estilo?'}</span><button type="button" className="quiet-action" onClick={() => setConfirmStyleDelete(false)} disabled={busy}>Cancelar</button><button type="button" className="danger-action" onClick={deleteStyle} disabled={busy}><Trash2 size={13} /> Eliminar estilo</button></div>
      : <button type="button" className="quiet-action" onClick={() => setConfirmStyleDelete(true)}><Trash2 size={13} /> Eliminar estilo</button>)}</div>}
    {active && active.kind !== 'free' && countFor(active.id) > maxActive && <div className="reference-manager__notice">Este estilo tiene {countFor(active.id)} referencias: solo se usarán las {maxActive} primeras.</div>}
    {active?.kind === 'free'
      ? <div className="reference-free"><Sparkles size={22} /><b>Sin referencias, a propósito</b><p>Con «En blanco» el director (Qwen3) lee el guion, elige un estilo de dibujo, diseña los personajes y los mantiene iguales en todas las escenas. Si quieres guiarlo con imágenes, crea un estilo propio.</p></div>
      : <div className="reference-manager__grid">
        {visible.map((reference) => { const position = activeIndexById.get(reference.id) ?? 0; return <figure key={reference.id} className={`reference-card${position >= maxActive ? ' is-inactive' : ''}`}><img src={reference.url} alt={reference.label} /><figcaption><b>{reference.label}</b><small>{filter === 'all' ? styleName(reference.styleId) : position < maxActive ? 'Activa' : 'Fuera del límite'}</small></figcaption>
          {pendingDelete === reference.id
            ? <div className="reference-card__confirm"><span>¿Eliminar esta referencia?</span><div><button type="button" onClick={() => setPendingDelete(null)} disabled={busy}>Cancelar</button><button type="button" className="danger" onClick={() => run(async () => { await library.remove(reference.id); setPendingDelete(null); })} disabled={busy}>{busy ? <Loader2 size={12} className="spin" /> : <Trash2 size={12} />} Eliminar</button></div></div>
            : <button type="button" className="reference-card__delete" onClick={() => setPendingDelete(reference.id)} aria-label={`Eliminar ${reference.label}`} disabled={busy}><Trash2 size={13} /></button>}
        </figure>; })}
        {active
          ? <label className={`reference-card reference-card--add${busy ? ' is-busy' : ''}`}>{busy ? <Loader2 size={20} className="spin" /> : <Upload size={20} />}<b>Añadir a {active.name}</b><small>PNG, JPG o WEBP · máx. 12 MB</small><input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={upload} disabled={busy} /></label>
          : <div className="reference-card reference-card--add is-hint"><Images size={20} /><b>Elige un estilo</b><small>Filtra por un estilo para añadirle imágenes</small></div>}
      </div>}
    <footer className="reference-manager__foot"><button type="button" className="quiet-action" onClick={() => run(library.restore)} disabled={busy}><RotateCcw size={13} /> Restaurar referencias Monos</button><button type="button" className="editor-action" onClick={() => { if (active) library.setStyleId(active.id); onClose(); }}><Check size={14} /> {active ? `Usar ${active.name}` : 'Listo'}</button></footer>
  </div></div>;
}

type SavedScript = { id: string; title: string; idea: string; body: string; seconds: number; tone: string; createdAt: string };

type ChatOption<T extends string | number> = { value: T; label: string; detail: string; tags: string[]; icon: typeof Sparkles };

const SCRIPT_DURATIONS: ChatOption<number>[] = [
  { value: 30, label: '30 segundos', detail: 'Gancho rápido para Reels y TikTok', tags: ['~75 palabras', 'Vertical'], icon: Zap },
  { value: 60, label: '1 minuto', detail: 'El formato estándar de Shorts', tags: ['~150 palabras', 'Shorts'], icon: Timer },
  { value: 120, label: '2 minutos', detail: 'Historia con desarrollo y giro', tags: ['~300 palabras', 'Relato'], icon: Clock3 },
  { value: 180, label: '3 minutos', detail: 'Vídeo completo para YouTube', tags: ['~450 palabras', 'YouTube'], icon: Film },
  { value: 300, label: '5 minutos', detail: 'Episodio largo con varios actos', tags: ['~750 palabras', 'Episodio'], icon: Clapperboard },
];
const SCRIPT_TONES: ChatOption<string>[] = [
  { value: 'narrativo', label: 'Narrativo', detail: 'Cercano, como un buen cuentacuentos', tags: ['Versátil'], icon: BookOpen },
  { value: 'epico', label: 'Épico', detail: 'Tensión creciente y un clímax claro', tags: ['Acción', 'Carreras'], icon: Swords },
  { value: 'divertido', label: 'Divertido', detail: 'Humor blanco y giros inesperados', tags: ['Comedia'], icon: Smile },
  { value: 'documental', label: 'Documental', detail: 'Informativo, con datos concretos', tags: ['Divulgación'], icon: GraduationCap },
  { value: 'misterio', label: 'Misterio', detail: 'Atmósfera, intriga y revelación final', tags: ['Suspense'], icon: Ghost },
  { value: 'infantil', label: 'Infantil', detail: 'Tierno y sencillo para peques', tags: ['Familia'], icon: Baby },
];

// Desplegable del chat de guiones: tarjetas con icono, etiquetas y check.
function ChatDropdown<T extends string | number>({ title, options, value, onChange, compactLabel }: { title: string; options: ChatOption<T>[]; value: T; onChange: (value: T) => void; compactLabel?: (option: ChatOption<T>) => string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) || options[0];
  const Icon = selected.icon;
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className={`chat-dropdown${open ? ' is-open' : ''}`} ref={rootRef}>
    <button type="button" className="chat-dropdown__trigger" onClick={() => setOpen((current) => !current)} aria-haspopup="listbox" aria-expanded={open}><span className="chat-dropdown__icon"><Icon size={12} /></span><span>{compactLabel ? compactLabel(selected) : selected.label}</span><ChevronDown size={13} className="chat-dropdown__chevron" /></button>
    {open && <div className="chat-dropdown__menu" role="listbox" aria-label={title}>
      <span className="chat-dropdown__title">{title}</span>
      {options.map((option) => {
        const OptionIcon = option.icon;
        const active = option.value === value;
        return <button type="button" role="option" aria-selected={active} key={String(option.value)} className={`chat-dropdown__option${active ? ' is-active' : ''}`} onClick={() => { onChange(option.value); setOpen(false); }}>
          <span className="chat-dropdown__badge"><OptionIcon size={13} /></span>
          <span className="chat-dropdown__copy"><b>{option.label}</b><small>{option.detail}</small><span className="chat-dropdown__tags">{option.tags.map((tag) => <em key={tag}>{tag}</em>)}</span></span>
          <span className="chat-dropdown__check">{active && <Check size={11} />}</span>
        </button>;
      })}
    </div>}
  </div>;
}

const ART_TYPE_ICONS: Record<string, typeof Sparkles> = {
  auto: Sparkles, dibujo: PenTool, anime: Wand2, realista: Camera, natural: Leaf, comic: BookOpen, rotulador: Highlighter,
  cera: Baby, 'mal-pintado': Frown, acuarela: Droplets, lapiz: Pencil, oleo: Paintbrush, '3d': Box, plastilina: Shapes,
  pixel: Grid3x3, vector: Shapes, papel: Scissors,
};
const ART_TYPE_OPTIONS: ChatOption<string>[] = ART_TYPES.map((type) => ({ value: type.id, label: type.label, detail: type.detail, tags: type.tags, icon: ART_TYPE_ICONS[type.id] || Brush }));
const ART_TYPE_STORAGE_KEY = 'videolab.artType';

function ArtTypePicker({ value, onChange, locked }: { value: string; onChange: (value: string) => void; locked: boolean }) {
  return <div className="art-type-picker"><div className="control-heading"><span><Brush size={12} /> Tipo de imagen</span><small>{locked ? 'fijado por Monos' : `${ART_TYPES.length - 1} técnicas`}</small></div>{locked
    ? <div className="art-type-locked">Monos usa siempre su propio dibujo (lo marcan sus referencias). Elige «En blanco», «Fondo blanco» o un estilo propio para cambiar la técnica.</div>
    : <ChatDropdown title="Técnica de las imágenes" options={ART_TYPE_OPTIONS} value={value} onChange={onChange} />}</div>;
}

// El modelo responde «Título: …» en la primera línea y después el guion.
function splitScriptTitle(raw: string) {
  const match = /^\s*T[ií]tulo\s*:\s*([^\n]*)(\n|$)/i.exec(raw);
  if (!match) return { title: '', body: raw.trimStart() };
  return { title: match[1].replace(/[*"«»]/g, '').trim(), body: raw.slice(match[0].length).trimStart() };
}

function countWords(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

function useSavedScripts() {
  const [scripts, setScripts] = useState<SavedScript[]>([]);
  const refresh = async () => {
    try {
      const response = await fetch('/api/scripts', { cache: 'no-store' });
      if (response.ok) setScripts((await response.json()).scripts || []);
    } catch { /* el servidor puede estar arrancando */ }
  };
  useEffect(() => { refresh(); }, []);
  const save = async (script: Omit<SavedScript, 'id' | 'createdAt'>) => {
    const response = await fetch('/api/scripts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(script) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar el guion.');
    setScripts((current) => [data.script, ...current]);
    return data.script as SavedScript;
  };
  const remove = async (id: string) => {
    const response = await fetch(`/api/scripts/${id}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new Error('No se pudo eliminar el guion.');
    setScripts((current) => current.filter((script) => script.id !== id));
  };
  return { scripts, save, remove, refresh };
}

type SavedScripts = ReturnType<typeof useSavedScripts>;

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function ScriptStudio({ library, onUseScript }: { library: SavedScripts; onUseScript: (text: string) => void }) {
  const [idea, setIdea] = useState('');
  const [seconds, setSeconds] = useState(60);
  const [tone, setTone] = useState('narrativo');
  const [phase, setPhase] = useState<'idle' | 'writing' | 'done' | 'error'>('idle');
  const [shown, setShown] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);
  const targetRef = useRef('');
  const streamDoneRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);

  // Máquina de escribir: el texto llega a trozos del modelo y se muestra letra
  // a letra; si se acumula mucho retraso, avanza un poco más rápido.
  useEffect(() => {
    if (phase !== 'writing') return;
    const timer = window.setInterval(() => {
      setShown((current) => {
        const target = targetRef.current;
        if (current.length >= target.length) {
          if (streamDoneRef.current) setPhase('done');
          return current;
        }
        const backlog = target.length - current.length;
        const step = backlog > 400 ? 6 : backlog > 160 ? 3 : backlog > 50 ? 2 : 1;
        return target.slice(0, current.length + step);
      });
    }, 22);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    const element = outputRef.current;
    if (element && phase === 'writing') element.scrollTop = element.scrollHeight;
  }, [shown, phase]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const generate = async () => {
    if (!idea.trim() || phase === 'writing') return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    targetRef.current = '';
    streamDoneRef.current = false;
    setShown('');
    setError('');
    setNotice('');
    setSavedId(null);
    setPhase('writing');
    try {
      const response = await fetch('/api/scripts/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea, seconds, tone }), signal: controller.signal });
      if (!response.ok || !response.body) throw new Error((await response.json().catch(() => ({}))).error || 'No se pudo generar el guion.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        targetRef.current += decoder.decode(value, { stream: true });
      }
      targetRef.current += decoder.decode();
      streamDoneRef.current = true;
    } catch (caught) {
      if (controller.signal.aborted) { streamDoneRef.current = true; return; }
      setError(caught instanceof Error ? caught.message : 'No se pudo generar el guion.');
      setPhase(targetRef.current ? 'done' : 'error');
      streamDoneRef.current = true;
    }
  };

  const stop = () => {
    controllerRef.current?.abort();
    streamDoneRef.current = true;
    setShown(targetRef.current);
    setPhase('done');
  };

  const reset = () => {
    controllerRef.current?.abort();
    targetRef.current = '';
    setShown('');
    setPhase('idle');
    setError('');
    setNotice('');
    setSavedId(null);
  };

  const { title, body } = splitScriptTitle(shown);
  const words = countWords(body);
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2200); };
  const save = async () => {
    try {
      const script = await library.save({ title, idea, body, seconds: Math.round(words / 2.5), tone });
      setSavedId(script.id);
      flash('Guion guardado en «Guiones guardados».');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar.');
    }
  };
  const raised = phase !== 'idle';

  return <section className={`script-studio${raised ? ' is-raised' : ''}`}>
    <video className="script-studio__video" src="/assets/guiones-bg.mp4" autoPlay muted loop playsInline aria-hidden="true" />
    <div className="script-studio__shade" aria-hidden="true" />
    <div className="script-studio__intro"><span className="eyebrow">GUIONES · QWEN3 LOCAL</span><h1>De una idea a un <i>guion narrado.</i></h1><p>Describe la historia y el director la escribe lista para generar el storyboard y la voz.</p></div>
    <div className="script-chat">
      <span className="script-chat__label">Describe la idea de tu guion</span>
      <textarea value={idea} maxLength={4000} onChange={(event) => setIdea(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) generate(); }} placeholder="Un mono piloto que pierde su coche la noche antes de la gran carrera y tiene que construir otro con chatarra…" rows={raised ? 2 : 3} />
      <div className="script-chat__bar">
        <ChatDropdown title="Duración del guion" options={SCRIPT_DURATIONS} value={seconds} onChange={setSeconds} compactLabel={(option) => option.label.replace('segundos', 's').replace('minutos', 'min').replace('minuto', 'min')} /><ChatDropdown title="Tono de la narración" options={SCRIPT_TONES} value={tone} onChange={setTone} /><span className="script-chat__model"><span className="online-dot" /> Qwen3-4B · local</span>
        {phase === 'writing'
          ? <button type="button" className="script-chat__send is-stop" onClick={stop}><Square size={13} /> Detener</button>
          : <button type="button" className="script-chat__send" onClick={generate} disabled={!idea.trim()}><WandSparkles size={15} /> Generar <small>~{Math.round(seconds * 2.5)} palabras</small></button>}
      </div>
    </div>
    <div className="script-output" aria-live="polite">
      <header><div><span className="eyebrow">{phase === 'writing' ? 'ESCRIBIENDO…' : phase === 'error' ? 'ERROR' : 'GUION'}</span><h2>{title || (phase === 'writing' ? 'Pensando la historia…' : 'Guion generado')}</h2></div><small>{words} palabras · ~{Math.max(1, Math.round(words / 2.5))} s de voz</small></header>
      <div className="script-output__body" ref={outputRef}>{body}{phase === 'writing' && <span className="script-caret" />}{phase === 'error' && <p className="script-output__error">{error}</p>}</div>
      {error && phase !== 'error' && <div className="error-box">{error}</div>}
      <footer>
        <button type="button" className="quiet-action" onClick={reset}><RotateCcw size={13} /> Nuevo guion</button>
        <div>
          {notice && <span className="script-notice"><Check size={12} /> {notice}</span>}
          <button type="button" className="quiet-action" onClick={async () => flash(await copyText(title ? `${title}\n\n${body}` : body) ? 'Copiado al portapapeles.' : 'No se pudo copiar.')} disabled={!body || phase === 'writing'}><Copy size={13} /> Copiar</button>
          <button type="button" className="quiet-action" onClick={save} disabled={!body || phase === 'writing' || Boolean(savedId)}>{savedId ? <><Check size={13} /> Guardado</> : <><BookmarkPlus size={13} /> Guardar</>}</button>
          <button type="button" className="editor-action" onClick={() => onUseScript(body)} disabled={!body || phase === 'writing'}><Film size={14} /> Usar en storyboard</button>
        </div>
      </footer>
    </div>
  </section>;
}

function SavedScriptsView({ library, onUseScript }: { library: SavedScripts; onUseScript: (text: string) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<SavedScript | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const cancelDelete = useCallback(() => { if (!busy) setToDelete(null); }, [busy]);
  const toneLabel = (value: string) => SCRIPT_TONES.find((tone) => tone.value === value)?.label || value;
  return <section className="library-view"><div className="view-heading"><div><span className="eyebrow">ARCHIVO LOCAL</span><h2>Guiones guardados</h2><p>Los guiones que escribes en «Guiones». Cópialos o llévalos directamente al creador de storyboards.</p></div><span className="folder-badge"><FileText size={14} /> data/scripts</span></div>
    {!library.scripts.length ? <div className="no-records"><FileText size={22} /><p>Aún no has guardado ningún guion.</p></div> : <div className="saved-scripts">{library.scripts.map((script) => {
      const open = openId === script.id;
      return <article key={script.id} className={`saved-script${open ? ' is-open' : ''}`}>
        <button type="button" className="saved-script__head" onClick={() => setOpenId(open ? null : script.id)}><div><b>{script.title}</b><small>{formatDate(script.createdAt)} · {toneLabel(script.tone)} · {countWords(script.body)} palabras · ~{Math.max(1, Math.round(countWords(script.body) / 2.5))} s</small></div><ChevronDown size={15} /></button>
        <p className="saved-script__text">{script.body}</p>
        {open && script.idea && <p className="saved-script__idea"><b>Idea:</b> {script.idea}</p>}
        <div className="saved-script__actions"><button type="button" className="quiet-action" onClick={async () => { if (await copyText(`${script.title}\n\n${script.body}`)) { setCopiedId(script.id); window.setTimeout(() => setCopiedId(null), 1800); } }}>{copiedId === script.id ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar</>}</button><button type="button" className="editor-action" onClick={() => onUseScript(script.body)}><Film size={14} /> Usar en storyboard</button><button type="button" className="recent-delete saved-script__delete" onClick={() => setToDelete(script)} aria-label={`Eliminar ${script.title}`}><Trash2 size={13} /></button></div>
      </article>;
    })}</div>}
    {toDelete && <ConfirmDialog title="Eliminar guion" message={`Se borrará «${toDelete.title}». No se puede deshacer.`} confirmLabel="Eliminar" busy={busy} onCancel={cancelDelete} onConfirm={async () => { setBusy(true); try { await library.remove(toDelete.id); setToDelete(null); } finally { setBusy(false); } }} />}
  </section>;
}

const EDIT_SUGGESTIONS = [
  'Quita la mano que sobra',
  'Arregla la cara para que se vea natural',
  'Quita cualquier texto o letra',
  'Que mire hacia la cámara',
  'Haz la escena más luminosa',
];

function SceneEditDialog({ image, onClose, onSubmit, onUndo }: { image: GeneratedImage; onClose: () => void; onSubmit: (instruction: string) => void; onUndo: () => void }) {
  const [instruction, setInstruction] = useState('');
  useEscape(onClose);
  const editCount = Math.max(0, (image.versions?.length || 1) - 1);
  const lastEdit = image.edits?.[image.edits.length - 1];
  const submit = () => { if (instruction.trim()) onSubmit(instruction.trim()); };
  return <div className="image-modal-backdrop" role="presentation" onClick={onClose}><div className="scene-edit" role="dialog" aria-modal="true" aria-labelledby="sceneEditTitle" onClick={(event) => event.stopPropagation()}>
    <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
    <div className="scene-edit__preview"><img src={image.url} alt={`Escena ${image.sceneId}`} />{editCount > 0 && <span className="scene-edit__badge">Editada {editCount}×</span>}</div>
    <div className="scene-edit__form">
      <span className="eyebrow">ESCENA {String(image.sceneId).padStart(2, '0')} · EDITAR CON IA</span>
      <h2 id="sceneEditTitle">¿Qué está mal o qué quieres cambiar?</h2>
      <p>Describe el problema («el niño está dentro de la tortuga», «tiene tres manos») o da la orden («ponle una gorra azul»). El director decide: los retoques pequeños se aplican sobre la imagen y los fallos de postura, posición o anatomía se corrigen redibujando la escena.</p>
      <textarea value={instruction} autoFocus maxLength={600} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(); }} placeholder="Por ejemplo: el niño está fundido con la tortuga, tienen que estar separados" />
      <div className="scene-edit__chips">{EDIT_SUGGESTIONS.map((suggestion) => <button type="button" key={suggestion} onClick={() => setInstruction(suggestion)}>{suggestion}</button>)}</div>
      {lastEdit && <small className="scene-edit__last">Última edición: «{lastEdit.instruction}»</small>}
      <div className="scene-edit__actions">
        {editCount > 0 && <button type="button" className="quiet-action" onClick={onUndo}><Undo2 size={13} /> Deshacer última edición</button>}
        <button type="button" className="scene-edit__submit" onClick={submit} disabled={!instruction.trim()}><Wand2 size={15} /> Editar imagen</button>
      </div>
    </div>
  </div></div>;
}

function ConfirmDialog({ title, message, confirmLabel, busy, onConfirm, onCancel }: { title: string; message: string; confirmLabel: string; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  useEscape(onCancel);
  return <div className="image-modal-backdrop" role="presentation" onClick={onCancel}><div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirmTitle" onClick={(event) => event.stopPropagation()}><span className="confirm-dialog__icon"><Trash2 size={18} /></span><h2 id="confirmTitle">{title}</h2><p>{message}</p><div><button type="button" className="quiet-action" onClick={onCancel} disabled={busy}>Cancelar</button><button type="button" className="danger-action" onClick={onConfirm} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} {confirmLabel}</button></div></div></div>;
}

const VOICE_STORAGE_KEY = 'racingmonos.voiceId';

type VoiceQuota = { used: number; limit: number; resetsAt: number | null } | null;

function VoicePicker({ voices, voiceId, onChange, notice, quota, freePlan, scriptLength }: { voices: VoiceOption[]; voiceId: string; onChange: (id: string) => void; notice: string; quota: VoiceQuota; freePlan: boolean; scriptLength: number }) {
  const [playing, setPlaying] = useState('');
  const [filter, setFilter] = useState('Disponibles');
  const [search, setSearch] = useState('');
  const [player] = useState(() => (typeof Audio === 'undefined' ? null : new Audio()));
  useEffect(() => {
    if (!player) return;
    const stop = () => setPlaying('');
    player.addEventListener('ended', stop);
    player.addEventListener('error', stop);
    return () => { player.pause(); player.removeEventListener('ended', stop); player.removeEventListener('error', stop); };
  }, [player]);
  const togglePreview = (voice: VoiceOption) => {
    if (!player || !voice.previewUrl) return;
    if (playing === voice.id) { player.pause(); setPlaying(''); return; }
    player.src = voice.previewUrl;
    void player.play().then(() => setPlaying(voice.id)).catch(() => setPlaying(''));
  };
  // Filtros: las que se pueden usar ya, y luego cada acento de la biblioteca.
  const accents = useMemo(() => {
    const counts = new Map<string, number>();
    voices.forEach((voice) => { const key = voice.accent || 'Español'; counts.set(key, (counts.get(key) || 0) + 1); });
    return [...counts.entries()].sort((first, second) => second[1] - first[1]).map(([accent]) => accent);
  }, [voices]);
  const usable = voices.filter((voice) => !voice.locked);
  const query = search.trim().toLowerCase();
  const shown = voices
    .filter((voice) => filter === 'Disponibles' ? !voice.locked : filter === 'Todas' ? true : (voice.accent || 'Español') === filter)
    .filter((voice) => !query || `${voice.name} ${voice.detail}`.toLowerCase().includes(query))
    .sort((first, second) => Number(Boolean(first.locked)) - Number(Boolean(second.locked)));
  const remaining = quota ? Math.max(0, quota.limit - quota.used) : null;
  return <>
    <div className="voice-filters">
      {['Disponibles', 'Todas', ...accents].map((item) => <button type="button" key={item} className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)}>{item}{item === 'Disponibles' && <small>{usable.length}</small>}</button>)}
    </div>
    {voices.length > 8 && <input className="voice-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Buscar entre ${voices.length} voces en español…`} />}
    <div className="voice-picker">{shown.map((voice) => <div key={voice.id} className={`voice-option ${voiceId === voice.id ? 'selected' : ''}${voice.locked ? ' is-locked' : ''}`}><button type="button" className="voice-select" onClick={() => !voice.locked && onChange(voice.id)} disabled={voice.locked} title={voice.locked ? 'Voz de la biblioteca de ElevenLabs: requiere un plan de pago para usarla por API' : undefined}><span className="voice-icon">{voice.locked ? <Lock size={12} /> : <Volume2 size={13} />}</span><span><b>{voice.name}<em className="voice-tag">{voice.accent || 'ES'}</em></b><small>{voice.detail}</small></span>{voiceId === voice.id && <Check size={14} />}</button>{voice.previewUrl && <button type="button" className="voice-preview" aria-label={`Escuchar ${voice.name}`} onClick={() => togglePreview(voice)}>{playing === voice.id ? <Pause size={12} /> : <Play size={12} />}</button>}</div>)}{!shown.length && <div className="voice-empty">No hay voces con este filtro.</div>}</div>
    {remaining !== null && <div className={`voice-quota${scriptLength > remaining ? ' is-short' : ''}`}><span>Te quedan <b>{remaining.toLocaleString('es-ES')}</b> de {quota!.limit.toLocaleString('es-ES')} caracteres este mes{quota!.resetsAt ? ` · se renueva el ${new Date(quota!.resetsAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}` : ''}</span>{scriptLength > remaining && <small>Este guion ocupa {scriptLength.toLocaleString('es-ES')} caracteres: no hay cuota suficiente para narrarlo entero.</small>}</div>}
    {freePlan && <div className="voice-notice">Plan gratuito de ElevenLabs: puedes usar las voces sin candado. Las {voices.filter((voice) => voice.locked).length} voces nativas de la biblioteca (España, México, Argentina…) necesitan un plan de pago; puedes escucharlas igualmente.</div>}
    {notice && <div className="voice-notice">{notice}</div>}
  </>;
}

function useVoices() {
  const [voices, setVoices] = useState<VoiceOption[]>(ELEVENLABS_VOICES);
  const [voiceId, setVoiceIdState] = useState<string>(ELEVENLABS_VOICES[0].id);
  const [voiceNotice, setVoiceNotice] = useState('');
  const [quota, setQuota] = useState<VoiceQuota>(null);
  const [freePlan, setFreePlan] = useState(false);
  const setVoiceId = (id: string) => { setVoiceIdState(id); try { localStorage.setItem(VOICE_STORAGE_KEY, id); } catch {} };
  useEffect(() => {
    let cancelled = false;
    fetch('/api/voices').then((response) => response.json()).then((data: { configured?: boolean; voices?: VoiceOption[]; defaultVoiceId?: string; error?: string; characters?: VoiceQuota; freePlan?: boolean }) => {
      if (cancelled) return;
      const list = Array.isArray(data.voices) && data.voices.length ? data.voices : ELEVENLABS_VOICES;
      setVoices(list);
      setQuota(data.characters || null);
      setFreePlan(Boolean(data.freePlan));
      let stored = '';
      try { stored = localStorage.getItem(VOICE_STORAGE_KEY) || ''; } catch {}
      const preferred = [stored, data.defaultVoiceId].find((id) => id && list.some((voice) => voice.id === id && !voice.locked));
      setVoiceIdState(preferred || list[0].id);
      if (!data.configured) setVoiceNotice('Añade ELEVENLABS_API_KEY en .env.local para cargar tus voces y generar la narración.');
      else if (data.error) setVoiceNotice(`No se pudieron cargar tus voces: ${data.error}`);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const selectedVoice = voices.find((voice) => voice.id === voiceId);
  const voiceName = selectedVoice?.name || voiceId;
  // Las voces de la biblioteca se envían con su propietario para añadirlas a la cuenta.
  const libraryOwnerId = selectedVoice?.source === 'library' ? selectedVoice.ownerId || '' : '';
  return { voices, voiceId, setVoiceId, voiceNotice, voiceName, libraryOwnerId, quota, freePlan };
}

type VoiceControls = ReturnType<typeof useVoices>;

// Genera (o regenera con otra voz) la narración de un storyboard con ElevenLabs.
async function requestNarration(storyboardId: string, script: string, voiceId: string, voiceName: string, libraryOwnerId = '') {
  const response = await fetch(`/api/storyboards/${storyboardId}/voice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ script, voiceId, voiceName, libraryOwnerId }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'No se pudo generar la voz.');
  return String(payload.voiceName || voiceName);
}

function PromptPanel({ voice, references, onEditReferences, incomingScript, onImage, onReset, onProgress, onFinished, onStoryboardId, onVoiceState }: { voice: VoiceControls; references: ReferenceLibrary; onEditReferences: () => void; incomingScript: { text: string; nonce: number } | null; onImage: (image: GeneratedImage) => void; onReset: () => void; onProgress: (progress: GenerationProgress) => void; onFinished: () => void; onStoryboardId: (id: string) => void; onVoiceState: (state: VoiceState) => void }) {
  const [script, setScript] = useState('Fuji, 1976. Dos monos pilotos se preparan para la carrera bajo la lluvia. El mono de chaqueta roja aprieta los puños. El semáforo cambia y los dos coches salen disparados. En la última curva, el piloto rojo adelanta por el interior y cruza la meta celebrando.');
  const [interval, setIntervalValue] = useState(4);
  const [artType, setArtTypeState] = useState('auto');
  useEffect(() => { try { const stored = localStorage.getItem(ART_TYPE_STORAGE_KEY); if (stored && ART_TYPES.some((type) => type.id === stored)) setArtTypeState(stored); } catch {} }, []);
  const setArtType = (value: string) => { setArtTypeState(value); try { localStorage.setItem(ART_TYPE_STORAGE_KEY, value); } catch {} };
  useEffect(() => { if (incomingScript) setScript(incomingScript.text.slice(0, SCRIPT_LIMIT)); }, [incomingScript]);
  const [ratio, setRatio] = useState<'9:16' | '16:9'>('9:16');
  const { voices, voiceId, setVoiceId, voiceNotice, voiceName } = voice;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sceneCount = useMemo(() => estimateSceneCount(script, interval), [script, interval]);

  async function generate() {
    setError('');
    if (!script.trim()) { setError('Escribe un guion para continuar.'); return; }
    setLoading(true);
    onReset();
    onVoiceState({ status: 'idle' });
    onProgress({ current: 0, total: sceneCount, status: 'generating' });
    try {
      const form = new FormData();
      form.append('script', script);
      form.append('intervalSeconds', String(interval));
      form.append('aspectRatio', ratio);
      form.append('style', references.styleId);
      form.append('artType', references.style?.kind === 'monos' ? 'auto' : artType);
      form.append('stream', '1');
      const response = await fetch('/api/generate-images', { method: 'POST', body: form });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'No se pudo generar el storyboard'); }
      if (!response.body) throw new Error('El navegador no puede recibir el progreso de generación.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;
      const handleEvent = async (event: any) => {
        if (event.type === 'start') { onStoryboardId(event.storyboardId); onProgress({ current: 0, total: event.total, status: 'generating' }); }
        if (event.type === 'scene-start') onProgress({ current: event.current - 1, total: event.total, status: 'generating', caption: event.caption });
        if (event.type === 'scene-complete') { onImage(event.image); onProgress({ current: event.current, total: event.total, status: 'generating', caption: event.image.caption }); }
        if (event.type === 'complete') {
          onStoryboardId(event.storyboardId);
          onVoiceState({ status: 'generating', name: voiceName });
          onProgress({ current: event.total, total: event.total, status: 'generating', caption: 'Sintetizando voz con ElevenLabs…' });
          try {
            onVoiceState({ status: 'ready', name: await requestNarration(event.storyboardId, script, voiceId, voiceName, voice.libraryOwnerId) });
          } catch (voiceError) {
            onVoiceState({ status: 'error', name: voiceName, error: voiceError instanceof Error ? voiceError.message : 'No se pudo generar la voz.' });
          }
          completed = true;
          onProgress({ current: event.total, total: event.total, status: 'complete' });
        }
        if (event.type === 'error') throw new Error(event.error || 'Error generando imágenes.');
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines.filter(Boolean)) await handleEvent(JSON.parse(line));
        if (done) break;
      }
      if (buffer.trim()) await handleEvent(JSON.parse(buffer));
      if (!completed) throw new Error('La generación terminó sin enviar el resultado final.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Error de generación');
      onProgress({ current: 0, total: sceneCount, status: 'error' });
    } finally { setLoading(false); onFinished(); }
  }

  return <section className="prompt-card"><div className="card-topline"><span className="eyebrow"><WandSparkles size={12} /> NUEVA CREACIÓN</span><span className="draft-state"><span /> Guardado local</span></div><div className="prompt-title"><h2>Del guion a tu storyboard</h2><p>{references.style?.kind === 'free' ? `Una ilustración cada ${interval} segundos; el director elige el estilo y los personajes según tu guion.` : `Una ilustración cada ${interval} segundos con el estilo ${references.style?.name || 'Monos'} siempre consistente.`}</p></div><div className="control-heading"><span>Guion</span><small>{script.length}/{SCRIPT_LIMIT}</small></div><textarea className="script-input" value={script} onChange={(event) => setScript(event.target.value.slice(0, SCRIPT_LIMIT))} placeholder="Pega aquí tu guion completo…" /><div className="script-hint"><Clock3 size={12} /> La IA lo dividirá en {sceneCount} escenas aproximadas</div><StylePicker library={references} onEdit={onEditReferences} /><ArtTypePicker value={artType} onChange={setArtType} locked={references.style?.kind === 'monos'} /><ReferencePicker library={references} onEdit={onEditReferences} /><div className="control-heading voice-heading"><span><Volume2 size={12} /> Voz española</span><small>ElevenLabs</small></div><VoicePicker voices={voices} voiceId={voiceId} onChange={setVoiceId} notice={voiceNotice} quota={voice.quota} freePlan={voice.freePlan} scriptLength={script.length} /><div className="control-grid"><div><div className="control-heading"><span>Duración por imagen</span></div><div className="segmented">{[3, 4, 5].map((seconds) => <button type="button" key={seconds} className={interval === seconds ? 'selected' : ''} onClick={() => setIntervalValue(seconds)}>{seconds}s</button>)}</div></div><div><div className="control-heading"><span>Formato</span></div><div className="segmented ratio-segment">{(['9:16', '16:9'] as const).map((value) => <button type="button" key={value} className={ratio === value ? 'selected' : ''} onClick={() => setRatio(value)}>{value}</button>)}</div></div></div>{error && <div className="error-box">{error}</div>}<button type="button" className="primary-action" onClick={generate} disabled={loading}>{loading ? <><Loader2 size={16} className="spin" /> Generando escenas…</> : <><Sparkles size={16} /> Generar storyboard <span>{sceneCount}</span></>}</button><div className="prompt-footer"><span><span className="green-dot" /> FLUX.2 Klein 4B</span><span><Volume2 size={11} /> Voz al finalizar</span></div></section>;
}

function EmptyGallery({ onCreate }: { onCreate: () => void }) {
  return <div className="empty-gallery"><div className="empty-visual"><img src={HERO_IMAGE} alt="Estilo visual Monos" /><div className="empty-visual-overlay"><Play size={16} fill="currentColor" /></div></div><div className="empty-copy"><span className="eyebrow">TU CANVAS</span><h2>Tu storyboard aparecerá aquí</h2><p>Escribe una historia y crea una secuencia visual lista para montar.</p><button type="button" className="secondary-action" onClick={onCreate}>Crear primera escena <ArrowUpRight size={14} /></button></div></div>;
}

function ProgressBar({ progress, generating }: { progress: GenerationProgress; generating: boolean }) {
  if (!generating && progress.status !== 'complete' && progress.status !== 'error') return null;
  const percent = progress.total ? Math.min(100, Math.round(progress.current / progress.total * 100)) : 0;
  return <div className={`progress-wrap ${progress.status === 'error' ? 'is-error' : ''}`}><div className="progress-line"><span style={{ width: `${percent}%` }} /></div><div className="progress-label"><span>{progress.status === 'error' ? 'La generación se detuvo' : generating ? (progress.current ? `Escena ${progress.current} de ${progress.total}` : 'Preparando primera escena') : `${progress.total} escenas guardadas`}</span><b>{percent}%</b></div></div>;
}

function Gallery({ images, onDownload, onOpen, onDownloadImage, progress, generating, onCreate, storyboardId, voiceState, onGenerateVoice, selectedVoiceName, onEditImage, editingScenes, editErrors, record, onSaveMap, onRegenerate }: { record: StoryboardRecord | null; onSaveMap: (state: MapState) => void; onRegenerate: (image: MapImage, description: string) => void; onEditImage: (image: GeneratedImage) => void; editingScenes: Record<number, boolean>; editErrors: Record<number, string>; onGenerateVoice: () => void; selectedVoiceName: string; images: GeneratedImage[]; onDownload: () => void; onOpen: (image: GeneratedImage) => void; onDownloadImage: (image: GeneratedImage) => void; progress: GenerationProgress; generating: boolean; onCreate: () => void; storyboardId: string | null; voiceState: VoiceState }) {
  const openEditor = () => { if (storyboardId) window.location.href = `/editor?storyboardId=${encodeURIComponent(storyboardId)}`; };
  // Vista de la galería: mapa de nodos (por defecto) o cuadrícula clásica.
  const [view, setViewState] = useState<'map' | 'grid'>('map');
  useEffect(() => { try { if (localStorage.getItem('videolab.galleryView') === 'grid') setViewState('grid'); } catch {} }, []);
  const setView = (next: 'map' | 'grid') => { setViewState(next); try { localStorage.setItem('videolab.galleryView', next); } catch {} };
  const mapImages: MapImage[] = images.map((image) => ({ ...image, description: image.description || record?.plan?.scenes?.[image.sceneId - 1] || image.caption }));
  return <section className="gallery-panel"><div className="gallery-heading"><div><span className="eyebrow">{generating ? 'GENERACIÓN EN DIRECTO' : 'STORYBOARD'}</span><h2>{generating ? `Generando ${progress.current}/${progress.total}` : images.length ? `${images.length} escenas listas` : 'Tus escenas'}</h2><p>{generating ? (progress.caption || 'Cada imagen aparece en cuanto termina en tu GPU.') : images.length ? 'Guardadas automáticamente en tu carpeta local.' : 'Elige crear para empezar una nueva secuencia.'}</p>{storyboardId && <code className="folder-path">data/storyboards/{storyboardId}</code>}{voiceState.status === 'generating' && <span className="voice-ready"><Loader2 size={12} className="spin" /> Generando narración · {voiceState.name}</span>}{voiceState.status === 'ready' && <span className="voice-ready"><Volume2 size={12} /> Voz lista · {voiceState.name}</span>}{voiceState.status === 'error' && <span className="voice-warning"><Volume2 size={12} /> {voiceState.error}</span>}</div><div className="gallery-actions">{images.length > 0 && <div className="gallery-view-switch" role="tablist" aria-label="Vista"><button type="button" className={view === 'map' ? 'selected' : ''} onClick={() => setView('map')}><Network size={12} /> Mapa</button><button type="button" className={view === 'grid' ? 'selected' : ''} onClick={() => setView('grid')}><LayoutGrid size={12} /> Cuadrícula</button></div>}{images.length > 0 && <button type="button" className="quiet-action" onClick={onDownload}><Archive size={14} /> Descargar ZIP</button>}{images.length > 0 && storyboardId && !generating && <button type="button" className="quiet-action" onClick={onGenerateVoice} disabled={voiceState.status === 'generating'} title={`Voz seleccionada: ${selectedVoiceName}`}>{voiceState.status === 'generating' ? <Loader2 size={14} className="spin" /> : <Volume2 size={14} />} {voiceState.status === 'ready' ? 'Cambiar voz' : 'Generar narración'}</button>}{images.length > 0 && storyboardId && <button type="button" className="editor-action" onClick={openEditor}><Film size={14} /> Abrir editor</button>}<button type="button" className="icon-button"><MoreHorizontal size={17} /></button></div></div><ProgressBar progress={progress} generating={generating} />{generating && !images.length && <div className="generation-placeholder"><Loader2 size={20} className="spin" /><span>Generando la primera imagen…</span></div>}{!images.length && !generating ? <EmptyGallery onCreate={onCreate} /> : view === 'map' && images.length > 0 ? <NodeMap storyboardKey={storyboardId || 'draft'} images={mapImages} script={record?.script || images.map((image) => image.caption).join(' ')} styleName={record?.styleName || 'Monos'} aspectRatio={record?.aspectRatio || '16:9'} initialState={record?.mapState} generating={generating} pendingCaption={progress.caption} editingScenes={editingScenes} editErrors={editErrors} onSave={onSaveMap} onRegenerate={onRegenerate} onEdit={(image) => onEditImage(image as GeneratedImage)} onOpen={(image) => onOpen(image as GeneratedImage)} onDownload={(image) => onDownloadImage(image as GeneratedImage)} /> : <div className="scene-grid">{images.map((image) => <article className={`scene-card${editingScenes[image.sceneId] ? ' is-editing' : ''}`} key={image.sceneId}><div className="scene-image-wrap" role="button" tabIndex={0} onClick={() => image.url && !editingScenes[image.sceneId] && onOpen(image)} onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => { if ((event.key === 'Enter' || event.key === ' ') && image.url) onOpen(image); }}><img src={image.url} alt={`Escena ${image.sceneId}`} /><span className="scene-index">{String(image.sceneId).padStart(2, '0')}</span><span className="scene-zoom"><ZoomIn size={12} /> Ver</span><div className="scene-tools"><button type="button" className="scene-tool" aria-label={`Editar escena ${image.sceneId}`} title="Editar con IA" disabled={editingScenes[image.sceneId] || generating} onClick={(event) => { event.stopPropagation(); onEditImage(image); }}><Wand2 size={13} /></button><button type="button" className="scene-tool" aria-label={`Descargar escena ${image.sceneId}`} title="Descargar" onClick={(event) => { event.stopPropagation(); onDownloadImage(image); }}><Download size={13} /></button></div>{(image.versions?.length || 1) > 1 && !editingScenes[image.sceneId] && <span className="scene-edited">Editada</span>}{editingScenes[image.sceneId] && <div className="scene-editing" aria-live="polite"><span className="scene-editing__blob scene-editing__blob--a" /><span className="scene-editing__blob scene-editing__blob--b" /><span className="scene-editing__blob scene-editing__blob--c" /><span className="scene-editing__label"><Wand2 size={13} /> Editando…</span></div>}{editErrors[image.sceneId] && !editingScenes[image.sceneId] && <span className="scene-edit-error" title={editErrors[image.sceneId]}>No se pudo editar</span>}</div><div className="scene-meta"><div><b>Escena {String(image.sceneId).padStart(2, '0')}</b><small>{image.time}</small></div><button type="button" aria-label="Regenerar escena"><RefreshCw size={13} /></button></div><p>{image.caption}</p></article>)}</div>}</section>;
}

function RecentList({ records, onOpen, onDelete }: { records: StoryboardRecord[]; onOpen: (record: StoryboardRecord) => void; onDelete: (record: StoryboardRecord) => void }) {
  if (!records.length) return <div className="no-records"><FolderPlus size={22} /><p>Aún no hay storyboards guardados.</p></div>;
  return <div className="recent-list">{records.map((record) => <div className="recent-row" key={record.id}><button type="button" className="recent-item" onClick={() => onOpen(record)}><div className="recent-cover">{record.images[0] ? <img src={record.images[0].url} alt="" /> : <img src={HERO_IMAGE} alt="" />}</div><div><b>{record.title}</b><small>{record.images.length} escenas · {formatDate(record.createdAt)}{record.audioUrl ? ' · con voz' : ''}</small></div><ArrowUpRight size={14} /></button><button type="button" className="recent-delete" onClick={() => onDelete(record)} aria-label={`Eliminar ${record.title}`} title="Eliminar storyboard"><Trash2 size={13} /></button></div>)}</div>;
}

function LibraryView({ records, onOpen, onDelete }: { records: StoryboardRecord[]; onOpen: (record: StoryboardRecord) => void; onDelete: (record: StoryboardRecord) => void }) {
  return <section className="library-view"><div className="view-heading"><div><span className="eyebrow">ARCHIVO LOCAL</span><h2>Mis storyboards</h2><p>Cada generación queda organizada en su propia carpeta. Elimina un storyboard para borrar sus imágenes, narración, montaje y vídeos exportados.</p></div><span className="folder-badge"><FolderOpen size={14} /> data/storyboards</span></div><RecentList records={records} onOpen={onOpen} onDelete={onDelete} /></section>;
}

function AssetsView({ records, references, styles }: { records: StoryboardRecord[]; references: ReferenceItem[]; styles: ReferenceStyle[] }) {
  const total = records.reduce((sum, record) => sum + record.images.length, 0);
  return <section className="library-view"><div className="view-heading"><div><span className="eyebrow">ASSETS</span><h2>Biblioteca visual</h2><p>Referencias de estilo y escenas generadas en local.</p></div><span className="folder-badge"><FileImage size={14} /> {total} imágenes</span></div><div className="asset-library-grid">{references.map((reference) => <div className="asset-card" key={reference.id}><img src={reference.url} alt={reference.label} /><div><b>{reference.label}</b><small>Referencia · {styles.find((style) => style.id === reference.styleId)?.name || 'estilo'}</small></div></div>)}{records.flatMap((record) => record.images.slice(0, 8)).map((image) => <div className="asset-card" key={`${image.url}-${image.sceneId}`}><img src={image.url} alt="Escena guardada" /><div><b>Escena {String(image.sceneId).padStart(2, '0')}</b><small>Storyboard local</small></div></div>)}</div></section>;
}

function ElementsView() {
  return <section className="library-view elements-view"><div className="view-heading"><div><span className="eyebrow">ELEMENTOS</span><h2>Dirección de arte</h2><p>El estilo Monos se aplica automáticamente a todas las escenas.</p></div></div><div className="art-direction"><img src={HERO_IMAGE} alt="Dirección de arte Monos" /><div><span className="eyebrow">ESTILO ACTIVO</span><h3>Monos / trazo limpio</h3><p>Ilustración plana 2D, contorno negro, colores sólidos y personajes recurrentes. Las cinco referencias se envían al motor local en cada generación.</p><div className="swatches"><span /><span /><span /><span /><span /></div></div></div></section>;
}

function ImageModal({ image, onClose, onDownload }: { image: GeneratedImage; onClose: () => void; onDownload: (image: GeneratedImage) => void }) {
  return <div className="image-modal-backdrop" role="presentation" onClick={onClose}><div className="image-modal" role="dialog" aria-modal="true" aria-label={`Escena ${image.sceneId} ampliada`} onClick={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar imagen"><X size={18} /></button><div className="modal-image-wrap"><img src={image.url} alt={`Escena ${image.sceneId} ampliada`} /></div><div className="modal-footer"><div><span>ESCENA {String(image.sceneId).padStart(2, '0')} · {image.time}</span><p>{image.caption}</p></div><button type="button" onClick={() => onDownload(image)}><Download size={14} /> Descargar PNG</button></div></div></div>;
}

export default function ImageLab() {
  const [active, setActive] = useState<Section>('create');
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [records, setRecords] = useState<StoryboardRecord[]>([]);
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [generating, setGenerating] = useState(false);
  const [currentStoryboardId, setCurrentStoryboardId] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>({ status: 'idle' });
  const voice = useVoices();
  const referenceLibrary = useReferenceLibrary();
  const [editTarget, setEditTarget] = useState<GeneratedImage | null>(null);
  const [editingScenes, setEditingScenes] = useState<Record<number, boolean>>({});
  const [editErrors, setEditErrors] = useState<Record<number, string>>({});
  // Aviso flotante: los fallos de edición no deben quedar escondidos en una etiqueta.
  const [toast, setToast] = useState<{ text: string; kind: 'error' | 'ok' } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.kind === 'error' ? 12_000 : 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const closeEditDialog = useCallback(() => setEditTarget(null), []);
  const savedScripts = useSavedScripts();
  const [incomingScript, setIncomingScript] = useState<{ text: string; nonce: number } | null>(null);
  const [editingReferences, setEditingReferences] = useState(false);
  const closeReferenceEditor = useCallback(() => setEditingReferences(false), []);
  const [storyboardToDelete, setStoryboardToDelete] = useState<StoryboardRecord | null>(null);
  const [deletingStoryboard, setDeletingStoryboard] = useState(false);
  const cancelDelete = useCallback(() => { if (!deletingStoryboard) setStoryboardToDelete(null); }, [deletingStoryboard]);
  const [progress, setProgress] = useState<GenerationProgress>({ current: 0, total: 0, status: 'idle' });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const refreshRecords = async () => {
    try { const response = await fetch('/api/storyboards', { cache: 'no-store' }); if (response.ok) setRecords((await response.json()).storyboards || []); } catch { /* local library is optional while server starts */ }
  };
  useEffect(() => { refreshRecords(); }, []);
  useEffect(() => {
    if (!selectedImage) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setSelectedImage(null); };
    document.addEventListener('keydown', closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', closeOnEscape); document.body.style.overflow = previousOverflow; };
  }, [selectedImage]);

  const generateVoice = async () => {
    if (!currentStoryboardId) return;
    const record = records.find((item) => item.id === currentStoryboardId);
    const script = record?.script || images.map((image) => image.caption).join(' ');
    setVoiceState({ status: 'generating', name: voice.voiceName });
    try {
      setVoiceState({ status: 'ready', name: await requestNarration(currentStoryboardId, script, voice.voiceId, voice.voiceName, voice.libraryOwnerId) });
      refreshRecords();
    } catch (error) {
      setVoiceState({ status: 'error', name: voice.voiceName, error: error instanceof Error ? error.message : 'No se pudo generar la voz.' });
    }
  };
  const confirmDeleteStoryboard = async () => {
    if (!storyboardToDelete) return;
    setDeletingStoryboard(true);
    try {
      const response = await fetch(`/api/storyboards/${storyboardToDelete.id}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) throw new Error((await response.json().catch(() => ({}))).error || 'No se pudo eliminar.');
      if (currentStoryboardId === storyboardToDelete.id) {
        setImages([]);
        setCurrentStoryboardId(null);
        setVoiceState({ status: 'idle' });
        setProgress({ current: 0, total: 0, status: 'idle' });
      }
      setRecords((current) => current.filter((record) => record.id !== storyboardToDelete.id));
      setStoryboardToDelete(null);
      refreshRecords();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'No se pudo eliminar el storyboard.');
    } finally {
      setDeletingStoryboard(false);
    }
  };
  // Edición de una escena con FLUX: la tarjeta muestra la animación de
  // degradados hasta que llega la nueva versión.
  const runSceneEdit = async (image: { sceneId: number }, body: Record<string, unknown>) => {
    const storyboardId = currentStoryboardId;
    if (!storyboardId) return;
    setEditTarget(null);
    setEditingScenes((current) => ({ ...current, [image.sceneId]: true }));
    setEditErrors((current) => { const next = { ...current }; delete next[image.sceneId]; return next; });
    try {
      const response = await fetch(`/api/storyboards/${storyboardId}/scenes/${image.sceneId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.image) throw new Error(data.error || 'No se pudo editar la imagen.');
      const updated = data.image as GeneratedImage;
      // Precarga la versión nueva para que el cambio sea instantáneo al quitar la animación.
      await new Promise<void>((resolve) => { const preload = new Image(); preload.onload = () => resolve(); preload.onerror = () => resolve(); preload.src = updated.url; });
      setImages((current) => current.map((item) => item.sceneId === updated.sceneId ? { ...item, ...updated } : item));
      refreshRecords();
      if (data.mode) setToast({ kind: 'ok', text: `Escena ${String(image.sceneId).padStart(2, '0')} ${data.mode === 'regenerate' ? 'redibujada' : 'retocada'}${data.problem ? `: ${data.problem}` : '.'}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo editar la imagen.';
      setEditErrors((current) => ({ ...current, [image.sceneId]: message }));
      setToast({ kind: 'error', text: `Escena ${String(image.sceneId).padStart(2, '0')}: ${message}` });
    } finally {
      setEditingScenes((current) => { const next = { ...current }; delete next[image.sceneId]; return next; });
    }
  };
  const currentRecord = records.find((record) => record.id === currentStoryboardId) || null;
  const saveMap = useCallback((mapState: MapState) => {
    const storyboardId = currentStoryboardId;
    if (!storyboardId) return;
    setRecords((current) => current.map((record) => record.id === storyboardId ? { ...record, mapState } : record));
    fetch(`/api/storyboards/${storyboardId}/map`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapState }) }).catch(() => {});
  }, [currentStoryboardId]);
  const loadRecord = (record: StoryboardRecord) => { setImages(record.images); setCurrentStoryboardId(record.id); setVoiceState(record.audioUrl ? { status: 'ready', name: record.voiceName } : record.voiceError ? { status: 'error', name: record.voiceName, error: record.voiceError } : { status: 'idle' }); setProgress({ current: record.images.length, total: record.images.length, status: 'complete' }); setActive('create'); setSidebarOpen(false); };
  const downloadImage = async (image: GeneratedImage) => {
    if (!image.url) return;
    const response = await fetch(image.url);
    const blob = await response.blob();
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = image.filename || `video-lab-ai-scene-${String(image.sceneId).padStart(2, '0')}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };
  const download = async () => {
    if (!images.length) return;
    const zip = new JSZip();
    await Promise.all(images.map(async (image) => { if (image.url) { const response = await fetch(image.url); zip.file(image.filename || `scene-${String(image.sceneId).padStart(2, '0')}.png`, await response.blob()); } }));
    const blob = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = currentStoryboardId ? `video-lab-ai-${currentStoryboardId.slice(0, 8)}.zip` : 'video-lab-ai-storyboard.zip';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };
  const navigate = (section: Section) => { setActive(section); setSidebarOpen(false); };
  const sendScriptToStoryboard = (text: string) => {
    setIncomingScript({ text, nonce: Date.now() });
    navigate('create');
    window.setTimeout(() => document.querySelector('.prompt-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  };

  return <div className="app-shell"><div className={`sidebar-wrap ${sidebarOpen ? 'open' : ''}`}><Sidebar active={active} onChange={navigate} savedCount={records.length} scriptCount={savedScripts.scripts.length} /></div><div className="app-main"><TopBar active={active} onMenu={() => setSidebarOpen((value) => !value)} /><main className="main-content">{active === 'create' && <><Showcase onCreate={() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })} /><div className="content-tabs"><button className="active" type="button">Showroom</button><button type="button" onClick={() => navigate('explore')}>Mis proyectos</button><button type="button" onClick={() => navigate('assets')}>Assets</button><span className="tab-spacer" /><span className="workspace-status"><span className="online-dot" /> Local workspace</span></div><div className="workspace-grid"><PromptPanel voice={voice} incomingScript={incomingScript} references={referenceLibrary} onEditReferences={() => setEditingReferences(true)} onReset={() => { setImages([]); setCurrentStoryboardId(null); setGenerating(true); }} onImage={(image) => setImages((current) => [...current.filter((item) => item.sceneId !== image.sceneId), image].sort((a, b) => a.sceneId - b.sceneId))} onProgress={(next) => { setProgress(next); setGenerating(next.status === 'generating'); }} onFinished={() => { setGenerating(false); refreshRecords(); }} onStoryboardId={setCurrentStoryboardId} onVoiceState={setVoiceState} /><Gallery images={images} onDownload={download} onOpen={setSelectedImage} onDownloadImage={downloadImage} progress={progress} generating={generating} onCreate={() => window.scrollTo({ top: 0, behavior: 'smooth' })} storyboardId={currentStoryboardId} record={currentRecord} onSaveMap={saveMap} onRegenerate={(image, description) => runSceneEdit(image, { action: 'regenerate', description })} onEditImage={setEditTarget} editingScenes={editingScenes} editErrors={editErrors} voiceState={voiceState} selectedVoiceName={voice.voiceName} onGenerateVoice={generateVoice} /></div></>}{active === 'explore' && <LibraryView records={records} onOpen={loadRecord} onDelete={setStoryboardToDelete} />}{active === 'scripts' && <ScriptStudio library={savedScripts} onUseScript={sendScriptToStoryboard} />}{active === 'saved-scripts' && <SavedScriptsView library={savedScripts} onUseScript={sendScriptToStoryboard} />}{active === 'assets' && <AssetsView records={records} references={referenceLibrary.references} styles={referenceLibrary.styles} />}{active === 'elements' && <ElementsView />}</main></div>{toast && <div className={`app-toast app-toast--${toast.kind}`} role="status"><span>{toast.text}</span><button type="button" onClick={() => setToast(null)} aria-label="Cerrar aviso"><X size={14} /></button></div>}{editTarget && <SceneEditDialog image={editTarget} onClose={closeEditDialog} onSubmit={(instruction) => runSceneEdit(editTarget, { instruction })} onUndo={() => runSceneEdit(editTarget, { action: 'undo' })} />}{editingReferences && <ReferenceManager library={referenceLibrary} initialFilter={referenceLibrary.styleId} onClose={closeReferenceEditor} />}{storyboardToDelete && <ConfirmDialog title="Eliminar storyboard" message={`Se borrará «${storyboardToDelete.title}» por completo: ${storyboardToDelete.images.length} imágenes${storyboardToDelete.audioUrl ? ', la narración' : ''}, el montaje del editor y los vídeos exportados. No se puede deshacer.`} confirmLabel="Eliminar todo" busy={deletingStoryboard} onConfirm={confirmDeleteStoryboard} onCancel={cancelDelete} />}{selectedImage && <ImageModal image={selectedImage} onClose={() => setSelectedImage(null)} onDownload={downloadImage} />}</div>;
}
