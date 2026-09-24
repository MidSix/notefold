#!/usr/bin/env python3
"""Validate NoteFold blocks (@note-start / @note-body-end / @note-end).

Usage:
  check_notes.py FILE...                 validate notes; exit 1 on any error
  check_notes.py --no-render FILE...     same, skipping the LaTeX/Mermaid check
  check_notes.py --snapshot FILE...      save the code of FILE (notes removed)
                                         BEFORE editing it
  check_notes.py --verify-code FILE...   after editing: the code without notes
                                         must be identical to the snapshot
  check_notes.py --new-id [-n N] FILE... print N fresh 6-char ids unused in FILEs

Checks: every note is complete and not nested, ids unique, colours valid,
the title (first body line) is "## ...", at most 60 characters, without
backticks or LaTeX, and LaTeX / Mermaid render with KaTeX / Mermaid (needs
node; dependencies are installed once into ~/.cache/code-notes-render).
The comment token is read from each @note-start line, so any language works.
"""
import hashlib
import json
import os
import random
import re
import shutil
import string
import subprocess
import sys
import tempfile

COLORS = {"blue", "green", "yellow", "red", "purple"}
LINE_TOKENS = ("#", "//", "--", ";", "%", "'")
START = re.compile(r"^(\s*)([^\w\s]*)\s*@note-start\b(.*)$")
MARKER = re.compile(r"@note-(start|body-end|end)\b")
TITLE_MAX = 60
HERE = os.path.dirname(os.path.abspath(__file__))
SNAPSHOTS = os.path.join(tempfile.gettempdir(), "code-notes-snapshots")


def marker(line):
    """Kind of note marker on a line that is a comment, else None."""
    m = MARKER.search(line)
    if not m:
        return None
    # Markers only count when preceded by comment punctuation (or nothing,
    # for "@note-body-end */" in block style), never by code or strings.
    if re.search(r"[\w\"'`]", line[: m.start()].strip()):
        return None
    return m.group(1)


def read_lines(path):
    with open(path, encoding="utf-8", newline="") as f:
        return f.read().splitlines()


def body_text(lines, token, block):
    out = []
    for l in lines:
        if not block and l.strip().startswith(token):
            l = l.lstrip()[len(token):]
        out.append(l.rstrip())
    nonblank = [x for x in out if x.strip()]
    cut = min((len(x) - len(x.lstrip()) for x in nonblank), default=0)
    return "\n".join(x[cut:] if x.strip() else "" for x in out).strip("\n")


def parse(lines):
    """Returns (notes, errors, warnings, ids); notes are dicts with lines and body."""
    notes, errors, warnings, ids = [], [], [], {}
    i = 0
    while i < len(lines):
        kind = marker(lines[i])
        if kind is None:
            i += 1
            continue
        if kind != "start":
            errors.append((i, f"@note-{kind} sin @note-start"))
            i += 1
            continue
        m = START.match(lines[i])
        token, attrs = (m.group(2), m.group(3)) if m else ("", "")
        block = bool(token) and token not in LINE_TOKENS
        start = i
        j = i + 1
        while j < len(lines) and marker(lines[j]) is None:
            s = lines[j].strip()
            if not block and s and not s.startswith(token):
                errors.append((j, f"línea del cuerpo sin prefijo de comentario '{token}' (¿falta @note-body-end?)"))
                break
            j += 1
        if j >= len(lines) or marker(lines[j]) != "body-end":
            errors.append((start, "nota sin @note-body-end"))
            i = start + 1
            continue
        body_end = j
        k = body_end + 1
        while k < len(lines) and marker(lines[k]) is None:
            k += 1
        if k >= len(lines):
            errors.append((start, "nota sin @note-end"))
            i = body_end + 1
            continue
        if marker(lines[k]) == "start":
            errors.append((start, "nota sin @note-end antes de la siguiente @note-start (las notas no se pueden anidar)"))
            i = k
            continue
        if marker(lines[k]) != "end":
            errors.append((k, "@note-body-end duplicado dentro del código anotado"))
        if k == body_end + 1:
            errors.append((start, "la nota no anota ninguna línea de código"))
        idm = re.search(r"(?:^|\s)id=([A-Za-z0-9_-]+)", attrs)
        if idm:
            if idm.group(1) in ids:
                errors.append((start, f"id duplicado '{idm.group(1)}' (también en la línea {ids[idm.group(1)] + 1})"))
            ids.setdefault(idm.group(1), start)
        else:
            warnings.append((start, "nota sin id"))
        cm = re.search(r"(?:^|\s)color=(\w+)", attrs)
        if cm and cm.group(1).lower() not in COLORS:
            errors.append((start, f"color '{cm.group(1)}' no válido ({', '.join(sorted(COLORS))})"))
        body = body_text(lines[start + 1 : body_end], token, block)
        notes.append({"start": start, "body_end": body_end, "end": k, "body": body})
        i = k + 1
    return notes, errors, warnings, ids


def check_title(note, errors):
    first = next((l for l in note["body"].split("\n") if l.strip()), "")
    if not first.startswith("## "):
        errors.append((note["start"], "la primera línea del cuerpo debe ser el título: '## nombre: qué hace'"))
        return
    title = first[3:].strip()
    if len(title) > TITLE_MAX:
        errors.append((note["start"], f"título de {len(title)} caracteres (máx. {TITLE_MAX}): acórtalo, el detalle va en la descripción"))
    if "`" in title or "$" in title:
        errors.append((note["start"], "el título no puede llevar backticks ni LaTeX (se muestra como texto plano junto al código)"))


def check_render(path, notes, errors, warnings):
    if not any("$" in n["body"] or "```mermaid" in n["body"] for n in notes):
        return
    if not shutil.which("node"):
        warnings.append((0, "node no está instalado: no se ha validado el LaTeX/Mermaid"))
        return
    payload = json.dumps([{"file": path, "line": n["start"], "body": n["body"]} for n in notes])
    try:
        r = subprocess.run(["node", os.path.join(HERE, "check_render.mjs")], input=payload, capture_output=True, text=True, timeout=300)
        for p in json.loads(r.stdout or "[]"):
            errors.append((p["line"], p["msg"]))
        if r.returncode != 0:
            warnings.append((0, f"no se pudo validar LaTeX/Mermaid: {r.stderr.strip()[:200]}"))
    except Exception as e:  # never block the structural check on this
        warnings.append((0, f"no se pudo validar LaTeX/Mermaid: {e}"))


def code_without_notes(lines):
    notes, errors, _, _ = parse(lines)
    drop = set()
    for n in notes:
        drop.update(range(n["start"], n["body_end"] + 1))
        drop.add(n["end"])
    return [l for i, l in enumerate(lines) if i not in drop], errors


def snapshot_path(path):
    return os.path.join(SNAPSHOTS, hashlib.sha1(os.path.abspath(path).encode()).hexdigest() + ".txt")


def snapshot(paths):
    os.makedirs(SNAPSHOTS, exist_ok=True)
    for p in paths:
        code, _ = code_without_notes(read_lines(p))
        with open(snapshot_path(p), "w", encoding="utf-8") as f:
            f.write("\n".join(code))
        print(f"{p}: instantánea guardada ({len(code)} líneas de código)")
    return 0


def verify_code(paths):
    import difflib

    failed = False
    for p in paths:
        sp = snapshot_path(p)
        if not os.path.exists(sp):
            print(f"{p}: no hay instantánea; ejecuta --snapshot ANTES de editar")
            failed = True
            continue
        with open(sp, encoding="utf-8") as f:
            before = f.read().split("\n")
        after, errors = code_without_notes(read_lines(p))
        if errors:
            print(f"{p}: hay notas mal formadas; corrígelas antes de verificar el código")
            failed = True
            continue
        if before == after:
            print(f"{p}: CÓDIGO INTACTO (sin las notas es idéntico a la instantánea)")
        else:
            failed = True
            print(f"{p}: EL CÓDIGO HA CAMBIADO. Diferencias (sin contar las notas):")
            for l in difflib.unified_diff(before, after, "antes", "después", lineterm="", n=1):
                print("  " + l)
    return 1 if failed else 0


def new_ids(argv):
    n = 1
    if argv[:1] == ["-n"]:
        n, argv = int(argv[1]), argv[2:]
    taken = set()
    for p in argv:
        try:
            taken |= set(parse(read_lines(p))[3])
        except FileNotFoundError:
            pass
    out = []
    while len(out) < n:
        new = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
        if new not in taken:
            taken.add(new)
            out.append(new)
    print("\n".join(out))
    return 0


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 2
    if argv[0] == "--new-id":
        return new_ids(argv[1:])
    if argv[0] == "--snapshot":
        return snapshot(argv[1:])
    if argv[0] == "--verify-code":
        return verify_code(argv[1:])
    render = True
    if argv[0] == "--no-render":
        render, argv = False, argv[1:]
    failed = False
    for p in argv:
        notes, errors, warnings, ids = parse(read_lines(p))
        for n in notes:
            check_title(n, errors)
        if render:
            check_render(p, notes, errors, warnings)
        for line, msg in sorted(errors):
            print(f"{p}:{line + 1}: error: {msg}")
        for line, msg in sorted(warnings):
            print(f"{p}:{line + 1}: aviso: {msg}")
        if errors:
            failed = True
            print(f"{p}: {len(errors)} errores")
        else:
            print(f"{p}: OK ({len(notes)} notas)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
