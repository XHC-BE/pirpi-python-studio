import { useState } from 'react';

const STATUS_HINT = {
  loading: 'Python est en cours de chargement…',
  idle: 'Aucune variable. Lancez le programme, ou utilisez « Étape suivante » pour l’exécuter ligne par ligne.',
  running: 'Le programme démarre…',
  paused: 'Aucune variable à afficher.',
  fatal: 'Python est indisponible.',
};

function VariableRow({ variable, changed, onCommit }) {
  const [draft, setDraft] = useState(null); // null = pas en cours d'édition
  // Fonctions, classes et objets (« <… object at …> ») ne s'écrivent pas comme une expression.
  const editable = onCommit && !variable.value.startsWith('<');

  const commit = () => {
    const expr = draft.trim();
    setDraft(null);
    if (expr !== '' && expr !== variable.value) onCommit(variable.name, expr);
  };

  return (
    <tr className={changed ? 'var-changed' : ''}>
      <td className="whitespace-nowrap py-1 pl-3 pr-2 align-top font-mono text-ide-var">{variable.name}</td>
      <td className="whitespace-nowrap px-2 py-1 align-top font-mono text-xs text-ide-type">{variable.type}</td>
      <td
        className="max-w-0 break-all py-1 pl-2 pr-3 align-top font-mono"
        title={editable ? `${variable.value}\n(double-clic pour modifier)` : variable.value}
        onDoubleClick={editable ? () => setDraft(variable.value) : undefined}
      >
        {draft === null ? (
          <span className="line-clamp-3">{variable.value}</span>
        ) : (
          <input
            autoFocus
            value={draft}
            maxLength={2000}
            spellCheck={false}
            aria-label={`Nouvelle valeur de ${variable.name}`}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => event.target.select()}
            onBlur={() => setDraft(null)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
              else if (event.key === 'Escape') setDraft(null);
              event.stopPropagation(); // pas de raccourcis de l'éditeur pendant la saisie
            }}
            className="w-full rounded border border-ide-border bg-ide-hover px-1 py-0.5 font-mono text-ide-fg outline-none focus:border-ide-var"
          />
        )}
      </td>
    </tr>
  );
}

/**
 * Panneau « Variables » : pile d'appels + variables locales/globales.
 * Pendant l'exécution les valeurs se rafraîchissent en direct ; en pause,
 * les variables modifiées par la dernière instruction sont mises en surbrillance.
 */
export default function VariablesPanel({ snapshot, status, onEditVariable }) {
  const stack = status === 'paused' ? snapshot?.stack ?? [] : [];
  const canEdit = status === 'paused' && !snapshot?.final && Boolean(onEditVariable);
  // Frame sélectionnée dans la pile ; revient à la frame courante à chaque nouvel arrêt
  // (pas après une modification de variable : `pause` ne change pas).
  const [selection, setSelection] = useState({ pause: null, index: 0 });
  const selected = selection.pause === snapshot?.pause && selection.index < stack.length ? selection.index : 0;

  let scopes = snapshot?.scopes ?? [];
  if (selected > 0) {
    const frame = stack[selected];
    const globals = scopes.find((scope) => scope.title === 'Variables globales');
    scopes = [
      ...(frame.vars ? [{ title: `Variables locales · ${frame.name}`, vars: frame.vars }] : []),
      ...(globals ? [globals] : []),
    ];
  }
  const hasVars = scopes.some((scope) => scope.vars.length > 0);

  return (
    <div className="flex h-full min-h-0 flex-col bg-ide-panel">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-ide-border px-3 text-xs font-semibold uppercase tracking-wide text-ide-muted">
        <span>Variables</span>
        {snapshot?.final && <span className="rounded bg-ide-hover px-1.5 py-0.5 normal-case">état final</span>}
        {status === 'running' && !snapshot?.final && (
          <span className="flex items-center gap-1 normal-case text-ide-run">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ide-run" /> en direct
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto text-sm">
        {snapshot?.editError && status === 'paused' && (
          <p role="alert" className="border-b border-ide-border px-3 py-1.5 font-mono text-xs text-red-400">
            Modification refusée — {snapshot.editError}
          </p>
        )}
        {stack.length > 0 && (
          <section className="border-b border-ide-border">
            <h3 className="px-3 py-1.5 text-xs font-semibold text-ide-muted">Pile d'appels</h3>
            <ol className="pb-2 font-mono text-xs">
              {stack.map((frame, index) => {
                const args = frame.args?.map((arg) => `${arg.name}=${arg.value}`).join(', ');
                const label = args !== undefined && frame.name.endsWith('()') ? `${frame.name.slice(0, -2)}(${args})` : frame.name;
                return (
                  <li key={index}>
                    <button
                      type="button"
                      onClick={() => setSelection({ pause: snapshot.pause, index })}
                      aria-current={index === selected}
                      title={`${label}\nligne ${frame.line}`}
                      className={`block w-full px-3 py-1 text-left hover:bg-ide-hover ${
                        index === selected ? 'bg-ide-hover text-ide-fg' : 'text-ide-muted'
                      }`}
                    >
                      <span className="flex justify-between gap-2">
                        <span className="truncate">
                          {index === 0 ? '▶ ' : '  '}
                          {label}
                        </span>
                        <span className="shrink-0">ligne {frame.line}</span>
                      </span>
                      {frame.source && <span className="block truncate pl-4 text-ide-type">{frame.source}</span>}
                    </button>
                  </li>
                );
              })}
              {snapshot.stackOmitted > 0 && (
                <li className="px-3 py-0.5 text-ide-muted">… {snapshot.stackOmitted} appels plus anciens non affichés</li>
              )}
            </ol>
          </section>
        )}

        {!hasVars && (
          <p className="px-4 py-6 text-center text-sm text-ide-muted">
            {snapshot ? 'Le programme ne définit encore aucune variable.' : STATUS_HINT[status]}
          </p>
        )}

        {scopes.map(
          (scope) =>
            scope.vars.length > 0 && (
              <section key={scope.title} className="border-b border-ide-border pb-1">
                <h3 className="px-3 py-1.5 text-xs font-semibold text-ide-muted">{scope.title}</h3>
                <table className="w-full table-fixed border-collapse text-sm">
                  <colgroup>
                    <col className="w-[28%]" />
                    <col className="w-[22%]" />
                    <col />
                  </colgroup>
                  <thead>
                    <tr className="text-left text-xs text-ide-muted">
                      <th className="py-0.5 pl-3 pr-2 font-normal">Nom</th>
                      <th className="px-2 py-0.5 font-normal">Type</th>
                      <th className="py-0.5 pl-2 pr-3 font-normal">Valeur</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scope.vars.map((variable) => {
                      const changed = selected === 0 && snapshot.changed?.has(`${scope.title}\u0000${variable.name}`);
                      return (
                        <VariableRow
                          // La clé change à chaque modification : l'animation de surbrillance se rejoue.
                          key={changed ? `${variable.name}:${snapshot.sequence}` : variable.name}
                          variable={variable}
                          changed={changed}
                          onCommit={
                            canEdit
                              ? (name, expr) =>
                                  onEditVariable({
                                    frame: selected,
                                    scope: scope.title === 'Variables globales' ? 'global' : 'local',
                                    name,
                                    expr,
                                  })
                              : undefined
                          }
                        />
                      );
                    })}
                  </tbody>
                </table>
              </section>
            ),
        )}
      </div>
    </div>
  );
}
