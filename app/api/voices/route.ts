import { NextResponse } from 'next/server';
import { accentLabel, ELEVENLABS_VOICES, type VoiceOption } from '../../../lib/voices';

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
  verified_languages?: { language?: string; accent?: string | null; locale?: string | null; preview_url?: string | null }[];
  sharing?: { status?: string } | null;
};

type SharedVoice = {
  voice_id: string;
  public_owner_id: string;
  name: string;
  gender?: string;
  age?: string;
  accent?: string;
  locale?: string;
  use_case?: string;
  descriptive?: string;
  preview_url?: string;
  free_users_allowed?: boolean;
};

const SPANISH_HINT = /spanish|español|espanol|castellano|castilian|mexican|argentin|colombian|latin|chilean|peruvian|venezuelan|andaluz/i;
const CACHE_MS = 10 * 60_000;
let cache: { at: number; body: Record<string, unknown> } | null = null;

const words = (value?: string | null) => String(value || '').replace(/[_-]+/g, ' ').trim();

// Voces de la cuenta (premade y añadidas): solo las que hablan español.
function accountOption(voice: ElevenLabsVoice, freePlan: boolean): VoiceOption | null {
  const labels = voice.labels || {};
  const spanishLanguage = voice.verified_languages?.find((item) => item.language === 'es');
  const spanish = Boolean(spanishLanguage || labels.language === 'es' || SPANISH_HINT.test([voice.name, labels.accent, labels.description, voice.description].filter(Boolean).join(' ')));
  if (!spanish) return null;
  const nativeSpanish = labels.language === 'es' || (!!spanishLanguage?.accent && !/american|british|australian/i.test(labels.accent || ''));
  const accent = nativeSpanish ? accentLabel(spanishLanguage?.accent || labels.accent, spanishLanguage?.locale) : 'Multilingüe';
  return {
    id: voice.voice_id,
    name: String(voice.name || voice.voice_id).split(' - ')[0].slice(0, 60),
    detail: [words(labels.gender), words(labels.age), accent, words(labels.use_case || labels.description)].filter(Boolean).join(' · ').slice(0, 90),
    spanish: true,
    previewUrl: spanishLanguage?.preview_url || voice.preview_url || undefined,
    source: 'account',
    accent,
    gender: labels.gender,
    // Voces copiadas de la biblioteca: el plan gratuito tampoco permite usarlas por API.
    locked: freePlan && (voice.category === 'professional' || voice.sharing?.status === 'copied'),
  };
}

// Voces nativas en español de la biblioteca pública de ElevenLabs.
function libraryOption(voice: SharedVoice, freePlan: boolean): VoiceOption {
  const accent = accentLabel(voice.accent, voice.locale);
  return {
    id: voice.voice_id,
    name: voice.name.split(' - ')[0].slice(0, 60),
    detail: [words(voice.gender), words(voice.age), accent, words(voice.use_case || voice.descriptive)].filter(Boolean).join(' · ').slice(0, 90),
    spanish: true,
    previewUrl: voice.preview_url || undefined,
    source: 'library',
    accent,
    gender: voice.gender,
    ownerId: voice.public_owner_id,
    // ElevenLabs no deja usar voces de la biblioteca por API en el plan gratuito.
    locked: freePlan,
  };
}

async function eleven<T>(path: string, apiKey: string): Promise<T> {
  const response = await fetch(`https://api.elevenlabs.io${path}`, { headers: { 'xi-api-key': apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000), cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload.detail?.message || payload.detail || `ElevenLabs respondió ${response.status}`).slice(0, 300));
  return payload as T;
}

export async function GET(request: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ configured: false, voices: ELEVENLABS_VOICES, defaultVoiceId: process.env.ELEVENLABS_VOICE_ID || ELEVENLABS_VOICES[0].id });
  }
  const fresh = new URL(request.url).searchParams.get('fresh') === '1';
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return NextResponse.json(cache.body);
  try {
    const [account, subscription] = await Promise.all([
      eleven<{ voices: ElevenLabsVoice[] }>('/v1/voices', apiKey),
      eleven<{ tier?: string; character_count?: number; character_limit?: number; next_character_count_reset_unix?: number; voice_slots_used?: number; voice_limit?: number }>('/v1/user/subscription', apiKey).catch(() => null),
    ]);
    const tier = String(subscription?.tier || 'free');
    const freePlan = tier === 'free';
    const accountVoices = (account.voices || []).map((voice) => accountOption(voice, freePlan)).filter((voice): voice is VoiceOption => Boolean(voice));
    const owned = new Set(accountVoices.map((voice) => voice.id));

    // Dos páginas de las voces en español más usadas de la biblioteca.
    const library: SharedVoice[] = [];
    for (let page = 0; page < 2; page += 1) {
      const result = await eleven<{ voices: SharedVoice[]; has_more?: boolean }>(`/v1/shared-voices?language=es&page_size=100&page=${page}&sort=usage_character_count_1y`, apiKey).catch(() => null);
      if (!result?.voices?.length) break;
      library.push(...result.voices);
      if (!result.has_more) break;
    }
    const seen = new Set<string>();
    const libraryVoices = library
      .filter((voice) => voice.voice_id && !owned.has(voice.voice_id) && !seen.has(voice.voice_id) && seen.add(voice.voice_id))
      .filter((voice) => !freePlan || voice.free_users_allowed !== false)
      .map((voice) => libraryOption(voice, freePlan));

    const voices = [...accountVoices, ...libraryVoices];
    const body = {
      configured: true,
      tier,
      freePlan,
      characters: subscription ? { used: subscription.character_count || 0, limit: subscription.character_limit || 0, resetsAt: subscription.next_character_count_reset_unix ? subscription.next_character_count_reset_unix * 1000 : null } : null,
      voiceSlots: subscription ? { used: subscription.voice_slots_used || 0, limit: subscription.voice_limit || 0 } : null,
      voices: voices.length ? voices : ELEVENLABS_VOICES,
      defaultVoiceId: process.env.ELEVENLABS_VOICE_ID || accountVoices.find((voice) => !voice.locked)?.id || ELEVENLABS_VOICES[0].id,
    };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json({ configured: true, voices: ELEVENLABS_VOICES, error: networkError(error, 'No se pudo consultar ElevenLabs.') });
  }
}
