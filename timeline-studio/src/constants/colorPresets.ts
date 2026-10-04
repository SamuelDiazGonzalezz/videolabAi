import type { VideoClip } from '../types/timeline';

// Función 4 — Corrección de color con presets tipo LUT. Cada preset solo
// RELLENA los 4 sliders existentes (brillo/contraste/saturación/temperatura)
// a valores de partida coherentes con su nombre — no es una caja negra: tras
// aplicarlo, el usuario puede seguir ajustando cualquiera de los sliders
// como si los hubiera tocado a mano.
export interface ColorPreset {
  id: string;
  label: string;
  values: Pick<VideoClip, 'brightness' | 'contrast' | 'saturation' | 'temperature'>;
}

export const COLOR_PRESETS: ColorPreset[] = [
  {
    id: 'cinematic-warm',
    label: 'Cinemático cálido',
    values: { brightness: -0.02, contrast: 1.12, saturation: 0.9, temperature: 35 }
  },
  {
    id: 'cinematic-cold',
    label: 'Cinemático frío',
    values: { brightness: -0.02, contrast: 1.1, saturation: 0.85, temperature: -35 }
  },
  {
    id: 'high-contrast-bw',
    label: 'Alto contraste B/N',
    values: { brightness: 0, contrast: 1.3, saturation: 0, temperature: 0 }
  },
  {
    id: 'vibrant-social',
    label: 'Vibrante redes sociales',
    values: { brightness: 0.03, contrast: 1.15, saturation: 1.4, temperature: 8 }
  },
  {
    id: 'natural-soft',
    label: 'Natural suave',
    values: { brightness: 0.02, contrast: 1.02, saturation: 1.05, temperature: 5 }
  }
];
