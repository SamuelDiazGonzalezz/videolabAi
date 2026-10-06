import { Agent } from 'undici';

// El fetch de Node corta cualquier respuesta que tarde más de 5 minutos en
// empezar (headersTimeout de undici) y da "fetch failed". Planificar un guion
// largo o esperar turno en la GPU puede tardar más, así que las llamadas al
// servidor FLUX local usan un agente sin ese límite: el tiempo máximo lo marca
// cada llamada con su propio AbortSignal.
const localAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0, keepAliveTimeout: 60_000 });

export function fluxFetch(input: string, init: RequestInit = {}) {
  return fetch(input, { ...init, dispatcher: localAgent } as RequestInit);
}
