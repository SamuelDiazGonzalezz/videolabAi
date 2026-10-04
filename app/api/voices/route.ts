import { NextResponse } from 'next/server';
import { ELEVENLABS_VOICES, type VoiceOption } from '../../../lib/voices';

export const runtime = 'nodejs';

// "fetch failed" no dice nada: se añade la causa (certificado, DNS, timeout…).
function networkError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
  return cause ? `${error.message}: ${cause.code || cause.message}` : error.message;
}

type ElevenLabsVoice = {
  voice_id: string;
  name?: string;
  category?: string;
  description?: string | null;
  preview_url?: string | null;
  labels?: Record<string, string | undefined>;
  verified_languages?: { language?: string; accent?: string | null; preview_url?: string | null }[];
};

const SPANISH_HINT = /spanish|español|espanol|castellano|castilian|mexican|argentin|colombian|latin|chilean|peruvian|venezuelan|andaluz/i;

function toOption(voice: ElevenLabsVoice): VoiceOption {
  const labels = voice.labels || {};
  const spanishLanguage = voice.verified_languages?.find((item) => item.language === 'es');
  const accent = spanishLanguage?.accent || labels.accent || '';
  const spanish = Boolean(
    spanishLanguage
      || labels.language === 'es'
      || SPANISH_HINT.test([voice.name, accent, labels.description, voice.description].filter(Boolean).join(' ')),
  );
  const detail = [labels.gender, labels.age, accent, labels.use_case || labels.description]
    .filter(Boolean)
    .map((value) => String(value).replace(/[_-]+/g, ' '))
    .join(' · ');
  return {
    id: voice.voice_id,
    name: String(voice.name || voice.voice_id).slice(0, 60),
    detail: (detail || (voice.category === 'premade' ? 'Premade · multilingüe' : voice.category || '')).slice(0, 90),
    spanish,
    previewUrl: spanishLanguage?.preview_url || voice.preview_url || undefined,
  };
}

export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ configured: false, voices: ELEVENLABS_VOICES, defaultVoiceId: process.env.ELEVENLABS_VOICE_ID || ELEVENLABS_VOICES[0].id });
  }
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.voices)) {
      const detail = String(payload.detail?.message || payload.detail || `ElevenLabs respondió ${response.status}`).slice(0, 300);
      return NextResponse.json({ configured: true, voices: ELEVENLABS_VOICES, error: detail });
    }
    const voices = (payload.voices as ElevenLabsVoice[])
      .filter((voice) => voice?.voice_id)
      .map(toOption)
      .sort((a, b) => Number(b.spanish) - Number(a.spanish) || a.name.localeCompare(b.name, 'es'));
    return NextResponse.json({
      configured: true,
      voices: voices.length ? voices : ELEVENLABS_VOICES,
      defaultVoiceId: process.env.ELEVENLABS_VOICE_ID || voices.find((voice) => voice.spanish)?.id || voices[0]?.id,
    });
  } catch (error) {
    return NextResponse.json({ configured: true, voices: ELEVENLABS_VOICES, error: networkError(error, 'No se pudo consultar ElevenLabs.') });
  }
}
