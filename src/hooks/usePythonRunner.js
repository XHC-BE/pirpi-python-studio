import { useCallback, useEffect, useRef, useState } from 'react';
import { PYODIDE_INDEX_URL } from '../lib/config.js';
import {
  CMD,
  CTRL,
  INPUT_CAPACITY,
  STREAM,
  createSharedBuffer,
  createViews,
  sendSignal,
  writeBreakpoints,
} from '../lib/protocol.js';

/** Délai laissé à Python pour s'arrêter proprement avant de redémarrer le worker. */
const STOP_GRACE_MS = 1500;
/** Délai d'attente de l'isolation cross-origin (le service worker recharge la page). */
const ISOLATION_WAIT_MS = 4000;

/**
 * États : loading → idle ⇄ running ⇄ paused ; fatal si Python est inutilisable.
 *
 * @param {object}   options
 * @param {object}   options.terminalRef  ref vers l'API impérative du Terminal
 * @param {number[]} options.breakpoints  lignes (base 1) des points d'arrêt
 */
export function usePythonRunner({ terminalRef, breakpoints }) {
  const [status, setStatus] = useState('loading');
  const [loadingText, setLoadingText] = useState('Chargement de Python…');
  const [fatalError, setFatalError] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [currentLine, setCurrentLine] = useState(null);
  const [errorInfo, setErrorInfo] = useState(null);

  const statusRef = useRef('loading');
  const workerRef = useRef(null);
  const viewsRef = useRef(null);
  const stopTimerRef = useRef(null);
  const breakpointsRef = useRef(breakpoints);
  const lastSnapshotRef = useRef(null);
  const sequenceRef = useRef(0);

  const changeStatus = useCallback((next) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const term = () => terminalRef.current;

  /** Enregistre un instantané ; calcule les variables modifiées si on est en pause. */
  const applySnapshot = useCallback((raw, { highlight }) => {
    const data = JSON.parse(raw);
    const previous = new Map();
    for (const scope of lastSnapshotRef.current?.scopes ?? []) {
      for (const v of scope.vars) previous.set(`${scope.title}\u0000${v.name}`, v.value);
    }
    const changed = new Set();
    if (highlight) {
      for (const scope of data.scopes) {
        for (const v of scope.vars) {
          const key = `${scope.title}\u0000${v.name}`;
          if (previous.get(key) !== v.value) changed.add(key);
        }
      }
    }
    lastSnapshotRef.current = data;
    sequenceRef.current += 1;
    setSnapshot({ ...data, changed, sequence: sequenceRef.current });
  }, []);

  const handleMessage = useCallback(
    (event) => {
      const message = event.data;
      switch (message.type) {
        case 'loading':
          setLoadingText(message.text);
          break;

        case 'ready':
          changeStatus('idle');
          break;

        case 'output':
          for (const { kind, text } of message.chunks) term()?.write(text, kind);
          break;

        case 'snapshot':
          applySnapshot(message.data, { highlight: false });
          break;

        case 'paused': {
          applySnapshot(message.data, { highlight: true });
          const line = JSON.parse(message.data).line;
          setCurrentLine(line);
          changeStatus('paused');
          break;
        }

        case 'input-request':
          term()?.beginInput();
          break;

        case 'done':
          clearTimeout(stopTimerRef.current);
          term()?.endInput();
          setCurrentLine(null);
          if (message.status === 'error' && message.line) {
            setErrorInfo({ line: message.line, message: message.message ?? 'Erreur' });
          }
          changeStatus('idle');
          break;

        case 'fatal':
          setFatalError(message.message);
          changeStatus('fatal');
          break;

        default:
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applySnapshot, changeStatus],
  );

  /** Crée (ou recrée) le worker Pyodide avec un nouveau buffer partagé. */
  const startWorker = useCallback(() => {
    workerRef.current?.terminate();
    clearTimeout(stopTimerRef.current);

    const buffer = createSharedBuffer();
    viewsRef.current = createViews(buffer);
    writeBreakpoints(viewsRef.current, breakpointsRef.current);

    const worker = new Worker(new URL('../workers/python.worker.js', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = handleMessage;
    worker.onerror = (event) => {
      setFatalError(event.message || 'Erreur inconnue dans le worker Python.');
      changeStatus('fatal');
    };
    workerRef.current = worker;

    setLoadingText('Chargement de Python…');
    changeStatus('loading');
    worker.postMessage({ type: 'init', buffer, indexURL: PYODIDE_INDEX_URL });
  }, [changeStatus, handleMessage]);

  // Démarrage : vérifie l'isolation cross-origin puis lance le worker.
  useEffect(() => {
    let timer;
    if (window.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined') {
      startWorker();
    } else {
      // Le service worker (GitHub Pages) recharge la page au premier chargement :
      // on attend un peu avant de déclarer l'échec.
      setLoadingText('Initialisation de la page sécurisée…');
      timer = setTimeout(() => {
        setFatalError(
          window.isSecureContext
            ? "Le navigateur n'autorise pas SharedArrayBuffer : les en-têtes COOP/COEP sont absents. Voir la section « Hébergement » du README."
            : 'La page doit être servie en HTTPS (ou sur localhost) pour que le débogueur fonctionne.',
        );
        changeStatus('fatal');
      }, ISOLATION_WAIT_MS);
    }
    return () => {
      clearTimeout(timer);
      clearTimeout(stopTimerRef.current);
      workerRef.current?.terminate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Les points d'arrêt sont recopiés dans la mémoire partagée : pris en compte en direct.
  useEffect(() => {
    breakpointsRef.current = breakpoints;
    if (viewsRef.current) writeBreakpoints(viewsRef.current, breakpoints);
  }, [breakpoints]);

  // ---- Commandes -----------------------------------------------------------

  const startProgram = useCallback(
    (code, mode) => {
      if (statusRef.current !== 'idle') return;
      term()?.clear();
      setErrorInfo(null);
      setSnapshot(null);
      lastSnapshotRef.current = null;
      setCurrentLine(null);
      changeStatus('running');
      workerRef.current.postMessage({ type: 'run', code, mode });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [changeStatus],
  );

  const resume = useCallback(
    (command) => {
      if (statusRef.current !== 'paused') return;
      setCurrentLine(null);
      changeStatus('running');
      sendSignal(viewsRef.current, command);
    },
    [changeStatus],
  );

  /** Exécuter : lance le programme jusqu'au prochain point d'arrêt. */
  const run = useCallback((code) => startProgram(code, 'run'), [startProgram]);

  /** Étape suivante : démarre en pause sur la 1re ligne, ou avance d'une ligne. */
  const stepOver = useCallback(
    (code) => {
      if (statusRef.current === 'idle') startProgram(code, 'step');
      else resume(CMD.OVER);
    },
    [resume, startProgram],
  );

  const stepInto = useCallback(() => resume(CMD.INTO), [resume]);
  const stepOut = useCallback(() => resume(CMD.OUT), [resume]);
  const continueRun = useCallback(() => resume(CMD.CONTINUE), [resume]);

  /** Arrêter : interruption douce, puis redémarrage du worker si Python ne répond pas. */
  const stop = useCallback(() => {
    const current = statusRef.current;
    if (current !== 'running' && current !== 'paused') return;
    const views = viewsRef.current;

    Atomics.store(views.control, CTRL.STOP_FLAG, 1); // réveille input() / pause
    views.interrupt[0] = 2; // SIGINT → KeyboardInterrupt, même dans « while True: pass »
    sendSignal(views, CMD.STOP);
    term()?.endInput();

    clearTimeout(stopTimerRef.current);
    stopTimerRef.current = setTimeout(() => {
      // Python ne répond plus (ex. « except: » qui avale l'interruption) : on repart de zéro.
      term()?.write('\nProgramme arrêté (interpréteur redémarré).\n', STREAM.ERR);
      setCurrentLine(null);
      startWorker();
    }, STOP_GRACE_MS);
  }, [startWorker]);

  /** Appelé par la console quand l'étudiant valide une saisie (text) ou fait Ctrl+D (null). */
  const submitInput = useCallback((text) => {
    const views = viewsRef.current;
    if (!views) return;
    if (text === null) {
      sendSignal(views, CMD.EOF);
      return;
    }
    const bytes = new TextEncoder().encode(text);
    const length = Math.min(bytes.length, INPUT_CAPACITY);
    views.input.set(bytes.subarray(0, length));
    Atomics.store(views.control, CTRL.INPUT_LEN, length);
    sendSignal(views, CMD.INPUT);
  }, []);

  const clearError = useCallback(() => setErrorInfo(null), []);

  return {
    status,
    loadingText,
    fatalError,
    snapshot,
    currentLine,
    errorInfo,
    run,
    stepOver,
    stepInto,
    stepOut,
    continueRun,
    stop,
    submitInput,
    clearError,
  };
}
