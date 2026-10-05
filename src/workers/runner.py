"""
Exécuteur pédagogique : lance le programme de l'étudiant avec un débogueur
basé sur sys.settrace, des flux stdout/stderr/stdin redirigés vers la console
de l'interface, et des instantanés de variables.

Ce fichier est chargé dans Pyodide par python.worker.js. Le module
`studio_bridge` est fourni par le worker (JavaScript) : voir python.worker.js.
"""
import builtins
import json
import linecache
import reprlib
import sys
import time
import traceback
import types

import studio_bridge as bridge

FILENAME = "<programme>"

# Commandes reçues de l'interface — identiques à CMD dans src/lib/protocol.js
CMD_CONTINUE, CMD_OVER, CMD_INTO, CMD_OUT, CMD_STOP = 1, 2, 3, 4, 5
CMD_EDIT = 8

STREAM_OUT, STREAM_ERR = 0, 1

_monotonic = time.monotonic
_real_sleep = time.sleep


class StopExecution(BaseException):
    """Interrompt le programme de l'étudiant (BaseException : un
    `except Exception:` écrit par l'étudiant ne peut pas l'avaler)."""


# --------------------------------------------------------------------------
# Affichage des valeurs
# --------------------------------------------------------------------------

_repr = reprlib.Repr()
_repr.maxstring = 120
_repr.maxother = 120
_repr.maxlong = 60
_repr.maxlevel = 4
_repr.maxdict = 20
_repr.maxlist = _repr.maxtuple = _repr.maxset = _repr.maxfrozenset = 30
_repr.maxdeque = _repr.maxarray = 30


def _describe(value):
    try:
        if isinstance(value, types.FunctionType):
            return f"<fonction {value.__qualname__}>"
        if isinstance(value, type):
            return f"<classe {value.__name__}>"
        return _repr.repr(value)
    except Exception as exc:  # __repr__ défectueux de l'étudiant
        return f"<erreur d'affichage : {type(exc).__name__}>"


def _collect(namespace):
    items = []
    for name, value in list(namespace.items()):
        if name.startswith("__") or not name.isidentifier():
            continue
        if isinstance(value, types.ModuleType):
            continue
        items.append({"name": name, "type": type(value).__name__, "value": _describe(value)})
    return items


MAX_STACK_FRAMES = 100  # une récursion profonde ne doit pas gonfler les messages


def _frame_args(frame):
    """Arguments de la fonction (valeurs actuelles), dans l'ordre de la signature."""
    code = frame.f_code
    count = code.co_argcount + code.co_kwonlyargcount
    if code.co_flags & 0x04:  # *args
        count += 1
    if code.co_flags & 0x08:  # **kwargs
        count += 1
    local_ns = frame.f_locals
    return [
        {"name": name, "value": _describe(local_ns[name])}
        for name in code.co_varnames[:count]
        if name in local_ns
    ]


def _describe_stack(frame):
    """Pile d'appels du programme de l'étudiant, de la frame courante au programme principal.
    Les variables locales sont jointes aux frames appelantes (la frame courante est
    déjà décrite par les « scopes » de l'instantané)."""
    stack, omitted = [], 0
    current = frame
    while current is not None:
        if current.f_code.co_filename == FILENAME:
            if len(stack) >= MAX_STACK_FRAMES:
                omitted += 1
            else:
                name = current.f_code.co_name
                is_module = name == "<module>"
                entry = {
                    "name": "programme principal" if is_module else f"{name}()",
                    "line": current.f_lineno,
                    "source": linecache.getline(FILENAME, current.f_lineno).strip(),
                    "args": [] if is_module else _frame_args(current),
                }
                if stack and not is_module:
                    entry["vars"] = _collect(current.f_locals)
                stack.append(entry)
        current = current.f_back
    return stack, omitted


def _snapshot_json(frame, line, final=False, namespace=None, edit_error=None):
    scopes = []
    stack = []
    omitted = 0
    if frame is not None:
        local_ns, global_ns = frame.f_locals, frame.f_globals
        if local_ns is global_ns:
            scopes.append({"title": "Variables globales", "vars": _collect(global_ns)})
        else:
            scopes.append(
                {"title": f"Variables locales · {frame.f_code.co_name}()", "vars": _collect(local_ns)}
            )
            scopes.append({"title": "Variables globales", "vars": _collect(global_ns)})
        if line is not None:  # pile détaillée uniquement en pause (pas pour les instantanés « en direct »)
            stack, omitted = _describe_stack(frame)
    elif namespace is not None:
        scopes.append({"title": "Variables globales", "vars": _collect(namespace)})
    return json.dumps(
        {
            "scopes": scopes,
            "stack": stack,
            "stackOmitted": omitted,
            "line": line,
            "final": final,
            "editError": edit_error,
        },
        default=str,
    )


# --------------------------------------------------------------------------
# Modification d'une variable pendant une pause
# --------------------------------------------------------------------------


def _locals_to_fast(frame):
    """Python ≤ 3.12 : `frame.f_locals` d'une fonction est une copie ; on la réinjecte
    dans la frame. Python ≥ 3.13 : f_locals écrit directement, rien à faire."""
    if sys.version_info >= (3, 13):
        return
    try:
        import ctypes

        ctypes.pythonapi.PyFrame_LocalsToFast(ctypes.py_object(frame), ctypes.c_int(0))
    except Exception as exc:
        raise RuntimeError(
            "Impossible de modifier une variable locale dans cet environnement "
            f"({type(exc).__name__}). Les variables globales restent modifiables."
        ) from exc


def _apply_edit(frame, payload):
    """Évalue l'expression saisie et l'affecte à la variable. Renvoie None ou un message d'erreur."""
    try:
        request = json.loads(payload)
        target = frame
        for _ in range(int(request["frame"])):  # frames du programme uniquement, comme la pile affichée
            target = target.f_back
            while target is not None and target.f_code.co_filename != FILENAME:
                target = target.f_back
        if target is None:
            raise ValueError("Cet appel n'existe plus.")

        name = request["name"]
        if not isinstance(name, str) or not name.isidentifier():
            raise ValueError("Nom de variable invalide.")
        local_ns, global_ns = target.f_locals, target.f_globals
        is_global = request["scope"] == "global" or local_ns is global_ns

        code = compile(request["expr"].strip(), "<modification>", "eval")
        value = eval(code, global_ns, dict(local_ns))

        if is_global:
            global_ns[name] = value
        else:
            if name not in local_ns:
                raise ValueError(f"« {name} » n'est pas une variable locale de cet appel.")
            local_ns[name] = value
            _locals_to_fast(target)
        return None
    except SyntaxError as exc:
        return f"Expression invalide : {exc.msg}"
    except Exception as exc:
        return f"{type(exc).__name__}: {exc}"


# --------------------------------------------------------------------------
# Débogueur (sys.settrace)
# --------------------------------------------------------------------------

HOUSEKEEPING_INTERVAL = 0.05  # s : rafraîchit les points d'arrêt et vide la sortie
SNAPSHOT_INTERVAL = 0.12  # s : fréquence des instantanés de variables pendant l'exécution


class Tracer:
    """
    Modes :
      run  : s'arrête uniquement sur les points d'arrêt
      into : s'arrête à la prochaine ligne, où qu'elle soit
      over : s'arrête à la prochaine ligne de la fonction courante (ou de l'appelante)
      out  : s'arrête quand la fonction courante est terminée

    `depth` compte les frames du programme de l'étudiant (hors bibliothèque
    standard) : +1 à l'événement « call », -1 à « return ».
    """

    def __init__(self, mode):
        self.mode = "into" if mode == "step" else "run"
        self.stop_depth = 0
        self.depth = 0
        self.breakpoints = self._read_breakpoints()
        self.last_housekeeping = self.last_snapshot = _monotonic()
        self._line_tracer = self.trace_line  # évite de recréer une méthode liée à chaque ligne

    @staticmethod
    def _read_breakpoints():
        return set(bridge.get_breakpoints().to_py())

    # -- fonctions passées à sys.settrace ---------------------------------

    def trace_call(self, frame, event, arg):
        if frame.f_code.co_filename != FILENAME:
            return None  # bibliothèque standard / code interne : on ne trace pas
        self.depth += 1
        return self._line_tracer

    def trace_line(self, frame, event, arg):
        if event == "line":
            self._on_line(frame)
        elif event == "return":
            self.depth -= 1
        return self._line_tracer

    # -- logique ------------------------------------------------------------

    def _on_line(self, frame):
        now = _monotonic()
        if now - self.last_housekeeping >= HOUSEKEEPING_INTERVAL:
            self.last_housekeeping = now
            self.breakpoints = self._read_breakpoints()
            bridge.flush()
            if now - self.last_snapshot >= SNAPSHOT_INTERVAL:
                self.last_snapshot = now
                bridge.snapshot(_snapshot_json(frame, None))

        mode = self.mode
        if (
            mode == "into"
            or (mode == "over" and self.depth <= self.stop_depth)
            or (mode == "out" and self.depth < self.stop_depth)
            or frame.f_lineno in self.breakpoints
        ):
            self._pause(frame)

    def _pause(self, frame):
        # Bloque le worker (Atomics.wait) jusqu'à la commande de l'utilisateur.
        command = bridge.pause(_snapshot_json(frame, frame.f_lineno))
        while command == CMD_EDIT:  # l'utilisateur modifie une variable : on reste en pause
            error = _apply_edit(frame, bridge.read_edit())
            command = bridge.pause(_snapshot_json(frame, frame.f_lineno, edit_error=error), True)
        self.breakpoints = self._read_breakpoints()
        self.last_housekeeping = self.last_snapshot = _monotonic()

        if command == CMD_STOP:
            raise StopExecution()
        if command == CMD_OVER:
            self.mode, self.stop_depth = "over", self.depth
        elif command == CMD_INTO:
            self.mode = "into"
        elif command == CMD_OUT:
            self.mode, self.stop_depth = "out", self.depth
        else:
            self.mode = "run"


# --------------------------------------------------------------------------
# Entrées / sorties
# --------------------------------------------------------------------------


class _Stream:
    encoding = "utf-8"
    errors = "strict"

    def __init__(self, kind):
        self.kind = kind

    def write(self, text):
        if not isinstance(text, str):
            raise TypeError(f"write() argument must be str, not {type(text).__name__}")
        if text:
            bridge.write(text, self.kind)
        return len(text)

    def flush(self):
        bridge.flush()

    def isatty(self):
        return False

    def writable(self):
        return True

    def readable(self):
        return False


def _read_line():
    """Demande une ligne à la console. None = fin de fichier (Ctrl+D)."""
    reply = bridge.read_line()
    tag = reply[:1]
    if tag == "L":
        return reply[1:]
    if tag == "E":
        return None
    raise StopExecution()  # « S » : l'utilisateur a cliqué sur Arrêter


def _input(prompt=""):
    if prompt != "":
        sys.stdout.write(str(prompt))
    text = _read_line()
    if text is None:
        raise EOFError("EOF when reading a line")
    return text


class _Stdin:
    def readline(self, size=-1):
        text = _read_line()
        return "" if text is None else text + "\n"

    def read(self, size=-1):
        parts = []
        while True:
            line = self.readline()
            if not line:
                break
            parts.append(line)
        return "".join(parts)

    def __iter__(self):
        return self

    def __next__(self):
        line = self.readline()
        if not line:
            raise StopIteration
        return line

    def isatty(self):
        return False

    def readable(self):
        return True


def _sleep(seconds):
    bridge.flush()  # affiche ce qui a déjà été imprimé avant de s'endormir
    _real_sleep(seconds)


# --------------------------------------------------------------------------
# Rapport d'erreur
# --------------------------------------------------------------------------


def _report_error(exc):
    """Affiche une trace lisible (sans les frames internes) ; renvoie (ligne, message)."""
    tb = exc.__traceback__
    while tb is not None and tb.tb_frame.f_code.co_filename != FILENAME:
        tb = tb.tb_next

    line = None
    if isinstance(exc, SyntaxError):
        if exc.filename == FILENAME:
            line = exc.lineno
        lines = traceback.format_exception_only(type(exc), exc)
    else:
        walker = tb
        while walker is not None:  # dernière frame de l'étudiant = l'endroit de l'erreur
            if walker.tb_frame.f_code.co_filename == FILENAME:
                line = walker.tb_lineno
            walker = walker.tb_next
        lines = traceback.format_exception(type(exc), exc, tb)

    sys.stderr.write("".join(lines))
    return line, f"{type(exc).__name__}: {exc}"


# --------------------------------------------------------------------------
# Point d'entrée appelé par le worker
# --------------------------------------------------------------------------


def run_program(code, mode):
    """Exécute `code`. mode : « run » ou « step » (pause dès la première ligne).
    Renvoie un JSON {status, line, message}."""
    linecache.cache[FILENAME] = (len(code), None, code.splitlines(True), FILENAME)
    namespace = {"__name__": "__main__", "__builtins__": builtins}

    saved = (sys.stdout, sys.stderr, sys.stdin, builtins.input, time.sleep)
    sys.stdout, sys.stderr, sys.stdin = _Stream(STREAM_OUT), _Stream(STREAM_ERR), _Stdin()
    builtins.input = _input
    time.sleep = _sleep

    status, error_line, message = "ok", None, None
    try:
        tracer = Tracer(mode)
        compiled = compile(code, FILENAME, "exec")
        sys.settrace(tracer.trace_call)
        exec(compiled, namespace)
    except SystemExit as exc:
        if exc.code not in (None, 0):
            sys.stderr.write(f"Programme terminé avec le code de sortie {exc.code}\n")
    except (KeyboardInterrupt, StopExecution):
        status = "stopped"
        sys.stderr.write("\nProgramme interrompu.\n")
    except BaseException as exc:
        status = "error"
        error_line, message = _report_error(exc)
    finally:
        sys.settrace(None)
        sys.stdout, sys.stderr, sys.stdin, builtins.input, time.sleep = saved

    bridge.snapshot(_snapshot_json(None, None, final=True, namespace=namespace))
    return json.dumps({"status": status, "line": error_line, "message": message})
