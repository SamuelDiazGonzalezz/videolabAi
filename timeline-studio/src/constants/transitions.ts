import type { TransitionType } from '../types/timeline';

export interface TransitionOption {
  value: TransitionType;
  title: string;
  subtitle: string;
  shortLabel: string;
}

export const TRANSITION_OPTIONS: TransitionOption[] = [
  { value: 'none', title: 'Sin transición', subtitle: 'Corte directo', shortLabel: 'Corte' },
  { value: 'fade', title: 'Fundido', subtitle: 'Mezcla suave', shortLabel: 'Fundido' },
  { value: 'dissolve', title: 'Disolver', subtitle: 'Textura gradual', shortLabel: 'Disolver' },
  { value: 'wipeleft', title: 'Barrido izquierda', subtitle: 'Entra desde la derecha', shortLabel: 'Barrido izq.' },
  { value: 'wiperight', title: 'Barrido derecha', subtitle: 'Entra desde la izquierda', shortLabel: 'Barrido der.' },
  { value: 'slideleft', title: 'Deslizar izquierda', subtitle: 'Movimiento lateral', shortLabel: 'Deslizar izq.' },
  { value: 'slideright', title: 'Deslizar derecha', subtitle: 'Movimiento lateral', shortLabel: 'Deslizar der.' },
  { value: 'circleopen', title: 'Apertura circular', subtitle: 'Revelado desde el centro', shortLabel: 'Circular' }
];

export const OPENING_TRANSITION_OPTIONS: TransitionOption[] = [
  { value: 'none', title: 'Sin apertura', subtitle: 'Comienza directamente', shortLabel: 'Sin apertura' },
  { value: 'fade', title: 'Aparición cinematográfica', subtitle: 'Surge suavemente desde negro', shortLabel: 'Aparición' },
  { value: 'dissolve', title: 'Revelado suave', subtitle: 'La escena se forma gradualmente', shortLabel: 'Revelado' },
  { value: 'wipeleft', title: 'Entrada lateral izquierda', subtitle: 'Descubre la escena con un barrido', shortLabel: 'Entrada izq.' },
  { value: 'wiperight', title: 'Entrada lateral derecha', subtitle: 'Descubre la escena desde el otro lado', shortLabel: 'Entrada der.' },
  { value: 'slideleft', title: 'Deslizamiento de apertura', subtitle: 'La escena entra con movimiento', shortLabel: 'Deslizamiento' },
  { value: 'slideright', title: 'Deslizamiento inverso', subtitle: 'Entrada dinámica desde la izquierda', shortLabel: 'Deslizamiento inv.' },
  { value: 'circleopen', title: 'Iris de apertura', subtitle: 'Revela el vídeo desde el centro', shortLabel: 'Iris' }
];

export const CLOSING_TRANSITION_OPTIONS: TransitionOption[] = [
  { value: 'none', title: 'Sin cierre', subtitle: 'Termina directamente', shortLabel: 'Sin cierre' },
  { value: 'fade', title: 'Fundido final', subtitle: 'Desaparece suavemente hacia negro', shortLabel: 'Fundido final' },
  { value: 'dissolve', title: 'Disolución de cierre', subtitle: 'La imagen se desvanece gradualmente', shortLabel: 'Disolución' },
  { value: 'wipeleft', title: 'Salida lateral izquierda', subtitle: 'Cierra la escena con un barrido', shortLabel: 'Salida izq.' },
  { value: 'wiperight', title: 'Salida lateral derecha', subtitle: 'Cierra la escena desde el otro lado', shortLabel: 'Salida der.' },
  { value: 'slideleft', title: 'Deslizamiento final', subtitle: 'La escena sale con movimiento', shortLabel: 'Deslizamiento' },
  { value: 'slideright', title: 'Deslizamiento inverso', subtitle: 'Salida dinámica hacia la derecha', shortLabel: 'Deslizamiento inv.' },
  { value: 'circleopen', title: 'Iris de cierre', subtitle: 'El negro cubre la escena desde el centro', shortLabel: 'Iris final' }
];

export function transitionLabel(type: TransitionType): string {
  return TRANSITION_OPTIONS.find((option) => option.value === type)?.shortLabel || 'Corte';
}
