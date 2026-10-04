// Asigna a cada clip un "carril" (fila) para que dos elementos que se
// solapan en el tiempo se dibujen en filas distintas del timeline en vez de
// amontonarse en la misma — mismo algoritmo greedy de coloreado de
// intervalos usado ya por B-Roll (Función 3) y ahora también por Texto.
export interface LaneItem {
  id: string;
  startTime: number;
  endTime: number;
}

export function assignLanes(clips: LaneItem[]): Map<string, number> {
  const lanes: number[] = []; // fin (endTime) del último clip en cada carril
  const laneById = new Map<string, number>();
  for (const clip of [...clips].sort((a, b) => a.startTime - b.startTime)) {
    let lane = lanes.findIndex((end) => end <= clip.startTime + 0.001);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(clip.endTime);
    } else {
      lanes[lane] = clip.endTime;
    }
    laneById.set(clip.id, lane);
  }
  return laneById;
}

export function laneCountOf(laneById: Map<string, number>): number {
  return Math.max(1, ...[...laneById.values()].map((lane) => lane + 1));
}
