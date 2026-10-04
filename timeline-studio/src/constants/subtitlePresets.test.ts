import { describe, expect, it } from 'vitest';
import {
  getSubtitlePresetOption,
  mixHexColors,
  resolveSubtitleRendering,
  subtitleWordFrame
} from './subtitlePresets';

describe('subtitle preview/export parity', () => {
  it('uses the bundled editor font mapped for each preset', () => {
    expect(getSubtitlePresetOption('karaoke').cssFont).toContain('Vidreum Anton');
    expect(getSubtitlePresetOption('chrome-pink').cssFont).toContain('Vidreum Nunito');
    expect(getSubtitlePresetOption('pearl-gold').cssFont).toContain('Vidreum Pacifico');
  });

  it('resolves ASS treatment and placement scaling in the preview', () => {
    const outline = resolveSubtitleRendering('karaoke', 'outline', 2);
    expect(outline.outlineWidth).toBeCloseTo(9.2);
    expect(outline.shadowDepth).toBeCloseTo(4.8);

    const box = resolveSubtitleRendering('karaoke', 'box');
    expect(box.borderStyle).toBe(3);
    expect(box.outlineWidth).toBe(8);
    expect(box.shadowDepth).toBe(0);
  });

  it('derives word effects from the playhead instead of restarting CSS animations', () => {
    const popPeak = subtitleWordFrame('pop', .085, 0, .5, .22);
    expect(popPeak.emphasis).toBeCloseTo(1);
    expect(popPeak.scaleX).toBeCloseTo(1.18);
    expect(popPeak.blur).toBeCloseTo(.1);

    const bouncePeak = subtitleWordFrame('bounce', .085, 0, .5, .22);
    expect(bouncePeak.scaleX).toBeCloseTo(1.08);
    expect(bouncePeak.scaleY).toBeCloseTo(1.26);
    expect(bouncePeak.rotation).toBeCloseTo(-2);

    const flashSettled = subtitleWordFrame('flash', .3, 0, .5, .22);
    expect(flashSettled.outlineEmphasis).toBe(1);
    expect(flashSettled.blur).toBeCloseTo(.22);

    expect(subtitleWordFrame('karaoke', -.1, 0, .5, .22).emphasis).toBe(0);
    expect(subtitleWordFrame('karaoke', .25, 0, .5, .22).emphasis).toBe(1);
  });

  it('interpolates the active word palette deterministically', () => {
    expect(mixHexColors('#000000', '#ffffff', .5)).toBe('#808080');
    expect(mixHexColors('#ff0000', '#00ff00', 0)).toBe('#ff0000');
    expect(mixHexColors('#ff0000', '#00ff00', 1)).toBe('#00ff00');
  });
});
