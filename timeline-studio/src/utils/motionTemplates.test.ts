import { describe, expect, it } from 'vitest';
import { MOTION_TEMPLATES } from '../constants/motionTemplates';
import { buildTemplateInsertion, type MotionTemplateFieldValues } from './motionTemplates';

function idSequence() {
  let n = 0;
  return () => `id-${n++}`;
}

describe('MOTION_TEMPLATES catalog', () => {
  it('tiene al menos 5 plantillas cubriendo intro, outro, 2 lower-third y un título', () => {
    expect(MOTION_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    const categories = MOTION_TEMPLATES.map((template) => template.category);
    expect(categories.filter((c) => c === 'intro').length).toBeGreaterThanOrEqual(1);
    expect(categories.filter((c) => c === 'outro').length).toBeGreaterThanOrEqual(1);
    expect(categories.filter((c) => c === 'lower-third').length).toBeGreaterThanOrEqual(2);
    expect(categories.filter((c) => c === 'titulo').length).toBeGreaterThanOrEqual(1);
  });

  it('cada plantilla tiene al menos 2 keyframes por elemento y una duración por defecto dentro de su propio rango', () => {
    for (const template of MOTION_TEMPLATES) {
      expect(template.defaultDurationMs).toBeGreaterThanOrEqual(template.durationRangeMs[0]);
      expect(template.defaultDurationMs).toBeLessThanOrEqual(template.durationRangeMs[1]);
      for (const element of template.elements) {
        expect(element.keyframes.length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe('buildTemplateInsertion', () => {
  const template = MOTION_TEMPLATES.find((item) => item.id === 'intro-pop')!;
  const emptyValues: MotionTemplateFieldValues = { text: {}, color: {}, logo: {} };

  it('usa el texto y color por defecto de la plantilla cuando el usuario no personaliza nada', () => {
    const { textClips } = buildTemplateInsertion(template, emptyValues, 10, 3000, idSequence());
    expect(textClips).toHaveLength(1);
    expect(textClips[0].text).toBe('Bienvenido');
    expect(textClips[0].color).toBe('blanco');
  });

  it('aplica el texto y el color elegidos por el usuario', () => {
    const values: MotionTemplateFieldValues = { text: { title: 'Hola Mundo' }, color: { accent: 'rojo' }, logo: {} };
    const { textClips } = buildTemplateInsertion(template, values, 0, 3000, idSequence());
    expect(textClips[0].text).toBe('Hola Mundo');
    expect(textClips[0].color).toBe('rojo');
  });

  it('coloca el clip en el instante de inserción pedido y respeta la duración elegida', () => {
    const { textClips } = buildTemplateInsertion(template, emptyValues, 12.5, 3000, idSequence());
    expect(textClips[0].startTime).toBe(12.5);
    expect(textClips[0].endTime).toBe(15.5);
  });

  it('reescala los keyframes (fracción t) a milisegundos según la duración elegida', () => {
    const { textClips } = buildTemplateInsertion(template, emptyValues, 0, 4000, idSequence());
    const keyframes = textClips[0].keyframes!;
    expect(keyframes[0].timeMs).toBe(0);
    expect(keyframes[keyframes.length - 1].timeMs).toBe(4000);
    // El segundo keyframe de esta plantilla está en t=.22
    expect(keyframes[1].timeMs).toBe(Math.round(.22 * 4000));
  });

  it('omite el elemento de logo cuando el usuario no proporciona uno', () => {
    const outro = MOTION_TEMPLATES.find((item) => item.id === 'outro-thanks')!;
    const { brollClips } = buildTemplateInsertion(outro, emptyValues, 0, 3200, idSequence());
    expect(brollClips).toHaveLength(0);
  });

  it('incluye el elemento de logo cuando el usuario sí proporciona uno', () => {
    const outro = MOTION_TEMPLATES.find((item) => item.id === 'outro-thanks')!;
    const values: MotionTemplateFieldValues = { text: {}, color: {}, logo: { logo: { url: '/generated/logo.png', storageKey: 'k1' } } };
    const { brollClips } = buildTemplateInsertion(outro, values, 0, 3200, idSequence());
    expect(brollClips).toHaveLength(1);
    expect(brollClips[0].sourceUrl).toBe('/generated/logo.png');
    expect(brollClips[0].storageKey).toBe('k1');
  });
});
