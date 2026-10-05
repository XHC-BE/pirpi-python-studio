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

/** Nombre persisté dans localStorage (taille d'un panneau). */
function usePersistentNumber(key, initial) {
  const [raw, setRaw] = usePersistentState(key, String(initial));
  const number = Number(raw);
  return [Number.isFinite(number) && number > 0 ? number : initial, (value) => setRaw(String(Math.round(value)))];
}

const KEY_STEP = 24; // pixels par appui de flèche

/**
 * Séparateur redimensionnable. `axis` : 'x' (colonne) ou 'y' (ligne).
 * Glisser à la souris/au doigt, flèches du clavier (une fois sélectionné), double-clic = taille d'origine.
 * onDrag(position) reçoit la coordonnée du pointeur ; onNudge(±1) un déplacement au clavier.
 */
function Splitter({ axis, onDrag, onNudge, onReset, label }) {
  const [dragging, setDragging] = useState(false);
  const horizontal = axis === 'y'; // ligne horizontale qui sépare haut et bas

  function handlePointerDown(event) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    document.body.classList.add(horizontal ? 'resizing-row' : 'resizing-col');
  }
  function handlePointerMove(event) {
    if (dragging) onDrag(horizontal ? event.clientY : event.clientX);
  }
  function handlePointerUp() {
    setDragging(false);
    document.body.classList.remove('resizing-col', 'resizing-row');
  }
  function handleKeyDown(event) {
    const before = horizontal ? 'ArrowUp' : 'ArrowLeft';
    const after = horizontal ? 'ArrowDown' : 'ArrowRight';
    if (event.key === before || event.key === after) {
      event.preventDefault();
      onNudge(event.key === before ? -1 : 1);
    }
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      title="Glisser pour redimensionner (double-clic : taille d'origine)"
      className={`splitter ${dragging ? 'dragging' : ''} ${
        horizontal ? 'splitter-row h-1.5 cursor-row-resize' : 'splitter-col w-1.5 cursor-col-resize'
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
    />
  );
}

const DEFAULT_SIZES = { sidebar: 340, consoleHeight: 260, consoleWidth: 420 };

export default function App() {
  const [theme, setTheme] = usePersistentState('pystudio.theme', 'dark');
  const [code, setCode] = usePersistentState('pystudio.code', DEFAULT_CODE);
  const [breakpoints, setBreakpoints] = useState([]);
  const [samples, setSamples] = useState([]);
  const [sidebarWidth, setSidebarWidth] = usePersistentNumber('pystudio.sidebarWidth', DEFAULT_SIZES.sidebar);
  const [consoleHeight, setConsoleHeight] = usePersistentNumber('pystudio.consoleHeight', DEFAULT_SIZES.consoleHeight);
  const [consoleWidth, setConsoleWidth] = usePersistentNumber('pystudio.consoleWidth', DEFAULT_SIZES.consoleWidth);
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
  // Tailles minimales volontairement petites : on peut presque masquer un panneau.
  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
  const sideBySide = consoleLayout === 'right';

  const resizeSidebar = (width) => {
    const rect = workspaceRef.current.getBoundingClientRect();
    setSidebarWidth(clamp(width, 120, rect.width - 160));
  };
  const resizeConsole = (size) => {
    const rect = columnRef.current.getBoundingClientRect();
    if (sideBySide) setConsoleWidth(clamp(size, 120, rect.width - 120));
    else setConsoleHeight(clamp(size, 40, rect.height - 80));
  };

  const dragSidebar = (clientX) => resizeSidebar(workspaceRef.current.getBoundingClientRect().right - clientX);
  const dragConsole = (position) => {
    const rect = columnRef.current.getBoundingClientRect();
    resizeConsole(sideBySide ? rect.right - position : rect.bottom - position);
  };
  // Clavier : déplacer le séparateur vers le début (-1) ou la fin (+1) ; le panneau suit en sens inverse.
  const nudgeSidebar = (direction) => resizeSidebar(sidebarWidth - direction * KEY_STEP);
  const nudgeConsole = (direction) =>
    resizeConsole((sideBySide ? consoleWidth : consoleHeight) - direction * KEY_STEP);
  const resetConsole = () =>
    resizeConsole(sideBySide ? DEFAULT_SIZES.consoleWidth : DEFAULT_SIZES.consoleHeight);

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

          <Splitter
            axis={sideBySide ? 'x' : 'y'}
            label="Séparateur entre le code et la console"
            onDrag={dragConsole}
            onNudge={nudgeConsole}
            onReset={resetConsole}
          />

          <section
            style={sideBySide ? { width: consoleWidth, maxWidth: '90%' } : { height: consoleHeight, maxHeight: '90%' }}
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

        <Splitter
          axis="x"
          label="Séparateur entre le code et le panneau Variables"
          onDrag={dragSidebar}
          onNudge={nudgeSidebar}
          onReset={() => resizeSidebar(DEFAULT_SIZES.sidebar)}
        />

        {/* Colonne droite : variables */}
        <aside style={{ width: sidebarWidth, maxWidth: '70%' }} className="hidden shrink-0 overflow-hidden md:block">
          <VariablesPanel snapshot={runner.snapshot} status={status} onEditVariable={runner.editVariable} />
        </aside>
      </div>
    </div>
  );
}
