/* Test de faisabilité : pygame-ce dans un Web Worker Pyodide.
 * Pygame utilise le pilote vidéo « dummy » (aucun canvas) ; chaque appel à
 * pygame.display.flip()/update() envoie les pixels à la page. */
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
// SDL (Emscripten) lit window.screen, absent dans un worker : on le simule.
self.screen = { width: 1920, height: 1080, availWidth: 1920, availHeight: 1080 };
const noop = () => {};
self.window = self;
self.document = {
  fullscreenElement: null,
  pointerLockElement: null,
  hidden: false,
  visibilityState: 'visible',
  addEventListener: noop,
  removeEventListener: noop,
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (tag) => {
    if (tag === 'canvas') return Object.assign(new OffscreenCanvas(1, 1), { style: {} });
    return { style: {}, addEventListener: noop, removeEventListener: noop };
  },
  body: { appendChild: noop, removeChild: noop, style: {} },
  documentElement: { style: {} },
};
const post = (m, t) => self.postMessage(m, t || []);
const log = (text) => post({ type: 'log', text });

let pyodide;
let interrupt;

const PY_PATCH = `
import os
os.environ["SDL_AUDIODRIVER"] = "dummy"
import pygame
import pygame.display
from pyodide.ffi import to_js
import studio_gfx

def _send_frame():
    surface = pygame.display.get_surface()
    if surface is not None:
        w, h = surface.get_size()
        studio_gfx.frame(w, h, to_js(pygame.image.tobytes(surface, "RGBA")))

def _flip():
    _send_frame()

def _update(*args, **kwargs):
    _send_frame()

pygame.display.flip = _flip
pygame.display.update = _update
`;

self.onmessage = async (event) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      interrupt = new Uint8Array(msg.interruptBuffer);
      const t0 = performance.now();
      const { loadPyodide } = await import(`${PYODIDE}pyodide.mjs`);
      pyodide = await loadPyodide({ indexURL: PYODIDE });
      pyodide.setInterruptBuffer(interrupt);
      log(`Pyodide ${pyodide.version} chargé en ${Math.round(performance.now() - t0)} ms`);

      const t1 = performance.now();
      await pyodide.loadPackage('pygame-ce');
      log(`pygame-ce chargé en ${Math.round(performance.now() - t1)} ms`);

      let frames = 0;
      let first = 0;
      // Canvas hors écran créé DANS le worker : SDL (pilote « emscripten ») s'y attache,
      // mais on n'affiche jamais ce canvas : les pixels partent vers la page via flip().
      try {
        const offscreen = new OffscreenCanvas(640, 480);
        // SDL traite le canvas comme un élément DOM : on ajoute ce qui lui manque.
        offscreen.style = {};
        offscreen.getBoundingClientRect = () => ({ left: 0, top: 0, width: offscreen.width, height: offscreen.height });
        pyodide.canvas.setCanvas2D(offscreen);
        log('setCanvas2D(OffscreenCanvas) OK');
      } catch (error) {
        log('setCanvas2D a échoué : ' + error.message);
      }

      pyodide.registerJsModule('studio_gfx', {
        frame: (w, h, data) => {
          const now = performance.now();
          if (!frames) first = now;
          frames++;
          // .slice() : copie dans un ArrayBuffer transférable
          const pixels = data.slice();
          post({ type: 'frame', w, h, buffer: pixels.buffer, n: frames, t: now - first }, [pixels.buffer]);
        },
      });
      pyodide.runPython(PY_PATCH);
      self.resetFrames = () => {
        frames = 0;
      };
      self.getFrames = () => frames;
      post({ type: 'ready' });
    } else if (msg.type === 'run') {
      interrupt[0] = 0;
      self.resetFrames();
      const t = performance.now();
      try {
        pyodide.runPython(msg.code);
        const s = (performance.now() - t) / 1000;
        log(`Programme terminé : ${self.getFrames()} images en ${s.toFixed(2)} s (${(self.getFrames() / s).toFixed(1)} i/s)`);
      } catch (error) {
        log('Arrêt/erreur : ' + String(error.message).split('\n').filter(Boolean).pop());
      }
      post({ type: 'done' });
    }
  } catch (error) {
    log('ERREUR : ' + (error.message || error));
    post({ type: 'fatal', message: String(error.message || error) });
  }
};
