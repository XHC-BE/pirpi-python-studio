/**
 * Auto-complétion Python (« Intellisense ») pour Monaco.
 *
 * Monaco n'embarque pas de serveur de langage Python : on fournit nous-mêmes
 * un moteur léger, suffisant pour l'enseignement :
 *   - mots-clés, fonctions natives documentées, extraits de code (snippets) ;
 *   - noms définis dans le fichier (variables, fonctions, classes, paramètres) ;
 *   - membres des modules courants (math., random., …) et méthodes des types
 *     natifs (str, list, dict, set) avec déduction simple du type de la variable.
 */

const KEYWORDS = [
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
  'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
  'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
];

/** [signature, description] */
const BUILTINS = [
  ['print(*objets, sep=" ", end="\\n")', 'Affiche les valeurs dans la console.'],
  ['input(invite="")', 'Lit une ligne saisie au clavier (renvoie toujours une chaîne str).'],
  ['len(objet)', "Renvoie le nombre d'éléments d'une séquence ou d'une collection."],
  ['range(début, fin, pas)', "Suite d'entiers : range(5) donne 0, 1, 2, 3, 4."],
  ['int(x)', 'Convertit en nombre entier.'],
  ['float(x)', 'Convertit en nombre décimal.'],
  ['str(x)', 'Convertit en chaîne de caractères.'],
  ['bool(x)', 'Convertit en booléen (True / False).'],
  ['list(itérable)', 'Crée une liste.'],
  ['tuple(itérable)', 'Crée un tuple (liste non modifiable).'],
  ['dict(...)', 'Crée un dictionnaire.'],
  ['set(itérable)', "Crée un ensemble (éléments uniques)."],
  ['abs(x)', 'Valeur absolue.'],
  ['round(x, chiffres)', 'Arrondit un nombre.'],
  ['min(itérable)', 'Plus petite valeur.'],
  ['max(itérable)', 'Plus grande valeur.'],
  ['sum(itérable, début=0)', 'Somme des éléments.'],
  ['sorted(itérable, key=None, reverse=False)', 'Renvoie une nouvelle liste triée.'],
  ['reversed(séquence)', 'Parcourt une séquence à l’envers.'],
  ['enumerate(itérable, début=0)', 'Parcourt en fournissant (indice, valeur).'],
  ['zip(*itérables)', 'Associe les éléments de plusieurs itérables.'],
  ['map(fonction, itérable)', 'Applique une fonction à chaque élément.'],
  ['filter(fonction, itérable)', 'Garde les éléments pour lesquels la fonction renvoie True.'],
  ['any(itérable)', 'True si au moins un élément est vrai.'],
  ['all(itérable)', 'True si tous les éléments sont vrais.'],
  ['type(objet)', "Renvoie le type d'un objet."],
  ['isinstance(objet, type)', "Teste si l'objet est du type donné."],
  ['open(fichier, mode="r")', 'Ouvre un fichier.'],
  ['pow(x, y)', 'x à la puissance y.'],
  ['divmod(a, b)', 'Renvoie (quotient, reste) de la division entière.'],
  ['chr(code)', 'Caractère correspondant à un code Unicode.'],
  ['ord(caractère)', "Code Unicode d'un caractère."],
  ['bin(x)', 'Écriture binaire.'],
  ['hex(x)', 'Écriture hexadécimale.'],
  ['id(objet)', "Identité (adresse) d'un objet."],
  ['repr(objet)', 'Représentation « développeur » d’un objet.'],
  ['dir(objet)', "Liste les attributs d'un objet."],
  ['help(objet)', 'Affiche l’aide.'],
  ['callable(objet)', "Teste si l'objet est appelable."],
  ['hasattr(objet, nom)', "Teste si l'objet possède un attribut."],
  ['getattr(objet, nom)', "Lit un attribut par son nom."],
  ['setattr(objet, nom, valeur)', "Modifie un attribut par son nom."],
  ['iter(objet)', 'Crée un itérateur.'],
  ['next(itérateur)', "Élément suivant d'un itérateur."],
  ['format(valeur, spécification)', 'Formate une valeur.'],
  ['exit()', 'Termine le programme.'],
];

const EXCEPTIONS = [
  'Exception', 'ValueError', 'TypeError', 'ZeroDivisionError', 'IndexError', 'KeyError', 'NameError',
  'AttributeError', 'FileNotFoundError', 'ImportError', 'StopIteration', 'RuntimeError', 'OSError',
  'AssertionError', 'KeyboardInterrupt', 'NotImplementedError', 'RecursionError',
];

const SNIPPETS = [
  ['for', 'for ${1:i} in range(${2:10}):\n\t${0:pass}', 'Boucle for'],
  ['foreach', 'for ${1:element} in ${2:liste}:\n\t${0:pass}', 'Boucle sur une collection'],
  ['while', 'while ${1:condition}:\n\t${0:pass}', 'Boucle while'],
  ['if', 'if ${1:condition}:\n\t${0:pass}', 'Condition if'],
  ['ifelse', 'if ${1:condition}:\n\t${2:pass}\nelse:\n\t${0:pass}', 'Condition if / else'],
  ['elif', 'elif ${1:condition}:\n\t${0:pass}', 'Branche elif'],
  ['def', 'def ${1:nom}(${2:parametres}):\n\t${0:pass}', 'Définition de fonction'],
  ['class', 'class ${1:Nom}:\n\tdef __init__(self${2}):\n\t\t${0:pass}', 'Définition de classe'],
  ['try', 'try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:e}:\n\t${0:print(e)}', 'Gestion d’erreur try / except'],
  ['with', 'with open(${1:"fichier.txt"}, ${2:"r"}) as ${3:f}:\n\t${0:pass}', 'Ouverture de fichier'],
  ['main', 'if __name__ == "__main__":\n\t${0:main()}', 'Point d’entrée du programme'],
  ['inputint', '${1:n} = int(input(${2:"Entrez un nombre : "}))', 'Lire un entier'],
  ['inputfloat', '${1:x} = float(input(${2:"Entrez un nombre : "}))', 'Lire un décimal'],
  ['inputstr', '${1:texte} = input(${2:"Votre saisie : "})', 'Lire du texte'],
  ['lc', '[${1:x} for ${2:x} in ${3:iterable}]', 'Liste en compréhension'],
];

const MODULES = {
  math: [
    'pi', 'e', 'tau', 'inf', 'sqrt(x)', 'pow(x, y)', 'ceil(x)', 'floor(x)', 'fabs(x)', 'factorial(n)',
    'gcd(a, b)', 'sin(x)', 'cos(x)', 'tan(x)', 'asin(x)', 'acos(x)', 'atan(x)', 'atan2(y, x)',
    'degrees(x)', 'radians(x)', 'exp(x)', 'log(x, base)', 'log2(x)', 'log10(x)', 'hypot(x, y)',
    'isclose(a, b)', 'trunc(x)', 'comb(n, k)', 'perm(n, k)',
  ],
  random: [
    'random()', 'randint(a, b)', 'randrange(début, fin, pas)', 'choice(séquence)', 'choices(séquence, k=1)',
    'sample(séquence, k)', 'shuffle(liste)', 'uniform(a, b)', 'seed(graine)', 'gauss(mu, sigma)',
  ],
  time: ['time()', 'sleep(secondes)', 'perf_counter()', 'monotonic()', 'strftime(format)', 'localtime()'],
  sys: ['argv', 'exit(code)', 'version', 'platform', 'stdout', 'stderr', 'stdin', 'setrecursionlimit(n)', 'getrecursionlimit()'],
  os: ['getcwd()', 'listdir(chemin)', 'path', 'remove(chemin)', 'mkdir(chemin)', 'environ', 'sep'],
  datetime: ['datetime', 'date', 'time', 'timedelta', 'timezone'],
  json: ['dumps(objet)', 'loads(texte)', 'dump(objet, fichier)', 'load(fichier)'],
  string: ['ascii_letters', 'ascii_lowercase', 'ascii_uppercase', 'digits', 'punctuation', 'whitespace'],
  statistics: ['mean(données)', 'median(données)', 'mode(données)', 'stdev(données)', 'variance(données)'],
  collections: ['Counter', 'defaultdict', 'deque', 'OrderedDict', 'namedtuple(nom, champs)'],
  itertools: ['permutations(itérable, r)', 'combinations(itérable, r)', 'product(*itérables)', 'count(début, pas)', 'cycle(itérable)', 'chain(*itérables)', 'islice(itérable, n)'],
};

const METHODS = {
  str: [
    'upper()', 'lower()', 'capitalize()', 'title()', 'strip()', 'lstrip()', 'rstrip()', 'split(sep)',
    'join(itérable)', 'replace(ancien, nouveau)', 'find(sous_chaîne)', 'index(sous_chaîne)', 'count(sous_chaîne)',
    'startswith(préfixe)', 'endswith(suffixe)', 'isdigit()', 'isalpha()', 'isalnum()', 'isspace()',
    'islower()', 'isupper()', 'format(*args)', 'zfill(largeur)', 'center(largeur)', 'splitlines()',
  ],
  list: [
    'append(x)', 'extend(itérable)', 'insert(i, x)', 'remove(x)', 'pop(i)', 'clear()', 'index(x)',
    'count(x)', 'sort(key=None, reverse=False)', 'reverse()', 'copy()',
  ],
  dict: ['keys()', 'values()', 'items()', 'get(clé, défaut)', 'pop(clé)', 'update(autre)', 'setdefault(clé, défaut)', 'clear()', 'copy()'],
  set: ['add(x)', 'remove(x)', 'discard(x)', 'pop()', 'union(autre)', 'intersection(autre)', 'difference(autre)', 'issubset(autre)', 'clear()', 'copy()'],
};

/** Déduit le type d'une variable d'après son affectation dans le fichier. */
function guessType(source, name) {
  const re = new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'gm');
  let type = null;
  let match;
  while ((match = re.exec(source)) !== null) {
    const value = match[1].trim();
    if (/^(f|r|b)?["']/.test(value) || /^(str|input)\(/.test(value)) type = 'str';
    else if (/^(\[|list\()/.test(value)) type = 'list';
    else if (/^(\{\s*\}|dict\(|\{[^}]*:)/.test(value)) type = 'dict';
    else if (/^(set\(|\{)/.test(value)) type = 'set';
    else type = null;
  }
  return type;
}

function toItem(monaco, signature, range, { kind, documentation, sortPrefix = '1' }) {
  const label = signature.split('(')[0];
  const isCallable = signature.includes('(');
  return {
    label,
    kind: isCallable ? kind : monaco.languages.CompletionItemKind.Constant,
    detail: isCallable ? signature : undefined,
    documentation,
    insertText: isCallable ? `${label}($0)` : label,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    range,
    sortText: sortPrefix + label,
  };
}

export function registerPythonCompletions(monaco) {
  const K = monaco.languages.CompletionItemKind;

  monaco.languages.registerCompletionItemProvider('python', {
    triggerCharacters: ['.'],

    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const source = model.getValue();

      // 1) « objet.<…> » : membres d'un module ou méthodes d'un type
      const member = /([A-Za-z_]\w*)\.(\w*)$/.exec(linePrefix);
      if (member) {
        const target = member[1];
        if (MODULES[target]) {
          return { suggestions: MODULES[target].map((s) => toItem(monaco, s, range, { kind: K.Function })) };
        }
        const type = guessType(source, target);
        const pool = type ? METHODS[type] : [...new Set(Object.values(METHODS).flat())];
        return {
          suggestions: pool.map((s) =>
            toItem(monaco, s, range, { kind: K.Method, documentation: type ? `Méthode de ${type}` : undefined }),
          ),
        };
      }

      // 2) « import <module> » / « from <module> import <nom> »
      if (/^\s*import\s+[\w\s,]*$/.test(linePrefix) || /^\s*from\s+\w*$/.test(linePrefix)) {
        return {
          suggestions: Object.keys(MODULES).map((name) => ({
            label: name,
            kind: K.Module,
            insertText: name,
            range,
          })),
        };
      }
      const fromImport = /^\s*from\s+(\w+)\s+import\s+[\w\s,]*$/.exec(linePrefix);
      if (fromImport && MODULES[fromImport[1]]) {
        return {
          suggestions: MODULES[fromImport[1]].map((s) => toItem(monaco, s, range, { kind: K.Function })),
        };
      }

      // 3) Complétion générale
      const suggestions = [];

      for (const keyword of KEYWORDS) {
        suggestions.push({ label: keyword, kind: K.Keyword, insertText: keyword, range, sortText: '3' + keyword });
      }
      for (const [signature, documentation] of BUILTINS) {
        suggestions.push(toItem(monaco, signature, range, { kind: K.Function, documentation, sortPrefix: '2' }));
      }
      for (const name of EXCEPTIONS) {
        suggestions.push({ label: name, kind: K.Class, insertText: name, range, sortText: '4' + name });
      }
      for (const [label, body, documentation] of SNIPPETS) {
        suggestions.push({
          label,
          kind: K.Snippet,
          documentation,
          detail: 'extrait de code',
          insertText: body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          sortText: '5' + label,
        });
      }

      // Noms définis par l'étudiant : prioritaires dans la liste.
      const known = new Map();
      const kinds = [
        [/\bdef\s+([A-Za-z_]\w*)/g, K.Function],
        [/\bclass\s+([A-Za-z_]\w*)/g, K.Class],
        [/^\s*([A-Za-z_]\w*)\s*(?:[-+*/%]?=)(?!=)/gm, K.Variable],
        [/\bfor\s+([A-Za-z_]\w*)\s+in\b/g, K.Variable],
        [/\bas\s+([A-Za-z_]\w*)/g, K.Variable],
        [/\bimport\s+([A-Za-z_]\w*)/g, K.Module],
      ];
      for (const [pattern, kind] of kinds) {
        let m;
        while ((m = pattern.exec(source)) !== null) known.set(m[1], kind);
      }
      // Paramètres des fonctions
      const params = /\bdef\s+\w+\s*\(([^)]*)\)/g;
      let pm;
      while ((pm = params.exec(source)) !== null) {
        for (const p of pm[1].split(',')) {
          const name = p.split('=')[0].split(':')[0].replace(/\*/g, '').trim();
          if (/^[A-Za-z_]\w*$/.test(name) && name !== 'self' && !known.has(name)) known.set(name, K.Variable);
        }
      }
      for (const [name, kind] of known) {
        if (KEYWORDS.includes(name)) continue;
        suggestions.push({
          label: name,
          kind,
          insertText: name,
          range,
          detail: 'défini dans ce fichier',
          sortText: '0' + name,
        });
      }

      return { suggestions };
    },
  });
}
