/**
 * Protocole partagé entre le thread principal (React) et le Web Worker Pyodide.
 *
 * Pourquoi un SharedArrayBuffer ?
 * Le code Python s'exécute de façon SYNCHRONE dans le worker. Quand il appelle
 * input() ou qu'il s'arrête sur un point d'arrêt, il doit se bloquer en
 * attendant l'utilisateur. Un worker bloqué ne peut plus recevoir de messages :
 * on utilise donc une mémoire partagée + Atomics.wait() côté worker, et
 * Atomics.store()/notify() côté interface. Le même buffer sert à :
 *   - envoyer les commandes (continuer, pas à pas, arrêter),
 *   - envoyer le texte saisi pour input(),
 *   - mettre à jour les points d'arrêt PENDANT l'exécution,
 *   - interrompre une boucle infinie (interrupt buffer de Pyodide).
 */

/** Commandes écrites dans CTRL.SIGNAL par l'interface. Doivent rester identiques dans runner.py. */
export const CMD = Object.freeze({
  CONTINUE: 1,
  OVER: 2, // Étape suivante (step over)
  INTO: 3, // Entrer dans la fonction (step into)
  OUT: 4, // Sortir de la fonction (step out)
  STOP: 5,
  INPUT: 6, // une ligne a été saisie (texte dans la zone d'entrée)
  EOF: 7, // Ctrl+D dans la console
  EDIT: 8, // modification d'une variable en pause (JSON dans la zone d'entrée)
});

/** Index des mots Int32 de contrôle. */
export const CTRL = Object.freeze({
  SIGNAL: 0, // commande en attente (0 = rien)
  STOP_FLAG: 1, // 1 = arrêt demandé (persistant, ne se perd jamais)
  INPUT_LEN: 2, // longueur (octets) du texte saisi
  BP_COUNT: 3, // nombre de points d'arrêt
});

/** Types de flux de sortie. */
export const STREAM = Object.freeze({ OUT: 0, ERR: 1, INFO: 2 });

const CONTROL_WORDS = 16;
export const MAX_BREAKPOINTS = 1024;
export const INPUT_CAPACITY = 16 * 1024;

const CONTROL_BYTES = (CONTROL_WORDS + MAX_BREAKPOINTS) * 4;
const INPUT_OFFSET = CONTROL_BYTES;
const INTERRUPT_OFFSET = INPUT_OFFSET + INPUT_CAPACITY;
export const SHARED_BYTES = INTERRUPT_OFFSET + 8;

export function createSharedBuffer() {
  return new SharedArrayBuffer(SHARED_BYTES);
}

/** Vues typées sur le buffer partagé (identiques des deux côtés). */
export function createViews(buffer) {
  return {
    control: new Int32Array(buffer, 0, CONTROL_WORDS + MAX_BREAKPOINTS),
    input: new Uint8Array(buffer, INPUT_OFFSET, INPUT_CAPACITY),
    interrupt: new Uint8Array(buffer, INTERRUPT_OFFSET, 1),
  };
}

/** Écrit la liste des points d'arrêt (numéros de lignes, base 1). */
export function writeBreakpoints(views, lines) {
  const list = lines.slice(0, MAX_BREAKPOINTS);
  list.forEach((line, i) => Atomics.store(views.control, CONTROL_WORDS + i, line));
  Atomics.store(views.control, CTRL.BP_COUNT, list.length);
}

export function readBreakpoints(views) {
  const count = Atomics.load(views.control, CTRL.BP_COUNT);
  const lines = [];
  for (let i = 0; i < count; i++) lines.push(Atomics.load(views.control, CONTROL_WORDS + i));
  return lines;
}

/** Envoie une commande au worker bloqué. */
export function sendSignal(views, command) {
  Atomics.store(views.control, CTRL.SIGNAL, command);
  Atomics.notify(views.control, CTRL.SIGNAL);
}
