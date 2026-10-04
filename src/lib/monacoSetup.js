/**
 * Monaco est embarqué dans le bundle (aucun CDN) : l'éditeur fonctionne donc
 * aussi hors-ligne une fois la page chargée.
 */
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { registerPythonCompletions } from './pythonCompletions.js';

// Python n'a pas de service de langage dédié : le worker générique suffit.
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

loader.config({ monaco });
registerPythonCompletions(monaco);

export { monaco };
