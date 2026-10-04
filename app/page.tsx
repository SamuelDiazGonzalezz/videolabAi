'use client';

import { ChangeEvent, KeyboardEvent, useEffect, useMemo, useState } from 'react';
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
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Upload,
  Volume2,
  WandSparkles,
  X,
  ZoomIn,
} from 'lucide-react';
import { ELEVENLABS_VOICES, type VoiceOption } from '../lib/voices';

type GeneratedImage = {
  sceneId: number;
  time: string;
  prompt: string;
  url: string;
  caption: string;
  filename?: string;
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
  style: 'monos';
  status: 'generating' | 'complete' | 'error';
  createdAt: string;
  updatedAt: string;
  folder: string;
  images: GeneratedImage[];
  audioUrl?: string;
  voiceName?: string;
  voiceError?: string;
};

type Section = 'create' | 'explore' | 'assets' | 'elements';

const HERO_IMAGE = '/assets/monos-empty.png';
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

function Sidebar({ active, onChange, savedCount }: { active: Section; onChange: (section: Section) => void; savedCount: number }) {
  const items: Array<{ id: Section; label: string; icon: typeof Sparkles }> = [
    { id: 'create', label: 'Crear', icon: Sparkles },
    { id: 'explore', label: 'Explorar', icon: LayoutGrid },
    { id: 'assets', label: 'Assets', icon: FolderOpen },
    { id: 'elements', label: 'Elementos', icon: Images },
  ];
  return (
    <aside className="sidebar">
      <div className="sidebar-brand"><span className="brand-mark">RM</span><div><b>RacingMonos</b><small>STUDIO</small></div></div>
      <button type="button" className="new-project" onClick={() => onChange('create')}><Plus size={15} /> Nuevo storyboard</button>
      <nav className="sidebar-nav" aria-label="Navegación principal">
        {items.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={active === id ? 'active' : ''} onClick={() => onChange(id)}><Icon size={16} /><span>{label}</span>{id === 'assets' && savedCount > 0 && <em>{savedCount}</em>}</button>)}
      </nav>
      <div className="sidebar-divider" />
      <div className="sidebar-label">Sesiones generativas</div>
      <button type="button" className="session-link" onClick={() => onChange('explore')}><span className="session-dot" /><span>Mis storyboards</span><small>{savedCount}</small></button>
      <div className="sidebar-bottom">
        <div className="local-engine"><span className="online-dot" /><div><b>GPU local</b><small>FLUX.2 Klein 4B</small></div><ChevronDown size={13} /></div>
        <button type="button" className="user-row"><span className="user-avatar">SM</span><span>Samuel</span><MoreHorizontal size={15} /></button>
      </div>
    </aside>
  );
}

function TopBar({ active, onMenu }: { active: Section; onMenu: () => void }) {
  const labels: Record<Section, string> = { create: 'Crear', explore: 'Explorar', assets: 'Assets', elements: 'Elementos' };
  return <header className="topbar"><button type="button" className="mobile-menu" onClick={onMenu} aria-label="Abrir menú"><Menu size={18} /></button><div className="crumb"><span>Workspace</span><ChevronDown size={13} /><b>{labels[active]}</b></div><div className="topbar-actions"><button type="button" className="icon-button" aria-label="Buscar"><Search size={16} /></button><button type="button" className="icon-button" aria-label="Ayuda"><CircleHelp size={16} /></button><button type="button" className="icon-button" aria-label="Ajustes"><Settings2 size={16} /></button><span className="top-avatar">SM</span></div></header>;
}

function Showcase({ onCreate }: { onCreate: () => void }) {
  return <section className="showcase">
    <div className="showcase-intro"><span className="eyebrow">RACINGMONOS / IMAGE LAB</span><h1>Ideas que se convierten<br /><i>en escenas.</i></h1><p>Genera una secuencia coherente desde tu guion, con personajes y trazo bloqueados.</p><button type="button" className="showcase-cta" onClick={onCreate}><Sparkles size={14} /> Empezar a crear <ArrowUpRight size={14} /></button></div>
    <div className="showcase-tiles">
      <button type="button" className="showcase-tile showcase-feature" onClick={onCreate}><img src={HERO_IMAGE} alt="Visual principal de RacingMonos" /><span className="tile-shade" /><div className="tile-copy"><b>Monos / Visual base</b><small>Estilo protegido para cada escena</small></div><ArrowUpRight className="tile-arrow" size={16} /></button>
      <button type="button" className="showcase-tile" onClick={onCreate}><img src={DEFAULT_REFERENCES[1].src} alt="Referencia de carrera" /><span className="tile-shade" /><div className="tile-copy"><b>Race day</b><small>Referencia de composición</small></div></button>
      <button type="button" className="showcase-tile" onClick={onCreate}><img src={DEFAULT_REFERENCES[3].src} alt="Referencia de historia" /><span className="tile-shade" /><div className="tile-copy"><b>Story frames</b><small>Una imagen cada 3–4 s</small></div></button>
    </div>
  </section>;
}

function ReferencePicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviewUrls(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);
  const add = (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) return;
    onChange([...files, ...Array.from(event.target.files).slice(0, 4 - files.length)]);
    event.target.value = '';
  };
  return <div className="reference-picker"><div className="control-heading"><span>Referencias</span><small>5 incluidas · {files.length} propias</small></div><div className="reference-row">{DEFAULT_REFERENCES.map((reference) => <div className="reference-thumb locked" key={reference.src} title={reference.label}><img src={reference.src} alt={reference.label} /><span><Check size={9} /></span></div>)}{files.map((file, index) => <div className="reference-thumb custom" key={`${file.name}-${index}`}>{previewUrls[index] && <img src={previewUrls[index]} alt={`Referencia propia ${index + 1}`} />}<button type="button" onClick={() => onChange(files.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Quitar ${file.name}`}><X size={11} /></button></div>)}{files.length < 4 && <label className="reference-add"><Upload size={14} /><input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={add} /></label>}</div><small className="control-help">Las referencias fijas mantienen el mismo trazo y los mismos personajes.</small></div>;
}

const VOICE_STORAGE_KEY = 'racingmonos.voiceId';

function VoicePicker({ voices, voiceId, onChange, notice }: { voices: VoiceOption[]; voiceId: string; onChange: (id: string) => void; notice: string }) {
  const [playing, setPlaying] = useState('');
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
  return <><div className="voice-picker">{voices.map((voice) => <div key={voice.id} className={`voice-option ${voiceId === voice.id ? 'selected' : ''}`}><button type="button" className="voice-select" onClick={() => onChange(voice.id)}><span className="voice-icon"><Volume2 size={13} /></span><span><b>{voice.name}{voice.spanish && <em className="voice-tag">ES</em>}</b><small>{voice.detail}</small></span>{voiceId === voice.id && <Check size={14} />}</button>{voice.previewUrl && <button type="button" className="voice-preview" aria-label={`Escuchar ${voice.name}`} onClick={() => togglePreview(voice)}>{playing === voice.id ? <Pause size={12} /> : <Play size={12} />}</button>}</div>)}</div>{notice && <div className="voice-notice">{notice}</div>}</>;
}

function useVoices() {
  const [voices, setVoices] = useState<VoiceOption[]>(ELEVENLABS_VOICES);
  const [voiceId, setVoiceIdState] = useState<string>(ELEVENLABS_VOICES[0].id);
  const [voiceNotice, setVoiceNotice] = useState('');
  const setVoiceId = (id: string) => { setVoiceIdState(id); try { localStorage.setItem(VOICE_STORAGE_KEY, id); } catch {} };
  useEffect(() => {
    let cancelled = false;
    fetch('/api/voices').then((response) => response.json()).then((data: { configured?: boolean; voices?: VoiceOption[]; defaultVoiceId?: string; error?: string }) => {
      if (cancelled) return;
      const list = Array.isArray(data.voices) && data.voices.length ? data.voices : ELEVENLABS_VOICES;
      setVoices(list);
      let stored = '';
      try { stored = localStorage.getItem(VOICE_STORAGE_KEY) || ''; } catch {}
      const preferred = [stored, data.defaultVoiceId].find((id) => id && list.some((voice) => voice.id === id));
      setVoiceIdState(preferred || list[0].id);
      if (!data.configured) setVoiceNotice('Añade ELEVENLABS_API_KEY en .env.local para cargar tus voces y generar la narración.');
      else if (data.error) setVoiceNotice(`No se pudieron cargar tus voces: ${data.error}`);
      else if (!list.some((voice) => voice.spanish)) setVoiceNotice('Tu cuenta no tiene voces nativas en español: añádelas desde la Voice Library de ElevenLabs y aparecerán aquí.');
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const voiceName = voices.find((voice) => voice.id === voiceId)?.name || voiceId;
  return { voices, voiceId, setVoiceId, voiceNotice, voiceName };
}

type VoiceControls = ReturnType<typeof useVoices>;

// Genera (o regenera con otra voz) la narración de un storyboard con ElevenLabs.
async function requestNarration(storyboardId: string, script: string, voiceId: string, voiceName: string) {
  const response = await fetch(`/api/storyboards/${storyboardId}/voice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ script, voiceId, voiceName }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'No se pudo generar la voz.');
  return String(payload.voiceName || voiceName);
}

function PromptPanel({ voice, onImage, onReset, onProgress, onFinished, onStoryboardId, onVoiceState }: { voice: VoiceControls; onImage: (image: GeneratedImage) => void; onReset: () => void; onProgress: (progress: GenerationProgress) => void; onFinished: () => void; onStoryboardId: (id: string) => void; onVoiceState: (state: VoiceState) => void }) {
  const [script, setScript] = useState('Fuji, 1976. Dos monos pilotos se preparan para la carrera bajo la lluvia. El mono de chaqueta roja aprieta los puños. El semáforo cambia y los dos coches salen disparados. En la última curva, el piloto rojo adelanta por el interior y cruza la meta celebrando.');
  const [files, setFiles] = useState<File[]>([]);
  const [interval, setIntervalValue] = useState(4);
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
      form.append('style', 'monos');
      form.append('stream', '1');
      files.forEach((file) => form.append('references', file));
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
            onVoiceState({ status: 'ready', name: await requestNarration(event.storyboardId, script, voiceId, voiceName) });
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

  return <section className="prompt-card"><div className="card-topline"><span className="eyebrow"><WandSparkles size={12} /> NUEVA CREACIÓN</span><span className="draft-state"><span /> Guardado local</span></div><div className="prompt-title"><h2>Del guion a tu storyboard</h2><p>Una ilustración cada {interval} segundos con el universo Monos siempre consistente.</p></div><div className="control-heading"><span>Guion</span><small>{script.length}/5000</small></div><textarea className="script-input" value={script} onChange={(event) => setScript(event.target.value.slice(0, 5000))} placeholder="Pega aquí tu guion completo…" /><div className="script-hint"><Clock3 size={12} /> La IA lo dividirá en {sceneCount} escenas aproximadas</div><ReferencePicker files={files} onChange={setFiles} /><div className="control-heading voice-heading"><span><Volume2 size={12} /> Voz española</span><small>ElevenLabs</small></div><VoicePicker voices={voices} voiceId={voiceId} onChange={setVoiceId} notice={voiceNotice} /><div className="control-grid"><div><div className="control-heading"><span>Duración por imagen</span></div><div className="segmented">{[3, 4, 5].map((seconds) => <button type="button" key={seconds} className={interval === seconds ? 'selected' : ''} onClick={() => setIntervalValue(seconds)}>{seconds}s</button>)}</div></div><div><div className="control-heading"><span>Formato</span></div><div className="segmented ratio-segment">{(['9:16', '16:9'] as const).map((value) => <button type="button" key={value} className={ratio === value ? 'selected' : ''} onClick={() => setRatio(value)}>{value}</button>)}</div></div></div>{error && <div className="error-box">{error}</div>}<button type="button" className="primary-action" onClick={generate} disabled={loading}>{loading ? <><Loader2 size={16} className="spin" /> Generando escenas…</> : <><Sparkles size={16} /> Generar storyboard <span>{sceneCount}</span></>}</button><div className="prompt-footer"><span><span className="green-dot" /> FLUX.2 Klein 4B</span><span><Volume2 size={11} /> Voz al finalizar</span></div></section>;
}

function EmptyGallery({ onCreate }: { onCreate: () => void }) {
  return <div className="empty-gallery"><div className="empty-visual"><img src={HERO_IMAGE} alt="Estilo visual Monos" /><div className="empty-visual-overlay"><Play size={16} fill="currentColor" /></div></div><div className="empty-copy"><span className="eyebrow">TU CANVAS</span><h2>Tu storyboard aparecerá aquí</h2><p>Escribe una historia y crea una secuencia visual lista para montar.</p><button type="button" className="secondary-action" onClick={onCreate}>Crear primera escena <ArrowUpRight size={14} /></button></div></div>;
}

function ProgressBar({ progress, generating }: { progress: GenerationProgress; generating: boolean }) {
  if (!generating && progress.status !== 'complete' && progress.status !== 'error') return null;
  const percent = progress.total ? Math.min(100, Math.round(progress.current / progress.total * 100)) : 0;
  return <div className={`progress-wrap ${progress.status === 'error' ? 'is-error' : ''}`}><div className="progress-line"><span style={{ width: `${percent}%` }} /></div><div className="progress-label"><span>{progress.status === 'error' ? 'La generación se detuvo' : generating ? (progress.current ? `Escena ${progress.current} de ${progress.total}` : 'Preparando primera escena') : `${progress.total} escenas guardadas`}</span><b>{percent}%</b></div></div>;
}

function Gallery({ images, onDownload, onOpen, onDownloadImage, progress, generating, onCreate, storyboardId, voiceState, onGenerateVoice, selectedVoiceName }: { onGenerateVoice: () => void; selectedVoiceName: string; images: GeneratedImage[]; onDownload: () => void; onOpen: (image: GeneratedImage) => void; onDownloadImage: (image: GeneratedImage) => void; progress: GenerationProgress; generating: boolean; onCreate: () => void; storyboardId: string | null; voiceState: VoiceState }) {
  const openEditor = () => { if (storyboardId) window.location.href = `/editor?storyboardId=${encodeURIComponent(storyboardId)}`; };
  return <section className="gallery-panel"><div className="gallery-heading"><div><span className="eyebrow">{generating ? 'GENERACIÓN EN DIRECTO' : 'STORYBOARD'}</span><h2>{generating ? `Generando ${progress.current}/${progress.total}` : images.length ? `${images.length} escenas listas` : 'Tus escenas'}</h2><p>{generating ? (progress.caption || 'Cada imagen aparece en cuanto termina en tu GPU.') : images.length ? 'Guardadas automáticamente en tu carpeta local.' : 'Elige crear para empezar una nueva secuencia.'}</p>{storyboardId && <code className="folder-path">data/storyboards/{storyboardId}</code>}{voiceState.status === 'generating' && <span className="voice-ready"><Loader2 size={12} className="spin" /> Generando narración · {voiceState.name}</span>}{voiceState.status === 'ready' && <span className="voice-ready"><Volume2 size={12} /> Voz lista · {voiceState.name}</span>}{voiceState.status === 'error' && <span className="voice-warning"><Volume2 size={12} /> {voiceState.error}</span>}</div><div className="gallery-actions">{images.length > 0 && <button type="button" className="quiet-action" onClick={onDownload}><Archive size={14} /> Descargar ZIP</button>}{images.length > 0 && storyboardId && !generating && <button type="button" className="quiet-action" onClick={onGenerateVoice} disabled={voiceState.status === 'generating'} title={`Voz seleccionada: ${selectedVoiceName}`}>{voiceState.status === 'generating' ? <Loader2 size={14} className="spin" /> : <Volume2 size={14} />} {voiceState.status === 'ready' ? 'Cambiar voz' : 'Generar narración'}</button>}{images.length > 0 && storyboardId && <button type="button" className="editor-action" onClick={openEditor}><Film size={14} /> Abrir editor</button>}<button type="button" className="icon-button"><MoreHorizontal size={17} /></button></div></div><ProgressBar progress={progress} generating={generating} />{generating && !images.length && <div className="generation-placeholder"><Loader2 size={20} className="spin" /><span>Generando la primera imagen…</span></div>}{!images.length && !generating ? <EmptyGallery onCreate={onCreate} /> : <div className="scene-grid">{images.map((image) => <article className="scene-card" key={image.sceneId}><div className="scene-image-wrap" role="button" tabIndex={0} onClick={() => image.url && onOpen(image)} onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => { if ((event.key === 'Enter' || event.key === ' ') && image.url) onOpen(image); }}><img src={image.url} alt={`Escena ${image.sceneId}`} /><span className="scene-index">{String(image.sceneId).padStart(2, '0')}</span><span className="scene-zoom"><ZoomIn size={12} /> Ver</span><button type="button" className="scene-download" aria-label={`Descargar escena ${image.sceneId}`} onClick={(event) => { event.stopPropagation(); onDownloadImage(image); }}><Download size={13} /></button></div><div className="scene-meta"><div><b>Escena {String(image.sceneId).padStart(2, '0')}</b><small>{image.time}</small></div><button type="button" aria-label="Regenerar escena"><RefreshCw size={13} /></button></div><p>{image.caption}</p></article>)}</div>}</section>;
}

function RecentList({ records, onOpen }: { records: StoryboardRecord[]; onOpen: (record: StoryboardRecord) => void }) {
  if (!records.length) return <div className="no-records"><FolderPlus size={22} /><p>Aún no hay storyboards guardados.</p></div>;
  return <div className="recent-list">{records.map((record) => <button type="button" className="recent-item" key={record.id} onClick={() => onOpen(record)}><div className="recent-cover">{record.images[0] ? <img src={record.images[0].url} alt="" /> : <img src={HERO_IMAGE} alt="" />}</div><div><b>{record.title}</b><small>{record.images.length} escenas · {formatDate(record.createdAt)}</small></div><ArrowUpRight size={14} /></button>)}</div>;
}

function LibraryView({ records, onOpen }: { records: StoryboardRecord[]; onOpen: (record: StoryboardRecord) => void }) {
  return <section className="library-view"><div className="view-heading"><div><span className="eyebrow">ARCHIVO LOCAL</span><h2>Mis storyboards</h2><p>Cada generación queda organizada en su propia carpeta.</p></div><span className="folder-badge"><FolderOpen size={14} /> data/storyboards</span></div><RecentList records={records} onOpen={onOpen} /></section>;
}

function AssetsView({ records }: { records: StoryboardRecord[] }) {
  const total = records.reduce((sum, record) => sum + record.images.length, 0);
  return <section className="library-view"><div className="view-heading"><div><span className="eyebrow">ASSETS</span><h2>Biblioteca visual</h2><p>Referencias fijas y escenas generadas en local.</p></div><span className="folder-badge"><FileImage size={14} /> {total} imágenes</span></div><div className="asset-library-grid">{DEFAULT_REFERENCES.map((reference) => <div className="asset-card" key={reference.src}><img src={reference.src} alt={reference.label} /><div><b>{reference.label}</b><small>Referencia Monos · fija</small></div></div>)}{records.flatMap((record) => record.images.slice(0, 8)).map((image) => <div className="asset-card" key={`${image.url}-${image.sceneId}`}><img src={image.url} alt="Escena guardada" /><div><b>Escena {String(image.sceneId).padStart(2, '0')}</b><small>Storyboard local</small></div></div>)}</div></section>;
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
      setVoiceState({ status: 'ready', name: await requestNarration(currentStoryboardId, script, voice.voiceId, voice.voiceName) });
      refreshRecords();
    } catch (error) {
      setVoiceState({ status: 'error', name: voice.voiceName, error: error instanceof Error ? error.message : 'No se pudo generar la voz.' });
    }
  };
  const loadRecord = (record: StoryboardRecord) => { setImages(record.images); setCurrentStoryboardId(record.id); setVoiceState(record.audioUrl ? { status: 'ready', name: record.voiceName } : record.voiceError ? { status: 'error', name: record.voiceName, error: record.voiceError } : { status: 'idle' }); setProgress({ current: record.images.length, total: record.images.length, status: 'complete' }); setActive('create'); setSidebarOpen(false); };
  const downloadImage = async (image: GeneratedImage) => {
    if (!image.url) return;
    const response = await fetch(image.url);
    const blob = await response.blob();
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = image.filename || `racingmonos-scene-${String(image.sceneId).padStart(2, '0')}.png`;
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
    link.download = currentStoryboardId ? `racingmonos-${currentStoryboardId.slice(0, 8)}.zip` : 'racingmonos-storyboard.zip';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };
  const navigate = (section: Section) => { setActive(section); setSidebarOpen(false); };

  return <div className="app-shell"><div className={`sidebar-wrap ${sidebarOpen ? 'open' : ''}`}><Sidebar active={active} onChange={navigate} savedCount={records.length} /></div><div className="app-main"><TopBar active={active} onMenu={() => setSidebarOpen((value) => !value)} /><main className="main-content">{active === 'create' && <><Showcase onCreate={() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })} /><div className="content-tabs"><button className="active" type="button">Showroom</button><button type="button" onClick={() => navigate('explore')}>Mis proyectos</button><button type="button" onClick={() => navigate('assets')}>Assets</button><span className="tab-spacer" /><span className="workspace-status"><span className="online-dot" /> Local workspace</span></div><div className="workspace-grid"><PromptPanel voice={voice} onReset={() => { setImages([]); setCurrentStoryboardId(null); setGenerating(true); }} onImage={(image) => setImages((current) => [...current.filter((item) => item.sceneId !== image.sceneId), image].sort((a, b) => a.sceneId - b.sceneId))} onProgress={(next) => { setProgress(next); setGenerating(next.status === 'generating'); }} onFinished={() => { setGenerating(false); refreshRecords(); }} onStoryboardId={setCurrentStoryboardId} onVoiceState={setVoiceState} /><Gallery images={images} onDownload={download} onOpen={setSelectedImage} onDownloadImage={downloadImage} progress={progress} generating={generating} onCreate={() => window.scrollTo({ top: 0, behavior: 'smooth' })} storyboardId={currentStoryboardId} voiceState={voiceState} selectedVoiceName={voice.voiceName} onGenerateVoice={generateVoice} /></div></>}{active === 'explore' && <LibraryView records={records} onOpen={loadRecord} />}{active === 'assets' && <AssetsView records={records} />}{active === 'elements' && <ElementsView />}</main></div>{selectedImage && <ImageModal image={selectedImage} onClose={() => setSelectedImage(null)} onDownload={downloadImage} />}</div>;
}
