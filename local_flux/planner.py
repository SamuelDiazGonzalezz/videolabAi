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

BIBLE_USER = """Script:
\"\"\"{script}\"\"\"

Return exactly this JSON object:
{{
  "story_summary": "the whole plot in 3 short sentences: beginning, turning point and ending",
  "setting": "where the story happens, concrete and visual (track, city, landmarks)",
  "era": "time period and how it shows (car shapes, clothing details)",
  "weather_and_light": "weather and light at the start, and how it changes if the story says so",
  "pilot_a_role": "what PILOT A (coral-red jacket) does in this story, or 'not present'",
  "pilot_b_role": "what PILOT B (white jacket) does in this story, or 'not present'",
  "other_characters": ["short visual description of each extra chimpanzee character, if any"],
  "recurring_props": ["important objects that must look the same in every scene"],
  "palette_and_mood": "overall mood"
}}"""

SCENE_USER = """Story bible (keep everything consistent with it):
{bible}

Context only, already illustrated in earlier scenes (do NOT draw it): {previous}
Context only, will be illustrated in later scenes (do NOT draw it): {following}

THE SENTENCE TO ILLUSTRATE NOW (scene {index} of {total}): \"{sentence}\"
Illustrate this sentence and nothing that only appears in the context lines above.

{rules}"""

MONOS_SCENE_RULES = """Write the illustration for THIS SCENE only, in English, 3 to 5 sentences, at most 110 words:
- Who is in the frame. Name pilots only by their clothes ("the chimpanzee pilot in the coral-red jacket").
- Exactly what each character is physically doing right now, body pose and facial expression.
- Where they are (consistent with the bible), weather and light.
- The specific objects, vehicles and events mentioned in the sentence, clearly visible.
- The camera framing (wide shot, medium shot or close-up) that best shows the action.
If the sentence is only a place or a date, show an establishing shot of that place with the cast preparing.
Do not show earlier or later events. Never mention text, signs, letters, numbers or logos.
Never add helmets, goggles or hats that the script does not mention.
Answer with the description only."""


FREE_DIRECTION = (
    "There is no fixed cast and no fixed art style: you decide both from the script. "
    "Choose ONE art style that suits the tone of the story (for example a warm watercolor children's book, "
    "a cinematic semi-realistic digital painting, a bold flat vector illustration, a moody ink comic or a "
    "soft 3D animated film look) and keep it for every scene. Invent a precise, recurring visual design for "
    "every character (who or what they are, age, body, face, hair or fur, clothing and colors) so they can be "
    "drawn identically in every image. Only include vehicles, animals or objects that the script mentions or "
    "clearly implies."
)

FREE_BIBLE_USER = """Script:
\"\"\"{script}\"\"\"

Return exactly this JSON object:
{{
  "art_style": "one sentence describing the single art style for every image (medium, line, color, lighting)",
  "story_summary": "the whole plot in 3 short sentences: beginning, turning point and ending",
  "setting": "where the story happens, concrete and visual",
  "era": "time period and how it shows",
  "weather_and_light": "weather and light at the start, and how it changes if the story says so",
  "characters": [{{"name": "name or role", "look": "complete visual design: species or person, age, build, face, hair or fur, clothing with colors"}}],
  "recurring_props": ["important objects that must look the same in every scene"],
  "palette_and_mood": "overall palette and mood"
}}"""

FREE_SCENE_RULES = """Write the illustration for THIS SCENE only, in English, 3 to 5 sentences, at most 110 words:
- Who is in the frame. Every time a character appears, repeat their key look from the bible (e.g. "Lucía, a ten-year-old girl with curly black hair, a yellow raincoat and red boots").
- Exactly what each character is physically doing right now, body pose and facial expression.
- Where they are (consistent with the bible), weather and light.
- The specific objects, animals, vehicles and events mentioned in the sentence, clearly visible.
- The camera framing (wide shot, medium shot or close-up) that best shows the action.
If the sentence is only a place or a date, show an establishing shot of that place.
Do not show earlier or later events. Do not describe the art style. Never mention text, signs, letters, numbers or logos.
Answer with the description only."""


WHITE_DIRECTION = (
    "This is an EDUCATIONAL video drawn on a PURE WHITE background, like a clean explainer or whiteboard animation. "
    "Every illustration shows only the key subject of the sentence (objects, animals, people, simple diagrams made of "
    "objects) ISOLATED on plain white: no landscape, no room, no floor, no sky, no horizon, no background scenery at all. "
    "Choose ONE clean, friendly illustration style for the whole video (for example flat vector with soft shading) and "
    "keep it in every scene. Design any recurring character once with a precise look and repeat it identically. "
    "Abstract ideas are shown with concrete, recognizable objects or symbols; quantities are shown by the number of objects."
)

WHITE_SCENE_RULES = """Write the illustration for THIS SCENE only, in English, 2 to 4 sentences, at most 90 words:
- Show ONLY the concept of THIS sentence, as big and centered as possible. Do not repeat objects that belong to other sentences: if the sentence is about sunlight, show the sun shining on the plant; if it is about water, show the roots drinking water; if it is about air, show air flowing into the leaves.
- Use a close or medium framing so the subject fills most of the image.
- If the sentence explains a process or comparison, arrange 2-4 objects side by side or with simple arrows.
- If a recurring character appears, repeat their key look from the bible.
- State explicitly that everything sits on a pure white background with no scenery, no floor and no horizon.
Do not show earlier or later events. Do not describe the art style. Never mention text, labels, letters, numbers or logos.
Answer with the description only."""


def _directions(mode: str, notes: str, medium: str = ""):
    """Returns (bible_system, bible_user, scene_system, scene_rules) for a style mode."""
    chosen = (f" The user chose this exact art medium for every image, use it word for word as the art_style: {medium}." if medium and mode != "monos" else "")
    if mode == "monos":
        return (
            "You are the art director of an animated storyboard. " + CAST + " "
            "Read the whole script (it is in Spanish) and plan a coherent visual world for it. "
            "Answer with JSON only, in English, no markdown.",
            BIBLE_USER,
            "You are the storyboard artist of an animated short. " + CAST + " "
            "You turn one sentence of a Spanish script into the description of ONE illustration. "
            "The description must make the sentence instantly recognizable in the picture.",
            MONOS_SCENE_RULES,
        )
    if mode == "white":
        direction = WHITE_DIRECTION + (f" Match the drawing style of the user's reference images. {notes}" if notes else "") + chosen
        return (
            "You are the art director of an educational explainer video. " + direction + " "
            "Read the whole script (it is in Spanish) and plan a coherent visual world for it. "
            "Answer with JSON only, in English, no markdown.",
            FREE_BIBLE_USER,
            "You are the illustrator of an educational explainer video. " + direction + " "
            "You turn one sentence of a Spanish script into the description of ONE illustration. "
            "The description must make the sentence instantly understandable at a glance.",
            WHITE_SCENE_RULES,
        )
    direction = FREE_DIRECTION
    if mode == "custom":
        direction = (
            "The drawing style comes from the user's reference images; follow these art direction notes: "
            f"{notes or 'match the reference images'}. Characters are not fixed: design them from the script "
            "unless the notes say otherwise, with a precise recurring look for each one."
        )
    elif notes:
        direction += f" The user adds these notes: {notes}."
    direction += chosen
    return (
        "You are the art director of an illustrated storyboard. " + direction + " "
        "Read the whole script (it is in Spanish) and plan a coherent visual world for it. "
        "Answer with JSON only, in English, no markdown.",
        FREE_BIBLE_USER,
        "You are the storyboard artist of an illustrated short. " + direction + " "
        "You turn one sentence of a Spanish script into the description of ONE illustration. "
        "The description must make the sentence instantly recognizable in the picture.",
        FREE_SCENE_RULES,
    )


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

    def plan(self, script: str, sentences: list[str], mode: str = "monos", notes: str = "", medium: str = "", batch_size: int = 8) -> dict:
        bible_system, bible_user, scene_system, scene_rules = _directions(mode, notes.strip()[:400], medium.strip()[:300])
        script = script.strip()[:10000]
        raw_bible = self._chat(
            [[{"role": "system", "content": bible_system}, {"role": "user", "content": bible_user.format(script=script)}]],
            max_new_tokens=700,
        )[0]
        bible = _parse_json(raw_bible) or {"notes": raw_bible[:1200]}
        bible_text = json.dumps(bible, ensure_ascii=False, indent=1)

        conversations = []
        total = len(sentences)
        for index, sentence in enumerate(sentences):
            # Only the bible (with the plot summary) and the neighbouring
            # sentences travel with each scene: sending the whole script to
            # every scene made long scripts take more than ten minutes.
            before = " ".join(sentences[max(0, index - 3) : index]).strip()
            after = " ".join(sentences[index + 1 : index + 3]).strip()
            user = SCENE_USER.format(
                bible=bible_text,
                previous=f'"{before}"' if before else "(this is the first scene)",
                index=index + 1,
                total=total,
                sentence=sentence,
                following=f'"{after}"' if after else "(this is the last scene)",
                rules=scene_rules,
            )
            conversations.append([{"role": "system", "content": scene_system}, {"role": "user", "content": user}])

        scenes: list[str] = []
        for start in range(0, len(conversations), batch_size):
            scenes.extend(self._chat(conversations[start : start + batch_size], max_new_tokens=190))
        # Keep descriptions short enough to fit FLUX's 512-token prompt window
        # together with the fixed style block.
        scenes = [" ".join(scene.split()[:130]) for scene in scenes]
        return {"bible": bible, "scenes": scenes}


EDIT_SYSTEM = (
    "You rewrite a user's request (usually in Spanish) to fix or change an existing illustration into ONE short, "
    "precise English image-editing instruction for an image model. Name the exact element to change and how "
    "(for example 'Remove the extra third hand on the boy's left side, leaving him with exactly two hands'). "
    "Do not describe the rest of the image. Answer with the instruction only."
)


def rewrite_edit_instruction(planner: "StoryPlanner", request: str, context: str = "") -> str:
    """Turns a free-form Spanish edit request into a precise English instruction."""
    user = f"Edit request: {request.strip()[:600]}"
    if context.strip():
        user += f"\nWhat the illustration shows (for reference): {context.strip()[:700]}"
    text = planner._chat([[{"role": "system", "content": EDIT_SYSTEM}, {"role": "user", "content": user}]], max_new_tokens=90)[0]
    text = " ".join(text.split()).strip().strip('"')
    return text or request.strip()


EDIT_PLAN_SYSTEM = (
    "You are the art director fixing ONE illustration of a storyboard. The user writes in Spanish and may either "
    "DESCRIBE A PROBLEM they see (e.g. 'el niño está dentro de la tortuga', 'tiene tres manos', 'la cara está rara') "
    "or GIVE AN INSTRUCTION (e.g. 'ponle una gorra azul'). A described problem must be FIXED, never reproduced. "
    "Decide how to fix it:\n"
    "- mode 'edit': small local appearance changes that keep the same composition (colors, clothing, adding or removing "
    "a small object, removing text, expression tweaks, lighting).\n"
    "- mode 'regenerate': anything that changes pose, position, layout or anatomy (characters merged or inside each other, "
    "extra or missing limbs or fingers, wrong number of characters, someone in the wrong place, broken faces or bodies, "
    "a different action or camera angle).\n"
    "Answer with JSON only, in English, no markdown."
)

EDIT_PLAN_USER = """Current scene description (what the illustration should show):
\"\"\"{description}\"\"\"

User request: \"{request}\"

Return exactly this JSON:
{{
  "problem": "one short sentence: what is wrong or what the user wants",
  "mode": "edit" or "regenerate",
  "instruction": "for mode edit: one precise English editing instruction stating the desired end result",
  "description": "for mode regenerate: the full corrected scene description (keep every character's look, the setting and the action), written positively so the problem cannot happen again, e.g. 'the boy kneels on the sand beside the turtle, clearly separate from it, with exactly two hands'"
}}"""


def plan_scene_fix(planner: "StoryPlanner", request: str, description: str) -> dict:
    """Interprets a user's fix request and chooses between editing the image and redrawing the scene."""
    raw = planner._chat(
        [[{"role": "system", "content": EDIT_PLAN_SYSTEM}, {"role": "user", "content": EDIT_PLAN_USER.format(description=description.strip()[:1500], request=request.strip()[:600])}]],
        max_new_tokens=420,
    )[0]
    data = _parse_json(raw) or {}
    mode = "regenerate" if str(data.get("mode", "")).strip().lower().startswith("regen") else "edit"
    instruction = " ".join(str(data.get("instruction") or "").split())
    corrected = " ".join(str(data.get("description") or "").split())
    if mode == "regenerate" and len(corrected) < 40:
        mode = "edit"
    if mode == "edit" and not instruction:
        instruction = rewrite_edit_instruction(planner, request, description)
    return {
        "problem": " ".join(str(data.get("problem") or "").split()),
        "mode": mode,
        "instruction": instruction,
        "description": " ".join(corrected.split()[:150]),
    }
