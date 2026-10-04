/**
 * Ouvrir / enregistrer un fichier .py sur le poste de l'utilisateur.
 *
 * Chrome et Edge : « File System Access API » — vraies boîtes de dialogue
 * Ouvrir / Enregistrer sous. L'utilisateur peut donc choisir son dossier
 * OneDrive (synchronisé par l'application OneDrive de Windows/macOS) et
 * ré-enregistrer ensuite au même endroit sans nouvelle boîte de dialogue.
 *
 * Firefox / Safari : repli sur l'envoi de fichier (<input type="file">)
 * et le téléchargement.
 */
export const hasFilePicker = typeof window !== 'undefined' && 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;

const PY_TYPES = [{ description: 'Programmes Python', accept: { 'text/x-python': ['.py'], 'text/plain': ['.txt'] } }];

const isAbort = (error) => error?.name === 'AbortError';

function pickWithInput() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.py,.txt,text/plain,text/x-python';
    input.onchange = () => resolve(input.files[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Ouvre un fichier. Renvoie { name, text, handle } ou null si l'utilisateur annule. */
export async function openFile() {
  try {
    if (hasFilePicker) {
      const [handle] = await window.showOpenFilePicker({ types: PY_TYPES, multiple: false });
      const file = await handle.getFile();
      return { name: file.name, text: await file.text(), handle };
    }
    const file = await pickWithInput();
    return file ? { name: file.name, text: await file.text(), handle: null } : null;
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
}

/**
 * Enregistre `text`. Sans `handle` (ou avec `forcePicker`), demande l'emplacement.
 * Renvoie { name, handle } ou null si l'utilisateur annule.
 */
export async function saveFile(text, { handle = null, suggestedName = 'programme.py', forcePicker = false } = {}) {
  try {
    if (hasFilePicker) {
      let target = handle;
      if (!target || forcePicker) {
        target = await window.showSaveFilePicker({ suggestedName, types: PY_TYPES });
      }
      const writable = await target.createWritable();
      await writable.write(text);
      await writable.close();
      return { name: target.name, handle: target };
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/x-python;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = suggestedName;
    link.click();
    URL.revokeObjectURL(url);
    return { name: suggestedName, handle: null };
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
}
