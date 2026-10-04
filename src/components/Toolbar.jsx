const ICONS = {
  run: <path d="M6 4l14 8-14 8z" />,
  stop: <rect x="5" y="5" width="14" height="14" rx="1.5" />,
  over: (
    <>
      <path d="M3 14a9 9 0 0 1 18 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 14v7M8.5 17.5L12 21l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  into: (
    <path d="M12 3v14M6 11l6 6 6-6M5 21h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  ),
  out: (
    <path d="M12 17V3M6 9l6-6 6 6M5 21h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  ),
  cont: (
    <>
      <path d="M5 4v16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M10 4l10 8-10 8z" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  layoutBottom: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M3 14h18" stroke="currentColor" strokeWidth="2" />
    </>
  ),
  layoutRight: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M13 4v16" stroke="currentColor" strokeWidth="2" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />,
  cloudOpen: (
    <path d="M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9.5 4.25 4.25 0 0 1 17.5 18M12 11v7m-2.5-2.5L12 18l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  ),
  cloudSave: (
    <path d="M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9.5 4.25 4.25 0 0 1 17.5 18M12 18v-7m-2.5 2.5L12 11l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  ),
  open: (
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H7l-4 8V7zM7 10h15l-3.5 9H3.5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  ),
  save: (
    <path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 3v6h8V3M7 21v-7h10v7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  ),
  saveAs: (
    <path d="M5 3h11l3 3v5M5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7M7 3v6h8V3M7 21v-7h5M17 15v6M14 18h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  ),
};

export function Icon({ name, className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

const TONES = {
  run: 'bg-ide-run/15 text-ide-run hover:bg-ide-run/25',
  stop: 'bg-ide-stop/15 text-ide-stop hover:bg-ide-stop/25',
  step: 'bg-ide-accent/15 text-ide-accent hover:bg-ide-accent/25',
  neutral: 'text-ide-fg hover:bg-ide-hover',
};

function ToolButton({ icon, label, shortcut, tone, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={`flex h-8 items-center gap-1.5 rounded px-2.5 text-sm font-medium transition-colors
        disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent ${TONES[tone]}`}
    >
      <Icon name={icon} />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

function IconButton({ icon, title, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="flex h-8 w-8 items-center justify-center rounded text-ide-fg hover:bg-ide-hover disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
    >
      <Icon name={icon} className="h-[18px] w-[18px]" />
    </button>
  );
}

const STATUS_LABEL = {
  loading: ['Chargement de Python…', 'bg-ide-accent animate-pulse'],
  idle: ['Prêt', 'bg-ide-run'],
  running: ['Exécution en cours…', 'bg-ide-run animate-pulse'],
  paused: ['En pause', 'bg-ide-warn'],
  fatal: ['Erreur', 'bg-ide-stop'],
};

export default function Toolbar({
  status,
  loadingText,
  currentLine,
  samples,
  onSample,
  onRun,
  onStop,
  onStepOver,
  onStepInto,
  onStepOut,
  onContinue,
  fileName,
  fileSource,
  oneDriveEnabled,
  onOneDriveOpen,
  onOneDriveSave,
  dirty,
  canPickFiles,
  busy,
  onOpen,
  onSave,
  onSaveAs,
  theme,
  onToggleTheme,
  consoleLayout,
  onToggleLayout,
}) {
  const idle = status === 'idle';
  const paused = status === 'paused';
  const active = status === 'running' || paused;
  const [label, dot] = STATUS_LABEL[status];

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto overflow-y-hidden border-b border-ide-border bg-ide-panel px-3">
      <div className="mr-2 flex items-center gap-2 font-semibold">
        <span className="flex h-6 w-6 items-center justify-center rounded bg-ide-accent/20 font-mono text-sm text-ide-accent">
          {'>_'}
        </span>
        <span className="hidden whitespace-nowrap lg:inline">pirpi's Python Studio</span>
      </div>

      <ToolButton icon="run" label="Exécuter" shortcut="F5 ou Ctrl+Entrée" tone="run" onClick={onRun} disabled={!idle} />
      <ToolButton icon="stop" label="Arrêter" shortcut="Maj+F5 ou Ctrl+Maj+Entrée" tone="stop" onClick={onStop} disabled={!active} />

      <span className="mx-1 h-5 w-px bg-ide-border" />

      <ToolButton
        icon="over"
        label="Étape suivante"
        shortcut="F10"
        tone="step"
        onClick={onStepOver}
        disabled={!idle && !paused}
      />
      <ToolButton icon="into" label="Entrer" shortcut="F11" tone="step" onClick={onStepInto} disabled={!paused} />
      <ToolButton icon="out" label="Sortir" shortcut="Maj+F11" tone="step" onClick={onStepOut} disabled={!paused} />
      <ToolButton icon="cont" label="Continuer" shortcut="F8" tone="step" onClick={onContinue} disabled={!paused} />

      <div className="ml-auto flex items-center gap-2">
        <span className="hidden items-center gap-2 whitespace-nowrap text-xs text-ide-muted xl:flex" aria-live="polite">
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          {status === 'loading' ? loadingText : paused && currentLine ? `En pause · ligne ${currentLine}` : label}
        </span>

        <select
          aria-label="Exemples de programmes"
          value=""
          onChange={(event) => onSample(event.target.value)}
          disabled={active}
          className="h-8 rounded border border-ide-border bg-ide-bg px-2 text-sm text-ide-fg disabled:opacity-40"
        >
          <option value="" disabled>
            Exemples…
          </option>
          {samples.map((sample) => (
            <option key={sample.file} value={sample.file}>
              {sample.title}
            </option>
          ))}
        </select>

        <span
          className="hidden max-w-40 truncate text-xs text-ide-muted xl:inline"
          title={fileName ?? 'Fichier sans nom'}
        >
          {fileSource === 'onedrive' && <span title="Fichier OneDrive">☁ </span>}
          {fileName ?? 'Sans nom'}
          {dirty && <span className="ml-1 text-ide-warn" title="Modifications non enregistrées">●</span>}
        </span>
        <div className="flex items-center">
          <IconButton
            icon="open"
            title="Ouvrir un fichier .py de cet ordinateur — Ctrl+O"
            onClick={onOpen}
            disabled={busy}
          />
          <IconButton
            icon="save"
            title={canPickFiles ? 'Enregistrer — Ctrl+S' : 'Télécharger le fichier .py — Ctrl+S'}
            onClick={onSave}
          />
          {canPickFiles && (
            <IconButton icon="saveAs" title="Enregistrer sous… (sur cet ordinateur) — Ctrl+Maj+S" onClick={onSaveAs} />
          )}
          {oneDriveEnabled && (
            <>
              <span className="mx-1 h-5 w-px bg-ide-border" />
              <IconButton icon="cloudOpen" title="Ouvrir depuis OneDrive" onClick={onOneDriveOpen} disabled={busy} />
              <IconButton icon="cloudSave" title="Enregistrer dans OneDrive" onClick={onOneDriveSave} />
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onToggleLayout}
          title={consoleLayout === 'bottom' ? 'Placer la console à droite du code' : 'Placer la console sous le code'}
          className="flex h-8 w-8 items-center justify-center rounded text-ide-fg hover:bg-ide-hover"
        >
          <Icon name={consoleLayout === 'bottom' ? 'layoutRight' : 'layoutBottom'} className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
          className="flex h-8 w-8 items-center justify-center rounded text-ide-fg hover:bg-ide-hover"
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="h-[18px] w-[18px]" />
        </button>
      </div>
    </header>
  );
}
