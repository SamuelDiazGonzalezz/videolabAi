export interface ResizeBounds {
  min: number;
  max: number;
}

export interface EditorLayoutPreference {
  transcriptWidth: number;
  timelineHeight: number;
}

export interface EditorChromeSizes {
  canvasMinimumWidth: number;
  propertiesPanelWidth: number;
  toolRailWidth: number;
}

export interface EditorLayoutStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export type EditorResizeAxis = 'vertical' | 'horizontal';

export const EDITOR_LAYOUT_STORAGE_KEY = 'vidreum.timeline-studio.layout.v1';
export const DEFAULT_TIMELINE_HEIGHT = 294;
export const MIN_TIMELINE_HEIGHT = 180;
export const MIN_WORKSPACE_HEIGHT = 240;
export const MIN_TRANSCRIPT_WIDTH = 280;
export const MIN_CANVAS_WIDTH = 340;
export const EDITOR_RESIZE_HANDLE_SIZE = 7;

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function clampResizeValue(value: number, bounds: ResizeBounds): number {
  const minimum = Math.round(Math.min(bounds.min, bounds.max));
  const maximum = Math.round(Math.max(bounds.min, bounds.max));
  if (!Number.isFinite(value)) return minimum;
  return Math.round(Math.min(maximum, Math.max(minimum, value)));
}

export function defaultTranscriptWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 640;
  if (viewportWidth <= 1250) return 310;
  const progressiveWidth = Math.round(310 + (viewportWidth - 1250) * .572);
  return Math.max(MIN_TRANSCRIPT_WIDTH, Math.min(Math.round(viewportWidth * .36), progressiveWidth));
}

export function editorChromeSizes(workspaceWidth: number): EditorChromeSizes {
  const safeWidth = Number.isFinite(workspaceWidth) ? workspaceWidth : 1000;
  const progress = Math.min(1, Math.max(0, (safeWidth - 1000) / 250));
  return {
    canvasMinimumWidth: Math.round(320 + 20 * progress),
    propertiesPanelWidth: Math.round(270 + 60 * progress),
    toolRailWidth: Math.round(74 + 14 * progress)
  };
}

export function editorResizeAvailability(workspaceWidth: number): { transcript: boolean; timeline: boolean } {
  return {
    transcript: workspaceWidth > 1000,
    timeline: workspaceWidth > 760
  };
}

export function transcriptResizeBounds(workspaceWidth: number, propertiesPanelOpen: boolean): ResizeBounds {
  const chrome = editorChromeSizes(workspaceWidth);
  const propertiesWidth = propertiesPanelOpen ? chrome.propertiesPanelWidth : 0;
  const availableMaximum = Math.round(workspaceWidth)
    - chrome.toolRailWidth
    - propertiesWidth
    - chrome.canvasMinimumWidth
    - EDITOR_RESIZE_HANDLE_SIZE;

  return {
    min: MIN_TRANSCRIPT_WIDTH,
    max: Math.max(MIN_TRANSCRIPT_WIDTH, availableMaximum)
  };
}

export function timelineResizeBounds(appHeight: number): ResizeBounds {
  // Cabecera (54px) + estado (24px) + espacio mínimo para toolbar y lienzo.
  // El tirador horizontal se superpone al límite y no consume una fila propia.
  const availableMaximum = Math.max(0, Math.round(appHeight) - 54 - 24 - MIN_WORKSPACE_HEIGHT);
  return {
    min: Math.min(MIN_TIMELINE_HEIGHT, availableMaximum),
    max: availableMaximum
  };
}

export function resizeFromPointer(
  startValue: number,
  startCoordinate: number,
  currentCoordinate: number,
  bounds: ResizeBounds,
  reverse = false
): number {
  const delta = (currentCoordinate - startCoordinate) * (reverse ? -1 : 1);
  return clampResizeValue(startValue + delta, bounds);
}

export function resizeFromKeyboard(
  value: number,
  key: string,
  axis: EditorResizeAxis,
  bounds: ResizeBounds,
  largeStep = false
): number | null {
  const step = largeStep ? 48 : 16;
  if (key === 'Home') return bounds.min;
  if (key === 'End') return bounds.max;
  if (axis === 'vertical' && key === 'ArrowLeft') return clampResizeValue(value - step, bounds);
  if (axis === 'vertical' && key === 'ArrowRight') return clampResizeValue(value + step, bounds);
  // El valor horizontal representa la altura del panel inferior: subir el
  // divisor aumenta la línea de tiempo y bajarlo deja más espacio al lienzo.
  if (axis === 'horizontal' && key === 'ArrowUp') return clampResizeValue(value + step, bounds);
  if (axis === 'horizontal' && key === 'ArrowDown') return clampResizeValue(value - step, bounds);
  return null;
}

export function parseEditorLayoutPreference(raw: string | null): Partial<EditorLayoutPreference> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as Partial<EditorLayoutPreference> | null;
    if (!value || typeof value !== 'object') return {};
    const transcriptWidth = finiteNumber(value.transcriptWidth);
    const timelineHeight = finiteNumber(value.timelineHeight);
    return {
      ...(transcriptWidth != null && transcriptWidth > 0 ? { transcriptWidth } : {}),
      ...(timelineHeight != null && timelineHeight > 0 ? { timelineHeight } : {})
    };
  } catch {
    return {};
  }
}

export function readEditorLayoutPreference(storage: Pick<EditorLayoutStorage, 'getItem'> | null, viewportWidth: number): EditorLayoutPreference {
  let saved: Partial<EditorLayoutPreference> = {};
  try {
    saved = parseEditorLayoutPreference(storage?.getItem(EDITOR_LAYOUT_STORAGE_KEY) ?? null);
  } catch {
    // El almacenamiento es opcional (por ejemplo, navegación privada estricta).
  }
  return {
    transcriptWidth: saved.transcriptWidth ?? defaultTranscriptWidth(viewportWidth),
    timelineHeight: saved.timelineHeight ?? DEFAULT_TIMELINE_HEIGHT
  };
}

export function writeEditorLayoutPreference(
  storage: Pick<EditorLayoutStorage, 'setItem'> | null,
  preference: EditorLayoutPreference
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(EDITOR_LAYOUT_STORAGE_KEY, JSON.stringify(preference));
    return true;
  } catch {
    return false;
  }
}
