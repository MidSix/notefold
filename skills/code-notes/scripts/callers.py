#!/usr/bin/env python3
"""List who calls each function defined in a file (for the "Usada por" field).

Usage:
  callers.py FILE [--root DIR] [NAME ...]

For every function/method defined in FILE (or only NAME ...), prints each
call site with the function that CONTAINS the call, so "Usada por" can be
written from facts instead of a quick grep. Methods that share a name
(multiple dispatch, overloads) are told apart by their signature line.

--root DIR  also search the other source files with the same extension under
            DIR (skips .git, node_modules, build folders).

Heuristic, language-agnostic parser (Julia, Python, JS/TS, C/C++/C#/Java,
Go, Rust, Ruby, Lua, shell): definitions are found with regexes and a call is
attributed to the innermost definition whose body contains it (by
indentation). Always sanity-check surprising results against the code.
"""
import os
import re
import sys

C_KEYWORDS = {"if", "for", "while", "switch", "catch", "return", "sizeof", "else", "do", "new", "delete", "throw", "case"}

DEF_PATTERNS = {
    "julia": [
        r"^\s*(?:@\w+\s+)*(?:function|macro)\s+(?:\([^)]*\)\s*)?([\w.!]+)",
        r"^\s*(?:@\w+\s+)*([\w.!]+)(?:\{[^}]*\})?\([^=]*\)\s*(?:::\s*\S+\s*)?(?:where\s.*)?=(?!=)",
    ],
    "python": [r"^\s*(?:async\s+)?def\s+(\w+)"],
    "js": [
        r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)",
        r"^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::\s*[^=]+)?=>",
        r"^\s*(?:public|private|protected|static|async|readonly|\s)*(\w+)\s*(?:<[^>]*>)?\([^;]*\)\s*(?::\s*[^{]+)?\{\s*$",
    ],
    "go": [r"^\s*func\s+(?:\([^)]*\)\s*)?(\w+)"],
    "rust": [r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?fn\s+(\w+)"],
    "c": [r"^\s*(?:[\w:<>,*&~\[\]]+\s+)+\**&?([\w:~]+)\s*\([^;]*\)\s*(?:const)?\s*(?:noexcept)?\s*(?:override)?\s*\{?\s*$"],
    "ruby": [r"^\s*def\s+(?:self\.)?([\w?!]+)"],
    "lua": [r"^\s*(?:local\s+)?function\s+([\w.:]+)", r"^\s*(?:local\s+)?([\w.]+)\s*=\s*function\b"],
    "shell": [r"^\s*(?:function\s+)?(\w+)\s*\(\)\s*\{?"],
}
LANG_BY_EXT = {
    ".jl": "julia", ".py": "python", ".js": "js", ".mjs": "js", ".cjs": "js", ".ts": "js", ".tsx": "js", ".jsx": "js",
    ".go": "go", ".rs": "rust", ".c": "c", ".h": "c", ".cc": "c", ".cpp": "c", ".hpp": "c", ".cxx": "c", ".cs": "c",
    ".java": "c", ".kt": "c", ".rb": "ruby", ".lua": "lua", ".sh": "shell", ".bash": "shell", ".zsh": "shell",
}
LINE_COMMENT = {"julia": "#", "python": "#", "ruby": "#", "shell": "#", "lua": "--"}
SKIP_DIRS = {".git", "node_modules", "dist", "build", "out", "target", ".venv", "venv", "__pycache__", ".vscode-test"}


def indent(line):
    return len(line) - len(line.lstrip())


def code_mask(lines, lang):
    """True for lines that are code (not comments or docstrings)."""
    comment = LINE_COMMENT.get(lang, "//")
    mask, in_doc, in_block = [], False, False
    for line in lines:
        s = line.strip()
        if lang in ("julia", "python") and s.count('"""') % 2 == 1:
            mask.append(False)
            in_doc = not in_doc
            continue
        if in_doc:
            mask.append(False)
            continue
        if lang not in ("julia", "python", "ruby", "shell", "lua"):
            if in_block:
                mask.append(False)
                if "*/" in s:
                    in_block = False
                continue
            if s.startswith("/*"):
                mask.append(False)
                in_block = "*/" not in s
                continue
        mask.append(bool(s) and not s.startswith(comment) and not (lang == "julia" and s.startswith('"""')))
    return mask


def find_defs(lines, lang, mask):
    pats = [re.compile(p) for p in DEF_PATTERNS[lang]]
    defs = []
    for i, line in enumerate(lines):
        if not mask[i]:
            continue
        for p in pats:
            m = p.match(line)
            if m and m.group(1).split(".")[-1].split("::")[-1] not in C_KEYWORDS:
                defs.append({"name": m.group(1), "line": i, "indent": indent(line)})
                break
    for d in defs:
        d["end"] = def_end(lines, mask, d, lang)
    return defs


def def_end(lines, mask, d, lang):
    """Last line of a definition's body, by indentation."""
    i0 = d["line"]
    head = lines[i0].rstrip()
    one_liner = (lang == "julia" and not re.match(r"^\s*(?:@\w+\s+)*(function|macro)\b", head)) or (
        head.endswith(";") and "{" not in head
    )
    if one_liner:
        return i0
    last = i0
    for j in range(i0 + 1, len(lines)):
        s = lines[j].strip()
        if not s or not mask[j]:
            continue
        if indent(lines[j]) <= d["indent"]:
            if re.match(r"^[)\]]|^where\b|^->|^\{$", s):  # signature continuation
                last = j
                continue
            if re.match(r"^(end\b|\}|\);?$)", s):
                return j
            return last
        last = j
    return last


def enclosing(defs, line):
    inner = None
    for d in defs:
        if d["line"] < line <= d["end"] and (inner is None or d["line"] > inner["line"]):
            inner = d
    return inner


def label(lines, d):
    sig = lines[d["line"]].strip()
    return f"{d['name']} (L{d['line'] + 1}: {sig[:70]})"


def analyse(path, lang):
    with open(path, encoding="utf-8", errors="replace") as f:
        lines = f.read().split("\n")
    mask = code_mask(lines, lang)
    return lines, mask, find_defs(lines, lang, mask)


def calls_in(lines, mask, defs, name, skip_lines=()):
    base = re.escape(name.split(".")[-1].split("::")[-1])
    pat = re.compile(rf"(?<![\w.]){base}\.?\s*\(")
    hits = []
    for i, line in enumerate(lines):
        if not mask[i] or i in skip_lines:
            continue
        code = re.sub(r'"(?:\\.|[^"\\])*"', '""', line)  # ignore string contents
        if pat.search(code):
            hits.append((i, enclosing(defs, i)))
    return hits


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 2
    path, rest = argv[0], argv[1:]
    root = None
    if "--root" in rest:
        k = rest.index("--root")
        root = rest[k + 1]
        rest = rest[:k] + rest[k + 2:]
    ext = os.path.splitext(path)[1].lower()
    lang = LANG_BY_EXT.get(ext)
    if not lang:
        print(f"Extensión no soportada: {ext}")
        return 2
    lines, mask, defs = analyse(path, lang)
    names = rest or list(dict.fromkeys(d["name"] for d in defs))

    others = []
    if root:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [x for x in dirnames if x not in SKIP_DIRS]
            for fn in filenames:
                p = os.path.join(dirpath, fn)
                if os.path.splitext(fn)[1].lower() == ext and os.path.abspath(p) != os.path.abspath(path):
                    others.append(p)
        others = others[:3000]
    other_data = {p: analyse(p, lang) for p in others}

    for name in names:
        own = [d for d in defs if d["name"] == name]
        where = ", ".join(f"L{d['line'] + 1}" for d in own) or "no definida en este archivo"
        print(f"\n{name}  [definida en {where}]")
        if len(own) > 1:
            for d in own:
                print(f"  método: {label(lines, d)}")
        hits = calls_in(lines, mask, defs, name, skip_lines={d["line"] for d in own})
        by_caller = {}
        for i, enc in hits:
            key = label(lines, enc) if enc else "(nivel superior del archivo)"
            by_caller.setdefault(key, []).append(i + 1)
        for p, (olines, omask, odefs) in other_data.items():
            for i, enc in calls_in(olines, omask, odefs, name):
                key = f"{os.path.relpath(p, root)} · " + (label(olines, enc) if enc else "(nivel superior)")
                by_caller.setdefault(key, []).append(i + 1)
        if not by_caller:
            scope = "en el proyecto" if root else "en este archivo (usa --root para buscar en el proyecto)"
            print(f"  nadie la llama {scope} → probablemente API pública o hook llamado desde fuera")
        for caller, at in by_caller.items():
            print(f"  llamada desde {caller} en L{', L'.join(map(str, at))}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
