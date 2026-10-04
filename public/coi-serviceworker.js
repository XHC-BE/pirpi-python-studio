/*
 * coi-serviceworker — active l'isolation « cross-origin » (COOP/COEP) sur les
 * hébergeurs statiques qui n'autorisent pas les en-têtes personnalisés
 * (ex. GitHub Pages). Sans elle, SharedArrayBuffer est indisponible.
 *
 * Fonctionnement :
 *  - dans la page : enregistre ce même fichier comme Service Worker puis
 *    recharge la page une fois ;
 *  - dans le Service Worker : ajoute les en-têtes COOP/COEP à chaque réponse.
 *
 * Inspiré de https://github.com/gzuidhof/coi-serviceworker (licence MIT).
 */
if (typeof window === 'undefined') {
  // ---- Contexte Service Worker ----
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

  self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 0) return response; // réponse opaque : on ne touche à rien
          const headers = new Headers(response.headers);
          headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
          headers.set('Cross-Origin-Opener-Policy', 'same-origin');
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        })
        .catch((error) => {
          console.error('[coi-serviceworker]', error);
          return Response.error();
        }),
    );
  });
} else {
  // ---- Contexte page ----
  (() => {
    if (window.crossOriginIsolated !== false) return; // déjà isolée (ou non supporté)
    if (!window.isSecureContext) {
      console.warn('[coi-serviceworker] Contexte non sécurisé (HTTPS requis) : isolation impossible.');
      return;
    }
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register(window.document.currentScript.src)
      .then((registration) => {
        registration.addEventListener('updatefound', () => window.location.reload());
        // Premier chargement : le SW est actif mais ne contrôle pas encore la page.
        if (registration.active && !navigator.serviceWorker.controller) {
          window.location.reload();
        }
      })
      .catch((error) => console.error('[coi-serviceworker] Échec de l\'enregistrement :', error));
  })();
}
