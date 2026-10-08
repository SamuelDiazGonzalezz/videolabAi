export type VoiceOption = {
  id: string;
  name: string;
  detail: string;
  spanish: boolean;
  previewUrl?: string;
  /** account: voces que ya puede usar la cuenta; library: biblioteca pública de ElevenLabs. */
  source?: 'account' | 'library';
  /** Acento agrupado para el filtro (España, México, Argentina…). */
  accent?: string;
  gender?: string;
  /** Propietario público de una voz de la biblioteca (necesario para añadirla a la cuenta). */
  ownerId?: string;
  /** La cuenta no puede usarla (p. ej. plan gratuito con voces de la biblioteca). */
  locked?: boolean;
};

// Voces premade de ElevenLabs verificadas en español. Se usan cuando no hay
// ELEVENLABS_API_KEY o la API no responde; con clave, /api/voices devuelve las
// voces en español de la cuenta y de la biblioteca.
export const ELEVENLABS_VOICES: VoiceOption[] = [
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', detail: 'Narrador cálido · multilingüe', spanish: true, source: 'account', accent: 'Multilingüe' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', detail: 'Madura y segura · multilingüe', spanish: true, source: 'account', accent: 'Multilingüe' },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', detail: 'Grave y enérgico · multilingüe', spanish: true, source: 'account', accent: 'Multilingüe' },
];

export function voiceLabel(id: string) {
  return ELEVENLABS_VOICES.find((voice) => voice.id === id)?.name || id;
}

const ACCENTS: Record<string, string> = {
  peninsular: 'España',
  castilian: 'España',
  spain: 'España',
  mexican: 'México',
  argentine: 'Argentina',
  argentinian: 'Argentina',
  colombian: 'Colombia',
  chilean: 'Chile',
  peruvian: 'Perú',
  venezuelan: 'Venezuela',
  'latin american': 'Latinoamérica',
  latino: 'Latinoamérica',
  american: 'EE. UU.',
  caribbean: 'Caribe',
  cuban: 'Caribe',
};

/** Agrupa el acento de ElevenLabs (inglés) en una etiqueta en español. */
export function accentLabel(accent: string | null | undefined, locale?: string | null) {
  const key = String(accent || '').trim().toLowerCase();
  if (ACCENTS[key]) return ACCENTS[key];
  const region = String(locale || '').split('-')[1]?.toUpperCase();
  const byLocale: Record<string, string> = { ES: 'España', MX: 'México', AR: 'Argentina', CO: 'Colombia', CL: 'Chile', PE: 'Perú', VE: 'Venezuela', US: 'EE. UU.' };
  return (region && byLocale[region]) || (key ? key.replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Español');
}
