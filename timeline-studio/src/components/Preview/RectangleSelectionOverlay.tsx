import { useRef, useState } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import type { RectangleSelection } from '../../types/timeline';

const FULL_FRAME: RectangleSelection = { x: 0, y: 0, width: 1, height: 1 };
const FULL_CONTENT_BOX = { x: 0, y: 0, width: 1, height: 1 };

// Texto compartido con VideoPreview: en formatos estrechos (9:16, 1:1, 4:5)
// no cabe entero junto al cuadro de zoom dentro del fotograma, así que
// VideoPreview lo muestra fuera del recuadro en vez de aquí (ver showHint).
export const ROI_DRAG_HINT = 'Arrastra para mover el vídeo · rueda o los botones +/- de la barra inferior para acercar y alejar';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

interface RectangleSelectionOverlayProps {
  active: boolean;
  // Rectángulo (fracciones 0-1 del fotograma) donde realmente se ve el
  // vídeo: si el ajuste actual (contain/cover, sin roi todavía) deja barras
  // negras, el vídeo ocupa menos que el fotograma completo y hay que
  // descontar ese margen para que arrastrar/hacer zoom apunte al vídeo real.
  contentBox?: { x: number; y: number; width: number; height: number };
  // Falso cuando el fotograma es demasiado estrecho para mostrar el texto de
  // ayuda entero junto al cuadro de zoom: en ese caso VideoPreview lo
  // renderiza fuera del recuadro y aquí no se duplica.
  showHint?: boolean;
}

export function RectangleSelectionOverlay({ active, contentBox = FULL_CONTENT_BOX, showHint = true }: RectangleSelectionOverlayProps) {
  const roi = useTimelineStore((state) => state.timeline?.roi ?? null);
  const setRectangleSelection = useTimelineStore((state) => state.setRectangleSelection);
  const zoomRectangleSelection = useTimelineStore((state) => state.zoomRectangleSelection);
  const clearRectangleSelection = useTimelineStore((state) => state.clearRectangleSelection);
  const [draft, setDraft] = useState<RectangleSelection | null>(null);
  const draftRef = useRef<RectangleSelection | null>(null);

  if (!active) return null;
  const current = draft || roi || FULL_FRAME;

  // Convierte una posición del puntero (píxeles de pantalla) en una fracción
  // 0-1 relativa al vídeo realmente visible, no al fotograma completo (que
  // puede incluir barras negras mientras no haya un roi todavía).
  const sourcePoint = (frame: HTMLElement, clientX: number, clientY: number) => {
    const rect = frame.getBoundingClientRect();
    const frameX = (clientX - rect.left) / rect.width;
    const frameY = (clientY - rect.top) / rect.height;
    return {
      x: contentBox.width > 0 ? clamp((frameX - contentBox.x) / contentBox.width, 0, 1) : frameX,
      y: contentBox.height > 0 ? clamp((frameY - contentBox.y) / contentBox.height, 0, 1) : frameY
    };
  };

  // Arrastra el propio vídeo (no una ventana sobre él): el contenido sigue
  // al cursor, en vez de tener que dibujar/mover un recuadro de selección.
  const startPan = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const frame = event.currentTarget.closest<HTMLElement>('.video-preview__frame');
    if (!frame) return;
    event.preventDefault();
    event.stopPropagation();
    const startPoint = sourcePoint(frame, event.clientX, event.clientY);
    const start = { ...current };
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    const update = (pointer: PointerEvent) => {
      const point = sourcePoint(frame, pointer.clientX, pointer.clientY);
      const next = {
        ...start,
        x: clamp(start.x - (point.x - startPoint.x) * start.width, 0, 1 - start.width),
        y: clamp(start.y - (point.y - startPoint.y) * start.height, 0, 1 - start.height)
      };
      draftRef.current = next;
      setDraft(next);
    };
    const finish = (pointer?: PointerEvent) => {
      if (pointer && pointer.pointerId !== event.pointerId) return;
      window.removeEventListener('pointermove', update);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      document.body.style.userSelect = previousUserSelect;
      if (draftRef.current) setRectangleSelection(draftRef.current);
      draftRef.current = null;
      setDraft(null);
    };
    const cancel = (pointer: PointerEvent) => finish(pointer);
    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
  };

  // Acerca/aleja el vídeo manteniendo fijo el punto bajo el cursor. La rueda
  // es el único zoom que queda anclado al puntero: los botones +/- viven
  // ahora en la barra de controles inferior (fuera del fotograma) y por eso
  // acercan/alejan desde el centro del recorte actual (ver zoomRectangleSelection).
  const handleWheel = (event: React.WheelEvent<HTMLElement>) => {
    event.preventDefault();
    const frame = event.currentTarget.closest<HTMLElement>('.video-preview__frame');
    if (!frame) return;
    const point = sourcePoint(frame, event.clientX, event.clientY);
    const anchorX = current.x + point.x * current.width;
    const anchorY = current.y + point.y * current.height;
    zoomRectangleSelection(event.deltaY < 0 ? 0.9 : 1 / 0.9, { x: anchorX, y: anchorY });
  };

  const zoomPercent = Math.round(100 / current.width);
  return (
    <div
      className="rectangle-selection-overlay"
      onPointerDown={startPan}
      onWheel={handleWheel}
      role="button"
      tabIndex={0}
      aria-label="Mover y ajustar el vídeo"
    >
      <div className="rectangle-selection-overlay__bottom-bar">
        {showHint && <span className="rectangle-selection-overlay__hint">{ROI_DRAG_HINT}</span>}
        <div
          className="rectangle-selection-overlay__inspector"
          aria-live="polite"
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <span>Zoom {zoomPercent}%</span>
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={clearRectangleSelection}>Restablecer</button>
        </div>
      </div>
    </div>
  );
}
