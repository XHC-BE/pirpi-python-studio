"""
Traducteur pédagogique Python -> Pascal (Free Pascal) ou C#.

Il s'appuie sur le module `ast` de Python et ne traduit qu'un SOUS-ENSEMBLE
adapté à l'initiation :

  - variables de type entier, réel, texte, booléen (type déduit des affectations) ;
  - opérateurs arithmétiques, de comparaison et logiques (and / or / not) ;
  - print() (avec sep=, end= et f-strings simples) et input() ;
  - int(), float(), str(), abs(), len(), min(), max(), round() ;
  - if / elif / else, while, for ... in range(...), break, continue, pass.

Tout le reste (fonctions, listes, classes, import...) est refusé avec un message
précis indiquant la ligne concernée : on ne produit jamais de code faux.

Ce fichier est chargé par python.worker.js ; il est aussi utilisable seul
(`translate_program(code, "pascal" | "csharp")` renvoie un JSON).
"""
import ast
import io
import json
import re
import tokenize

INT, FLOAT, STR, BOOL, UNKNOWN = "int", "float", "str", "bool", "?"
NUMERIC = (INT, FLOAT)
TYPE_FR = {INT: "entier", FLOAT: "réel", STR: "texte", BOOL: "booléen"}

# Niveaux de priorité des expressions générées (plus grand = lie plus fort)
ATOM, UNARY, MUL, ADD, CMP, AND, OR = 10, 9, 7, 6, 5, 3, 2

CONSTRUCTS = {
    "FunctionDef": "les fonctions (def)",
    "AsyncFunctionDef": "les fonctions asynchrones",
    "ClassDef": "les classes",
    "Import": "import",
    "ImportFrom": "import",
    "Try": "try / except",
    "With": "with",
    "Return": "return",
    "List": "les listes",
    "Dict": "les dictionnaires",
    "Set": "les ensembles",
    "Tuple": "les tuples",
    "ListComp": "les listes en compréhension",
    "DictComp": "les dictionnaires en compréhension",
    "SetComp": "les ensembles en compréhension",
    "GeneratorExp": "les expressions génératrices",
    "Lambda": "les fonctions lambda",
    "IfExp": "l'expression conditionnelle (a if c else b)",
    "Subscript": "l'indexation et les tranches (x[i])",
    "Attribute": "les méthodes et attributs (ex. x.upper())",
    "Global": "global",
    "Nonlocal": "nonlocal",
    "Delete": "del",
    "Assert": "assert",
    "Raise": "raise",
    "Match": "match",
    "AnnAssign": "les affectations annotées (x: int = 0)",
    "NamedExpr": "l'opérateur :=",
    "Starred": "l'opérateur *",
    "Yield": "yield",
    "Await": "await",
}

PASCAL_RESERVED = set(
    """and array as asm begin case class const constructor destructor div do downto else end except
    exports file finalization finally for function goto if implementation in inherited initialization
    inline interface is label library mod nil not object of on operator or packed procedure program
    property raise record repeat resourcestring set shl shr string then threadvar to try type unit
    until uses var while with xor integer real boolean byte char write writeln read readln length abs
    round trunc result self programme power min max""".split()
)
CSHARP_KEYWORDS = set(
    """abstract as base bool break byte case catch char checked class const continue decimal default
    delegate do double else enum event explicit extern false finally fixed float for foreach goto if
    implicit in int interface internal is lock long namespace new null object operator out override
    params private protected public readonly ref return sbyte sealed short sizeof stackalloc static
    string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual
    void volatile while""".split()
)
CSHARP_CLASHES = {"Console", "Math", "Program", "Main", "System"}


class Unsupported(Exception):
    """Construction non traduisible (message destiné à l'étudiant)."""

    def __init__(self, node, message):
        super().__init__(message)
        self.line = getattr(node, "lineno", None)
        self.message = message


class Skip(Exception):
    """Erreur déjà signalée plus haut : on évite les messages en cascade."""


def unsupported(node, message=None):
    if message is None:
        name = type(node).__name__
        message = f"construction non prise en charge : {CONSTRUCTS.get(name, name)}"
    raise Unsupported(node, message)


def is_call(node, name):
    return isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == name


def const_int(node):
    """Valeur d'un entier littéral (éventuellement négatif), sinon None."""
    if isinstance(node, ast.Constant) and type(node.value) is int:
        return node.value
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        inner = const_int(node.operand)
        return -inner if inner is not None else None
    return None


# --------------------------------------------------------------------------
# Déduction des types
# --------------------------------------------------------------------------


def merge(name, old, new, node):
    if old is None or old == new:
        return new
    if old == UNKNOWN:
        return UNKNOWN
    if {old, new} == {INT, FLOAT}:
        return FLOAT
    unsupported(
        node,
        f"la variable « {name} » reçoit des valeurs de types différents ({TYPE_FR[old]} puis {TYPE_FR[new]}) : "
        "Pascal et C# exigent un seul type par variable",
    )


def type_of(node, env):
    kind = type(node)
    if kind is ast.Constant:
        value = node.value
        if isinstance(value, bool):
            return BOOL
        if isinstance(value, int):
            return INT
        if isinstance(value, float):
            return FLOAT
        if isinstance(value, str):
            return STR
        unsupported(node, "cette valeur constante n'est pas prise en charge")

    if kind is ast.Name:
        found = env.get(node.id)
        if found is None:
            unsupported(node, f"la variable « {node.id} » est utilisée avant d'avoir reçu une valeur")
        if found == UNKNOWN:
            raise Skip()
        return found

    if kind is ast.BinOp:
        left, right = type_of(node.left, env), type_of(node.right, env)
        op = type(node.op)
        if op is ast.Add and left == STR and right == STR:
            return STR
        if left in NUMERIC and right in NUMERIC:
            if op is ast.Div:
                return FLOAT
            if op in (ast.FloorDiv, ast.Mod):
                if left == INT and right == INT:
                    return INT
                unsupported(node, "// et % ne sont traduits que pour des nombres entiers")
            if op is ast.Pow:
                exponent = const_int(node.right)
                return INT if left == INT and right == INT and exponent is not None and exponent >= 0 else FLOAT
            if op in (ast.Add, ast.Sub, ast.Mult):
                return FLOAT if FLOAT in (left, right) else INT
        unsupported(node, f"opération impossible à traduire entre {TYPE_FR[left]} et {TYPE_FR[right]}")

    if kind is ast.UnaryOp:
        operand = type_of(node.operand, env)
        if isinstance(node.op, ast.Not):
            if operand != BOOL:
                unsupported(node, "« not » ne s'applique ici qu'à un booléen ou une comparaison")
            return BOOL
        if isinstance(node.op, (ast.USub, ast.UAdd)) and operand in NUMERIC:
            return operand
        unsupported(node, "cet opérateur unaire n'est pas pris en charge")

    if kind is ast.BoolOp:
        for value in node.values:
            if type_of(value, env) != BOOL:
                unsupported(node, "« and » / « or » ne relient ici que des comparaisons ou des booléens")
        return BOOL

    if kind is ast.Compare:
        allowed = (ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE)
        operands = [node.left] + node.comparators
        types = [type_of(operand, env) for operand in operands]
        for op in node.ops:
            if not isinstance(op, allowed):
                unsupported(node, "seules les comparaisons == != < <= > >= sont prises en charge")
        for a, b in zip(types, types[1:]):
            if not (a == b or (a in NUMERIC and b in NUMERIC)):
                unsupported(node, f"comparaison impossible à traduire entre {TYPE_FR[a]} et {TYPE_FR[b]}")
        return BOOL

    if kind is ast.JoinedStr:
        for part in node.values:
            if isinstance(part, ast.FormattedValue):
                type_of(part.value, env)
        return STR

    if kind is ast.Call:
        return call_type(node, env)

    unsupported(node)


def call_type(node, env):
    if not isinstance(node.func, ast.Name):
        unsupported(node.func)
    name = node.func.id
    if node.keywords or any(isinstance(a, ast.Starred) for a in node.args):
        unsupported(node, f"{name}() : les arguments nommés ne sont pas pris en charge")
    args = [type_of(a, env) for a in node.args]

    def expect(count, allowed=None):
        if len(args) != count:
            unsupported(node, f"{name}() attend {count} argument(s) dans cette traduction")
        if allowed and any(t not in allowed for t in args):
            unsupported(node, f"{name}() : type d'argument non pris en charge")

    if name == "int":
        expect(1, (INT, FLOAT, STR))
        return INT
    if name == "float":
        expect(1, (INT, FLOAT, STR))
        return FLOAT
    if name == "str":
        expect(1)
        return STR
    if name == "input":
        if len(args) > 1 or (args and args[0] != STR):
            unsupported(node, "input() accepte au plus un message (texte)")
        return STR
    if name == "abs":
        expect(1, NUMERIC)
        return args[0]
    if name == "len":
        expect(1, (STR,))
        return INT
    if name in ("min", "max"):
        expect(2, NUMERIC)
        return INT if args == [INT, INT] else FLOAT
    if name == "round":
        expect(1, NUMERIC)
        return INT
    if name == "print":
        unsupported(node, "print() ne renvoie pas de valeur : il ne peut pas être utilisé dans une expression")
    unsupported(node, f"la fonction « {name}() » n'est pas encore prise en charge")


def assign_type(env, name, value_type, node):
    env[name] = merge(name, env.get(name), value_type, node)


def require_bool(test, env):
    if type_of(test, env) != BOOL:
        unsupported(test, "la condition doit être une comparaison ou un booléen (ex. x > 0)")


def check_range(node, env):
    it = node.iter
    if (
        not isinstance(node.target, ast.Name)
        or not is_call(it, "range")
        or it.keywords
        or not 1 <= len(it.args) <= 3
    ):
        unsupported(node, "seule la boucle « for i in range(...) » est prise en charge")
    if node.orelse:
        unsupported(node, "« else » sur une boucle n'est pas pris en charge")
    for arg in it.args:
        if type_of(arg, env) != INT:
            unsupported(arg, "range() n'accepte ici que des nombres entiers")
    if len(it.args) == 3:
        step = const_int(it.args[2])
        if step is None or step == 0:
            unsupported(it.args[2], "range() : le pas doit être un entier constant non nul")


def infer_block(stmts, env, errors):
    for stmt in stmts:
        try:
            infer_stmt(stmt, env, errors)
        except Skip:
            pass
        except Unsupported as exc:
            errors.append({"line": exc.line, "message": exc.message})
            if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
                env[stmt.targets[0].id] = UNKNOWN  # évite les erreurs en cascade


def infer_stmt(stmt, env, errors):
    if isinstance(stmt, ast.Assign):
        if len(stmt.targets) != 1 or not isinstance(stmt.targets[0], ast.Name):
            unsupported(stmt, "seules les affectations simples (x = valeur) sont prises en charge")
        assign_type(env, stmt.targets[0].id, type_of(stmt.value, env), stmt)
    elif isinstance(stmt, ast.AugAssign):
        if not isinstance(stmt.target, ast.Name):
            unsupported(stmt, "seules les affectations simples (x += valeur) sont prises en charge")
        name = stmt.target.id
        if name not in env:
            unsupported(stmt, f"la variable « {name} » est utilisée avant d'avoir reçu une valeur")
        fake = ast.copy_location(ast.BinOp(left=ast.Name(id=name, ctx=ast.Load()), op=stmt.op, right=stmt.value), stmt)
        assign_type(env, name, type_of(fake, env), stmt)
    elif isinstance(stmt, ast.Expr):
        value = stmt.value
        if is_call(value, "print"):
            for arg in value.args:
                if isinstance(arg, ast.Starred):
                    unsupported(arg)
                type_of(arg, env)
        elif not (isinstance(value, ast.Constant) and isinstance(value.value, str)):
            unsupported(stmt, "seuls les appels à print() sont traduits comme instruction")
    elif isinstance(stmt, ast.If):
        require_bool(stmt.test, env)
        infer_block(stmt.body, env, errors)
        infer_block(stmt.orelse, env, errors)
    elif isinstance(stmt, ast.While):
        if stmt.orelse:
            unsupported(stmt, "« else » sur une boucle n'est pas pris en charge")
        require_bool(stmt.test, env)
        infer_block(stmt.body, env, errors)
    elif isinstance(stmt, ast.For):
        check_range(stmt, env)
        assign_type(env, stmt.target.id, INT, stmt)
        infer_block(stmt.body, env, errors)
    elif isinstance(stmt, (ast.Pass, ast.Break, ast.Continue)):
        pass
    else:
        unsupported(stmt)


# --------------------------------------------------------------------------
# Littéraux de chaîne
# --------------------------------------------------------------------------


def pas_str(text):
    if text == "":
        return "''"
    parts, buffer = [], ""
    for ch in text:
        if ord(ch) < 32 or ord(ch) == 127:
            if buffer:
                parts.append("'" + buffer.replace("'", "''") + "'")
                buffer = ""
            parts.append("#%d" % ord(ch))
        else:
            buffer += ch
    if buffer:
        parts.append("'" + buffer.replace("'", "''") + "'")
    return parts[0] if len(parts) == 1 else "(" + " + ".join(parts) + ")"


def cs_escape(text, interpolated=False):
    out = []
    for ch in text:
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif ord(ch) < 32 or ord(ch) == 127:
            out.append("\\u%04x" % ord(ch))
        elif interpolated and ch in "{}":
            out.append(ch * 2)
        else:
            out.append(ch)
    return "".join(out)


def cs_str(text):
    return '"' + cs_escape(text) + '"'


# --------------------------------------------------------------------------
# Génération de code
# --------------------------------------------------------------------------


class Generator:
    def __init__(self, pascal, env, comments):
        self.pas = pascal
        self.env = env
        self.full, self.trailing = comments
        self.used_full, self.used_trailing = set(), set()
        self.lines = []
        self.depth = 0
        self.unit = "  " if pascal else "    "
        self.needs_math = False
        self.needs_sysutils = False
        self.notes = []
        self.errors = []

    # -- utilitaires ---------------------------------------------------------

    def note(self, text):
        if text not in self.notes:
            self.notes.append(text)

    def t(self, node):
        return type_of(node, self.env)

    def ident(self, name):
        if self.pas:
            return name + "_" if name.lower() in PASCAL_RESERVED else name
        if name in CSHARP_CLASHES:
            return name + "_"
        return "@" + name if name in CSHARP_KEYWORDS else name

    def add(self, text, lineno=None):
        line = self.unit * self.depth + text
        if lineno in self.trailing and lineno not in self.used_trailing:
            self.used_trailing.add(lineno)
            line += "  // " + self.trailing[lineno]
        self.lines.append(line)

    def flush_comments(self, before=None):
        for number in sorted(self.full):
            if number not in self.used_full and (before is None or number < before):
                self.used_full.add(number)
                self.lines.append(self.unit * self.depth + "// " + self.full[number])

    # -- expressions ---------------------------------------------------------

    def w(self, node, min_level):
        text, level = self.ex(node)
        return f"({text})" if level < min_level else text

    def to_str(self, node):
        """Texte correspondant à la valeur de `node` (pour la concaténation Pascal)."""
        kind = self.t(node)
        if kind == STR:
            return self.w(node, ADD)
        self.needs_sysutils = True
        text = self.ex(node)[0]
        if kind == INT:
            return f"IntToStr({text})"
        if kind == FLOAT:
            return f"FloatToStr({text})"
        return f"BoolToStr({text}, True)"

    def spec_digits(self, spec):
        """Format de f-string « .2f » -> 2 ; None si absent."""
        if spec is None:
            return None
        if len(spec.values) == 1 and isinstance(spec.values[0], ast.Constant):
            match = re.fullmatch(r"\.(\d+)f", str(spec.values[0].value))
            if match:
                return int(match.group(1))
        unsupported(spec, "seul le format de f-string « {x:.2f} » (nombre de décimales) est pris en charge")

    def ex(self, node):
        kind = type(node)

        if kind is ast.Constant:
            value = node.value
            if isinstance(value, bool):
                text = ("True" if value else "False") if self.pas else ("true" if value else "false")
                return text, ATOM
            if isinstance(value, float):
                text = repr(value)
                if "inf" in text or "nan" in text:
                    unsupported(node, "cette valeur réelle n'est pas prise en charge")
                return text, ATOM
            if isinstance(value, int):
                return str(value), ATOM
            return (pas_str(value) if self.pas else cs_str(value)), ATOM

        if kind is ast.Name:
            self.t(node)
            return self.ident(node.id), ATOM

        if kind is ast.UnaryOp:
            if isinstance(node.op, ast.Not):
                inner = self.w(node.operand, UNARY if not self.pas else ATOM)
                return (f"not {inner}" if self.pas else f"!{inner}"), UNARY
            sign = "-" if isinstance(node.op, ast.USub) else "+"
            return sign + self.w(node.operand, UNARY), UNARY

        if kind is ast.BinOp:
            return self.binop(node)

        if kind is ast.Compare:
            symbols = {
                ast.Eq: "=" if self.pas else "==",
                ast.NotEq: "<>" if self.pas else "!=",
                ast.Lt: "<",
                ast.LtE: "<=",
                ast.Gt: ">",
                ast.GtE: ">=",
            }
            operands = [node.left] + node.comparators
            pairs = []
            for left, op, right in zip(operands, node.ops, operands[1:]):
                pairs.append(f"{self.w(left, ADD)} {symbols[type(op)]} {self.w(right, ADD)}")
            if len(pairs) == 1:
                return pairs[0], CMP
            if self.pas:
                return " and ".join(f"({p})" for p in pairs), AND
            return " && ".join(pairs), AND

        if kind is ast.BoolOp:
            is_and = isinstance(node.op, ast.And)
            if self.pas:
                child_level, joiner = ADD, " and " if is_and else " or "
            else:
                child_level, joiner = (AND if is_and else OR), " && " if is_and else " || "
            return joiner.join(self.w(v, child_level) for v in node.values), AND if is_and else OR

        if kind is ast.JoinedStr:
            return self.fstring(node)

        if kind is ast.Call:
            return self.call(node)

        unsupported(node)

    def binop(self, node):
        op = type(node.op)
        left_type, right_type = self.t(node.left), self.t(node.right)

        if op is ast.Add and left_type == STR:
            return f"{self.w(node.left, ADD)} + {self.w(node.right, ADD + 1)}", ADD

        if op is ast.Pow:
            self.needs_math = self.needs_math or self.pas
            a, b = self.ex(node.left)[0], self.ex(node.right)[0]
            if self.t(node) == INT:
                self.note("Les puissances passent par Power (Pascal) / Math.Pow (C#), qui travaillent en réels : le résultat est reconverti en entier.")
                return (f"Round(Power({a}, {b}))" if self.pas else f"(int)Math.Pow({a}, {b})"), ATOM if self.pas else UNARY
            return (f"Power({a}, {b})" if self.pas else f"Math.Pow({a}, {b})"), ATOM

        if op in (ast.FloorDiv, ast.Mod):
            self.note("// et % : Python arrondit vers le bas, Pascal et C# vers zéro. Les résultats diffèrent pour les nombres négatifs.")

        if self.pas:
            symbol = {ast.Add: "+", ast.Sub: "-", ast.Mult: "*", ast.Div: "/", ast.FloorDiv: "div", ast.Mod: "mod"}[op]
        else:
            symbol = {ast.Add: "+", ast.Sub: "-", ast.Mult: "*", ast.Div: "/", ast.FloorDiv: "/", ast.Mod: "%"}[op]
        level = ADD if op in (ast.Add, ast.Sub) else MUL

        if not self.pas and op is ast.Div and left_type == INT and right_type == INT:
            return f"(double){self.w(node.left, UNARY)} / {self.w(node.right, level + 1)}", level
        return f"{self.w(node.left, level)} {symbol} {self.w(node.right, level + 1)}", level

    def fstring(self, node):
        if self.pas:
            parts = []
            for part in node.values:
                if isinstance(part, ast.Constant):
                    parts.append(pas_str(part.value))
                else:
                    if part.format_spec is not None or part.conversion != -1:
                        unsupported(node, "les formats de f-string ne sont pris en charge que dans print()")
                    parts.append(self.to_str(part.value))
            return (" + ".join(parts) if parts else "''"), ADD
        out = []
        for part in node.values:
            if isinstance(part, ast.Constant):
                out.append(cs_escape(part.value, True))
            else:
                if part.conversion != -1:
                    unsupported(node, "les conversions !r / !s des f-strings ne sont pas prises en charge")
                digits = self.spec_digits(part.format_spec)
                out.append(self.interpolation(part.value, digits))
        return '$"' + "".join(out) + '"', ATOM

    def interpolation(self, value_node, digits):
        text = self.ex(value_node)[0]
        if digits is not None and self.t(value_node) not in NUMERIC:
            unsupported(value_node, "le format « .Nf » ne s'applique qu'à un nombre")
        if ":" in text or "?" in text:
            text = f"({text})"
        return "{" + text + (f":F{digits}" if digits is not None else "") + "}"

    def call(self, node):
        name = node.func.id
        args = node.args

        if name == "input":
            unsupported(
                node,
                "input() n'est traduit que dans une affectation : x = input(...), x = int(input(...)) ou x = float(input(...))",
            )

        arg_type = self.t(args[0]) if args else None
        text = self.ex(args[0])[0] if args else ""

        if name == "int":
            if arg_type == INT:
                return self.ex(args[0])
            if arg_type == FLOAT:
                return (f"Trunc({text})", ATOM) if self.pas else (f"(int){self.w(args[0], UNARY)}", UNARY)
            if self.pas:
                self.needs_sysutils = True
                return f"StrToInt({text})", ATOM
            return f"int.Parse({text})", ATOM

        if name == "float":
            if arg_type == STR:
                if self.pas:
                    self.needs_sysutils = True
                    return f"StrToFloat({text})", ATOM
                self.note("double.Parse dépend des réglages régionaux de l'ordinateur (virgule ou point décimal).")
                return f"double.Parse({text})", ATOM
            if self.pas or arg_type == FLOAT:
                return self.ex(args[0])
            return f"(double){self.w(args[0], UNARY)}", UNARY

        if name == "str":
            if self.pas:
                return self.to_str(args[0]), ATOM if arg_type != STR else ADD
            if arg_type == STR:
                return self.ex(args[0])
            return f"{self.w(args[0], ATOM)}.ToString()", ATOM

        if name == "abs":
            return (f"Abs({text})" if self.pas else f"Math.Abs({text})"), ATOM

        if name == "len":
            return (f"Length({text})" if self.pas else f"{self.w(args[0], ATOM)}.Length"), ATOM

        if name in ("min", "max"):
            other = self.ex(args[1])[0]
            fn = name.capitalize()
            if self.pas:
                self.needs_math = True
                return f"{fn}({text}, {other})", ATOM
            return f"Math.{fn}({text}, {other})", ATOM

        if name == "round":
            return (f"Round({text})", ATOM) if self.pas else (f"(int)Math.Round({text})", UNARY)

        unsupported(node)

    # -- instructions -------------------------------------------------------

    def block(self, stmts):
        for stmt in stmts:
            try:
                self.flush_comments(stmt.lineno)
                self.stmt(stmt)
            except Unsupported as exc:
                self.errors.append({"line": exc.line, "message": exc.message})
            except Skip:
                pass

    def open_body(self, stmts):
        self.add("begin" if self.pas else "{")
        self.depth += 1
        self.block(stmts)
        self.depth -= 1

    def stmt(self, node):
        if isinstance(node, ast.Assign):
            self.assign(node)
        elif isinstance(node, ast.AugAssign):
            self.aug_assign(node)
        elif isinstance(node, ast.Expr):
            value = node.value
            if is_call(value, "print"):
                self.print_stmt(value, node.lineno)
            # une chaîne seule (docstring) est ignorée
        elif isinstance(node, ast.If):
            self.if_stmt(node, False)
        elif isinstance(node, ast.While):
            self.while_stmt(node)
        elif isinstance(node, ast.For):
            self.for_stmt(node)
        elif isinstance(node, ast.Break):
            self.add("Break;" if self.pas else "break;", node.lineno)
        elif isinstance(node, ast.Continue):
            self.add("Continue;" if self.pas else "continue;", node.lineno)
        elif isinstance(node, ast.Pass):
            self.add("// pass", node.lineno)
        else:
            unsupported(node)

    @staticmethod
    def input_pattern(value):
        """Reconnaît x = input(..), x = int(input(..)), x = float(input(..))."""
        kind, inner = STR, value
        if is_call(value, "int") and len(value.args) == 1 and is_call(value.args[0], "input"):
            kind, inner = INT, value.args[0]
        elif is_call(value, "float") and len(value.args) == 1 and is_call(value.args[0], "input"):
            kind, inner = FLOAT, value.args[0]
        if not is_call(inner, "input"):
            return None, None
        return kind, (inner.args[0] if inner.args else None)

    def assign(self, node):
        target = self.ident(node.targets[0].id)
        kind, prompt = self.input_pattern(node.value)
        if kind:
            if self.pas:
                if prompt is not None:
                    self.add(f"Write({self.ex(prompt)[0]});", node.lineno)
                self.add(f"ReadLn({target});", None if prompt is None else None)
            else:
                if prompt is not None:
                    self.add(f"Console.Write({self.ex(prompt)[0]});", node.lineno)
                reader = {
                    STR: "Console.ReadLine()",
                    INT: "int.Parse(Console.ReadLine())",
                    FLOAT: "double.Parse(Console.ReadLine())",
                }[kind]
                if kind == FLOAT:
                    self.note("double.Parse dépend des réglages régionaux de l'ordinateur (virgule ou point décimal).")
                self.add(f"{target} = {reader};", node.lineno if prompt is None else None)
            return
        value = self.ex(node.value)[0]
        self.add(f"{target} := {value};" if self.pas else f"{target} = {value};", node.lineno)

    def aug_assign(self, node):
        name = node.target.id
        target = self.ident(name)
        op = type(node.op)
        if self.pas or op in (ast.Pow,):
            fake = ast.copy_location(
                ast.BinOp(left=ast.Name(id=name, ctx=ast.Load()), op=node.op, right=node.value), node
            )
            self.add(f"{target} := {self.ex(fake)[0]};" if self.pas else f"{target} = {self.ex(fake)[0]};", node.lineno)
            return
        symbol = {ast.Add: "+=", ast.Sub: "-=", ast.Mult: "*=", ast.Div: "/=", ast.FloorDiv: "/=", ast.Mod: "%="}[op]
        if op in (ast.FloorDiv, ast.Mod):
            self.note("// et % : Python arrondit vers le bas, Pascal et C# vers zéro. Les résultats diffèrent pour les nombres négatifs.")
        self.add(f"{target} {symbol} {self.ex(node.value)[0]};", node.lineno)

    def if_stmt(self, node, is_elif):
        cond = self.ex(node.test)[0]
        head = "else if " if is_elif else "if "
        self.add(f"{head}{cond} then" if self.pas else f"{head}({cond})", node.lineno)
        self.open_body(node.body)
        closer = "end" if self.pas else "}"
        orelse = node.orelse
        if not orelse:
            self.add(closer + (";" if self.pas else ""))
            return
        self.add(closer)
        if len(orelse) == 1 and isinstance(orelse[0], ast.If):
            self.flush_comments(orelse[0].lineno)
            self.if_stmt(orelse[0], True)
        else:
            self.add("else")
            self.open_body(orelse)
            self.add(closer + (";" if self.pas else ""))

    def while_stmt(self, node):
        cond = self.ex(node.test)[0]
        self.add(f"while {cond} do" if self.pas else f"while ({cond})", node.lineno)
        self.open_body(node.body)
        self.add("end;" if self.pas else "}")

    def for_stmt(self, node):
        name = node.target.id
        if self.env[name] != INT:
            unsupported(node, f"la variable de boucle « {name} » doit rester un entier")
        var = self.ident(name)
        args = node.iter.args
        start_node = args[0] if len(args) > 1 else None
        stop_node = args[1] if len(args) > 1 else args[0]
        step = const_int(args[2]) if len(args) == 3 else 1
        start = self.ex(start_node)[0] if start_node is not None else "0"
        stop_text = self.w(stop_node, ADD)
        stop_value = const_int(stop_node)
        ascending = step > 0

        if self.pas:
            if step in (1, -1):
                if step == 1:
                    limit = str(stop_value - 1) if stop_value is not None else f"{stop_text} - 1"
                    self.add(f"for {var} := {start} to {limit} do", node.lineno)
                else:
                    limit = str(stop_value + 1) if stop_value is not None else f"{stop_text} + 1"
                    self.add(f"for {var} := {start} downto {limit} do", node.lineno)
                self.open_body(node.body)
                self.add("end;")
                return
            if any(isinstance(n, ast.Continue) for n in ast.walk(ast.Module(body=node.body, type_ignores=[]))):
                unsupported(node, "range() avec un pas autre que 1 ou -1 et « continue » : non traduisible en Pascal")
            self.add(f"{var} := {start};", node.lineno)
            self.add(f"while {var} {'<' if ascending else '>'} {stop_text} do")
            self.add("begin")
            self.depth += 1
            self.block(node.body)
            self.add(f"{var} := {var} {'+' if ascending else '-'} {abs(step)};")
            self.depth -= 1
            self.add("end;")
            return

        comparison = "<" if ascending else ">"
        if step == 1:
            update = f"{var}++"
        elif step == -1:
            update = f"{var}--"
        else:
            update = f"{var} {'+=' if ascending else '-='} {abs(step)}"
        self.add(f"for ({var} = {start}; {var} {comparison} {stop_text}; {update})", node.lineno)
        self.open_body(node.body)
        self.add("}")

    # -- print ---------------------------------------------------------------

    def print_items(self, arg):
        """Découpe un argument de print en éléments ('lit', texte) / ('val', noeud, type, décimales)."""
        if isinstance(arg, ast.JoinedStr):
            items = []
            for part in arg.values:
                if isinstance(part, ast.Constant):
                    items.append(("lit", part.value))
                else:
                    if part.conversion != -1:
                        unsupported(arg, "les conversions !r / !s des f-strings ne sont pas prises en charge")
                    digits = self.spec_digits(part.format_spec)
                    kind = self.t(part.value)
                    if digits is not None and kind != FLOAT and (self.pas or kind not in NUMERIC):
                        unsupported(part.value, "le format « .Nf » ne s'applique qu'à un nombre réel")
                    items.append(("val", part.value, kind, digits))
            return items
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            return [("lit", arg.value)]
        return [("val", arg, self.t(arg), None)]

    def print_stmt(self, call, lineno):
        sep, end = " ", "\n"
        for keyword in call.keywords:
            ok = isinstance(keyword.value, ast.Constant) and isinstance(keyword.value.value, str)
            if keyword.arg not in ("sep", "end") or not ok:
                unsupported(call, "print() : seuls sep= et end= (avec un texte constant) sont pris en charge")
            if keyword.arg == "sep":
                sep = keyword.value.value
            else:
                end = keyword.value.value

        items = []
        for index, arg in enumerate(call.args):
            if index and sep:
                items.append(("lit", sep))
            items.extend(self.print_items(arg))
        if end not in ("\n", ""):
            items.append(("lit", end))

        merged = []
        for item in items:  # fusionne les littéraux voisins
            if item[0] == "lit" and merged and merged[-1][0] == "lit":
                merged[-1] = ("lit", merged[-1][1] + item[1])
            else:
                merged.append(item)
        newline = end == "\n"
        self.print_pascal(merged, newline, lineno) if self.pas else self.print_csharp(merged, newline, lineno)

    def print_pascal(self, items, newline, lineno):
        parts = []
        for item in items:
            if item[0] == "lit":
                parts.append(pas_str(item[1]))
                continue
            _, node, kind, digits = item
            text = self.ex(node)[0]
            if kind == FLOAT:
                if digits is None:
                    self.note("Pascal affiche les réels en notation scientifique : « :0:2 » impose 2 décimales (à adapter).")
                parts.append(f"{text}:0:{2 if digits is None else digits}")
            else:
                parts.append(text)
        if not parts:
            if newline:
                self.add("WriteLn;", lineno)
            return
        self.add(f"{'WriteLn' if newline else 'Write'}({', '.join(parts)});", lineno)

    def print_csharp(self, items, newline, lineno):
        method = "Console.WriteLine" if newline else "Console.Write"
        if not items:
            if newline:
                self.add("Console.WriteLine();", lineno)
            return
        if len(items) == 1:
            item = items[0]
            if item[0] == "lit":
                self.add(f"{method}({cs_str(item[1])});", lineno)
                return
            if item[3] is None:
                self.add(f"{method}({self.ex(item[1])[0]});", lineno)
                return
        body = []
        for item in items:
            if item[0] == "lit":
                body.append(cs_escape(item[1], True))
            else:
                body.append(self.interpolation(item[1], item[3]))
        self.add(f'{method}($"{"".join(body)}");', lineno)


# --------------------------------------------------------------------------
# Programme complet
# --------------------------------------------------------------------------


def collect_comments(code):
    full, trailing = {}, {}
    try:
        for token in tokenize.generate_tokens(io.StringIO(code).readline):
            if token.type == tokenize.COMMENT:
                text = token.string.lstrip("#").strip()
                if token.line.strip().startswith("#"):
                    full[token.start[0]] = text
                else:
                    trailing[token.start[0]] = text
    except (tokenize.TokenError, IndentationError, SyntaxError):
        pass
    return full, trailing


def default_value(kind, pascal):
    return {INT: "0", FLOAT: "0.0", STR: '""', BOOL: "false"}[kind]


def assemble(gen, pascal):
    variables = [(name, kind) for name, kind in gen.env.items() if kind != UNKNOWN]
    out = []
    if pascal:
        out.append("{$mode objfpc}{$H+}")
        out.append("program Programme;")
        out.append("")
        uses = []
        if gen.needs_sysutils:
            uses.append("SysUtils")
        if gen.needs_math:
            uses.append("Math")
        if uses:
            out.append("uses " + ", ".join(uses) + ";")
            out.append("")
        if variables:
            names = {INT: "Integer", FLOAT: "Real", STR: "string", BOOL: "Boolean"}
            out.append("var")
            out.extend(f"  {gen.ident(name)}: {names[kind]};" for name, kind in variables)
            out.append("")
        out.append("begin")
        out.extend(gen.lines)
        out.append("end.")
    else:
        names = {INT: "int", FLOAT: "double", STR: "string", BOOL: "bool"}
        out += ["using System;", "", "class Program", "{", "    static void Main()", "    {"]
        for name, kind in variables:
            out.append(f"        {names[kind]} {gen.ident(name)} = {default_value(kind, False)};")
        if variables and gen.lines:
            out.append("")
        out.extend(gen.lines)
        out += ["    }", "}"]
    return "\n".join(out) + "\n"


def translate_program(code, target):
    """Renvoie un JSON : {ok, code, errors: [{line, message}], notes: [str]}."""

    def result(ok, text="", errors=(), notes=()):
        return json.dumps({"ok": ok, "code": text, "errors": list(errors), "notes": list(notes)}, ensure_ascii=False)

    pascal = target == "pascal"
    try:
        tree = ast.parse(code, "<programme>")
    except SyntaxError as exc:
        return result(False, errors=[{"line": exc.lineno, "message": f"erreur de syntaxe Python : {exc.msg}"}])

    env, errors = {}, []
    for _ in range(4):  # plusieurs passes : un entier peut devenir réel plus loin dans le programme
        before = dict(env)
        infer_block(tree.body, env, errors)
        if env == before:
            break
    seen = set()
    errors = [e for e in errors if (e["line"], e["message"]) not in seen and not seen.add((e["line"], e["message"]))]
    if errors:
        return result(False, errors=errors)

    if pascal:
        lowered = {}
        for name in env:
            other = lowered.setdefault(name.lower(), name)
            if other != name:
                return result(
                    False,
                    errors=[{"line": None, "message": f"Pascal ne distingue pas majuscules et minuscules : « {other} » et « {name} » désigneraient la même variable"}],
                )

    gen = Generator(pascal, env, collect_comments(code))
    gen.depth = 1 if pascal else 2
    gen.block(tree.body)
    if gen.errors:
        return result(False, errors=gen.errors)
    gen.flush_comments()
    return result(True, assemble(gen, pascal), notes=gen.notes)
