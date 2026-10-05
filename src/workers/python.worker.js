/**
 * Web Worker : héberge Pyodide (Python/WebAssembly) hors du thread de l'interface.
 *
 * Messages reçus  : { type: 'init', buffer, indexURL } | { type: 'run', code, mode }
 * Messages émis   : loading, ready, output, snapshot, paused, input-request, done, fatal
 *
 * Les commandes de l'utilisateur (continuer, pas à pas, arrêter, texte saisi,
 * points d'arrêt) NE passent PAS par postMessage — le worker est bloqué dans
 * Python — mais par le SharedArrayBuffer : voir src/lib/protocol.js.
 */
import runnerSource from './runner.py?raw';
import { CMD, CTRL, STREAM, createViews, readBreakpoints } from '../lib/protocol.js';

const OUTPUT_LIMIT = 2_000_000; // caractères max par exécution (garde-fou boucle infinie + print)
const FLUSH_INTERVAL_MS = 40;
const FLUSH_SIZE = 16 * 1024;

let pyodide = null;
let runProgram = null;
let views = null;

// ---------------------------------------------------------------------------
// Sortie console (regroupée pour ne pas saturer le thread principal)
// ---------------------------------------------------------------------------

let chunks = [];
let bufferedChars = 0;
let lastFlush = 0;
let sentChars = 0;
let limitHit = false;

const post = (message) => self.postMessage(message);

function flushOutput() {
  if (chunks.length) {
    post({ type: 'output', chunks });
    chunks = [];
  }
  bufferedChars = 0;
  lastFlush = performance.now();
}

function writeOutput(text, kind) {
  if (limitHit) return;
  sentChars += text.length;
  if (sentChars > OUTPUT_LIMIT) {
    limitHit = true;
    chunks.push({ kind: STREAM.ERR, text: '\n[Trop de texte affiché : exécution interrompue]\n' });
    flushOutput();
    views.interrupt[0] = 2; // KeyboardInterrupt dans Python
    return;
  }
  const last = chunks[chunks.length - 1];
  if (last && last.kind === kind) last.text += text;
  else chunks.push({ kind, text });
  bufferedChars += text.length;
  if (bufferedChars >= FLUSH_SIZE || performance.now() - lastFlush >= FLUSH_INTERVAL_MS) flushOutput();
}

// ---------------------------------------------------------------------------
// Attente bloquante d'une commande de l'interface
// ---------------------------------------------------------------------------

function waitForSignal() {
  const control = views.control;
  for (;;) {
    if (Atomics.load(control, CTRL.STOP_FLAG)) return CMD.STOP;
    const value = Atomics.load(control, CTRL.SIGNAL);
    if (value !== 0) {
      Atomics.store(control, CTRL.SIGNAL, 0);
      return value;
    }
    // Réveil immédiat par Atomics.notify ; le timeout sert de filet de sécurité.
    Atomics.wait(control, CTRL.SIGNAL, 0, 100);
  }
}

function readInputText() {
  const length = Atomics.load(views.control, CTRL.INPUT_LEN);
  // .slice() copie hors du SharedArrayBuffer : TextDecoder refuse les vues partagées.
  return new TextDecoder().decode(views.input.slice(0, length));
}

// ---------------------------------------------------------------------------
// Module JavaScript exposé à Python sous le nom « studio_bridge »
// ---------------------------------------------------------------------------

const bridge = {
  get_breakpoints: () => readBreakpoints(views),

  write: (text, kind) => writeOutput(text, kind),

  flush: () => flushOutput(),

  /** Instantané de variables pendant que le programme tourne. */
  snapshot: (json) => post({ type: 'snapshot', data: json }),

  /** Pause (point d'arrêt / pas à pas) : bloque jusqu'à la commande de l'utilisateur. */
  pause: (json, edit = false) => {
    flushOutput();
    Atomics.store(views.control, CTRL.SIGNAL, 0);
    post({ type: 'paused', data: json, edit });
    return waitForSignal();
  },

  /** Texte déposé par l'interface dans la zone d'entrée (saisie input() ou modification de variable). */
  read_edit: () => readInputText(),

  /** input() : renvoie "L<texte>", "E" (fin de fichier) ou "S" (arrêt demandé). */
  read_line: () => {
    flushOutput();
    Atomics.store(views.control, CTRL.SIGNAL, 0);
    post({ type: 'input-request' });
    const command = waitForSignal();
    if (command === CMD.INPUT) return 'L' + readInputText();
    return command === CMD.EOF ? 'E' : 'S';
  },
};

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

async function init({ buffer, indexURL }) {
  views = createViews(buffer);

  post({ type: 'loading', text: 'Téléchargement de Python (Pyodide)…' });
  const { loadPyodide } = await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`);
  pyodide = await loadPyodide({ indexURL });

  post({ type: 'loading', text: 'Initialisation du débogueur…' });
  pyodide.setInterruptBuffer(views.interrupt); // permet d'arrêter même un « while True: pass »
  pyodide.registerJsModule('studio_bridge', bridge);
  pyodide.runPython(runnerSource);
  runProgram = pyodide.globals.get('run_program');

  post({ type: 'ready', version: pyodide.version });
}

async function run({ code, mode }) {
  Atomics.store(views.control, CTRL.STOP_FLAG, 0);
  Atomics.store(views.control, CTRL.SIGNAL, 0);
  views.interrupt[0] = 0;
  chunks = [];
  bufferedChars = 0;
  sentChars = 0;
  limitHit = false;
  lastFlush = performance.now();

  let result;
  try {
    // Charge automatiquement les paquets utilisés par « import » (numpy, pandas…).
    await pyodide.loadPackagesFromImports(code, {
      messageCallback: (text) => writeOutput(text + '\n', STREAM.INFO),
      errorCallback: (text) => writeOutput(text + '\n', STREAM.ERR),
    });
    flushOutput();

    if (Atomics.load(views.control, CTRL.STOP_FLAG)) {
      result = { status: 'stopped' };
    } else {
      result = JSON.parse(runProgram(code, mode));
    }
  } catch (error) {
    const text = String(error?.message ?? error);
    if (text.includes('KeyboardInterrupt')) {
      result = { status: 'stopped' };
    } else {
      writeOutput(text + '\n', STREAM.ERR);
      result = { status: 'error', message: text.split('\n').filter(Boolean).pop() };
    }
  }

  flushOutput();
  post({ type: 'done', ...result });
}

self.onmessage = async (event) => {
  const message = event.data;
  try {
    if (message.type === 'init') await init(message);
    else if (message.type === 'run') await run(message);
  } catch (error) {
    post({ type: 'fatal', message: String(error?.message ?? error) });
  }
};
