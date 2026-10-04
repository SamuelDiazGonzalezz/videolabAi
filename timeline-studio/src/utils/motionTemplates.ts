import type { BrollClip, Keyframe, TextClip, TextClipColor } from '../types/timeline';
import type { MotionTemplate } from '../constants/motionTemplates';
import { createKeyframeId } from './keyframes';
import { DEFAULT_TEXT_ANIMATION_DURATION_MS } from '../constants/textAnimations';

// Función 2 — Plantillas de motion graphics reutilizables.
//
// Convierte una MotionTemplate (datos declarativos) + los valores que el
// usuario eligió en el panel de personalización, en clips reales (con
// keyframes de la Función 1 ya resueltos a milisegundos) listos para
// insertarse en el store con addTextClip/addBrollClip. Pura y testeable:
// no toca el store ni genera ids aleatorios salvo a través del parámetro
// `createId` (inyectado para que los tests sean deterministas).

export interface MotionTemplateFieldValues {
  text: Record<string, string>;
  color: Record<string, TextClipColor>;
  logo: Record<string, { url: string; storageKey?: string } | undefined>;
}

export interface MotionTemplateInsertion {
  textClips: TextClip[];
  brollClips: BrollClip[];
}

function resolveKeyframes(
  templateKeyframes: MotionTemplate['elements'][number]['keyframes'],
  durationMs: number,
  createId: () => string
): Keyframe[] {
  return templateKeyframes.map((kf) => ({
    id: createId(),
    timeMs: Math.round(kf.t * durationMs),
    x: kf.x,
    y: kf.y,
    scale: kf.scale,
    opacity: kf.opacity,
    rotation: kf.rotation,
    easing: kf.easing
  }));
}

/** Posición/escala representativas para los campos estáticos del clip (se usan si se borran los keyframes más adelante): el keyframe más cercano a la mitad de la animación, clampado a un encuadre visible. */
function representativeStatic(keyframes: Keyframe[]): { x: number; y: number; scale: number } {
  const middle = keyframes[Math.min(keyframes.length - 1, Math.floor(keyframes.length / 2))];
  return {
    x: Math.min(1, Math.max(0, middle.x)),
    y: Math.min(1, Math.max(0, middle.y)),
    scale: Math.min(2.5, Math.max(0.5, middle.scale))
  };
}

export function buildTemplateInsertion(
  template: MotionTemplate,
  values: MotionTemplateFieldValues,
  startTime: number,
  durationMs: number,
  createId: () => string = createKeyframeId
): MotionTemplateInsertion {
  const endTime = startTime + durationMs / 1000;
  const textClips: TextClip[] = [];
  const brollClips: BrollClip[] = [];

  for (const element of template.elements) {
    const keyframes = resolveKeyframes(element.keyframes, durationMs, createId);
    const staticValues = representativeStatic(keyframes);

    if (element.kind === 'text') {
      const text = (values.text[element.textFieldKey] ?? element.defaultText).trim().slice(0, 80) || element.defaultText;
      const color = element.colorFieldKey ? (values.color[element.colorFieldKey] ?? 'blanco') : 'blanco';
      textClips.push({
        id: `tpl-text-${createId()}`,
        kind: 'text',
        text,
        startTime,
        endTime,
        style: element.style,
        font: element.font,
        position: element.position,
        size: element.size,
        color,
        x: staticValues.x,
        y: staticValues.y,
        width: element.width,
        scale: staticValues.scale,
        preset: 'none',
        wordEffect: 'karaoke',
        entranceAnimation: 'none',
        entranceDurationMs: DEFAULT_TEXT_ANIMATION_DURATION_MS,
        exitAnimation: 'none',
        exitDurationMs: DEFAULT_TEXT_ANIMATION_DURATION_MS,
        keyframes
      });
      continue;
    }

    // kind === 'logo': sin logo elegido por el usuario, la plantilla se
    // inserta igualmente pero sin este elemento (el brief lo pide como
    // opcional — "si la plantilla lo soporta").
    const logo = values.logo[element.logoFieldKey];
    if (!logo?.url) continue;
    brollClips.push({
      id: `tpl-logo-${createId()}`,
      sourceUrl: logo.url,
      ...(logo.storageKey ? { storageKey: logo.storageKey } : {}),
      name: 'Logo',
      startTime,
      endTime,
      opacity: 1,
      x: staticValues.x,
      y: staticValues.y,
      width: element.width,
      height: element.height,
      blendMode: 'normal',
      keyframes
    });
  }

  return { textClips, brollClips };
}
