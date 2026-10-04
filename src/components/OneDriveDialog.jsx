import { useCallback, useEffect, useState } from 'react';
import { AuthRequiredError, getAccount, listChildren, signIn, signOut } from '../lib/onedrive.js';

const isPython = (name) => /\.(py|txt)$/i.test(name);

/**
 * Explorateur OneDrive : choisir un fichier à ouvrir (mode « open ») ou un
 * dossier + un nom de fichier (mode « save »).
 *
 * onOpen(item)            → ouvre le fichier choisi
 * onSave({parentId,name}) → enregistre dans le dossier courant (null = racine)
 * Les deux fonctions sont asynchrones : une erreur levée est affichée ici.
 */
export default function OneDriveDialog({ mode, initialName, onClose, onOpen, onSave }) {
  const [account, setAccount] = useState(undefined); // undefined = vérification en cours
  const [path, setPath] = useState([{ id: null, name: 'OneDrive' }]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [name, setName] = useState(initialName || 'programme.py');

  const folder = path[path.length - 1];

  const load = useCallback(async (folderId) => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listChildren(folderId));
    } catch (e) {
      if (e instanceof AuthRequiredError) setAccount(null);
      else setError(e.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    getAccount()
      .then(setAccount)
      .catch((e) => {
        setAccount(null);
        setError(e.message);
      });
  }, []);

  useEffect(() => {
    if (account) load(folder.id);
  }, [account, folder.id, load]);

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const run = async (action) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      if (e instanceof AuthRequiredError) setAccount(null);
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const visible = items.filter((item) => item.isFolder || (mode === 'save' ? /\.py$/i.test(item.name) : isPython(item.name)));

  const submitSave = () => {
    const finalName = /\.py$/i.test(name.trim()) ? name.trim() : `${name.trim()}.py`;
    if (!name.trim() || /[\\/:*?"<>|]/.test(finalName)) {
      setError('Nom de fichier invalide (caractères interdits : \\ / : * ? " < > |).');
      return;
    }
    const exists = items.some((item) => !item.isFolder && item.name.toLowerCase() === finalName.toLowerCase());
    if (exists && !window.confirm(`« ${finalName} » existe déjà dans ce dossier. Le remplacer ?`)) return;
    run(() => onSave({ parentId: folder.id, name: finalName }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'open' ? 'Ouvrir depuis OneDrive' : 'Enregistrer dans OneDrive'}
        className="flex max-h-full w-full max-w-lg flex-col rounded-lg border border-ide-border bg-ide-panel shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-ide-border px-4 py-3">
          <h2 className="font-semibold">{mode === 'open' ? 'Ouvrir depuis OneDrive' : 'Enregistrer dans OneDrive'}</h2>
          <button type="button" onClick={onClose} disabled={busy} className="rounded px-2 text-lg leading-none text-ide-muted hover:bg-ide-hover" aria-label="Fermer">
            ×
          </button>
        </div>

        {account === undefined && <p className="p-6 text-center text-sm text-ide-muted">Vérification de la connexion…</p>}

        {account === null && (
          <div className="flex flex-col items-center gap-3 p-6 text-center text-sm">
            <p>Connectez-vous avec votre compte scolaire Microsoft 365 pour accéder à votre OneDrive.</p>
            <p className="text-xs text-ide-muted">La page va s'ouvrir sur le site de Microsoft puis revenir ici ; votre code est conservé.</p>
            <button
              type="button"
              onClick={() => run(() => signIn(mode))}
              disabled={busy}
              className="rounded bg-ide-accent px-4 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Se connecter avec Microsoft
            </button>
            {error && <p className="text-ide-stop">{error}</p>}
          </div>
        )}

        {account && (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-ide-border px-4 py-2 text-xs text-ide-muted">
              <nav className="flex min-w-0 flex-wrap items-center gap-1" aria-label="Chemin">
                {path.map((step, index) => (
                  <span key={`${step.id}-${index}`} className="flex items-center gap-1">
                    {index > 0 && <span>/</span>}
                    <button
                      type="button"
                      disabled={index === path.length - 1}
                      onClick={() => setPath(path.slice(0, index + 1))}
                      className="max-w-40 truncate rounded px-1 hover:bg-ide-hover disabled:font-semibold disabled:text-ide-fg disabled:hover:bg-transparent"
                    >
                      {step.name}
                    </button>
                  </span>
                ))}
              </nav>
              <button type="button" onClick={() => run(signOut)} className="shrink-0 hover:text-ide-fg" title={account.username}>
                Déconnexion
              </button>
            </div>

            <ul className="h-72 min-h-0 flex-1 overflow-auto py-1 text-sm">
              {loading && <li className="px-4 py-3 text-ide-muted">Chargement…</li>}
              {!loading && visible.length === 0 && !error && (
                <li className="px-4 py-3 text-ide-muted">Aucun dossier ni fichier .py ici.</li>
              )}
              {!loading &&
                visible.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (item.isFolder) setPath([...path, { id: item.id, name: item.name }]);
                        else if (mode === 'open') run(() => onOpen(item));
                        else setName(item.name);
                      }}
                      className="flex w-full items-center gap-2 px-4 py-1.5 text-left hover:bg-ide-hover disabled:opacity-50"
                    >
                      <span aria-hidden="true">{item.isFolder ? '📁' : '🐍'}</span>
                      <span className="truncate">{item.name}</span>
                    </button>
                  </li>
                ))}
            </ul>

            {error && <p className="border-t border-ide-border px-4 py-2 text-sm text-ide-stop">{error}</p>}

            {mode === 'save' && (
              <div className="flex items-center gap-2 border-t border-ide-border px-4 py-3">
                <label htmlFor="onedrive-name" className="text-xs text-ide-muted">
                  Nom
                </label>
                <input
                  id="onedrive-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && submitSave()}
                  className="min-w-0 flex-1 rounded border border-ide-border bg-ide-bg px-2 py-1 text-sm"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={submitSave}
                  disabled={busy}
                  className="rounded bg-ide-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  Enregistrer ici
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
