"""Story planner for RacingMonos.

FLUX.2 Klein ships a full Qwen3-4B chat model as its text encoder. Before any
image is drawn, the same weights act as an art director: they read the whole
script once to write a visual "story bible" (setting, era, weather, roles,
recurring props) and then turn every scene sentence into a concrete English
shot description that respects the bible and the neighbouring scenes. No extra
model is downloaded and no extra VRAM is needed: the module is already loaded.
"""

import json
import re

import torch

CAST = (
    "The cast is fixed and always drawn the same way: "
    "PILOT A is a gray-furred cartoon chimpanzee racing pilot wearing a coral-red jacket; "
    "PILOT B is a gray-furred cartoon chimpanzee racing pilot wearing a white jacket and dark trousers. "
    "They race small red open-top race cars. Any other character in the story is also a gray-furred "
    "cartoon chimpanzee with its own distinct outfit. There are never humans. "
    "Both pilots are bare-headed with the gray fur on top of their heads visible: nobody wears helmets, "
    "goggles, hats or glasses unless the script explicitly says so. "
    "Whenever the story says they start, drive, race, accelerate, overtake or cross the finish line, "
    "the pilots are seated inside their own red race cars, hands on the steering wheel."
)

BIBLE_SYSTEM = (
    "You are the art director of an animated storyboard. " + CAST + " "
    "Read the whole script (it is in Spanish) and plan a coherent visual world for it. "
    "Answer with JSON only, in English, no markdown."
)

BIBLE_USER = """Script:
\"\"\"{script}\"\"\"

Return exactly this JSON object:
{{
  "setting": "where the story happens, concrete and visual (track, city, landmarks)",
  "era": "time period and how it shows (car shapes, clothing details)",
  "weather_and_light": "weather and light at the start, and how it changes if the story says so",
  "pilot_a_role": "what PILOT A (coral-red jacket) does in this story, or 'not present'",
  "pilot_b_role": "what PILOT B (white jacket) does in this story, or 'not present'",
  "other_characters": ["short visual description of each extra chimpanzee character, if any"],
  "recurring_props": ["important objects that must look the same in every scene"],
  "palette_and_mood": "overall mood"
}}"""

SCENE_SYSTEM = (
    "You are the storyboard artist of an animated short. " + CAST + " "
    "You turn one sentence of a Spanish script into the description of ONE illustration. "
    "The description must make the sentence instantly recognizable in the picture."
)

SCENE_USER = """Story bible (keep everything consistent with it):
{bible}

Full script, for context only:
\"\"\"{script}\"\"\"

Previous scene sentence: {previous}
THIS SCENE ({index} of {total}): \"{sentence}\"
Next scene sentence: {following}

Write the illustration for THIS SCENE only, in English, 3 to 5 sentences, at most 110 words:
- Who is in the frame. Name pilots only by their clothes ("the chimpanzee pilot in the coral-red jacket").
- Exactly what each character is physically doing right now, body pose and facial expression.
- Where they are (consistent with the bible), weather and light.
- The specific objects, vehicles and events mentioned in the sentence, clearly visible.
- The camera framing (wide shot, medium shot or close-up) that best shows the action.
If the sentence is only a place or a date, show an establishing shot of that place with the cast preparing.
Do not show earlier or later events. Never mention text, signs, letters, numbers or logos.
Never add helmets, goggles or hats that the script does not mention.
Answer with the description only."""


def _strip(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    return text.replace("<think>", "").replace("</think>", "").strip()


def _parse_json(text: str):
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None


class StoryPlanner:
    def __init__(self, pipe, device: str):
        self.model = pipe.text_encoder
        self.tokenizer = pipe.tokenizer
        self.device = device
        self.tokenizer.padding_side = "left"
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

    def _chat(self, conversations: list[list[dict]], max_new_tokens: int) -> list[str]:
        texts = [
            self.tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True, enable_thinking=False
            )
            for messages in conversations
        ]
        inputs = self.tokenizer(texts, return_tensors="pt", padding=True).to(self.device)
        with torch.inference_mode():
            output = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                do_sample=False,
                repetition_penalty=1.05,
                pad_token_id=self.tokenizer.pad_token_id,
            )
        generated = output[:, inputs["input_ids"].shape[1] :]
        return [_strip(text) for text in self.tokenizer.batch_decode(generated, skip_special_tokens=True)]

    def plan(self, script: str, sentences: list[str], batch_size: int = 6) -> dict:
        script = script.strip()[:6000]
        raw_bible = self._chat(
            [[{"role": "system", "content": BIBLE_SYSTEM}, {"role": "user", "content": BIBLE_USER.format(script=script)}]],
            max_new_tokens=420,
        )[0]
        bible = _parse_json(raw_bible) or {"notes": raw_bible[:1200]}
        bible_text = json.dumps(bible, ensure_ascii=False, indent=1)

        conversations = []
        total = len(sentences)
        for index, sentence in enumerate(sentences):
            user = SCENE_USER.format(
                bible=bible_text,
                script=script,
                previous=f'"{sentences[index - 1]}"' if index > 0 else "(this is the first scene)",
                index=index + 1,
                total=total,
                sentence=sentence,
                following=f'"{sentences[index + 1]}"' if index + 1 < total else "(this is the last scene)",
            )
            conversations.append([{"role": "system", "content": SCENE_SYSTEM}, {"role": "user", "content": user}])

        scenes: list[str] = []
        for start in range(0, len(conversations), batch_size):
            scenes.extend(self._chat(conversations[start : start + batch_size], max_new_tokens=220))
        # Keep descriptions short enough to fit FLUX's 512-token prompt window
        # together with the fixed style block.
        scenes = [" ".join(scene.split()[:130]) for scene in scenes]
        return {"bible": bible, "scenes": scenes}
