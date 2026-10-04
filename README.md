# pirpi's Python Studio — IDE Python pédagogique dans le navigateur

Un mini-IDE pour l'enseignement de Python, **100 % côté navigateur** (aucun serveur d'exécution, hébergeable gratuitement) :

| Fonction | Technologie |
|---|---|
| Éditeur (coloration, auto-complétion, points d'arrêt dans la marge) | Monaco Editor |
| Exécution de Python sans bloquer l'interface | Pyodide (Python 3.12 en WebAssembly) dans un **Web Worker** |
| Console avec `print()` et saisie `input()` | xterm.js |
| Débogueur pas à pas, variables en direct | `sys.settrace` dans le worker |
| Interface sombre/claire | React + Vite + Tailwind CSS 4 |

## Fonctionnalités

- **Exécuter** (`F5`) · **Arrêter** (`Maj+F5`, interrompt même une boucle infinie) · **Étape suivante** (`F10`, *step over*) · **Continuer** (`F8`).
  Bonus pédagogiques : **Entrer** (`F11`, *step into*) et **Sortir** (`Maj+F11`, *step out*).
- **Étape suivante** sans programme lancé : démarre l'exécution en pause sur la première ligne.
- **Points d'arrêt** : clic dans la marge à gauche des numéros de ligne. Ils suivent les lignes quand on édite le code et peuvent être ajoutés/retirés **pendant** l'exécution.
- **Console** : affiche `print()`, les erreurs (en rouge, avec la ligne fautive soulignée dans l'éditeur) et capture `input()` (`Entrée` valide, `Ctrl+D` = fin de fichier, `Ctrl+C` = arrêt).
- **Variables** : nom, type et valeur des variables locales/globales, **pile d'appels**, rafraîchies en direct pendant l'exécution ; en pause, les variables qui viennent de changer clignotent. L'état final reste visible après la fin du programme.
- Console placée **sous** le code ou **à sa droite** (bouton dans la barre d'outils, choix mémorisé), séparateurs redimensionnables à la souris, au doigt ou au clavier (flèches, après avoir cliqué sur un séparateur) ; double-clic = taille d'origine ; les tailles sont mémorisées.
- **Ouvrir / Enregistrer / Enregistrer sous** (`Ctrl+O`, `Ctrl+S`, `Ctrl+Maj+S`) : sur Chrome et Edge, ce sont de vraies boîtes de dialogue. Choisissez votre dossier **OneDrive** (celui synchronisé par l'application OneDrive, ex. `C:\Users\vous\OneDrive`) : le fichier est alors dans votre OneDrive, et `Ctrl+S` le met à jour au même endroit. Sur Firefox/Safari, « Ouvrir » envoie un fichier et « Enregistrer » le télécharge.
- Exemples intégrés, sauvegarde automatique du code (localStorage), thème sombre (par défaut) / clair.
- Les paquets Pyodide importés (`numpy`, `pandas`…) sont chargés automatiquement au premier `import`.

## Lancer le projet en local

Prérequis : [Node.js](https://nodejs.org) 18 ou plus récent, et une **connexion Internet** au premier lancement
(Pyodide est téléchargé depuis le CDN jsDelivr, puis mis en cache par le navigateur ; voir plus bas pour un mode hors-ligne).

```bash
npm install
npm run dev
```

Ouvrez ensuite <http://localhost:5173>. Le message « Chargement de Python… » disparaît au bout de quelques secondes (la première fois, le premier démarrage de Vite peut aussi prendre un moment : il prépare Monaco).

Pour tester la version de production :

```bash
npm run build      # génère le dossier dist/
npm run preview    # sert dist/ sur http://localhost:4173
```

### Ajouter vos propres exemples

Le menu « Exemples… » lit les fichiers du dossier `public/exemples/` :

1. déposez votre fichier `mon_exercice.py` dans ce dossier ;
2. ajoutez une ligne dans `public/exemples/index.json` : `{ "title": "Mon exercice", "file": "mon_exercice.py" }`.

Après publication, ces fichiers sont dans `exemples/` à côté de `index.html` : vous pouvez les modifier directement sur le serveur, sans reconstruire le site (rechargez la page pour voir le changement).

### Partager depuis votre poste (réseau local / classe)

```bash
npm run build
npm run preview:classe
```

Vite affiche une adresse `https://192.168.x.x:4173` (ou `npm run dev:classe`, port 5173). Les étudiants du même réseau l'ouvrent dans leur navigateur et acceptent l'avertissement de certificat (« Paramètres avancés → Continuer »), car le certificat est auto-signé. Le HTTPS est indispensable : en HTTP simple, hors `localhost`, le navigateur désactive `SharedArrayBuffer`. Autorisez le port dans le pare-feu Windows si besoin ; le site s'arrête quand vous fermez le terminal.

## OneDrive (compte Microsoft 365 Éducation)

Deux boutons **nuage** (« Ouvrir depuis OneDrive » / « Enregistrer dans OneDrive ») permettent de parcourir le OneDrive de l'étudiant, d'ouvrir un `.py` et de l'enregistrer, depuis n'importe quel navigateur — y compris sur Chromebook, sans application OneDrive installée. Une fois un fichier OneDrive ouvert ou enregistré (nom précédé de ☁), `Ctrl+S` le met à jour directement.

Ils n'apparaissent que si l'application est déclarée auprès de Microsoft. **À faire une seule fois** (par vous ou le service informatique de l'établissement) :

1. Ouvrez <https://entra.microsoft.com> → **Applications → Inscriptions d'applications → Nouvelle inscription**.
2. Nom : `Python Studio`. Types de comptes : *Comptes dans cet annuaire d'organisation uniquement* (recommandé) ou *… n'importe quel annuaire d'organisation*.
3. **URI de redirection** : plateforme **Application monopage (SPA)**, avec l'adresse exacte du site, **terminée par `/`** — par exemple `https://monsite.netlify.app/`. Ajoutez aussi `http://localhost:5173/` pour tester en local (une entrée par adresse utilisée).
4. **Autorisations de l'API** → Microsoft Graph → *Autorisations déléguées* : `User.Read` et `Files.ReadWrite`. Si votre établissement interdit le consentement par les utilisateurs, cliquez sur **Accorder le consentement administrateur** (sinon chaque étudiant verra une demande d'autorisation, ou un refus).
5. Copiez l'**ID d'application (client)** et, si vous avez choisi « cet annuaire uniquement », l'**ID de l'annuaire (locataire)**.
6. Copiez `.env.example` en `.env.local` et renseignez :

   ```
   VITE_MSAL_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   VITE_MSAL_AUTHORITY=https://login.microsoftonline.com/<ID-du-locataire>
   ```

   (sur Netlify/Vercel/GitHub Actions, définissez ces mêmes variables dans les réglages de build), puis `npm run build`.

Notes :
- La connexion se fait **par redirection** vers la page Microsoft, puis retour sur le site (pas de fenêtre pop-up : elles sont incompatibles avec l'isolation nécessaire au débogueur). Le code en cours est conservé pendant la redirection.
- L'identifiant d'application n'est pas un secret ; aucune donnée ne transite par un serveur tiers : le navigateur parle directement à Microsoft Graph.
- Le site doit être en HTTPS et son adresse doit correspondre exactement à l'URI de redirection déclarée.

## Utilisation sur Chromebook

- **Navigateur** : Chrome (déjà installé). La Console, les points d'arrêt, le pas à pas et `input()` fonctionnent comme sur PC.
- **Touches F** : sur un Chromebook, la rangée du haut commande le navigateur. Utilisez `Ctrl+Entrée` (Exécuter) et `Ctrl+Maj+Entrée` (Arrêter), les boutons de la barre d'outils, ou maintenez la touche **Recherche** (🔍) avec la touche de fonction : `Recherche+F10` = Étape suivante, `Recherche+F11` = Entrer, `Recherche+F8` = Continuer.
- **OneDrive** : utilisez les boutons **nuage** de la barre d'outils (voir la section précédente) : ils fonctionnent sur Chromebook sans application OneDrive.
- **Ouvrir / Enregistrer (icônes disque)** : ce sont les boîtes de dialogue de l'application *Fichiers* de ChromeOS (Mes fichiers, Google Drive…), pour les fichiers locaux.
- Un Chromebook géré par l'établissement peut bloquer certaines fonctions (accès aux fichiers, SharedArrayBuffer). Testez avec un compte étudiant.

## Architecture

```
index.html                    point d'entrée (+ script coi-serviceworker, voir « Hébergement »)
vite.config.js                en-têtes COOP/COEP, chemins relatifs, Tailwind
public/
  coi-serviceworker.js        injecte COOP/COEP sur les hébergeurs sans en-têtes (GitHub Pages)
  _headers                    en-têtes pour Netlify / Cloudflare Pages
src/
  main.jsx, App.jsx           mise en page, raccourcis clavier, séparateurs redimensionnables
  components/
    Toolbar.jsx               boutons Exécuter / Arrêter / Étape suivante / Continuer…
    CodeEditor.jsx            Monaco : points d'arrêt, ligne courante, marqueur d'erreur
    Terminal.jsx              xterm.js : sortie + saisie pour input()
    VariablesPanel.jsx        variables, types, valeurs, pile d'appels
  hooks/usePythonRunner.js    pilote le worker : état, messages, commandes
  lib/
    protocol.js               mémoire partagée + commandes (le « contrat » UI ⇄ worker)
    pythonCompletions.js      auto-complétion Python (mots-clés, natives, modules, variables…)
    monacoSetup.js            Monaco embarqué (sans CDN) + worker de l'éditeur
    samples.js, config.js     chargement des exemples ; version/URL de Pyodide
  workers/
    python.worker.js          charge Pyodide, fait le pont JavaScript ⇄ Python
    runner.py                 exécuteur Python : sys.settrace, stdin/stdout, instantanés de variables
```

### Comment fonctionnent `input()` et le pas à pas

Le code de l'étudiant s'exécute de manière **synchrone** dans le worker. Quand il appelle `input()` ou atteint un point d'arrêt, il doit *se bloquer* en attendant l'utilisateur — or un worker bloqué ne reçoit plus de messages. On utilise donc un **`SharedArrayBuffer`** :

1. Python appelle `input()` (remplacé par `runner.py`) → le worker envoie `input-request` à l'interface puis se met en attente avec `Atomics.wait()`.
2. L'étudiant tape sa réponse dans xterm.js → l'interface écrit le texte dans la mémoire partagée et réveille le worker avec `Atomics.notify()`.
3. `input()` renvoie le texte ; le programme continue.

Le même mécanisme gère les pauses du débogueur (commandes *continuer / pas à pas / arrêter*) et la **mise à jour des points d'arrêt en direct** (la fonction de trace Python relit la liste partagée toutes les 50 ms). L'arrêt d'une boucle infinie utilise `pyodide.setInterruptBuffer()` (équivalent de Ctrl+C) ; si Python ne réagit pas dans les 1,5 s (ex. `except:` qui avale l'interruption), le worker est redémarré.

Le débogueur (`Tracer` dans `runner.py`) compte la profondeur des frames du programme de l'étudiant (événements `call`/`return` de `sys.settrace`) pour distinguer *step over*, *step into* et *step out*. Seul le code de l'étudiant (`<programme>`) est tracé, pas la bibliothèque standard.

## Hébergement (gratuit)

Le projet est un **site statique** : `npm run build` produit `dist/`, à publier tel quel.

> ⚠️ **Important** : `SharedArrayBuffer` n'est disponible que sur une page *cross-origin isolated*, c'est-à-dire servie avec les en-têtes
> `Cross-Origin-Opener-Policy: same-origin` et `Cross-Origin-Embedder-Policy: require-corp`.
> Le projet gère les trois cas :

| Hébergeur | Mise en place |
|---|---|
| **Netlify** / **Cloudflare Pages** | Build : `npm run build`, dossier : `dist`. Le fichier `public/_headers` (copié dans `dist/`) ajoute les en-têtes automatiquement. |
| **IIS** (Windows Server) | Copiez le contenu de `dist/` dans le dossier du site. Le fichier `web.config` (copié dans `dist/`) ajoute les en-têtes et les types MIME. Le site doit être en **HTTPS** (liaison avec certificat) ; le module *En-têtes de réponse HTTP* d'IIS doit être autorisé. |
| **Vercel** | Importez le dépôt ; `vercel.json` ajoute les en-têtes. |
| **GitHub Pages** | Aucun en-tête personnalisable : `coi-serviceworker.js` les injecte via un Service Worker (la page se recharge une fois à la première visite). Un workflow prêt à l'emploi est fourni : `.github/workflows/deploy.yml` — poussez sur `main` et activez *Settings → Pages → Source : GitHub Actions*. |

Le HTTPS est obligatoire (sauf `localhost`) — tous ces hébergeurs le fournissent.

### IIS : certificat HTTPS auto-signé

Si vous n'avez pas de certificat d'établissement, générez-en un **sur le serveur IIS** (PowerShell en administrateur) :

```powershell
.\scripts\creer-certificat-iis.ps1 -Noms "pythonstudio.ecole.local"
```

Utilisez un **nom DNS** (celui que les étudiants tapent dans le navigateur), pas une adresse IP. Dans IIS, ajoutez ensuite une liaison `https` qui utilise ce certificat. Comme il est auto-signé, chaque poste doit lui faire confiance, sinon le navigateur affiche un avertissement et refuse parfois d'activer `SharedArrayBuffer` :

- **Windows** : installez `pythonstudio.cer` dans *Autorités de certification racines de confiance* (double-clic → Installer le certificat → Ordinateur local), ou déployez-le par stratégie de groupe.
- **Chromebook** : *Paramètres → Confidentialité et sécurité → Sécurité → Gérer les certificats → Autorités → Importer*, ou déploiement par la console d'administration (recommandé pour une classe).

Un certificat d'établissement ou Let's Encrypt évite ces manipulations sur chaque poste.

### Mode hors-ligne / intranet (Pyodide auto-hébergé)

Par défaut, Pyodide vient de `cdn.jsdelivr.net`. Pour s'en passer :

1. Copiez les fichiers de Pyodide dans `public/pyodide/` (depuis `node_modules/pyodide` après `npm i pyodide@0.27.7`, ou l'archive officielle de [pyodide releases](https://github.com/pyodide/pyodide/releases)) : au minimum `pyodide.mjs`, `pyodide.asm.js`, `pyodide.asm.wasm`, `python_stdlib.zip`, `pyodide-lock.json` (+ les `.whl` des paquets voulus, ex. numpy).
2. Créez un fichier `.env.local` contenant : `VITE_PYODIDE_URL=./pyodide/`
3. Relancez `npm run build`.

## Dépannage

- **Bandeau rouge « SharedArrayBuffer indisponible »** : la page n'est pas isolée. En local, utilisez `npm run dev` / `npm run preview` (les en-têtes sont configurés) plutôt que d'ouvrir `index.html` directement ou de servir `dist/` avec un autre serveur. En production, voir « Hébergement ».
- **« Chargement de Python… » ne finit jamais** : vérifiez l'accès à `cdn.jsdelivr.net` (pare-feu d'établissement ?) ou passez en mode auto-hébergé ci-dessus.
- **Le programme ne répond plus à l'arrêt** : le worker est automatiquement redémarré après 1,5 s ; l'état des variables est perdu mais le code est conservé.
- Les messages d'erreur Python sont ceux de Python (en anglais) ; seules les indications de l'interface sont en français.

## Limites connues

- L'auto-complétion est « maison » (pas de serveur de langage Python) : elle connaît les mots-clés, les fonctions natives, les modules courants (`math`, `random`, `time`…), les méthodes de `str`/`list`/`dict`/`set` et les noms définis dans le fichier.
- Pas de threads, de `socket` ni d'accès disque réel (le système de fichiers est en mémoire) ; les graphiques `matplotlib` ne sont pas affichés.
- Le panneau Variables est masqué sur les écrans de moins de 768 px de large.
- Le site compilé est volumineux (~14 Mo, dont des workers Monaco CSS/HTML/TS jamais chargés pour Python) : sans impact sur le temps de chargement, seul l'éditeur et le worker Python sont téléchargés.
