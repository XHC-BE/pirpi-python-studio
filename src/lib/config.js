/**
 * Emplacement de Pyodide (l'interpréteur Python compilé en WebAssembly).
 *
 * Par défaut il est téléchargé depuis le CDN jsDelivr (gratuit, mis en cache
 * par le navigateur). Pour un déploiement 100 % hors-ligne / intranet,
 * copiez les fichiers de Pyodide dans public/pyodide/ et définissez
 * VITE_PYODIDE_URL=./pyodide/ (voir README).
 */
export const PYODIDE_VERSION = '0.27.7';

const custom = import.meta.env.VITE_PYODIDE_URL;

export const PYODIDE_INDEX_URL = custom
  ? new URL(custom.endsWith('/') ? custom : `${custom}/`, document.baseURI).href
  : `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
