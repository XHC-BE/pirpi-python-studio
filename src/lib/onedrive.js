/**
 * Accès à OneDrive (compte Microsoft 365 Éducation) via Microsoft Graph.
 *
 * Connexion : flux OAuth « code + PKCE » par REDIRECTION (MSAL).
 * Les fenêtres pop-up ne sont pas utilisées : l'en-tête COOP « same-origin »
 * (nécessaire pour SharedArrayBuffer) casse la communication avec elles.
 *
 * Configuration (voir README, section « OneDrive ») :
 *   VITE_MSAL_CLIENT_ID  identifiant de l'application enregistrée dans Microsoft Entra ID
 *   VITE_MSAL_AUTHORITY  facultatif : https://login.microsoftonline.com/<ID-du-locataire>
 *                        (par défaut : tout compte scolaire/professionnel)
 */
import { InteractionRequiredAuthError, PublicClientApplication } from '@azure/msal-browser';

const CLIENT_ID = import.meta.env.VITE_MSAL_CLIENT_ID;
const AUTHORITY = import.meta.env.VITE_MSAL_AUTHORITY || 'https://login.microsoftonline.com/organizations';

export const isOneDriveConfigured = Boolean(CLIENT_ID);

const SCOPES = ['User.Read', 'Files.ReadWrite'];
const GRAPH = 'https://graph.microsoft.com/v1.0';
const PENDING_KEY = 'pystudio.onedrive.pending';

/** Levée quand l'utilisateur doit (re)faire la connexion. */
export class AuthRequiredError extends Error {
  constructor() {
    super('Connexion à OneDrive requise.');
    this.name = 'AuthRequiredError';
  }
}

/** Adresse de retour après connexion : le dossier de l'application (à déclarer dans Azure). */
export const redirectUri = () => new URL('./', document.baseURI).href;

let msalPromise = null;
function getMsal() {
  if (!msalPromise) {
    const app = new PublicClientApplication({
      auth: {
        clientId: CLIENT_ID,
        authority: AUTHORITY,
        redirectUri: redirectUri(),
        postLogoutRedirectUri: redirectUri(),
        navigateToLoginRequestUrl: false,
      },
      cache: { cacheLocation: 'localStorage' },
    });
    msalPromise = app.initialize().then(() => app);
  }
  return msalPromise;
}

function currentAccount(app) {
  return app.getActiveAccount() ?? app.getAllAccounts()[0] ?? null;
}

/**
 * À appeler au démarrage : termine une connexion par redirection éventuelle.
 * Renvoie { account, pending, error } — `pending` = action à reprendre ('open' | 'save').
 */
export async function initOneDrive() {
  const app = await getMsal();
  let error = null;
  try {
    const result = await app.handleRedirectPromise();
    if (result?.account) app.setActiveAccount(result.account);
  } catch (e) {
    error = e;
  }
  const account = currentAccount(app);
  if (account) app.setActiveAccount(account);
  const pending = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  return { account, pending: account ? pending : null, error };
}

export async function getAccount() {
  return currentAccount(await getMsal());
}

/** Redirige vers la page de connexion Microsoft ; `pending` sera repris au retour. */
export async function signIn(pending) {
  const app = await getMsal();
  sessionStorage.setItem(PENDING_KEY, pending);
  await app.loginRedirect({ scopes: SCOPES, prompt: 'select_account' });
}

export async function signOut() {
  const app = await getMsal();
  await app.logoutRedirect({ account: currentAccount(app) });
}

async function getToken() {
  const app = await getMsal();
  const account = currentAccount(app);
  if (!account) throw new AuthRequiredError();
  try {
    return (await app.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
  } catch (error) {
    const needsLogin =
      error instanceof InteractionRequiredAuthError ||
      ['monitor_window_timeout', 'no_tokens_found', 'token_refresh_required', 'invalid_grant'].includes(error?.errorCode);
    if (needsLogin) throw new AuthRequiredError();
    throw error;
  }
}

async function graph(path, options = {}) {
  const token = await getToken();
  const response = await fetch(path.startsWith('http') ? path : GRAPH + path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  if (response.status === 401) throw new AuthRequiredError();
  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.json()).error?.message ?? '';
    } catch {
      /* corps non JSON */
    }
    throw new Error(detail || `OneDrive : erreur HTTP ${response.status}`);
  }
  return response;
}

/** Contenu d'un dossier (null = racine) : [{ id, name, isFolder }], dossiers d'abord. */
export async function listChildren(folderId) {
  const base = folderId ? `/me/drive/items/${folderId}/children` : '/me/drive/root/children';
  let url = `${base}?$select=id,name,folder,file&$top=200`;
  const items = [];
  while (url) {
    const page = await (await graph(url)).json();
    for (const entry of page.value) items.push({ id: entry.id, name: entry.name, isFolder: Boolean(entry.folder) });
    url = page['@odata.nextLink'] ?? null;
  }
  return items.sort((a, b) => b.isFolder - a.isFolder || a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}

/** Lit un fichier texte. */
export async function readFile(id) {
  const meta = await (await graph(`/me/drive/items/${id}?$select=id,name,@microsoft.graph.downloadUrl`)).json();
  let text;
  const downloadUrl = meta['@microsoft.graph.downloadUrl'];
  if (downloadUrl) {
    try {
      const response = await fetch(downloadUrl); // lien pré-autorisé, sans jeton
      if (response.ok) text = await response.text();
    } catch {
      /* repli ci-dessous */
    }
  }
  if (text === undefined) text = await (await graph(`/me/drive/items/${id}/content`)).text();
  return { name: meta.name, text };
}

const TEXT_HEADERS = { 'Content-Type': 'text/plain; charset=utf-8' };

/** Crée (ou remplace) un fichier dans un dossier (null = racine). Renvoie { id, name }. */
export async function createFile(parentId, name, text) {
  const target = parentId ? `/me/drive/items/${parentId}:/${encodeURIComponent(name)}:` : `/me/drive/root:/${encodeURIComponent(name)}:`;
  const item = await (
    await graph(`${target}/content?@microsoft.graph.conflictBehavior=replace`, {
      method: 'PUT',
      headers: TEXT_HEADERS,
      body: text,
    })
  ).json();
  return { id: item.id, name: item.name };
}

/** Met à jour le contenu d'un fichier existant. */
export async function updateFile(id, text) {
  await graph(`/me/drive/items/${id}/content`, { method: 'PUT', headers: TEXT_HEADERS, body: text });
}
