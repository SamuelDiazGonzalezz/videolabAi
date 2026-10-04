import { NextResponse } from 'next/server';
import { getStoryboard, saveStoryboardAudio, saveStoryboardVoiceError } from '../../../../../lib/storyboards';
import { voiceLabel } from '../../../../../lib/voices';

export const runtime = 'nodejs';

// "fetch failed" no dice nada: se añade la causa (certificado, DNS, timeout…).
function networkError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
  return cause ? `${error.message}: ${cause.code || cause.message}` : error.message;
}
export const maxDuration = 180;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Access-Control-Allow-Origin': '*' } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await getStoryboard(id);
  if (!record) return json({ error: 'Storyboard no encontrado.' }, 404);
  const body = await request.json().catch(() => ({}));
  const script = String(body.script || record.script || '').trim().slice(0, 20_000);
  const voiceId = String(body.voiceId || process.env.ELEVENLABS_VOICE_ID || '').trim();
  const voiceName = String(body.voiceName || voiceLabel(voiceId)).trim().slice(0, 80);
  if (!script) return json({ error: 'El guion está vacío.' }, 400);
  if (!voiceId) return json({ error: 'Configura ELEVENLABS_VOICE_ID o selecciona una voz.' }, 400);
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return json({ error: 'Falta ELEVENLABS_API_KEY. Las imágenes siguen disponibles; añade la clave para generar la voz.' }, 503);

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        text: script,
        model_id: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
        output_format: 'mp3_44100_128',
        voice_settings: { stability: 0.48, similarity_boost: 0.78, style: 0.2, use_speaker_boost: true },
      }),
      signal: AbortSignal.timeout(150_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || typeof payload.audio_base64 !== 'string') {
      const detail = String(payload.detail?.message || payload.detail || `ElevenLabs respondió ${response.status}`).slice(0, 500);
      await saveStoryboardVoiceError(id, voiceId, detail);
      return json({ error: detail }, response.status || 502);
    }
    const saved = await saveStoryboardAudio({
      id,
      bytes: Buffer.from(payload.audio_base64, 'base64'),
      voiceId,
      voiceName,
      alignment: payload.alignment || payload.normalized_alignment,
    });
    return json({ audioUrl: saved.audioUrl, voiceId, voiceName, alignment: saved.alignment || null });
  } catch (error) {
    const detail = networkError(error, 'No se pudo generar la voz.');
    await saveStoryboardVoiceError(id, voiceId, detail);
    return json({ error: detail }, 502);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
