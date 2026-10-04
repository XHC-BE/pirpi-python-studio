/**
 * Les exemples sont de simples fichiers .py dans public/exemples/, listés dans
 * public/exemples/index.json : [{ "title": "...", "file": "nom.py" }, ...].
 * Ils sont lus par le navigateur à la demande : on peut en ajouter ou les
 * modifier sur le serveur sans reconstruire l'application.
 */
const BASE = 'exemples/';

export const DEFAULT_CODE = `# Écrivez votre programme ici, puis cliquez sur « Exécuter » (F5).
print("Bonjour le monde !")
`;

async function fetchText(path) {
  const response = await fetch(new URL(BASE + path, document.baseURI), { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path} : HTTP ${response.status}`);
  return response.text();
}

/** Renvoie la liste [{ title, file }] ; liste vide si le fichier est absent ou invalide. */
export async function loadSampleList() {
  try {
    const list = JSON.parse(await fetchText('index.json'));
    return list.filter((s) => s && typeof s.title === 'string' && typeof s.file === 'string');
  } catch (error) {
    console.warn('Exemples indisponibles :', error);
    return [];
  }
}

export function loadSampleCode(file) {
  return fetchText(file);
}
