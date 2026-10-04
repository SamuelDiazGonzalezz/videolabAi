import { useEffect, useState } from 'react';
import { Check, Clapperboard, Plus } from 'lucide-react';
import { MOTION_TEMPLATES, type MotionTemplate } from '../constants/motionTemplates';
import { TEXT_COLORS, type MediaAsset, type TextClipColor } from '../types/timeline';
import { interpolateKeyframes } from '../utils/keyframes';
import type { MotionTemplateFieldValues } from '../utils/motionTemplates';

// Función 2 — Plantillas de motion graphics reutilizables. Panel de
// selección + personalización, análogo a los demás paneles de
// PropertiesPanel (media/graphics/brand): catálogo declarativo
// (constants/motionTemplates.ts) → formulario genérico generado a partir de
// `editableFields` → inserción vía buildTemplateInsertion (utils puros,
// testeados aparte).

const CATEGORY_LABELS: Record<MotionTemplate['category'], string> = {
  intro: 'Intro',
  outro: 'Outro',
  'lower-third': 'Rótulo inferior',
  titulo: 'Título'
};

const COLOR_ENTRIES = Object.keys(TEXT_COLORS) as TextClipColor[];

function TemplatePreview({ template }: { template: MotionTemplate }) {
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    let frame = 0;
    let cancelled = false;
    const start = performance.now();
    const tick = (time: number) => {
      if (cancelled) return;
      setNowMs((time - start) % template.defaultDurationMs);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [template.defaultDurationMs]);

  return (
    <div className="template-card__preview">
      {template.elements.map((element, index) => {
        const animated = interpolateKeyframes(
          element.keyframes.map((kf) => ({
            id: String(index),
            timeMs: kf.t * template.defaultDurationMs,
            x: kf.x, y: kf.y, scale: kf.scale, opacity: kf.opacity, rotation: kf.rotation, easing: kf.easing
          })),
          nowMs
        );
        if (!animated) return null;
        return (
          <span
            key={index}
            className="template-card__element"
            style={{
              left: `${animated.x * 100}%`,
              top: `${animated.y * 100}%`,
              opacity: animated.opacity,
              transform: `translate(-50%, -50%) scale(${animated.scale}) rotate(${animated.rotation}deg)`
            }}
          >
            {element.kind === 'text' ? 'Aa' : '◆'}
          </span>
        );
      })}
    </div>
  );
}

export interface TemplatesPanelProps {
  assets: MediaAsset[];
  onInsertTemplate: (template: MotionTemplate, values: MotionTemplateFieldValues, durationMs: number) => void;
}

export function TemplatesPanel({ assets, onInsertTemplate }: TemplatesPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [textValues, setTextValues] = useState<Record<string, string>>({});
  const [colorValues, setColorValues] = useState<Record<string, TextClipColor>>({});
  const [logoValues, setLogoValues] = useState<Record<string, { url: string; storageKey?: string } | undefined>>({});
  const [durationMs, setDurationMs] = useState(0);

  const selected = MOTION_TEMPLATES.find((template) => template.id === selectedId) || null;
  const imageAssets = assets.filter((asset) => asset.type === 'image');

  const selectTemplate = (template: MotionTemplate) => {
    setSelectedId(template.id);
    setTextValues(Object.fromEntries(
      template.editableFields.filter((field) => field.type === 'text').map((field) => {
        const element = template.elements.find((item) => item.kind === 'text' && item.textFieldKey === field.key);
        return [field.key, element && element.kind === 'text' ? element.defaultText : ''];
      })
    ));
    setColorValues({});
    setLogoValues({});
    setDurationMs(template.defaultDurationMs);
  };

  return (
    <>
      <p className="properties-panel__hint">Arrastra una plantilla lista para usar: personalízala y añádela en el cabezal actual.</p>
      <div className="template-grid">
        {MOTION_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            className={`template-card${selected?.id === template.id ? ' is-active' : ''}`}
            onClick={() => selectTemplate(template)}
          >
            <TemplatePreview template={template} />
            <span className="template-card__label">
              <strong>{template.name}</strong>
              <small>{CATEGORY_LABELS[template.category]}</small>
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="properties-panel__section properties-panel__clip-box template-customize">
          <span className="properties-panel__label"><Clapperboard size={13} /> Personalizar «{selected.name}»</span>
          {selected.editableFields.map((field) => {
            if (field.type === 'text') {
              return (
                <label className="properties-panel__field" key={field.key}>
                  <span>{field.label}</span>
                  <input
                    data-i18n-skip=""
                    maxLength={80}
                    value={textValues[field.key] ?? ''}
                    onChange={(event) => setTextValues((current) => ({ ...current, [field.key]: event.target.value }))}
                  />
                </label>
              );
            }
            if (field.type === 'color') {
              return (
                <fieldset className="properties-panel__colors" key={field.key}>
                  <legend>{field.label}</legend>
                  <div>
                    {COLOR_ENTRIES.map((color) => (
                      <label key={color} title={color}>
                        <input
                          type="radio"
                          name={`template-${selected.id}-${field.key}`}
                          checked={(colorValues[field.key] ?? 'blanco') === color}
                          onChange={() => setColorValues((current) => ({ ...current, [field.key]: color }))}
                        />
                        <span style={{ background: TEXT_COLORS[color] }} />
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            }
            // type === 'logo'
            return (
              <div className="properties-panel__section" key={field.key}>
                <span className="properties-panel__label">{field.label}</span>
                {!imageAssets.length && <p className="properties-panel__hint">Sube una imagen desde el panel Multimedia para poder usarla como logo.</p>}
                <div className="template-logo-grid">
                  {imageAssets.map((asset) => (
                    <button
                      type="button"
                      key={asset.id}
                      className={logoValues[field.key]?.url === asset.url ? 'is-active' : ''}
                      onClick={() => setLogoValues((current) => ({
                        ...current,
                        [field.key]: current[field.key]?.url === asset.url ? undefined : { url: asset.url, storageKey: asset.storageKey }
                      }))}
                    >
                      <img src={asset.url} alt="" />
                      {logoValues[field.key]?.url === asset.url && <Check size={12} />}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          <label className="properties-panel__range">
            <span>Duración<strong>{(durationMs / 1000).toFixed(1)} s</strong></span>
            <input
              type="range"
              min={selected.durationRangeMs[0]}
              max={selected.durationRangeMs[1]}
              step={100}
              value={durationMs}
              onChange={(event) => setDurationMs(Number(event.target.value))}
            />
          </label>
          <button
            type="button"
            className="properties-panel__primary"
            onClick={() => onInsertTemplate(selected, { text: textValues, color: colorValues, logo: logoValues }, durationMs)}
          >
            <Plus size={14} /> Insertar en el cabezal actual
          </button>
        </div>
      )}
    </>
  );
}
