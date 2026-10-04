import { useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, LoaderCircle, Search, Shapes } from 'lucide-react';

interface CatalogElement { id: string; name: string; path: string; aspectRatio?: number }
interface CatalogCategory { id: string; name: string; elements: CatalogElement[] }
interface RemoteAsset {
  id: string; provider: 'pixabay' | 'unsplash'; title?: string; thumbnailUrl?: string; previewUrl?: string;
  highResUrl?: string; fallbackUrl?: string; sourcePageUrl?: string; downloadLocation?: string; download_location?: string;
  trackingUrl?: string; type?: string; format?: string;
}

export interface GraphicInsert { name: string; url: string; width?: number; height?: number; transparentPng?: boolean }

export function GraphicsLibrary({ onInsert, getAuthToken }: {
  onInsert: (graphic: GraphicInsert) => void;
  getAuthToken: () => Promise<string>;
}) {
  const [tab, setTab] = useState<'local' | 'photos' | 'vectors'>('local');
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [query, setQuery] = useState('formas abstractas');
  const [results, setResults] = useState<RemoteAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/assets/editor-elements.json').then((response) => response.json()).then((data) => {
      setCategories(Array.isArray(data?.categories) ? data.categories : []);
    }).catch(() => setMessage('No se pudo cargar el catálogo de elementos.'));
  }, []);

  const elements = useMemo(() => categories.flatMap((category) => category.elements.map((element) => ({ ...element, category: category.name }))), [categories]);

  const search = async () => {
    const clean = query.trim();
    if (!clean) return;
    setLoading(true); setMessage('');
    try {
      const token = await getAuthToken();
      const params = new URLSearchParams({ q: clean, provider: tab === 'photos' ? 'unsplash' : 'pixabay', type: tab === 'photos' ? 'photo' : 'vector', page: '1', perPage: '24', safeSearch: 'true' });
      const response = await fetch(`/api/media-assets/search?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || data?.error || 'No se pudo buscar.');
      setResults(Array.isArray(data?.items) ? data.items : Array.isArray(data?.assets) ? data.assets : []);
    } catch (error) { setResults([]); setMessage(error instanceof Error ? error.message : 'No se pudo buscar.'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (tab === 'local') return;
    setQuery(tab === 'photos' ? 'producto' : 'formas abstractas');
    setResults([]);
  }, [tab]);

  const insertLocal = (element: CatalogElement) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="white" d="${element.path}"/></svg>`;
    onInsert({ name: element.name, url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, width: element.aspectRatio ? Math.min(.82, .48 * element.aspectRatio) : .44, height: element.aspectRatio ? .34 : .44, transparentPng: true });
  };

  const insertRemote = async (asset: RemoteAsset) => {
    setLoading(true); setMessage('Preparando recurso HD…');
    try {
      const token = await getAuthToken();
      const endpoint = asset.provider === 'pixabay' ? '/api/media-assets/import' : '/api/media-assets/track';
      const body = asset.provider === 'pixabay'
        ? { provider: 'pixabay', assetId: asset.id, highResUrl: asset.highResUrl, fallbackUrl: asset.fallbackUrl, sourcePageUrl: asset.sourcePageUrl, type: asset.type, format: asset.format }
        : { provider: 'unsplash', assetId: asset.id, downloadLocation: asset.downloadLocation || asset.download_location || asset.trackingUrl };
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || data?.error || 'No se pudo preparar el recurso.');
      const prepared = data?.asset || data;
      const url = prepared?.canvasUrl || prepared?.highResUrl || prepared?.url || asset.highResUrl || asset.previewUrl;
      if (!url) throw new Error('El recurso no contiene una imagen utilizable.');
      onInsert({ name: asset.title || (asset.provider === 'unsplash' ? 'Foto de Unsplash' : 'Elemento de Pixabay'), url, transparentPng: asset.provider === 'pixabay' });
      setMessage('Recurso añadido al vídeo.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo insertar.'); }
    finally { setLoading(false); }
  };

  return <>
    <div className="graphics-tabs">
      <button className={tab === 'local' ? 'is-active' : ''} onClick={() => setTab('local')}><Shapes size={13}/> Gráficos</button>
      <button className={tab === 'photos' ? 'is-active' : ''} onClick={() => setTab('photos')}><ImageIcon size={13}/> Fotos</button>
      <button className={tab === 'vectors' ? 'is-active' : ''} onClick={() => setTab('vectors')}><Shapes size={13}/> Pixabay</button>
    </div>
    {tab !== 'local' && <form className="graphics-search" onSubmit={(event) => { event.preventDefault(); void search(); }}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar recursos…"/><button aria-label="Buscar"><Search size={15}/></button></form>}
    {loading && <p className="graphics-status"><LoaderCircle size={14}/> {message || 'Cargando…'}</p>}
    {!loading && message && <p className="graphics-status">{message}</p>}
    {tab === 'local' ? <div className="graphics-grid">{elements.map((element) => <button key={element.id} onClick={() => insertLocal(element)} title={`Añadir ${element.name}`}><svg viewBox="0 0 100 100"><path d={element.path}/></svg><span>{element.name}</span></button>)}</div>
      : <div className="graphics-grid graphics-grid--media">{results.map((asset) => <button key={`${asset.provider}-${asset.id}`} data-i18n-skip={asset.title ? '' : undefined} onClick={() => void insertRemote(asset)} title={asset.title || 'Añadir recurso'}><img src={asset.thumbnailUrl || asset.previewUrl} alt=""/></button>)}</div>}
    {tab !== 'local' && !results.length && !loading && <button className="properties-panel__primary" onClick={() => void search()}><Search size={14}/> Buscar en {tab === 'photos' ? 'Unsplash' : 'Pixabay'}</button>}
    {tab === 'photos' && results.length > 0 && <p className="graphics-attribution">Fotografías proporcionadas por Unsplash.</p>}
  </>;
}
