import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMELINE_HEIGHT,
  clampResizeValue,
  defaultTranscriptWidth,
  editorChromeSizes,
  editorResizeAvailability,
  parseEditorLayoutPreference,
  readEditorLayoutPreference,
  resizeFromKeyboard,
  resizeFromPointer,
  timelineResizeBounds,
  transcriptResizeBounds,
  writeEditorLayoutPreference
} from './editorLayout';

describe('editor layout resizing', () => {
  it('mueve el panel de texto en la misma dirección que el puntero y respeta sus límites', () => {
    const bounds = { min: 280, max: 720 };
    expect(resizeFromPointer(500, 600, 680, bounds)).toBe(580);
    expect(resizeFromPointer(500, 600, 100, bounds)).toBe(280);
    expect(resizeFromPointer(700, 600, 900, bounds)).toBe(720);
  });

  it('mueve el divisor horizontal al revés para que subirlo amplíe el timeline', () => {
    const bounds = { min: 180, max: 580 };
    expect(resizeFromPointer(DEFAULT_TIMELINE_HEIGHT, 610, 550, bounds, true)).toBe(354);
    expect(resizeFromPointer(DEFAULT_TIMELINE_HEIGHT, 610, 760, bounds, true)).toBe(180);
  });

  it('calcula máximos que conservan el lienzo y los paneles fijos', () => {
    expect(transcriptResizeBounds(1912, true)).toEqual({ min: 280, max: 1147 });
    expect(transcriptResizeBounds(1200, true)).toEqual({ min: 280, max: 454 });
    expect(transcriptResizeBounds(1200, false)).toEqual({ min: 280, max: 772 });
    expect(timelineResizeBounds(907)).toEqual({ min: 180, max: 589 });
  });

  it('mantiene continuos los paneles fijos al cruzar 1250 px', () => {
    expect(editorChromeSizes(1000)).toEqual({ canvasMinimumWidth: 320, propertiesPanelWidth: 270, toolRailWidth: 74 });
    expect(editorChromeSizes(1250)).toEqual({ canvasMinimumWidth: 340, propertiesPanelWidth: 330, toolRailWidth: 88 });
    expect(editorChromeSizes(1251)).toEqual(editorChromeSizes(1250));
    expect(transcriptResizeBounds(1251, true).max).toBeGreaterThanOrEqual(transcriptResizeBounds(1250, true).max);
  });

  it('define exactamente los breakpoints en los que cada tirador está disponible', () => {
    expect(editorResizeAvailability(760)).toEqual({ transcript: false, timeline: false });
    expect(editorResizeAvailability(761)).toEqual({ transcript: false, timeline: true });
    expect(editorResizeAvailability(1000)).toEqual({ transcript: false, timeline: true });
    expect(editorResizeAvailability(1001)).toEqual({ transcript: true, timeline: true });
  });

  it('reduce el mínimo del timeline en ventanas excepcionalmente bajas', () => {
    expect(timelineResizeBounds(498)).toEqual({ min: 180, max: 180 });
    expect(timelineResizeBounds(400)).toEqual({ min: 82, max: 82 });
    expect(timelineResizeBounds(300)).toEqual({ min: 0, max: 0 });
  });

  it('adapta el ancho inicial al breakpoint de escritorio compacto', () => {
    expect(defaultTranscriptWidth(1912)).toBe(688);
    expect(defaultTranscriptWidth(1200)).toBe(310);
    expect(defaultTranscriptWidth(1250)).toBe(310);
    expect(defaultTranscriptWidth(1251)).toBe(311);
  });

  it('permite redimensionar con flechas, Shift, Inicio y Fin', () => {
    const bounds = { min: 180, max: 580 };
    expect(resizeFromKeyboard(300, 'ArrowUp', 'horizontal', bounds)).toBe(316);
    expect(resizeFromKeyboard(300, 'ArrowDown', 'horizontal', bounds, true)).toBe(252);
    expect(resizeFromKeyboard(300, 'Home', 'horizontal', bounds)).toBe(180);
    expect(resizeFromKeyboard(300, 'End', 'horizontal', bounds)).toBe(580);
    expect(resizeFromKeyboard(300, 'ArrowLeft', 'vertical', bounds)).toBe(284);
    expect(resizeFromKeyboard(300, 'Enter', 'vertical', bounds)).toBeNull();
  });

  it('restaura solo preferencias persistidas válidas', () => {
    expect(parseEditorLayoutPreference('{"transcriptWidth":640,"timelineHeight":360}')).toEqual({
      transcriptWidth: 640,
      timelineHeight: 360
    });
    expect(parseEditorLayoutPreference('{"transcriptWidth":"no","timelineHeight":-2}')).toEqual({});
    expect(parseEditorLayoutPreference('{')).toEqual({});
    expect(clampResizeValue(Number.NaN, { min: 20, max: 40 })).toBe(20);
  });

  it('lee y escribe la preferencia sin depender de localStorage real', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }
    };
    expect(readEditorLayoutPreference(storage, 1200)).toEqual({ transcriptWidth: 310, timelineHeight: 294 });
    expect(writeEditorLayoutPreference(storage, { transcriptWidth: 520, timelineHeight: 360 })).toBe(true);
    expect(readEditorLayoutPreference(storage, 1200)).toEqual({ transcriptWidth: 520, timelineHeight: 360 });
    expect(readEditorLayoutPreference({ getItem: () => { throw new Error('blocked'); } }, 1200)).toEqual({
      transcriptWidth: 310,
      timelineHeight: 294
    });
    expect(writeEditorLayoutPreference({ setItem: () => { throw new Error('blocked'); } }, { transcriptWidth: 520, timelineHeight: 360 })).toBe(false);
  });
});
