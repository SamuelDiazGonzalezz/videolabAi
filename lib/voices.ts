export type VoiceOption = {
  id: string;
  name: string;
  detail: string;
  spanish: boolean;
  previewUrl?: string;
};

// Voces premade de ElevenLabs: con eleven_multilingual_v2 narran en español,
// aunque su acento nativo es inglés. Se usan cuando no hay ELEVENLABS_API_KEY
// o la API no responde; con clave, /api/voices devuelve las voces de la cuenta.
export const ELEVENLABS_VOICES: VoiceOption[] = [
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Narrador grave', detail: 'Documental · multilingüe', spanish: false },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Narradora cálida', detail: 'Cercana · multilingüe', spanish: false },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Narrador energético', detail: 'Ritmo · carreras y acción', spanish: false },
];

export function voiceLabel(id: string) {
  return ELEVENLABS_VOICES.find((voice) => voice.id === id)?.name || id;
}
