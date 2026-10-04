import { useState } from 'react';
import { Diamond, Plus, Scan, Trash2 } from 'lucide-react';
import type { Keyframe, KeyframeEasing } from '../types/timeline';
import { createKeyframeId, interpolateKeyframes } from '../utils/keyframes';
import { formatTimecode } from '../utils/timeline';

// Función 1 — Keyframes simples de transformación. Panel de edición
// reutilizado por 'Texto' y 'B-Roll' en PropertiesPanel.tsx: lista de
// keyframes con inputs numéricos (el brief pide explícitamente que no sea
// solo arrastre) + botón "+" en la posición actual del cabezal.

const EASING_OPTIONS: Array<{ value: KeyframeEasing; label: string }> = [
  { value: 'linear', label: 'Lineal' },
  { value: 'ease-in', label: 'Entrada' },
  { value: 'ease-out', label: 'Salida' },
  { value: 'ease-in-out', label: 'Entrada y salida' }
];

interface StaticTransform {
  x: number;
  y: number;
  scale: number;
  opacity: number;
}

interface KeyframesEditorProps {
  keyframes: Keyframe[] | undefined;
  /** Duración del clip en ms — para clampar el tiempo del nuevo keyframe. */
  clipDurationMs: number;
  /** Instante actual del cabezal, relativo al inicio del clip, en ms. */
  currentRelativeMs: number;
  /** Valores estáticos actuales del clip (se usan como punto de partida del primer keyframe). */
  staticTransform: StaticTransform;
  onChange: (keyframes: Keyframe[] | undefined) => void;
  onSeekRelativeMs: (relativeMs: number) => void;
  /** Función 5 — Tracking automático: la posición ACTUAL del elemento sobre
      el lienzo es la región que se analiza (arrástralo sobre el sujeto
      antes de pulsar el botón). Ausente si el elemento no admite tracking
      todavía (p. ej. sin clip de vídeo activo en ese instante). */
  onTrackRegion?: (durationSec: number) => Promise<void>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sorted(keyframes: Keyframe[]): Keyframe[] {
  return [...keyframes].sort((a, b) => a.timeMs - b.timeMs);
}

export function KeyframesEditor({
  keyframes, clipDurationMs, currentRelativeMs, staticTransform, onChange, onSeekRelativeMs, onTrackRegion
}: KeyframesEditorProps) {
  const list = sorted(keyframes || []);
  const [tracking, setTracking] = useState(false);
  const [trackError, setTrackError] = useState('');
  const trackDurationSec = Math.max(0.5, Math.min(30, clipDurationMs / 1000));

  const runTracking = async () => {
    if (!onTrackRegion || tracking) return;
    setTracking(true);
    setTrackError('');
    try {
      await onTrackRegion(trackDurationSec);
    } catch (error) {
      setTrackError(error instanceof Error ? error.message : 'No se pudo completar el seguimiento.');
    } finally {
      setTracking(false);
    }
  };

  const addKeyframe = () => {
    const timeMs = clamp(Math.round(currentRelativeMs), 0, Math.max(0, Math.round(clipDurationMs)));
    // Si ya hay keyframes, arranca desde el valor animado en este instante
    // (para no dar un salto visual); si es el primero, desde los valores
    // estáticos actuales del clip — en ambos casos el usuario edita luego.
    const base = list.length
      ? interpolateKeyframes(list, timeMs) || staticTransform
      : staticTransform;
    const next: Keyframe = {
      id: createKeyframeId(),
      timeMs,
      x: base.x,
      y: base.y,
      scale: base.scale,
      opacity: 'opacity' in base ? base.opacity : 1,
      rotation: 'rotation' in base && typeof (base as Keyframe).rotation === 'number' ? (base as Keyframe).rotation : 0,
      easing: 'linear'
    };
    // Dos keyframes en el mismo instante no interpolan nada: si ya existe
    // uno muy cerca, se sustituye en vez de duplicar.
    const withoutClash = list.filter((kf) => Math.abs(kf.timeMs - timeMs) >= 30);
    onChange(sorted([...withoutClash, next]));
  };

  const updateKeyframe = (id: string, changes: Partial<Keyframe>) => {
    onChange(list.map((kf) => (kf.id === id ? { ...kf, ...changes } : kf)));
  };

  const removeKeyframe = (id: string) => {
    const next = list.filter((kf) => kf.id !== id);
    onChange(next.length >= 2 ? next : undefined);
  };

  return (
    <div className="properties-panel__section keyframes-editor">
      <div className="keyframes-editor__header">
        <span className="properties-panel__label"><Diamond size={12} /> Keyframes</span>
        <button type="button" className="keyframes-editor__add" onClick={addKeyframe}>
          <Plus size={13} /> Añadir en {formatTimecode(currentRelativeMs / 1000, false)}
        </button>
      </div>
      {onTrackRegion && (
        <div className="keyframes-editor__tracking">
          <button type="button" className="keyframes-editor__track-button" onClick={() => void runTracking()} disabled={tracking}>
            <Scan size={13} /> {tracking ? 'Analizando el vídeo…' : `Rastrear objeto automáticamente (${trackDurationSec.toFixed(1)} s)`}
          </button>
          <p className="properties-panel__hint">
            Coloca este elemento sobre el sujeto que quieras seguir (arrástralo en el lienzo) y pulsa aquí — sustituye los keyframes actuales por la trayectoria detectada, que luego puedes corregir a mano abajo.
          </p>
          {trackError && <p className="properties-panel__warning">{trackError}</p>}
        </div>
      )}
      {list.length === 0 ? (
        <p className="properties-panel__hint">
          Añade al menos 2 keyframes para animar la posición, escala, opacidad y rotación de este elemento a lo largo del tiempo.
        </p>
      ) : (
        <>
          {list.length === 1 && (
            <p className="properties-panel__hint">Con un solo keyframe el elemento no se anima todavía — añade uno segundo en otro instante.</p>
          )}
          <ul className="keyframes-editor__list">
            {list.map((kf, index) => (
              <li key={kf.id} className="keyframes-editor__item">
                <div className="keyframes-editor__item-header">
                  <button type="button" className="keyframes-editor__time" onClick={() => onSeekRelativeMs(kf.timeMs)}>
                    <Diamond size={10} /> #{index + 1} · {formatTimecode(kf.timeMs / 1000, false)}
                  </button>
                  <button type="button" className="keyframes-editor__delete" title="Eliminar keyframe" onClick={() => removeKeyframe(kf.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="keyframes-editor__grid">
                  <label><span>X</span><input type="number" step={1} value={Math.round(kf.x * 100)} onChange={(event) => updateKeyframe(kf.id, { x: clamp(Number(event.target.value) / 100, 0, 1) })} /></label>
                  <label><span>Y</span><input type="number" step={1} value={Math.round(kf.y * 100)} onChange={(event) => updateKeyframe(kf.id, { y: clamp(Number(event.target.value) / 100, 0, 1) })} /></label>
                  <label><span>Escala</span><input type="number" step={1} value={Math.round(kf.scale * 100)} onChange={(event) => updateKeyframe(kf.id, { scale: clamp(Number(event.target.value) / 100, 5, 400) / 100 })} /></label>
                  <label><span>Opacidad</span><input type="number" step={1} value={Math.round(kf.opacity * 100)} onChange={(event) => updateKeyframe(kf.id, { opacity: clamp(Number(event.target.value) / 100, 0, 1) })} /></label>
                  <label><span>Rotación</span><input type="number" step={1} value={Math.round(kf.rotation)} onChange={(event) => updateKeyframe(kf.id, { rotation: clamp(Number(event.target.value), -360, 360) })} /></label>
                  <label>
                    <span>Easing</span>
                    <select value={kf.easing} onChange={(event) => updateKeyframe(kf.id, { easing: event.target.value as KeyframeEasing })}>
                      {EASING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
