import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Columns2,
  Crop,
  Frame,
  Gamepad2,
  Grid2X2,
  LayoutPanelTop,
  Maximize,
  Monitor,
  PanelsTopLeft,
  Presentation,
  ScanSearch,
  Smartphone,
  Square
} from 'lucide-react';
import { useTimelineStore } from '../store/timelineStore';
import type { AspectRatio, FramePreset, LayoutPreset } from '../types/timeline';
import { correctionSourceClip, correctionTargetClipIds } from '../utils/timeline';
import './CanvasToolbar.css';

const RATIOS: Array<{ value: AspectRatio; label: string; icon: typeof Smartphone }> = [
  { value: '9:16', label: 'Vertical 9:16', icon: Smartphone },
  { value: '1:1', label: 'Cuadrado 1:1', icon: Square },
  { value: '16:9', label: 'Horizontal 16:9', icon: Monitor },
  { value: '4:5', label: 'Retrato 4:5', icon: Smartphone }
];

const LAYOUTS: Array<{ value: LayoutPreset; label: string; icon: typeof Maximize }> = [
  { value: 'fill', label: 'Rellenar', icon: Maximize },
  { value: 'fit', label: 'Ajustar', icon: Presentation },
  { value: 'split', label: 'Dividir', icon: Columns2 },
  { value: 'three', label: 'Tres', icon: LayoutPanelTop },
  { value: 'four', label: 'Cuatro', icon: Grid2X2 },
  { value: 'screen-share', label: 'Compartir pantalla', icon: PanelsTopLeft },
  { value: 'gameplay', label: 'Gameplay', icon: Gamepad2 }
];

const FRAMES: Array<{ value: FramePreset; label: string }> = [
  { value: 'none', label: 'Sin marco' },
  { value: 'minimal', label: 'Minimal blanco' },
  { value: 'neon', label: 'Neón azul' },
  { value: 'film', label: 'Película' },
  { value: 'polaroid', label: 'Polaroid' },
  { value: 'cinema', label: 'Cinematográfico' }
];

export function CanvasToolbar() {
  const timeline = useTimelineStore((state) => state.timeline);
  const selection = useTimelineStore((state) => state.selection);
  const rangeSelection = useTimelineStore((state) => state.rangeSelection);
  const updateSettings = useTimelineStore((state) => state.updateSettings);
  const updateVideoClips = useTimelineStore((state) => state.updateVideoClips);
  const rectangleSelectionActive = useTimelineStore((state) => state.rectangleSelectionActive);
  const setRectangleSelectionActive = useTimelineStore((state) => state.setRectangleSelectionActive);
  const clearRectangleSelection = useTimelineStore((state) => state.clearRectangleSelection);
  const [menu, setMenu] = useState<'ratio' | 'layout' | 'frame' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);

  if (!timeline) return null;
  const settings = timeline.settings;
  const selectedLayout = LAYOUTS.find((item) => item.value === settings.layoutPreset) || LAYOUTS[1];
  const selectedFrame = FRAMES.find((item) => item.value === settings.framePreset) || FRAMES[0];
  const enhanceClip = correctionSourceClip(timeline, selection, rangeSelection);
  const enhanceTargetIds = correctionTargetClipIds(timeline, selection, rangeSelection);
  const trackingEnabled = enhanceClip?.trackingEnabled ?? false;
  // El backend (timelineRoiFilter) solo aplica el recorte manual cuando el
  // diseño es de un único vídeo a pantalla completa; en el resto de diseños
  // (dividir, tres, cuatro, gameplay...) la región dibujada se ignoraría.
  const roiSupported = settings.layoutPreset === 'fit' || settings.layoutPreset === 'fill';

  return (
    <div className="canvas-toolbar" ref={rootRef}>
      <div className="canvas-toolbar__group">
        <button type="button" className={menu === 'ratio' ? 'is-active' : ''} onClick={() => setMenu(menu === 'ratio' ? null : 'ratio')}>
          <Smartphone size={14} /> <strong>{settings.aspectRatio}</strong>
        </button>
        {menu === 'ratio' && (
          <div className="canvas-menu canvas-menu--ratio">
            {RATIOS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                className={settings.aspectRatio === value ? 'is-selected' : ''}
                onClick={() => {
                  // Cambiar de lienzo debe reencuadrar el vídeo y conservar el
                  // plano completo. El usuario puede elegir «Rellenar» después
                  // si prefiere un recorte deliberado.
                  updateSettings({ aspectRatio: value, layoutPreset: 'fit', fitMode: 'contain' });
                  setMenu(null);
                }}
              >
                <Icon size={15} /><span>{label}</span>{settings.aspectRatio === value && <Check size={15} />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="canvas-toolbar__group">
        <button type="button" className={menu === 'layout' ? 'is-active' : ''} onClick={() => setMenu(menu === 'layout' ? null : 'layout')}>
          <selectedLayout.icon size={14} /> <span>Diseño:</span><strong>{selectedLayout.label}</strong>
        </button>
        {menu === 'layout' && (
          <div className="canvas-menu canvas-menu--layout">
            <div className="canvas-menu__heading"><strong>Ajustes globales de diseño</strong></div>
            <span className="canvas-menu__label">Diseño actual</span>
            {LAYOUTS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                className={settings.layoutPreset === value ? 'is-selected' : ''}
                onClick={() => {
                  updateSettings({
                    layoutPreset: value,
                    ...(value === 'fill' ? { fitMode: 'cover' as const } : {}),
                    ...(value === 'fit' ? { fitMode: 'contain' as const } : {})
                  });
                  setMenu(null);
                }}
              >
                <Icon size={15} /><span>{label}</span>{settings.layoutPreset === value && <Check size={15} />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="canvas-toolbar__group">
        <button type="button" className={menu === 'frame' ? 'is-active' : ''} onClick={() => setMenu(menu === 'frame' ? null : 'frame')}>
          <Frame size={14} /> <span>Marco:</span><strong>{selectedFrame.label}</strong>
        </button>
        {menu === 'frame' && (
          <div className="canvas-menu canvas-menu--frame">
            <div className="canvas-menu__heading"><strong>Plantillas de marco</strong></div>
            <span className="canvas-menu__label">Aplicar al proyecto</span>
            {FRAMES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={settings.framePreset === value ? 'is-selected' : ''}
                onClick={() => {
                  updateSettings({ framePreset: value });
                  setMenu(null);
                }}
              >
                <span className={`canvas-frame-swatch canvas-frame-swatch--${value}`} aria-hidden="true" />
                <span>{label}</span>
                {settings.framePreset === value && <Check size={15} />}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        className={trackingEnabled ? 'is-active canvas-toolbar__tracking' : 'canvas-toolbar__tracking'}
        onClick={() => updateVideoClips(enhanceTargetIds, { trackingEnabled: !trackingEnabled })}
        disabled={!enhanceTargetIds.length}
        title="Sigue automáticamente al sujeto principal. Para encuadrar tú a mano, usa el botón Recorte"
      >
        <ScanSearch size={14} /> <span>Seguimiento IA:</span><strong>{trackingEnabled ? 'ACTIVADO' : 'DESACTIVADO'}</strong>
      </button>

      <div className="canvas-toolbar__group">
        <button
          type="button"
          className={rectangleSelectionActive ? 'is-active canvas-toolbar__roi' : 'canvas-toolbar__roi'}
          onClick={() => setRectangleSelectionActive(!rectangleSelectionActive)}
          disabled={!roiSupported}
          title={roiSupported
            ? 'Arrastra el vídeo para moverlo y usa la rueda del ratón para acercar/alejar'
            : 'Mover y ajustar el vídeo solo está disponible con Diseño: Rellenar o Ajustar'}
        >
          <Crop size={14} /> <span>Mover/Ajustar vídeo:</span>
          <strong>{rectangleSelectionActive ? 'ACTIVO' : timeline.roi ? 'AJUSTADO' : 'AUTO'}</strong>
        </button>
        {timeline.roi && (
          <button
            type="button"
            className="canvas-toolbar__roi-clear"
            onClick={() => {
              clearRectangleSelection();
              setRectangleSelectionActive(false);
            }}
            title="Restablecer el encuadre automático"
          >
            <span>Quitar</span>
          </button>
        )}
      </div>
    </div>
  );
}
