import { useCallback, useEffect, useRef, useState } from 'react';
import CodeEditor from './components/CodeEditor.jsx';
import Terminal from './components/Terminal.jsx';
import Toolbar from './components/Toolbar.jsx';
import VariablesPanel from './components/VariablesPanel.jsx';
import { usePythonRunner } from './hooks/usePythonRunner.js';
import OneDriveDialog from './components/OneDriveDialog.jsx';
import { hasFilePicker, openFile, saveFile } from './lib/files.js';
import {
  AuthRequiredError,
  createFile as createOneDriveFile,
  initOneDrive,
  isOneDriveConfigured,
  readFile as readOneDriveFile,
  updateFile as updateOneDriveFile,
} from './lib/onedrive.js';
import { DEFAULT_CODE, loadSampleCode, loadSampleList } from './lib/samples.js';

/** useState persisté dans localStorage (silencieux si le stockage est indisponible). */
function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) ?? initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* stockage plein ou bloqué : tant pis */
    }
  }, [key, value]);
  return [value, setValue];
}

/** Séparateur glissable. `axis` : 'x' (colonne) ou 'y' (ligne). */
function Splitter({ axis, onDrag }) {
  const [dragging, setDragging] = useState(false);

  function handlePointerDown(event) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    document.body.classList.add(axis === 'x' ? 'resizing-col' : 'resizing-row');
  }
  function handlePointerMove(event) {
    if (dragging) onDrag(axis === 'x' ? event.clientX : event.clientY);
  }
  function handlePointerUp() {
    setDragging(false);
    document.body.classList.remove('resizing-col', 'resizing-row');
  }

  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      className={`splitter ${dragging ? 'dragging' : ''} ${axis === 'x' ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize'}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  );
}

export default function App() {
  const [theme, setTheme] = usePersistentState('pystudio.theme', 'dark');
  const [code, setCode] = usePersistentState('pystudio.code', DEFAULT_CODE);
  const [breakpoints, setBreakpoints] = useState([]);
  const [samples, setSamples] = useState([]);
  const [sidebarWidth, setSidebarWidth] = useState(340);
  const [consoleHeight, setConsoleHeight] = useState(260);
  const [consoleWidth, setConsoleWidth] = useState(420);
  const [fileName, setFileName] = useState(null); // fichier ouvert/enregistré (null = sans nom)
  const [savedCode, setSavedCode] = useState(code); // contenu au dernier enregistrement
  const [fileSource, setFileSource] = useState(null); // 'local' | 'onedrive' | null
  const [oneDriveDialog, setOneDriveDialog] = useState(null); // 'open' | 'save' | null
  const fileHandle = useRef(null); // fichier local (File System Access API)
  const driveItemId = useRef(null); // fichier OneDrive
  const [storedLayout, setConsoleLayout] = usePersistentState('pystudio.consoleLayout', 'bottom');
  const consoleLayout = storedLayout === 'right' ? 'right' : 'bottom'; // « bottom » : sous le code

  const terminalRef = useRef(null);
  const workspaceRef = useRef(null);
  const columnRef = useRef(null);

  const runner = usePythonRunner({ terminalRef, breakpoints });
  const { status, clearError } = runner;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const handleCodeChange = useCallback(
    (next) => {
      setCode(next);
      clearError();
    },
    [setCode, clearError],
  );

  useEffect(() => {
    loadSampleList().then(setSamples);
  }, []);

  const detachFile = () => {
    fileHandle.current = null;
    driveItemId.current = null;
    setFileName(null);
    setFileSource(null);
  };

  const loadSample = async (file) => {
    try {
      const text = await loadSampleCode(file);
      detachFile(); // un exemple n'est lié à aucun fichier
      setSavedCode(text);
      setBreakpoints([]);
      setCode(text);
      clearError();
    } catch (error) {
      terminalRef.current?.write(`Impossible de charger l'exemple : ${error.message}\n`, 1);
    }
  };

  const reportFileError = (verb, error) =>
    terminalRef.current?.write(`Impossible de ${verb} le fichier : ${error.message}\n`, 1);

  const openFromDisk = async () => {
    if (status === 'running' || status === 'paused') return; // le code est verrouillé pendant l'exécution
    try {
      const file = await openFile();
      if (!file) return;
      detachFile();
      fileHandle.current = file.handle;
      setFileName(file.name);
      setFileSource('local');
      setSavedCode(file.text);
      setBreakpoints([]);
      setCode(file.text);
      clearError();
    } catch (error) {
      reportFileError('lire', error);
    }
  };

  const saveToDisk = async ({ forcePicker = false } = {}) => {
    try {
      // Fichier venant de OneDrive : « Enregistrer » le met à jour directement.
      if (driveItemId.current && !forcePicker) {
        await updateOneDriveFile(driveItemId.current, code);
        setSavedCode(code);
        return;
      }
      const result = await saveFile(code, {
        handle: fileSource === 'local' ? fileHandle.current : null,
        suggestedName: fileName ?? 'programme.py',
        forcePicker,
      });
      if (!result) return;
      detachFile();
      fileHandle.current = result.handle;
      setFileName(result.name);
      setFileSource('local');
      setSavedCode(code);
    } catch (error) {
      if (error instanceof AuthRequiredError) setOneDriveDialog('save'); // session expirée : reconnexion
      else reportFileError('enregistrer', error);
    }
  };

  // ---- OneDrive ----
  const openOneDriveDialog = (mode) => {
    if (mode === 'open' && (status === 'running' || status === 'paused')) return;
    setOneDriveDialog(mode);
  };

  const openFromOneDrive = async (item) => {
    const file = await readOneDriveFile(item.id);
    detachFile();
    driveItemId.current = item.id;
    setFileName(file.name);
    setFileSource('onedrive');
    setSavedCode(file.text);
    setBreakpoints([]);
    setCode(file.text);
    clearError();
    setOneDriveDialog(null);
  };

  const saveToOneDrive = async ({ parentId, name }) => {
    const saved = await createOneDriveFile(parentId, name, code);
    detachFile();
    driveItemId.current = saved.id;
    setFileName(saved.name);
    setFileSource('onedrive');
    setSavedCode(code);
    setOneDriveDialog(null);
  };

  // Au démarrage : termine une connexion Microsoft par redirection et reprend l'action en attente.
  useEffect(() => {
    if (!isOneDriveConfigured) return;
    initOneDrive().then(({ pending, error }) => {
      if (error) terminalRef.current?.write(`Connexion OneDrive impossible : ${error.message}\n`, 1);
      if (pending === 'open' || pending === 'save') setOneDriveDialog(pending);
    });
  }, []);

  // Raccourcis clavier façon VS Code
  const actions = useRef({});
  actions.current = { runner, code, openFromDisk, saveToDisk };
  useEffect(() => {
    function onKeyDown(event) {
      const { runner: r, code: source, openFromDisk: open, saveToDisk: save } = actions.current;
      const ctrl = event.ctrlKey || event.metaKey;
      let handled = true;
      if (ctrl && event.key.toLowerCase() === 's') save({ forcePicker: event.shiftKey });
      else if (ctrl && event.key.toLowerCase() === 'o') open();
      // Chromebook : pas de touches F → Ctrl+Entrée / Ctrl+Maj+Entrée
      else if (ctrl && event.key === 'Enter' && !event.shiftKey) r.run(source);
      else if (ctrl && event.key === 'Enter' && event.shiftKey) r.stop();
      else if (event.key === 'F5' && !event.shiftKey) r.run(source);
      else if (event.key === 'F5' && event.shiftKey) r.stop();
      else if (event.key === 'F10') r.stepOver(source);
      else if (event.key === 'F11' && !event.shiftKey) r.stepInto();
      else if (event.key === 'F11' && event.shiftKey) r.stepOut();
      else if (event.key === 'F8') r.continueRun();
      else handled = false;
      if (handled) event.preventDefault();
    }
    // Phase de capture : passe avant Monaco (qui utilise Ctrl+Entrée pour insérer une ligne).
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // Redimensionnement
  const dragSidebar = (clientX) => {
    const rect = workspaceRef.current.getBoundingClientRect();
    setSidebarWidth(Math.min(Math.max(rect.right - clientX, 220), rect.width - 320));
  };
  const dragConsole = (position) => {
    const rect = columnRef.current.getBoundingClientRect();
    if (consoleLayout === 'right') {
      setConsoleWidth(Math.min(Math.max(rect.right - position, 200), rect.width - 240));
    } else {
      setConsoleHeight(Math.min(Math.max(rect.bottom - position, 90), rect.height - 140));
    }
  };
  const sideBySide = consoleLayout === 'right';

  const busy = status === 'running' || status === 'paused';

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        status={status}
        loadingText={runner.loadingText}
        currentLine={runner.currentLine}
        samples={samples}
        onSample={loadSample}
        onRun={() => runner.run(code)}
        onStop={runner.stop}
        onStepOver={() => runner.stepOver(code)}
        onStepInto={runner.stepInto}
        onStepOut={runner.stepOut}
        onContinue={runner.continueRun}
        fileName={fileName}
        fileSource={fileSource}
        oneDriveEnabled={isOneDriveConfigured}
        onOneDriveOpen={() => openOneDriveDialog('open')}
        onOneDriveSave={() => openOneDriveDialog('save')}
        dirty={code !== savedCode}
        canPickFiles={hasFilePicker}
        busy={busy}
        onOpen={openFromDisk}
        onSave={() => saveToDisk()}
        onSaveAs={() => saveToDisk({ forcePicker: true })}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        consoleLayout={consoleLayout}
        onToggleLayout={() => setConsoleLayout(sideBySide ? 'bottom' : 'right')}
      />

      {oneDriveDialog && (
        <OneDriveDialog
          mode={oneDriveDialog}
          initialName={fileName}
          onClose={() => setOneDriveDialog(null)}
          onOpen={openFromOneDrive}
          onSave={saveToOneDrive}
        />
      )}

      {status === 'fatal' && (
        <div role="alert" className="shrink-0 border-b border-ide-stop/40 bg-ide-stop/10 px-4 py-2 text-sm text-ide-stop">
          <strong>Impossible de démarrer Python.</strong> {runner.fatalError}
        </div>
      )}

      <div ref={workspaceRef} className="flex min-h-0 flex-1">
        {/* Zone gauche : éditeur + console (sous le code ou à sa droite) */}
        <div ref={columnRef} className={`flex min-w-0 flex-1 ${sideBySide ? 'flex-row' : 'flex-col'}`}>
          <div className="min-h-0 min-w-0 flex-1">
            <CodeEditor
              value={code}
              onChange={handleCodeChange}
              breakpoints={breakpoints}
              onBreakpointsChange={setBreakpoints}
              currentLine={runner.currentLine}
              errorInfo={runner.errorInfo}
              readOnly={busy}
              theme={theme}
            />
          </div>

          <Splitter axis={sideBySide ? 'x' : 'y'} onDrag={dragConsole} />

          <section
            style={sideBySide ? { width: consoleWidth } : { height: consoleHeight }}
            className="flex shrink-0 flex-col bg-ide-bg"
          >
            <div className="flex h-8 shrink-0 items-center border-b border-ide-border bg-ide-panel px-3 text-xs font-semibold uppercase tracking-wide text-ide-muted">
              Console
              {status === 'running' && (
                <span className="ml-3 normal-case font-normal">· cliquez ici pour répondre à input()</span>
              )}
            </div>
            <div className="min-h-0 flex-1">
              <Terminal
                ref={terminalRef}
                theme={theme}
                onSubmit={runner.submitInput}
                onInterrupt={runner.stop}
              />
            </div>
          </section>
        </div>

        <Splitter axis="x" onDrag={dragSidebar} />

        {/* Colonne droite : variables */}
        <aside style={{ width: sidebarWidth }} className="hidden shrink-0 md:block">
          <VariablesPanel snapshot={runner.snapshot} status={status} />
        </aside>
      </div>
    </div>
  );
}
