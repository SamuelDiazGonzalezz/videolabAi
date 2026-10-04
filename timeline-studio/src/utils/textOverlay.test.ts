import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TextClip } from '../types/timeline';
import { waitForEditorFonts } from './textOverlay';

const originalDocument = globalThis.document;

afterEach(() => {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: originalDocument
  });
});

function textClip(overrides: Partial<TextClip> = {}): TextClip {
  return {
    id: 'text-1',
    kind: 'text',
    text: 'Vidreum',
    startTime: 0,
    endTime: 1000,
    style: 'outline',
    font: 'modern',
    position: 'center',
    size: 'medium',
    color: 'blanco',
    x: .5,
    y: .5,
    width: .8,
    scale: 1,
    preset: 'none',
    wordEffect: 'karaoke',
    entranceAnimation: 'none',
    entranceDurationMs: 0,
    exitAnimation: 'none',
    exitDurationMs: 0,
    ...overrides
  };
}

describe('waitForEditorFonts', () => {
  it('carga únicamente las fuentes efectivas y no espera fuentes ajenas', async () => {
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        fonts: {
          load,
          get ready() {
            throw new Error('no debe esperar document.fonts.ready');
          }
        }
      }
    });

    await waitForEditorFonts([
      textClip(),
      textClip({ id: 'text-2' }),
      textClip({ id: 'text-3', font: 'serif' }),
      textClip({ id: 'text-4', preset: 'pearl-gold' })
    ]);

    expect(load.mock.calls.map(([font]) => font)).toEqual([
      '800 64px "Vidreum Inter", sans-serif',
      '700 64px "Vidreum Noto Serif", serif',
      '400 64px "Vidreum Pacifico", cursive'
    ]);
  });

  it('no inicia descargas si no hay rótulos rasterizados', async () => {
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { fonts: { load } }
    });

    await waitForEditorFonts([]);

    expect(load).not.toHaveBeenCalled();
  });
});
