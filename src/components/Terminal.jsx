import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { STREAM } from '../lib/protocol.js';

const THEMES = {
  dark: {
    background: '#1e1e1e',
    foreground: '#cccccc',
    cursor: '#aeafad',
    selectionBackground: '#264f78',
    brightBlack: '#8c8c8c',
  },
  light: {
    background: '#ffffff',
    foreground: '#333333',
    cursor: '#333333',
    selectionBackground: '#add6ff',
    red: '#cd3131',
    brightBlack: '#7a7a7a',
  },
};

const RED = '\x1b[31m';
const GREY = '\x1b[90m';
const RESET = '\x1b[0m';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

/**
 * Console xterm.js. Affiche stdout/stderr et gère la saisie pour input().
 *
 * API impérative (ref) : write(text, kind), clear(), beginInput(), endInput().
 * Callbacks : onSubmit(text | null) — null = Ctrl+D (fin de fichier) —, onInterrupt() pour Ctrl+C.
 */
const Terminal = forwardRef(function Terminal({ theme, onSubmit, onInterrupt }, ref) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const input = useRef({ awaiting: false, buffer: '', pending: '' });
  const callbacks = useRef({});
  callbacks.current = { onSubmit, onInterrupt };

  useEffect(() => {
    const term = new XTerm({
      fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, 'DejaVu Sans Mono', monospace",
      fontSize: 14,
      cursorBlink: true,
      convertEol: false,
      scrollback: 5000,
      theme: THEMES[document.documentElement.dataset.theme] ?? THEMES.dark,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    termRef.current = term;

    const safeFit = () => {
      try {
        fit.fit();
      } catch {
        /* conteneur masqué ou de taille nulle */
      }
    };
    safeFit();
    const observer = new ResizeObserver(() => requestAnimationFrame(safeFit));
    observer.observe(containerRef.current);

    term.write(`${HIDE_CURSOR}${GREY}Console Python — lancez un programme avec « Exécuter ».${RESET}\r\n`);

    // Ctrl+C avec une sélection = copier ; sans sélection = interrompre le programme.
    term.attachCustomKeyEventHandler((event) => {
      const isCopy = event.type === 'keydown' && (event.ctrlKey || event.metaKey) && event.key === 'c';
      return !(isCopy && term.hasSelection());
    });

    term.onData((data) => handleData(data));

    return () => {
      observer.disconnect();
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = THEMES[theme] ?? THEMES.dark;
  }, [theme]);

  function handleData(data) {
    const term = termRef.current;
    const state = input.current;
    if (!term) return;
    if (data.charCodeAt(0) === 0x1b) return; // flèches, touches de fonction… ignorées

    const chars = Array.from(data); // gère correctement emojis / caractères hors BMP
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];

      if (ch === '\x03') {
        // Ctrl+C
        if (state.awaiting) term.write(`^C\r\n${HIDE_CURSOR}`);
        state.awaiting = false;
        state.buffer = '';
        state.pending = '';
        callbacks.current.onInterrupt?.();
        return;
      }
      if (!state.awaiting) {
        // Frappe anticipée : mise en attente (comme un vrai terminal), rejouée au prochain input().
        if (ch === '\x7f' || ch === '\b') state.pending = Array.from(state.pending).slice(0, -1).join('');
        else if (ch === '\r' || ch === '\n' || ch >= ' ') state.pending += ch;
        continue;
      }

      if (ch === '\r' || ch === '\n') {
        const text = state.buffer;
        state.buffer = '';
        state.awaiting = false;
        term.write(`\r\n${HIDE_CURSOR}`);
        // Texte collé sur plusieurs lignes : le reste sera consommé par le prochain input().
        state.pending = chars
          .slice(i + 1)
          .join('')
          .replace(/^\n/, '');
        callbacks.current.onSubmit?.(text);
        return;
      }
      if (ch === '\x7f' || ch === '\b') {
        const typed = Array.from(state.buffer);
        if (typed.length) {
          typed.pop();
          state.buffer = typed.join('');
          term.write('\b \b');
        }
        continue;
      }
      if (ch === '\x04') {
        // Ctrl+D sur une ligne vide = fin de fichier
        if (state.buffer === '') {
          state.awaiting = false;
          term.write(`^D\r\n${HIDE_CURSOR}`);
          callbacks.current.onSubmit?.(null);
          return;
        }
        continue;
      }
      if (ch < ' ') continue; // autres caractères de contrôle
      state.buffer += ch;
      term.write(ch);
    }
  }

  useImperativeHandle(ref, () => ({
    write(text, kind = STREAM.OUT) {
      const term = termRef.current;
      if (!term) return;
      const normalized = text.replace(/\r?\n/g, '\r\n');
      if (kind === STREAM.ERR) term.write(`${RED}${normalized}${RESET}`);
      else if (kind === STREAM.INFO) term.write(`${GREY}${normalized}${RESET}`);
      else term.write(normalized);
    },

    clear() {
      const term = termRef.current;
      if (!term) return;
      input.current = { awaiting: false, buffer: '', pending: '' };
      term.reset();
      term.write(HIDE_CURSOR);
    },

    /** Le programme appelle input() : active la saisie. */
    beginInput() {
      const term = termRef.current;
      if (!term) return;
      const state = input.current;
      state.awaiting = true;
      state.buffer = '';
      term.write(SHOW_CURSOR);
      term.focus();
      if (state.pending) {
        const pending = state.pending;
        state.pending = '';
        handleData(pending);
      }
    },

    /** Fin du programme ou arrêt : désactive la saisie. */
    endInput() {
      const term = termRef.current;
      const state = input.current;
      if (state.awaiting) term?.write(`\r\n`);
      state.awaiting = false;
      state.buffer = '';
      state.pending = '';
      term?.write(HIDE_CURSOR);
    },
  }));

  return <div ref={containerRef} className="h-full w-full overflow-hidden px-2 py-1" />;
});

export default Terminal;
