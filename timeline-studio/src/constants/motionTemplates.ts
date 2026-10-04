import type { KeyframeEasing, TextClipFont, TextClipPosition, TextClipSize, TextClipStyle } from '../types/timeline';

// Función 2 — Plantillas de motion graphics reutilizables. Datos puramente
// declarativos (ni un `if (template.id === ...)` en ningún sitio): añadir
// una plantilla nueva es añadir una entrada aquí, nada más — el motor que
// las interpreta (App.tsx → insertMotionTemplate) es genérico y reutiliza
// tal cual el sistema de keyframes de la Función 1.
//
// Los keyframes de una plantilla se expresan como fracción `t` (0–1) de SU
// PROPIA duración, no en ms: así, si el usuario alarga o acorta la plantilla
// dentro de `durationRangeMs`, la animación se reescala proporcionalmente
// sin tener que definir una curva distinta por duración.

export type MotionTemplateCategory = 'intro' | 'outro' | 'lower-third' | 'titulo';
export type MotionTemplateFieldType = 'text' | 'color' | 'logo';

export interface MotionTemplateField {
  key: string;
  type: MotionTemplateFieldType;
  label: string;
}

export interface TemplateKeyframe {
  t: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  rotation: number;
  easing: KeyframeEasing;
}

export interface MotionTemplateTextElement {
  kind: 'text';
  /** Referencia a un MotionTemplateField de type:'text' — qué campo edita el contenido de este elemento. */
  textFieldKey: string;
  /** Si está presente, el color de este elemento sigue al MotionTemplateField de type:'color' con esta key. */
  colorFieldKey?: string;
  defaultText: string;
  font: TextClipFont;
  style: TextClipStyle;
  size: TextClipSize;
  position: TextClipPosition;
  width: number;
  keyframes: TemplateKeyframe[];
}

export interface MotionTemplateLogoElement {
  kind: 'logo';
  /** Referencia a un MotionTemplateField de type:'logo'. Sin logo del usuario, este elemento simplemente no se inserta. */
  logoFieldKey: string;
  width: number;
  height: number;
  keyframes: TemplateKeyframe[];
}

export type MotionTemplateElement = MotionTemplateTextElement | MotionTemplateLogoElement;

export interface MotionTemplate {
  id: string;
  name: string;
  category: MotionTemplateCategory;
  durationRangeMs: [number, number];
  defaultDurationMs: number;
  editableFields: MotionTemplateField[];
  elements: MotionTemplateElement[];
}

const FULLSCREEN_TITLE_IN_OUT: TemplateKeyframe[] = [
  { t: 0, x: .5, y: .5, scale: .55, opacity: 0, rotation: -6, easing: 'ease-out' },
  { t: .22, x: .5, y: .5, scale: 1.06, opacity: 1, rotation: 0, easing: 'linear' },
  { t: .82, x: .5, y: .5, scale: 1, opacity: 1, rotation: 0, easing: 'ease-in' },
  { t: 1, x: .5, y: .5, scale: 1.18, opacity: 0, rotation: 3, easing: 'linear' }
];

export const MOTION_TEMPLATES: MotionTemplate[] = [
  {
    id: 'intro-pop',
    name: 'Intro — Aparición',
    category: 'intro',
    durationRangeMs: [1800, 4000],
    defaultDurationMs: 2800,
    editableFields: [
      { key: 'title', type: 'text', label: 'Título' },
      { key: 'accent', type: 'color', label: 'Color de acento' }
    ],
    elements: [
      {
        kind: 'text',
        textFieldKey: 'title',
        colorFieldKey: 'accent',
        defaultText: 'Bienvenido',
        font: 'display',
        style: 'shadow',
        size: 'large',
        position: 'center',
        width: .82,
        keyframes: FULLSCREEN_TITLE_IN_OUT
      }
    ]
  },
  {
    id: 'outro-thanks',
    name: 'Outro — Gracias por ver',
    category: 'outro',
    durationRangeMs: [2200, 4500],
    defaultDurationMs: 3200,
    editableFields: [
      { key: 'title', type: 'text', label: 'Título' },
      { key: 'subtitle', type: 'text', label: 'Subtítulo' },
      { key: 'accent', type: 'color', label: 'Color de acento' },
      { key: 'logo', type: 'logo', label: 'Logo (opcional)' }
    ],
    elements: [
      {
        kind: 'logo',
        logoFieldKey: 'logo',
        width: .22,
        height: .22,
        keyframes: [
          { t: 0, x: .5, y: .22, scale: .6, opacity: 0, rotation: 0, easing: 'ease-out' },
          { t: .3, x: .5, y: .22, scale: 1, opacity: 1, rotation: 0, easing: 'linear' },
          { t: .82, x: .5, y: .22, scale: 1, opacity: 1, rotation: 0, easing: 'ease-in' },
          { t: 1, x: .5, y: .22, scale: .92, opacity: 0, rotation: 0, easing: 'linear' }
        ]
      },
      {
        kind: 'text',
        textFieldKey: 'title',
        colorFieldKey: 'accent',
        defaultText: 'Gracias por ver',
        font: 'display',
        style: 'outline',
        size: 'medium',
        position: 'center',
        width: .82,
        keyframes: [
          { t: 0, x: .5, y: .48, scale: .85, opacity: 0, rotation: 0, easing: 'ease-out' },
          { t: .28, x: .5, y: .48, scale: 1, opacity: 1, rotation: 0, easing: 'linear' },
          { t: .85, x: .5, y: .48, scale: 1, opacity: 1, rotation: 0, easing: 'ease-in' },
          { t: 1, x: .5, y: .44, scale: 1, opacity: 0, rotation: 0, easing: 'linear' }
        ]
      },
      {
        kind: 'text',
        textFieldKey: 'subtitle',
        defaultText: 'Sigue el canal para más vídeos',
        font: 'modern',
        style: 'outline',
        size: 'small',
        position: 'center',
        width: .74,
        keyframes: [
          { t: 0, x: .5, y: .64, scale: 1, opacity: 0, rotation: 0, easing: 'ease-out' },
          { t: .38, x: .5, y: .64, scale: 1, opacity: 1, rotation: 0, easing: 'linear' },
          { t: .85, x: .5, y: .64, scale: 1, opacity: 1, rotation: 0, easing: 'ease-in' },
          { t: 1, x: .5, y: .64, scale: 1, opacity: 0, rotation: 0, easing: 'linear' }
        ]
      }
    ]
  },
  {
    id: 'lower-third-slide',
    name: 'Rótulo inferior — Deslizante',
    category: 'lower-third',
    durationRangeMs: [2500, 6000],
    defaultDurationMs: 4000,
    editableFields: [
      { key: 'name', type: 'text', label: 'Nombre' },
      { key: 'role', type: 'text', label: 'Cargo / descripción' },
      { key: 'accent', type: 'color', label: 'Color de acento' }
    ],
    elements: [
      {
        kind: 'text',
        textFieldKey: 'name',
        colorFieldKey: 'accent',
        defaultText: 'Nombre Apellido',
        font: 'condensed',
        style: 'box',
        size: 'medium',
        position: 'bottom',
        width: .58,
        keyframes: [
          // x=-0.2 arranca fuera del lienzo por la izquierda: entrada
          // deslizante clásica de rótulo inferior.
          { t: 0, x: -.2, y: .84, scale: 1, opacity: 0, rotation: 0, easing: 'ease-out' },
          { t: .18, x: .3, y: .84, scale: 1, opacity: 1, rotation: 0, easing: 'linear' },
          { t: .85, x: .3, y: .84, scale: 1, opacity: 1, rotation: 0, easing: 'ease-in' },
          { t: 1, x: -.2, y: .84, scale: 1, opacity: 0, rotation: 0, easing: 'linear' }
        ]
      },
      {
        kind: 'text',
        textFieldKey: 'role',
        defaultText: 'Cargo o descripción',
        font: 'condensed',
        style: 'box',
        size: 'small',
        position: 'bottom',
        width: .58,
        keyframes: [
          { t: 0, x: -.2, y: .92, scale: 1, opacity: 0, rotation: 0, easing: 'ease-out' },
          { t: .24, x: .3, y: .92, scale: 1, opacity: 1, rotation: 0, easing: 'linear' },
          { t: .85, x: .3, y: .92, scale: 1, opacity: 1, rotation: 0, easing: 'ease-in' },
          { t: 1, x: -.2, y: .92, scale: 1, opacity: 0, rotation: 0, easing: 'linear' }
        ]
      }
    ]
  },
  {
    id: 'lower-third-pop',
    name: 'Rótulo inferior — Aparición',
    category: 'lower-third',
    durationRangeMs: [2500, 6000],
    defaultDurationMs: 3800,
    editableFields: [
      { key: 'name', type: 'text', label: 'Nombre' },
      { key: 'role', type: 'text', label: 'Cargo / descripción' },
      { key: 'accent', type: 'color', label: 'Color de acento' }
    ],
    elements: [
      {
        kind: 'text',
        textFieldKey: 'name',
        colorFieldKey: 'accent',
        defaultText: 'Nombre Apellido',
        font: 'rounded',
        style: 'shadow',
        size: 'medium',
        position: 'bottom',
        width: .56,
        keyframes: [
          { t: 0, x: .28, y: .85, scale: .4, opacity: 0, rotation: -4, easing: 'ease-out' },
          { t: .22, x: .28, y: .85, scale: 1.08, opacity: 1, rotation: 0, easing: 'linear' },
          { t: .3, x: .28, y: .85, scale: 1, opacity: 1, rotation: 0, easing: 'linear' },
          { t: .85, x: .28, y: .85, scale: 1, opacity: 1, rotation: 0, easing: 'ease-in' },
          { t: 1, x: .28, y: .85, scale: .7, opacity: 0, rotation: 0, easing: 'linear' }
        ]
      },
      {
        kind: 'text',
        textFieldKey: 'role',
        defaultText: 'Cargo o descripción',
        font: 'rounded',
        style: 'shadow',
        size: 'small',
        position: 'bottom',
        width: .56,
        keyframes: [
          { t: 0, x: .28, y: .93, scale: .4, opacity: 0, rotation: 0, easing: 'ease-out' },
          { t: .3, x: .28, y: .93, scale: 1, opacity: 1, rotation: 0, easing: 'linear' },
          { t: .85, x: .28, y: .93, scale: 1, opacity: 1, rotation: 0, easing: 'ease-in' },
          { t: 1, x: .28, y: .93, scale: .7, opacity: 0, rotation: 0, easing: 'linear' }
        ]
      }
    ]
  },
  {
    id: 'title-fullscreen',
    name: 'Título animado a pantalla completa',
    category: 'titulo',
    durationRangeMs: [1800, 4000],
    defaultDurationMs: 2600,
    editableFields: [
      { key: 'title', type: 'text', label: 'Título' },
      { key: 'accent', type: 'color', label: 'Color de acento' }
    ],
    elements: [
      {
        kind: 'text',
        textFieldKey: 'title',
        colorFieldKey: 'accent',
        defaultText: 'CAPÍTULO 1',
        font: 'display',
        style: 'outline',
        size: 'large',
        position: 'center',
        width: .9,
        keyframes: [
          { t: 0, x: .5, y: .5, scale: 1.6, opacity: 0, rotation: 8, easing: 'ease-out' },
          { t: .3, x: .5, y: .5, scale: 1, opacity: 1, rotation: 0, easing: 'linear' },
          { t: .78, x: .5, y: .5, scale: 1, opacity: 1, rotation: 0, easing: 'ease-in' },
          { t: 1, x: .5, y: .5, scale: .82, opacity: 0, rotation: -6, easing: 'linear' }
        ]
      }
    ]
  }
];
