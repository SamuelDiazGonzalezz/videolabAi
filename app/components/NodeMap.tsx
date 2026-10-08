'use client';

import {
  Download,
  FileText,
  Hand,
  Image as ImageIcon,
  Loader2,
  Maximize,
  Maximize2,
  Minimize2,
  Minus,
  MousePointer2,
  Play,
  Plus,
  RotateCcw,
  StickyNote,
  Trash2,
  Type,
  Wand2,
} from 'lucide-react';
import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './node-map.css';

// Mapa de nodos del storyboard: un nodo «Guion», y por escena un nodo Prompt
// (descripción editable que se puede volver a generar) conectado a su nodo
// Imagen; las imágenes se encadenan en orden. Los nodos, las conexiones y las
// notas se pueden mover, crear y borrar; la disposición se guarda por storyboard.

export type MapImage = {
  sceneId: number;
  url: string;
  caption: string;
  time: string;
  description?: string;
  versions?: string[];
};

type Point = { x: number; y: number };
type EdgeKind = 'script' | 'text' | 'image';
type MapEdge = { id: string; from: string; to: string; custom?: boolean };
type MapNote = { id: string; x: number; y: number; text: string };
type Viewport = { x: number; y: number; zoom: number };

export type MapState = {
  version: 1;
  positions: Record<string, Point>;
  customEdges: MapEdge[];
  removedEdges: string[];
  notes: MapNote[];
  viewport?: Viewport;
};

type Tool = 'select' | 'hand' | 'note';
type Selection = { kind: 'node' | 'edge' | 'note'; id: string } | null;

const SCRIPT_W = 300;
const SCRIPT_H = 230;
const PROMPT_W = 290;
const PROMPT_H = 250;
const NOTE_W = 170;
const NOTE_H = 120;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2;

const edgeId = (from: string, to: string) => `e:${from}->${to}`;
const sourceKind = (nodeId: string): EdgeKind => nodeId === 'script' ? 'script' : nodeId.startsWith('prompt-') ? 'text' : 'image';

function imageSize(aspectRatio: string) {
  return aspectRatio === '9:16' ? { w: 230, h: 409 } : { w: 340, h: 191 };
}

function defaultLayout(images: MapImage[], aspectRatio: string) {
  const { w: imageW, h: imageH } = imageSize(aspectRatio);
  const imageNodeH = imageH + 92;
  const pairW = PROMPT_W + 80 + imageW;
  const strideX = pairW + 150;
  const strideY = Math.max(PROMPT_H, imageNodeH) + 170;
  const columns = 3;
  const positions: Record<string, Point> = { script: { x: -SCRIPT_W - 170, y: (imageNodeH - SCRIPT_H) / 2 } };
  images.forEach((image, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * strideX;
    const y = row * strideY;
    positions[`prompt-${image.sceneId}`] = { x, y: y + (imageNodeH - PROMPT_H) / 2 };
    positions[`image-${image.sceneId}`] = { x: x + PROMPT_W + 80, y };
  });
  return positions;
}

function defaultEdges(images: MapImage[]): MapEdge[] {
  const edges: MapEdge[] = [];
  if (images[0]) edges.push({ id: edgeId('script', `prompt-${images[0].sceneId}`), from: 'script', to: `prompt-${images[0].sceneId}` });
  images.forEach((image, index) => {
    edges.push({ id: edgeId(`prompt-${image.sceneId}`, `image-${image.sceneId}`), from: `prompt-${image.sceneId}`, to: `image-${image.sceneId}` });
    const next = images[index + 1];
    if (next) edges.push({ id: edgeId(`image-${image.sceneId}`, `image-${next.sceneId}`), from: `image-${image.sceneId}`, to: `image-${next.sceneId}` });
  });
  return edges;
}

function normalizeState(value: unknown): MapState {
  const state = value && typeof value === 'object' ? value as Partial<MapState> : {};
  return {
    version: 1,
    positions: state.positions && typeof state.positions === 'object' ? state.positions : {},
    customEdges: Array.isArray(state.customEdges) ? state.customEdges : [],
    removedEdges: Array.isArray(state.removedEdges) ? state.removedEdges : [],
    notes: Array.isArray(state.notes) ? state.notes : [],
    viewport: state.viewport,
  };
}

function curve(a: Point, b: Point) {
  const dx = Math.max(60, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

type Props = {
  storyboardKey: string;
  images: MapImage[];
  script: string;
  styleName: string;
  aspectRatio: string;
  initialState: unknown;
  generating: boolean;
  pendingCaption?: string;
  editingScenes: Record<number, boolean>;
  editErrors: Record<number, string>;
  onSave: (state: MapState) => void;
  onRegenerate: (image: MapImage, description: string) => void;
  onEdit: (image: MapImage) => void;
  onOpen: (image: MapImage) => void;
  onDownload: (image: MapImage) => void;
};

export function NodeMap({ storyboardKey, images, script, styleName, aspectRatio, initialState, generating, pendingCaption, editingScenes, editErrors, onSave, onRegenerate, onEdit, onOpen, onDownload }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<MapState>(() => normalizeState(initialState));
  const [viewport, setViewport] = useState<Viewport>(() => normalizeState(initialState).viewport || { x: 420, y: 60, zoom: 0.55 });
  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<Selection>(null);
  const [linking, setLinking] = useState<{ from: string; point: Point } | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [fullscreen, setFullscreen] = useState(false);
  // Marca el lienzo como «en movimiento» mientras dura un zoom o un arrastre.
  const [moving, setMoving] = useState(false);
  const movingTimer = useRef<number | null>(null);
  const markMoving = useCallback(() => {
    setMoving(true);
    if (movingTimer.current) window.clearTimeout(movingTimer.current);
    movingTimer.current = window.setTimeout(() => setMoving(false), 180);
  }, []);
  const [newNoteId, setNewNoteId] = useState<string | null>(null);
  const dragRef = useRef<{ kind: 'pan' | 'node' | 'note'; id?: string; start: Point; origin: Point; moved: boolean } | null>(null);
  const fittedRef = useRef(false);
  const { w: imageW, h: imageH } = imageSize(aspectRatio);
  const imageNodeH = imageH + 92;

  // Al cambiar de storyboard se carga su propio mapa.
  useEffect(() => {
    const next = normalizeState(initialState);
    setState(next);
    setViewport(next.viewport || { x: 420, y: 60, zoom: 0.55 });
    setSelection(null);
    setDrafts({});
    fittedRef.current = Boolean(next.viewport);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyboardKey]);

  const layout = useMemo(() => defaultLayout(images, aspectRatio), [images, aspectRatio]);
  const position = useCallback((id: string) => state.positions[id] || layout[id] || { x: 0, y: 0 }, [state.positions, layout]);
  const size = useCallback((id: string) => id === 'script' ? { w: SCRIPT_W, h: SCRIPT_H } : id.startsWith('prompt-') ? { w: PROMPT_W, h: PROMPT_H } : { w: imageW, h: imageNodeH }, [imageW, imageNodeH]);
  const nodeIds = useMemo(() => new Set(['script', ...images.flatMap((image) => [`prompt-${image.sceneId}`, `image-${image.sceneId}`])]), [images]);
  const edges = useMemo(() => {
    const removed = new Set(state.removedEdges);
    return [...defaultEdges(images).filter((edge) => !removed.has(edge.id)), ...state.customEdges]
      .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  }, [images, state.customEdges, state.removedEdges, nodeIds]);

  // Guardado diferido: cada cambio de disposición se escribe en el storyboard.
  const saveTimer = useRef<number | null>(null);
  const persist = useCallback((next: MapState, nextViewport: Viewport) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => onSave({ ...next, viewport: nextViewport }), 700);
  }, [onSave]);
  const update = useCallback((patch: (current: MapState) => MapState) => {
    setState((current) => {
      const next = patch(current);
      persist(next, viewport);
      return next;
    });
  }, [persist, viewport]);
  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);

  const toWorld = useCallback((clientX: number, clientY: number, vp = viewport): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: (clientX - (rect?.left || 0) - vp.x) / vp.zoom, y: (clientY - (rect?.top || 0) - vp.y) / vp.zoom };
  }, [viewport]);

  const fit = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return;
    const ids = [...nodeIds];
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    ids.forEach((id) => { const p = position(id); const s = size(id); minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x + s.w); maxY = Math.max(maxY, p.y + s.h); });
    state.notes.forEach((note) => { minX = Math.min(minX, note.x); minY = Math.min(minY, note.y); maxX = Math.max(maxX, note.x + NOTE_W); maxY = Math.max(maxY, note.y + NOTE_H); });
    if (!Number.isFinite(minX)) return;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((rect.width - 80) / (maxX - minX), (rect.height - 110) / (maxY - minY))));
    const next = { zoom, x: (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom, y: 30 + (rect.height - 110 - (maxY - minY) * zoom) / 2 - minY * zoom };
    setViewport(next);
    persist(state, next);
  }, [nodeIds, position, size, state, persist]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => fit());
    document.body.style.overflow = fullscreen ? 'hidden' : '';
    return () => { window.cancelAnimationFrame(frame); document.body.style.overflow = ''; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen]);

  // Primer encuadre automático cuando el mapa todavía no tenía vista guardada.
  useEffect(() => {
    if (fittedRef.current || !images.length) return;
    const frame = window.requestAnimationFrame(() => { fit(); fittedRef.current = true; });
    return () => window.cancelAnimationFrame(frame);
  }, [images.length, fit]);

  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    setViewport((current) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const cx = clientX ?? (rect ? rect.left + rect.width / 2 : 0);
      const cy = clientY ?? (rect ? rect.top + rect.height / 2 : 0);
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.zoom * factor));
      const px = cx - (rect?.left || 0);
      const py = cy - (rect?.top || 0);
      const next = { zoom, x: px - (px - current.x) * (zoom / current.zoom), y: py - (py - current.y) * (zoom / current.zoom) };
      persist(state, next);
      return next;
    });
  }, [persist, state]);

  // Rueda = zoom hacia el cursor (salvo dentro de un campo de texto con scroll).
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const field = (event.target as HTMLElement).closest('textarea');
      if (field && field.scrollHeight > field.clientHeight) return;
      event.preventDefault();
      markMoving();
      zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoomAt, markMoving]);

  const removeSelection = useCallback(() => {
    if (!selection) return;
    if (selection.kind === 'note') update((current) => ({ ...current, notes: current.notes.filter((note) => note.id !== selection.id) }));
    if (selection.kind === 'edge') {
      const edge = edges.find((item) => item.id === selection.id);
      if (edge?.custom) update((current) => ({ ...current, customEdges: current.customEdges.filter((item) => item.id !== edge.id) }));
      else if (edge) update((current) => ({ ...current, removedEdges: [...current.removedEdges, edge.id] }));
    }
    setSelection(null);
  }, [selection, edges, update]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('textarea, input')) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selection && selection.kind !== 'node') { event.preventDefault(); removeSelection(); }
      if (event.key === 'Escape') setFullscreen(false);
      if (event.key === 'v' || event.key === 'V') setTool('select');
      if (event.key === 'h' || event.key === 'H') setTool('hand');
      if (event.key === 'n' || event.key === 'N') setTool('note');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, removeSelection]);

  // ---- Arrastres: lienzo, nodos, notas y nuevas conexiones -----------------
  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    if (tool === 'note' && event.button === 0) {
      const point = toWorld(event.clientX, event.clientY);
      const note: MapNote = { id: `note-${Date.now().toString(36)}`, x: point.x - NOTE_W / 2, y: point.y - 20, text: '' };
      update((current) => ({ ...current, notes: [...current.notes, note] }));
      setSelection({ kind: 'note', id: note.id });
      setNewNoteId(note.id);
      setTool('select');
      return;
    }
    setSelection(null);
    dragRef.current = { kind: 'pan', start: { x: event.clientX, y: event.clientY }, origin: { x: viewport.x, y: viewport.y }, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const startNodeDrag = (event: ReactPointerEvent, kind: 'node' | 'note', id: string, origin: Point) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (tool === 'hand') {
      dragRef.current = { kind: 'pan', start: { x: event.clientX, y: event.clientY }, origin: { x: viewport.x, y: viewport.y }, moved: false };
    } else {
      setSelection({ kind, id });
      dragRef.current = { kind, id, start: { x: event.clientX, y: event.clientY }, origin, moved: false };
    }
    containerRef.current?.setPointerCapture(event.pointerId);
  };

  const startLink = (event: ReactPointerEvent, from: string) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    setLinking({ from, point: toWorld(event.clientX, event.clientY) });
    containerRef.current?.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    if (linking) { setLinking({ ...linking, point: toWorld(event.clientX, event.clientY) }); return; }
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.start.x;
    const dy = event.clientY - drag.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    if (drag.kind === 'pan') { markMoving(); setViewport((current) => ({ ...current, x: drag.origin.x + dx, y: drag.origin.y + dy })); return; }
    const next = { x: drag.origin.x + dx / viewport.zoom, y: drag.origin.y + dy / viewport.zoom };
    if (drag.kind === 'node' && drag.id) setState((current) => ({ ...current, positions: { ...current.positions, [drag.id!]: next } }));
    if (drag.kind === 'note' && drag.id) setState((current) => ({ ...current, notes: current.notes.map((note) => note.id === drag.id ? { ...note, ...next } : note) }));
  };

  const onPointerUp = (event: ReactPointerEvent) => {
    if (linking) {
      const target = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest('[data-port-in]') as HTMLElement | null;
      const to = target?.dataset.portIn;
      if (to && to !== linking.from && !edges.some((edge) => edge.from === linking.from && edge.to === to)) {
        const id = edgeId(linking.from, to);
        update((current) => current.removedEdges.includes(id)
          ? { ...current, removedEdges: current.removedEdges.filter((item) => item !== id) }
          : { ...current, customEdges: [...current.customEdges, { id: `${id}:${Date.now().toString(36)}`, from: linking.from, to, custom: true }] });
      }
      setLinking(null);
      return;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved) persist(state, viewport);
  };

  // ---- Render ---------------------------------------------------------------
  const outPort = (id: string) => { const p = position(id); const s = size(id); return { x: p.x + s.w, y: p.y + s.h / 2 }; };
  const inPort = (id: string) => { const p = position(id); const s = size(id); return { x: p.x, y: p.y + s.h / 2 }; };
  const lastImage = images[images.length - 1];
  const ghost = generating && lastImage ? (() => { const p = position(`image-${lastImage.sceneId}`); return { x: p.x + imageW + 120, y: p.y }; })() : null;

  return <div className={`node-map tool-${tool}${linking ? ' is-linking' : ''}${fullscreen ? ' is-fullscreen' : ''}${moving ? ' is-moving' : ''}`} ref={containerRef} onPointerDown={onCanvasPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
    <video className="node-map__video" src="/assets/mapa-bg.mp4" autoPlay muted loop playsInline aria-hidden="true" />
    <div className="node-map__dots" style={{ backgroundSize: `${22 * viewport.zoom}px ${22 * viewport.zoom}px`, backgroundPosition: `${viewport.x}px ${viewport.y}px` }} aria-hidden="true" />
    <div className="node-map__world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
      <svg className="node-map__edges" width="1" height="1" aria-hidden="true">
        {edges.map((edge) => {
          const kind = sourceKind(edge.from);
          const d = curve(outPort(edge.from), inPort(edge.to));
          const selected = selection?.kind === 'edge' && selection.id === edge.id;
          return <g key={edge.id} className={`node-edge node-edge--${kind}${selected ? ' is-selected' : ''}`}>
            <path className="node-edge__hit" d={d} onPointerDown={(event) => { event.stopPropagation(); setSelection({ kind: 'edge', id: edge.id }); }} />
            <path className="node-edge__line" d={d} />
          </g>;
        })}
        {linking && <path className={`node-edge__draft node-edge--${sourceKind(linking.from)}`} d={curve(outPort(linking.from), linking.point)} />}
      </svg>

      {state.notes.map((note) => <div key={note.id} className={`map-note${selection?.kind === 'note' && selection.id === note.id ? ' is-selected' : ''}`} style={{ left: note.x, top: note.y, width: NOTE_W, minHeight: NOTE_H }} onPointerDown={(event) => event.stopPropagation()}>
        <div className="map-note__grip" onPointerDown={(event) => startNodeDrag(event, 'note', note.id, { x: note.x, y: note.y })} />
        <textarea value={note.text} placeholder="Nota…" autoFocus={note.id === newNoteId} onChange={(event) => { const text = event.target.value; update((current) => ({ ...current, notes: current.notes.map((item) => item.id === note.id ? { ...item, text } : item) })); }} onFocus={() => setSelection({ kind: 'note', id: note.id })} />
      </div>)}

      <MapNode id="script" title="Guion" icon={<FileText size={13} />} pos={position('script')} w={SCRIPT_W} h={SCRIPT_H} selected={selection?.id === 'script'} onDragStart={startNodeDrag} onLinkStart={startLink} hasIn={false}>
        <div className="map-node__script"><p>{script}</p></div>
        <div className="map-node__foot"><span className="map-chip">{styleName}</span><span className="map-chip">{images.length} escenas</span></div>
      </MapNode>

      {images.map((image) => {
        const promptId = `prompt-${image.sceneId}`;
        const imageId = `image-${image.sceneId}`;
        const busy = Boolean(editingScenes[image.sceneId]);
        const description = image.description || image.caption;
        const draft = drafts[image.sceneId] ?? description;
        const changed = draft.trim() !== description.trim();
        const number = String(image.sceneId).padStart(2, '0');
        return <div key={image.sceneId} className="map-pair">
          <MapNode id={promptId} title={`Prompt ${number}`} icon={<Type size={13} />} pos={position(promptId)} w={PROMPT_W} h={PROMPT_H} selected={selection?.id === promptId} onDragStart={startNodeDrag} onLinkStart={startLink}>
            <textarea className="map-node__prompt" value={draft} onChange={(event) => setDrafts((current) => ({ ...current, [image.sceneId]: event.target.value }))} onPointerDown={(event) => event.stopPropagation()} spellCheck={false} />
            <div className="map-node__foot"><span className="map-node__caption" title={image.caption}>«{image.caption}»</span><button type="button" className="map-run" disabled={busy || generating || !draft.trim()} onPointerDown={(event) => event.stopPropagation()} onClick={() => onRegenerate(image, draft.trim())} title={changed ? 'Generar con el prompt editado' : 'Volver a generar esta escena'}>{busy ? <Loader2 size={12} className="spin" /> : <Play size={11} />} {changed ? 'Generar' : 'Run'}</button></div>
          </MapNode>
          <MapNode id={imageId} title={`Imagen ${number}`} icon={<ImageIcon size={13} />} pos={position(imageId)} w={imageW} h={imageNodeH} selected={selection?.id === imageId} onDragStart={startNodeDrag} onLinkStart={startLink} badge={(image.versions?.length || 1) > 1 ? `v${image.versions!.length}` : undefined}>
            <div className="map-node__image" style={{ height: imageH }} onPointerDown={(event) => event.stopPropagation()} onClick={() => !busy && onOpen(image)}>
              <img src={image.url} alt={`Escena ${number}`} draggable={false} />
              <div className="scene-tools"><button type="button" className="scene-tool" title="Editar con IA" disabled={busy || generating} onClick={(event) => { event.stopPropagation(); onEdit(image); }}><Wand2 size={13} /></button><button type="button" className="scene-tool" title="Descargar" onClick={(event) => { event.stopPropagation(); onDownload(image); }}><Download size={13} /></button></div>
              {busy && <div className="scene-editing"><span className="scene-editing__blob scene-editing__blob--a" /><span className="scene-editing__blob scene-editing__blob--b" /><span className="scene-editing__blob scene-editing__blob--c" /><span className="scene-editing__label"><Wand2 size={13} /> Generando…</span></div>}
            </div>
            <div className="map-node__foot"><span className="map-chip">{image.time}</span>{editErrors[image.sceneId] && !busy ? <span className="map-chip is-error" title={editErrors[image.sceneId]}>Error</span> : (image.versions?.length || 1) > 1 && <span className="map-chip is-edited">Editada</span>}</div>
          </MapNode>
        </div>;
      })}

      {ghost && <div className="map-node map-node--ghost" style={{ left: ghost.x, top: ghost.y, width: imageW, height: imageNodeH }}><Loader2 size={20} className="spin" /><b>Generando siguiente escena…</b>{pendingCaption && <small>{pendingCaption}</small>}</div>}
    </div>

    <div className="map-toolbar" onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" className={tool === 'select' ? 'is-active' : ''} onClick={() => setTool('select')} title="Seleccionar y mover (V)"><MousePointer2 size={15} /></button>
      <button type="button" className={tool === 'hand' ? 'is-active' : ''} onClick={() => setTool('hand')} title="Desplazar el lienzo (H)"><Hand size={15} /></button>
      <span className="map-toolbar__sep" />
      <button type="button" className={tool === 'note' ? 'is-active' : ''} onClick={() => setTool('note')} title="Añadir nota (N)"><StickyNote size={15} /></button>
      <button type="button" onClick={removeSelection} disabled={!selection || selection.kind === 'node'} title="Borrar conexión o nota (Supr)"><Trash2 size={15} /></button>
      <button type="button" onClick={() => { update((current) => ({ ...current, positions: {}, removedEdges: [], customEdges: [] })); fittedRef.current = false; window.requestAnimationFrame(fit); }} title="Restaurar la disposición y las conexiones"><RotateCcw size={15} /></button>
      <span className="map-toolbar__sep" />
      <button type="button" onClick={fit} title="Encuadrar todo"><Maximize size={15} /></button>
      <button type="button" className={fullscreen ? 'is-active' : ''} onClick={() => setFullscreen((value) => !value)} title={fullscreen ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa'}>{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
      <button type="button" onClick={() => zoomAt(1 / 1.2)} title="Alejar"><Minus size={15} /></button>
      <span className="map-toolbar__zoom">{Math.round(viewport.zoom * 100)}%</span>
      <button type="button" onClick={() => zoomAt(1.2)} title="Acercar"><Plus size={15} /></button>
    </div>
    {tool === 'note' && <div className="map-hint">Haz clic en el lienzo para colocar la nota</div>}
    {linking && <div className="map-hint">Suelta sobre la entrada (izquierda) de otro nodo para conectarlos</div>}
  </div>;
}

function MapNode({ id, title, icon, pos, w, h, selected, badge, hasIn = true, onDragStart, onLinkStart, children }: { id: string; title: string; icon: React.ReactNode; pos: Point; w: number; h: number; selected: boolean; badge?: string; hasIn?: boolean; onDragStart: (event: ReactPointerEvent, kind: 'node', id: string, origin: Point) => void; onLinkStart: (event: ReactPointerEvent, from: string) => void; children: React.ReactNode }) {
  return <div className={`map-node${selected ? ' is-selected' : ''}`} style={{ left: pos.x, top: pos.y, width: w, height: h }} onPointerDown={(event) => onDragStart(event, 'node', id, pos)}>
    <header className="map-node__head"><span className="map-node__icon">{icon}</span><b>{title}</b>{badge && <em>{badge}</em>}</header>
    <div className="map-node__body">{children}</div>
    {hasIn && <span className="map-port map-port--in" data-port-in={id} title="Entrada" />}
    <span className="map-port map-port--out" onPointerDown={(event) => onLinkStart(event, id)} title="Arrastra para conectar" />
  </div>;
}
