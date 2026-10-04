import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EditorResizeHandle } from './EditorResizeHandle';

describe('EditorResizeHandle', () => {
  it('expone un separador vertical accesible y enfocable', () => {
    const html = renderToStaticMarkup(createElement(EditorResizeHandle, {
      axis: 'vertical',
      value: 480,
      bounds: { min: 280, max: 720 },
      label: 'Redimensionar panel',
      instructions: 'Arrastra o usa las flechas.',
      controls: 'panel canvas',
      cssVariable: '--transcript-panel-width',
      onChange: () => undefined,
      onReset: () => undefined
    }));

    expect(html).toContain('role="separator"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-controls="panel canvas"');
    expect(html).toContain('aria-valuemin="280"');
    expect(html).toContain('aria-valuemax="720"');
    expect(html).toContain('aria-valuenow="480"');
    expect(html).toContain('editor-resize-handle--vertical');
  });

  it('distingue el separador horizontal', () => {
    const html = renderToStaticMarkup(createElement(EditorResizeHandle, {
      axis: 'horizontal',
      reverse: true,
      value: 294,
      bounds: { min: 180, max: 580 },
      label: 'Redimensionar timeline',
      instructions: 'Arrastra o usa las flechas.',
      controls: 'canvas timeline',
      cssVariable: '--timeline-height',
      onChange: () => undefined,
      onReset: () => undefined
    }));

    expect(html).toContain('aria-orientation="horizontal"');
    expect(html).toContain('editor-resize-handle--horizontal');
  });
});
