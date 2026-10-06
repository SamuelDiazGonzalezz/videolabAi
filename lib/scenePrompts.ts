import type { ReferenceStyle } from './references';

// Construcción de los prompts de FLUX, compartida por la generación del
// storyboard y por la regeneración de una escena desde el mapa de nodos.

export const STYLE = 'clean flat 2D digital cartoon matching the supplied Monos references, naive hand-drawn character design, crisp thick black outlines, smooth solid color fills, simple geometric backgrounds, saturated turquoise sky and grass, two recurring gray-furred chimpanzee pilots with pale gray faces, Pilot A wears a coral-red jacket, Pilot B wears a white jacket with dark trousers, recurring red race cars that the pilots sit in and drive whenever the story mentions driving, racing, overtaking or crossing the finish line, playful proportions, clean cel-shaded illustration, no wax, no crayon, no marker texture, no paper grain, no painterly rendering, no photorealism, no 3D';
export const QUALITY_GUARD = 'Keep anatomy clean and readable: one head and one face per character, two eyes, two arms and two hands, no extra limbs, no fused fingers, no duplicate characters, no warped faces, no melted car, no random text, no watermark, no logo. Use a clear foreground action, simple background shapes and a stable camera composition. Never redesign the established pilots or change their clothing between scenes. Do not add hats, helmets, glasses or new accessories unless the current story beat explicitly asks for them. If only one pilot is mentioned, use one of the two established pilots instead of inventing a new character.';


export type StoryPlan = { bible: Record<string, unknown>; scenes: string[] };

export function storySetting(fullScript: string) {
  const first = fullScript.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.slice(0, 2).join(' ').trim() || fullScript;
  return first.replace(/\s+/g, ' ').slice(0, 220);
}

export function buildPrompt(fullScript: string, caption: string, sceneNumber: number, totalScenes: number) {
  // La acción de la escena va primero: con el guion completo delante, todas las
  // imágenes mezclaban la historia entera y acababan siendo casi iguales.
  return `Illustrate exactly this story moment (scene ${sceneNumber} of ${totalScenes}): "${caption}". Show the action, objects and emotion described in that sentence as the clear focus of the frame; do not depict earlier or later events. Story setting for reference only: "${storySetting(fullScript)}". Art style: ${STYLE}. ${QUALITY_GUARD} Absolutely no written words, letters, signs with text, banners or logos anywhere in the image.`;
}

// Con plan del director (Qwen3), el prompt es la descripción visual de la escena
// y un bloque de estilo compacto: todo cabe en los 512 tokens que lee FLUX.
const PLANNED_STYLE = 'Art style: flat 2D cartoon exactly matching the reference images, crisp thick black outlines, smooth solid color fills, simple shapes, saturated turquoise sky and green grass, gray-furred chimpanzee pilots (one in a coral-red jacket, one in a white jacket with dark trousers), red race cars, clean cel shading, no 3D, no photorealism, no paper or crayon texture.';
const PLANNED_GUARD = 'Clean anatomy: one head, two eyes, two arms and two hands per character, no extra limbs, no duplicated characters. Both pilots are bare-headed, gray fur visible on top of their heads. Keep the clothing of every pilot identical to the references. Absolutely no written words, letters, numbers, signs, banners or logos.';

// Estilos sin reparto fijo («En blanco» y propios): el director inventa los
// personajes y los describe completos en cada escena para que salgan iguales.
const OPEN_GUARD = 'Clean anatomy, no extra limbs, no duplicated characters. Every recurring character keeps exactly the same face, body, hair and clothing in every scene. Absolutely no written words, letters, numbers, signs, banners or logos.';

export function planArtStyle(plan: StoryPlan | null) {
  const value = plan?.bible?.art_style;
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : '';
}

// Prompt de FLUX según el estilo elegido.
export function buildScenePrompt(style: ReferenceStyle, plan: StoryPlan | null, index: number, fallback: { script: string; caption: string; total: number }) {
  if (style.kind === 'monos') {
    return plan ? `${plan.scenes[index]} ${PLANNED_STYLE} ${PLANNED_GUARD}` : buildPrompt(fallback.script, fallback.caption, index + 1, fallback.total);
  }
  const scene = plan?.scenes[index]
    || `Illustrate exactly this story moment (scene ${index + 1} of ${fallback.total}): "${fallback.caption}". Story setting for reference only: "${storySetting(fallback.script)}".`;
  if (style.kind === 'custom') {
    const notes = style.description ? `, ${style.description}` : '';
    return `${scene} Art style: exactly the drawing style, line work and colors of the reference images${notes}. ${OPEN_GUARD}`;
  }
  const artStyle = planArtStyle(plan) || 'a polished, cohesive illustration style that fits the tone of the story';
  return `${scene} Art style: ${artStyle}. ${OPEN_GUARD}`;
}


/** Descripción visual de la escena: la del director o, sin plan, la frase del guion. */
export function sceneDescription(plan: StoryPlan | null, index: number, caption: string) {
  return plan?.scenes[index]?.trim() || caption;
}

/** Prompt completo a partir de una descripción editada por el usuario en el mapa. */
export function promptFromDescription(style: ReferenceStyle, description: string, plan: StoryPlan | null) {
  const scene = description.trim();
  if (style.kind === 'monos') return `${scene} ${PLANNED_STYLE} ${PLANNED_GUARD}`;
  if (style.kind === 'custom') {
    const notes = style.description ? `, ${style.description}` : '';
    return `${scene} Art style: exactly the drawing style, line work and colors of the reference images${notes}. ${OPEN_GUARD}`;
  }
  const artStyle = planArtStyle(plan) || 'a polished, cohesive illustration style that fits the tone of the story';
  return `${scene} Art style: ${artStyle}. ${OPEN_GUARD}`;
}
