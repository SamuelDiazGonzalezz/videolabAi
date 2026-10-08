// Tipos de imagen (técnica visual) elegibles al crear un storyboard. El texto
// `prompt` va en inglés porque es el que recibe FLUX como estilo artístico; el
// director (Qwen3) también lo usa para planificar todas las escenas igual.

export type ArtType = {
  id: string;
  label: string;
  detail: string;
  tags: string[];
  prompt: string;
};

export const ART_TYPES: ArtType[] = [
  { id: 'auto', label: 'Automático', detail: 'El director elige la técnica según el guion', tags: ['Recomendado'], prompt: '' },
  { id: 'dibujo', label: 'Dibujo', detail: 'Ilustración 2D limpia, contorno definido', tags: ['2D', 'Versátil'], prompt: 'hand-drawn 2D digital illustration with clean confident line art and flat colors' },
  { id: 'anime', label: 'Anime', detail: 'Estilo japonés, ojos expresivos, cel shading', tags: ['Manga', 'Vibrante'], prompt: 'Japanese anime illustration, cel shading, expressive large eyes, crisp line art, vibrant colors, anime film key visual' },
  { id: 'realista', label: 'Realista', detail: 'Fotografía cinematográfica hiperrealista', tags: ['Foto', 'Cine'], prompt: 'photorealistic cinematic photograph, 35mm lens, shallow depth of field, realistic skin and materials, natural lighting' },
  { id: 'natural', label: 'Natural', detail: 'Foto documental espontánea, luz de día', tags: ['Foto', 'Documental'], prompt: 'natural candid documentary photograph, soft daylight, true-to-life colors, unposed, realistic everyday look' },
  { id: 'comic', label: 'Cómic', detail: 'Tinta gruesa, tramas y colores planos', tags: ['Viñeta', 'Tinta'], prompt: 'comic book art, bold black ink outlines, halftone dot shading, flat vivid colors, dynamic comic panel composition' },
  { id: 'rotulador', label: 'Rotulador', detail: 'Trazos de rotulador sobre papel', tags: ['Papel', 'Hecho a mano'], prompt: 'felt-tip marker drawing on paper, visible marker strokes and streaks, slightly overlapping marker colors, hand-made look' },
  { id: 'cera', label: 'Ceras', detail: 'Dibujo infantil con ceras de colores', tags: ['Infantil', 'Textura'], prompt: 'wax crayon drawing on paper, waxy textured strokes, paper grain showing through, childlike crayon coloring' },
  { id: 'mal-pintado', label: 'Mal pintado', detail: 'Paint cutre a propósito, trazos torpes', tags: ['Humor', 'Meme'], prompt: 'crude childish doodle drawn with a computer mouse in MS Paint, wobbly thin shaky outlines, flat bucket-fill colors spilling outside the lines, no shading, wrong proportions, stick-like limbs, plain white areas, extremely amateurish and funny' },
  { id: 'acuarela', label: 'Acuarela', detail: 'Manchas suaves y textura de papel', tags: ['Pintura', 'Suave'], prompt: 'watercolor painting, soft translucent washes, gentle color bleeding, visible cold-press paper texture' },
  { id: 'lapiz', label: 'Lápiz', detail: 'Boceto a grafito en blanco y negro', tags: ['Boceto', 'B/N'], prompt: 'graphite pencil sketch, hand shading and hatching, monochrome grey tones, sketchbook paper' },
  { id: 'oleo', label: 'Óleo', detail: 'Pintura al óleo con pincelada visible', tags: ['Clásico', 'Pintura'], prompt: 'oil painting on canvas, visible thick brush strokes, rich colors, classical painterly lighting' },
  { id: '3d', label: 'Animación 3D', detail: 'Película de animación, render suave', tags: ['3D', 'Familiar'], prompt: '3D animated feature film render, stylized characters, soft global illumination, subsurface scattering, polished CGI' },
  { id: 'plastilina', label: 'Plastilina', detail: 'Stop motion con figuras de arcilla', tags: ['Stop motion', '3D'], prompt: 'claymation stop-motion scene, handmade plasticine figures with fingerprints, miniature set, soft studio lighting' },
  { id: 'pixel', label: 'Pixel art', detail: 'Videojuego retro de 16 bits', tags: ['Retro', 'Juego'], prompt: 'pixel art, 16-bit retro video game style, limited color palette, crisp pixels, no anti-aliasing' },
  { id: 'vector', label: 'Vector plano', detail: 'Formas simples, estilo infografía', tags: ['Plano', 'Educativo'], prompt: 'flat vector illustration, simple geometric shapes, minimal shading, clean infographic look' },
  { id: 'papel', label: 'Recortes de papel', detail: 'Collage de papel recortado en capas', tags: ['Collage', 'Manual'], prompt: 'paper cut-out collage, layered colored paper with soft drop shadows, handmade craft look' },
];

export function artTypeById(id: string | null | undefined) {
  return ART_TYPES.find((type) => type.id === id) || ART_TYPES[0];
}
