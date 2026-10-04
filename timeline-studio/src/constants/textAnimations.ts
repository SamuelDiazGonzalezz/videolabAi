import type { TextAnimationPreset } from '../types/timeline';

export interface TextAnimationOption {
  value: TextAnimationPreset;
  label: string;
  entranceLabel: string;
  exitLabel: string;
  hint: string;
}

export const TEXT_ANIMATION_OPTIONS: TextAnimationOption[] = [
  { value: 'none', label: 'Ninguna', entranceLabel: 'Sin entrada', exitLabel: 'Sin salida', hint: 'La frase aparece sin movimiento.' },
  { value: 'fade', label: 'Fundido', entranceLabel: 'Fundido', exitLabel: 'Fundido', hint: 'Cambia la opacidad con suavidad.' },
  { value: 'pop', label: 'Pop', entranceLabel: 'Pop', exitLabel: 'Pop', hint: 'Zoom rápido con un pequeño rebote.' },
  { value: 'bounce', label: 'Rebote', entranceLabel: 'Rebote', exitLabel: 'Rebote', hint: 'Movimiento elástico y enérgico.' },
  { value: 'slide-left', label: 'Izquierda', entranceLabel: 'Desde izquierda', exitLabel: 'Hacia izquierda', hint: 'Desliza por el lateral izquierdo.' },
  { value: 'slide-right', label: 'Derecha', entranceLabel: 'Desde derecha', exitLabel: 'Hacia derecha', hint: 'Desliza por el lateral derecho.' },
  { value: 'slide-up', label: 'Arriba', entranceLabel: 'Desde arriba', exitLabel: 'Hacia arriba', hint: 'Desliza por la parte superior.' },
  { value: 'slide-down', label: 'Abajo', entranceLabel: 'Desde abajo', exitLabel: 'Hacia abajo', hint: 'Desliza por la parte inferior.' },
  { value: 'spin', label: 'Giro', entranceLabel: 'Giro', exitLabel: 'Giro', hint: 'Combina giro, escala y fundido.' }
];

export const DEFAULT_TEXT_ANIMATION_DURATION_MS = 500;
export const MIN_TEXT_ANIMATION_DURATION_MS = 100;
export const MAX_TEXT_ANIMATION_DURATION_MS = 2000;
