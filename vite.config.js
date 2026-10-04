import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// SharedArrayBuffer (nécessaire au débogueur pas à pas et à input()) exige
// une page « cross-origin isolated » : ces deux en-têtes sont obligatoires.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig(({ mode }) => ({
  // Chemins relatifs : le build fonctionne à la racine d'un domaine
  // comme dans un sous-dossier (GitHub Pages : user.github.io/repo/).
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    // Mode « classe » (npm run dev:classe) : HTTPS avec certificat auto-signé,
    // pour que les postes du réseau puissent utiliser SharedArrayBuffer.
    ...(mode === 'lan' ? [basicSsl()] : []),
  ],
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 8000 },
}));
