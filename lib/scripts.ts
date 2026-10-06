import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Guiones escritos con el asistente (Qwen3 local), guardados en data/scripts.
export type SavedScript = {
  id: string;
  title: string;
  idea: string;
  body: string;
  seconds: number;
  tone: string;
  createdAt: string;
};

const ROOT = path.join(process.cwd(), 'data', 'scripts');
const FILE = path.join(ROOT, 'scripts.json');

async function readAll(): Promise<SavedScript[]> {
  try {
    const data = JSON.parse(await readFile(FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writeAll(scripts: SavedScript[]) {
  await mkdir(ROOT, { recursive: true });
  await writeFile(FILE, JSON.stringify(scripts, null, 2), 'utf8');
}

export async function listScripts() {
  return (await readAll()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveScript(input: Omit<SavedScript, 'id' | 'createdAt'>) {
  const body = input.body.trim().slice(0, 20_000);
  if (!body) throw new Error('El guion está vacío.');
  const script: SavedScript = {
    id: randomUUID(),
    title: (input.title.trim() || body.split(/[.!?\n]/)[0] || 'Guion sin título').slice(0, 120),
    idea: input.idea.trim().slice(0, 4000),
    body,
    seconds: Math.max(0, Math.round(input.seconds) || 0),
    tone: input.tone.slice(0, 40),
    createdAt: new Date().toISOString(),
  };
  await writeAll([script, ...await readAll()]);
  return script;
}

export async function deleteScript(id: string) {
  const scripts = await readAll();
  const next = scripts.filter((script) => script.id !== id);
  if (next.length === scripts.length) return false;
  await writeAll(next);
  return true;
}
