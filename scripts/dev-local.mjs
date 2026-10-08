import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// Antivirus como Avast inspeccionan HTTPS con su propio certificado raíz, que
// está en el almacén de Windows pero no en el de Node: sin esto, las llamadas a
// ElevenLabs fallan con UNABLE_TO_VERIFY_LEAF_SIGNATURE.
const nodeOptions = [process.env.NODE_OPTIONS, '--use-system-ca'].filter(Boolean).join(' ');
const childEnv = { ...process.env, NODE_OPTIONS: nodeOptions };
const children = [];

function start(args, cwd) {
  const child = spawn(npmCommand, args, {
    cwd,
    stdio: 'inherit',
    env: childEnv,
    shell: process.platform === 'win32'
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(`No se pudo iniciar ${args.join(' ')}:`, error.message);
  });
  return child;
}

const root = process.cwd();
const fluxUrl = (process.env.LOCAL_FLUX_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');

// El generador de imágenes FLUX también se arranca aquí (si no lo hizo ya
// start-local.ps1), para que `npm run dev` deje toda la app lista.
// Variables del servidor FLUX definidas en .env.local (modelo, FP8…).
function fluxEnvFromFile() {
  const values = {};
  try {
    for (const line of readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
      const match = /^\s*((?:LOCAL_FLUX|HF)_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && match[2]) values[match[1]] = match[2];
    }
  } catch { /* sin .env.local */ }
  return values;
}

async function startFluxIfNeeded() {
  if ((process.env.GENERATION_PROVIDER || 'local').toLowerCase() !== 'local') return;
  try {
    const response = await fetch(`${fluxUrl}/health`, { signal: AbortSignal.timeout(2000) });
    if (response.ok) { console.log(`FLUX ya está en marcha en ${fluxUrl}.`); return; }
  } catch { /* no está arrancado */ }
  const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!existsSync(python)) {
    console.warn('No se encontró .venv: las imágenes no se podrán generar hasta instalar FLUX (ver README).');
    return;
  }
  spawnFlux(python);
}

// Si FLUX se cae (cuelgue de la GPU, falta de memoria…), se vuelve a arrancar
// solo, hasta 5 veces cada 10 minutos para no entrar en un bucle.
const fluxRestarts = [];
function spawnFlux(python) {
  console.log(`Arrancando ${fluxEnvFromFile().LOCAL_FLUX_MODEL || 'FLUX.2 Klein 4B'} en la GPU (tarda 1-3 minutos en cargar)…`);
  const flux = spawn(python, ['local_flux/server.py'], {
    cwd: root,
    stdio: 'inherit',
    env: { LOCAL_FLUX_INSECURE_HF: '1', ...childEnv, ...fluxEnvFromFile() },
    windowsHide: true
  });
  children.push(flux);
  flux.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`El servidor FLUX se detuvo (${code ?? signal}).`);
    const now = Date.now();
    while (fluxRestarts.length && now - fluxRestarts[0] > 10 * 60_000) fluxRestarts.shift();
    if (fluxRestarts.length >= 5) {
      console.error('FLUX se ha caído 5 veces en 10 minutos: no se reinicia más. Revisa la memoria libre o vuelve a Klein 4B en .env.local.');
      return;
    }
    fluxRestarts.push(now);
    console.log('Reiniciando FLUX en 5 s…');
    setTimeout(() => { if (!shuttingDown) spawnFlux(python); }, 5000);
  });
}

void startFluxIfNeeded();
const next = start(['exec', 'next', 'dev'], root);
const timeline = start(['run', 'dev', '--', '--host', '127.0.0.1'], `${root}/timeline-studio`);
let shuttingDown = false;

function stop(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(exitCode), 250);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
next.on('exit', (code, signal) => {
  if (!shuttingDown) stop(code ?? (signal ? 1 : 0));
});
timeline.on('exit', (code, signal) => {
  if (!shuttingDown && code && code !== 0) {
    console.error(`timeline-studio terminó (${code}${signal ? `/${signal}` : ''}).`);
  }
});
