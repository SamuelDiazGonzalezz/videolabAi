import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'RacingMonos Studio · Storyboards con IA local',
  description: 'Convierte un guion en una secuencia coherente de ilustraciones de Monos con FLUX local.',
  applicationName: 'RacingMonos Studio',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'dark',
  themeColor: '#0a0b0d',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="es"><body>{children}</body></html>;
}
