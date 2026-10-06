"""Script writer for Video Lab Ai.

Uses the Qwen3-4B text encoder that FLUX.2 Klein already keeps loaded to turn
an idea into a narration script in Spanish, streaming the text token by token
so the web app can show it being written live.
"""

import threading
from typing import Iterator

import torch
from transformers import TextIteratorStreamer

WORDS_PER_SECOND = 2.5  # natural Spanish voice-over pace (ElevenLabs narration)

TONES = {
    "narrativo": "narrativo y cercano, como un buen cuentacuentos",
    "epico": "épico y emocionante, con tensión creciente y un clímax claro",
    "divertido": "divertido y ágil, con humor blanco y giros inesperados",
    "documental": "documental, informativo y riguroso, con datos y descripciones concretas",
    "misterio": "de misterio e intriga, con atmósfera y una revelación final",
    "infantil": "infantil, tierno y sencillo, para niños pequeños",
}

SYSTEM = (
    "Eres un guionista profesional de vídeos narrados para redes sociales y YouTube. "
    "Escribes en español de España, con frases claras y visuales que se pueden ilustrar escena a escena. "
    "El texto será leído por una voz en off, así que escribe solo lo que se narra: sin acotaciones, "
    "sin nombres de escena, sin indicaciones de cámara, sin emojis, sin listas y sin markdown."
)

USER = """Idea o texto de partida:
\"\"\"{idea}\"\"\"

Escribe el guion de narración con estas condiciones:
- Duración aproximada: {seconds} segundos de voz, es decir, unas {words} palabras en total.
- Tono: {tone}.
- Empieza con un gancho potente en la primera frase y termina con un cierre memorable.
- Cada frase debe describir algo que se pueda dibujar (personajes, lugares, acciones concretas).
- Mantén los mismos personajes y el mismo mundo de principio a fin.

Formato de la respuesta, exactamente:
Título: <un título corto y atractivo>

<el guion completo en párrafos>"""


class ScriptWriter:
    def __init__(self, pipe, device: str):
        self.model = pipe.text_encoder
        self.tokenizer = pipe.tokenizer
        self.device = device

    def stream(self, idea: str, seconds: int, tone: str, lock: threading.Lock) -> Iterator[str]:
        seconds = max(15, min(600, int(seconds)))
        words = int(seconds * WORDS_PER_SECOND)
        messages = [
            {"role": "system", "content": SYSTEM},
            {
                "role": "user",
                "content": USER.format(
                    idea=idea.strip()[:4000],
                    seconds=seconds,
                    words=words,
                    tone=TONES.get(tone, TONES["narrativo"]),
                ),
            },
        ]
        text = self.tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True, enable_thinking=False
        )
        inputs = self.tokenizer([text], return_tensors="pt").to(self.device)
        streamer = TextIteratorStreamer(self.tokenizer, skip_prompt=True, skip_special_tokens=True, timeout=600)
        # Spanish averages ~1.7 tokens per word; leave room for the title.
        max_new_tokens = min(4096, int(words * 1.9) + 80)
        error: list[BaseException] = []

        def run():
            try:
                with lock, torch.inference_mode():
                    self.model.generate(
                        **inputs,
                        streamer=streamer,
                        max_new_tokens=max_new_tokens,
                        do_sample=True,
                        temperature=0.8,
                        top_p=0.9,
                        repetition_penalty=1.08,
                        pad_token_id=self.tokenizer.pad_token_id,
                    )
            except BaseException as exc:  # surfaced to the client below
                error.append(exc)
                streamer.end()
            finally:
                if self.device == "cuda":
                    torch.cuda.empty_cache()

        threading.Thread(target=run, daemon=True).start()
        for chunk in streamer:
            yield chunk.replace("<think>", "").replace("</think>", "")
        if error:
            yield f"\n\n[Error del modelo: {error[0]}]"
