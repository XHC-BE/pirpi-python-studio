import { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import '../lib/monacoSetup.js';

const OPTIONS = {
  fontSize: 15,
  fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, 'DejaVu Sans Mono', monospace",
  fontLigatures: true,
  glyphMargin: true, // marge de gauche : points d'arrêt
  lineNumbersMinChars: 3,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 4,
  insertSpaces: true,
  detectIndentation: false,
  wordBasedSuggestions: 'off', // remplacé par notre fournisseur Python
  quickSuggestions: { other: true, comments: false, strings: false },
  suggestOnTriggerCharacters: true,
  snippetSuggestions: 'inline',
  bracketPairColorization: { enabled: true },
  renderLineHighlight: 'line',
  smoothScrolling: true,
  padding: { top: 10, bottom: 10 },
  fixedOverflowWidgets: true,
  readOnlyMessage: { value: 'Arrêtez le programme pour modifier le code.' },
};

const sameLines = (a, b) => a.length === b.length && a.every((line, i) => line === b[i]);

/**
 * Éditeur Monaco avec points d'arrêt (clic dans la marge), ligne courante du
 * débogueur et marqueur d'erreur.
 *
 * Les points d'arrêt sont des « décorations » Monaco : elles suivent
 * automatiquement les lignes quand l'étudiant insère ou supprime du texte.
 */
export default function CodeEditor({
  value,
  onChange,
  breakpoints,
  onBreakpointsChange,
  currentLine,
  errorInfo,
  readOnly,
  theme,
}) {
  const [ready, setReady] = useState(false);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const bpDecorations = useRef(null);
  const execDecorations = useRef(null);
  const hoverDecorations = useRef(null);
  const latest = useRef({});
  latest.current = { breakpoints, onBreakpointsChange };

  const bpLines = () =>
    [...new Set(bpDecorations.current.getRanges().map((r) => r.startLineNumber))].sort((a, b) => a - b);

  function handleMount(editor, monaco) {
    editorRef.current = editor;
    monacoRef.current = monaco;
    bpDecorations.current = editor.createDecorationsCollection([]);
    execDecorations.current = editor.createDecorationsCollection([]);
    hoverDecorations.current = editor.createDecorationsCollection([]);

    const { GUTTER_GLYPH_MARGIN, GUTTER_LINE_NUMBERS } = monaco.editor.MouseTargetType;

    editor.onMouseDown((event) => {
      const type = event.target.type;
      if (type !== GUTTER_GLYPH_MARGIN && type !== GUTTER_LINE_NUMBERS) return;
      const line = event.target.position?.lineNumber;
      if (!line) return;
      const { breakpoints: current, onBreakpointsChange: notify } = latest.current;
      const next = current.includes(line)
        ? current.filter((l) => l !== line)
        : [...current, line].sort((a, b) => a - b);
      notify(next);
    });

    // Pastille grisée au survol de la marge : indique où cliquer.
    editor.onMouseMove((event) => {
      const inGlyph = event.target.type === GUTTER_GLYPH_MARGIN;
      const line = event.target.position?.lineNumber;
      if (inGlyph && line && !latest.current.breakpoints.includes(line)) {
        hoverDecorations.current.set([
          { range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: 'bp-glyph-hover' } },
        ]);
      } else {
        hoverDecorations.current.clear();
      }
    });
    editor.onMouseLeave(() => hoverDecorations.current.clear());

    // Après une modification du texte, les décorations ont bougé : on remonte les nouvelles lignes.
    // (setTimeout : laisse d'abord les effets React appliquer un éventuel changement externe.)
    editor.onDidChangeModelContent(() => {
      setTimeout(() => {
        if (!bpDecorations.current) return;
        const lines = bpLines();
        if (!sameLines(lines, latest.current.breakpoints)) latest.current.onBreakpointsChange(lines);
      }, 0);
    });

    setReady(true);
  }

  // Props → décorations des points d'arrêt
  useEffect(() => {
    if (!ready) return;
    if (sameLines(bpLines(), breakpoints)) return;
    const monaco = monacoRef.current;
    bpDecorations.current.set(
      breakpoints.map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: 'bp-line',
          glyphMarginClassName: 'bp-glyph',
          glyphMarginHoverMessage: { value: "Point d'arrêt — cliquez pour le retirer" },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      })),
    );
  }, [breakpoints, ready]);

  // Ligne en cours d'exécution + ligne en erreur
  useEffect(() => {
    if (!ready) return;
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    const model = editor.getModel();
    const decorations = [];

    if (errorInfo && errorInfo.line <= model.getLineCount()) {
      decorations.push({
        range: new monaco.Range(errorInfo.line, 1, errorInfo.line, 1),
        options: { isWholeLine: true, className: 'run-error-line', glyphMarginClassName: 'error-glyph' },
      });
      monaco.editor.setModelMarkers(model, 'python-run', [
        {
          severity: monaco.MarkerSeverity.Error,
          message: errorInfo.message,
          startLineNumber: errorInfo.line,
          startColumn: 1,
          endLineNumber: errorInfo.line,
          endColumn: model.getLineMaxColumn(errorInfo.line),
        },
      ]);
    } else {
      monaco.editor.setModelMarkers(model, 'python-run', []);
    }

    if (currentLine && currentLine <= model.getLineCount()) {
      decorations.push({
        range: new monaco.Range(currentLine, 1, currentLine, 1),
        options: { isWholeLine: true, className: 'exec-line', glyphMarginClassName: 'current-arrow' },
      });
      editor.revealLineInCenterIfOutsideViewport(currentLine);
    }
    execDecorations.current.set(decorations);
  }, [currentLine, errorInfo, ready]);

  return (
    <Editor
      height="100%"
      language="python"
      path="main.py"
      theme={theme === 'light' ? 'vs' : 'vs-dark'}
      value={value}
      onChange={(next) => onChange(next ?? '')}
      onMount={handleMount}
      options={{ ...OPTIONS, readOnly }}
      loading={<div className="p-4 text-sm text-ide-muted">Chargement de l'éditeur…</div>}
    />
  );
}
