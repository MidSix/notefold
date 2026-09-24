#!/usr/bin/env python3
"""Remove NoteFold blocks (@note-start … @note-body-end, @note-end), keeping
the code intact. DESTRUCTIVE: run --dry-run first and ask the user.

Usage:
  remove_notes.py --dry-run PATH...   list what would be removed; changes nothing
  remove_notes.py --apply PATH...     remove the notes, with backup + diff check

PATH can be a file or a directory (searched recursively, skipping .git,
node_modules, build folders). Only files that contain notes are touched.

--apply, per file:
  1. refuses the whole run if any file has malformed notes (orphan or missing
     markers), so no half-removed block is ever left behind;
  2. copies the original to a backup folder (printed at the end);
  3. removes exactly the note lines, preserving line endings byte for byte;
  4. verifies with a before/after diff that every removed line belonged to a
     note, that no line was added or modified, and that no marker is left.
     If any check fails the original file is restored from the backup.
The diffs are saved next to the backup for the user to inspect.
"""
import datetime
import difflib
import os
import re
import shutil
import sys
import tempfile

MARKER = re.compile(r"@note-(start|body-end|end)\b")
START = re.compile(r"^(\s*)([^\w\s]*)\s*@note-start\b(.*)$")
SKIP_DIRS = {".git", "node_modules", "dist", "build", "out", "target", ".venv", "venv", "__pycache__", ".vscode-test"}
LINE_TOKENS = ("#", "//", "--", ";", "%", "'")


def marker(line):
    m = MARKER.search(line)
    if not m or re.search(r"[\w\"'`]", line[: m.start()].strip()):
        return None
    return m.group(1)


def parse(lines):
    """Note blocks as (start, body_end, end) plus a list of problems."""
    notes, problems, i = [], [], 0
    while i < len(lines):
        kind = marker(lines[i])
        if kind is None:
            i += 1
            continue
        if kind != "start":
            problems.append((i, f"@note-{kind} sin @note-start"))
            i += 1
            continue
        m = START.match(lines[i])
        token = m.group(2) if m else ""
        block = bool(token) and token not in LINE_TOKENS
        j = i + 1
        while j < len(lines) and marker(lines[j]) is None:
            if not block and lines[j].strip() and not lines[j].strip().startswith(token):
                break
            j += 1
        if j >= len(lines) or marker(lines[j]) != "body-end":
            problems.append((i, "nota sin @note-body-end"))
            i += 1
            continue
        k = j + 1
        while k < len(lines) and marker(lines[k]) is None:
            k += 1
        if k >= len(lines) or marker(lines[k]) != "end":
            problems.append((i, "nota sin @note-end"))
            i = j + 1
            continue
        notes.append((i, j, k))
        i = k + 1
    return notes, problems


def title(lines, start, body_end):
    for l in lines[start + 1 : body_end]:
        t = re.sub(r"^\s*[^\w\s]*\s?", "", l.rstrip("\r\n")).strip()
        if t:
            return t.lstrip("#").strip()[:70]
    return "(nota vacía)"


def collect(paths):
    files = []
    for p in paths:
        if os.path.isdir(p):
            for dirpath, dirnames, filenames in os.walk(p):
                dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
                files += [os.path.join(dirpath, f) for f in sorted(filenames)]
        else:
            files.append(p)
    out = []
    for f in files:
        try:
            with open(f, encoding="utf-8", newline="") as fh:
                text = fh.read()
        except (UnicodeDecodeError, OSError):
            continue
        if "@note-" in text:
            out.append((f, text))
    return out


def plan(paths):
    result = []
    for f, text in collect(paths):
        lines = text.splitlines(keepends=True)
        notes, problems = parse([l.rstrip("\r\n") for l in lines])
        if notes or problems:
            result.append((f, text, lines, notes, problems))
    return result


def dry_run(paths):
    items = plan(paths)
    if not items:
        print("No hay notas de NoteFold en las rutas indicadas.")
        return 0
    total_notes = total_lines = 0
    bad = False
    for f, _, lines, notes, problems in items:
        n_lines = sum(b - a + 2 for a, b, _ in notes)
        total_notes += len(notes)
        total_lines += n_lines
        print(f"\n{f}: {len(notes)} notas, {n_lines} líneas de comentario a eliminar")
        for a, b, e in notes:
            print(f"  L{a + 1}-{b + 1} y L{e + 1}: {title(lines, a, b)}")
        for line, msg in problems:
            bad = True
            print(f"  ERROR L{line + 1}: {msg}")
    print(f"\nTOTAL: {total_notes} notas en {len(items)} archivos, {total_lines} líneas de comentario. Ninguna línea de código.")
    if bad:
        print("HAY NOTAS MAL FORMADAS: --apply se negará a ejecutar hasta que se corrijan.")
        return 1
    return 0


def not_comment_line(lines, notes):
    """Independent of the parser's ranges: in line-comment notes every removed
    line must start with the comment token. Returns the first offender."""
    for a, b, e in notes:
        m = START.match(lines[a].rstrip("\r\n"))
        token = m.group(2) if m else ""
        if not token or token not in LINE_TOKENS:
            continue  # block style: the body is inside /* ... */ by construction
        for i in list(range(a, b + 1)) + [e]:
            s = lines[i].strip()
            if s and not s.startswith(token):
                return i
    return None


def verify(before, after, removable):
    """Every diff op must be a deletion of a note line."""
    sm = difflib.SequenceMatcher(a=before, b=after, autojunk=False)
    for op, a0, a1, b0, b1 in sm.get_opcodes():
        if op == "equal":
            continue
        if op != "delete":
            return f"el diff contiene una operación '{op}' (líneas {a0 + 1}-{a1}): se habría añadido o modificado código"
        outside = [i for i in range(a0, a1) if i not in removable]
        if outside:
            return f"se habría eliminado la línea {outside[0] + 1}, que no pertenece a ninguna nota"
    if len(before) - len(after) != len(removable):
        return "el número de líneas eliminadas no coincide con las líneas de las notas"
    if any(marker(l.rstrip("\r\n")) for l in after):
        return "quedan marcadores @note- en el archivo"
    return None


def apply(paths):
    items = plan(paths)
    if not items:
        print("No hay notas de NoteFold en las rutas indicadas. No se ha cambiado nada.")
        return 0
    broken = [(f, p) for f, _, _, _, p in items if p]
    if broken:
        for f, problems in broken:
            for line, msg in problems:
                print(f"{f}:{line + 1}: {msg}")
        print("ABORTADO: hay notas mal formadas. No se ha cambiado ningún archivo.")
        return 1

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_root = os.path.join(tempfile.gettempdir(), "code-notes-backups", stamp)
    os.makedirs(backup_root, exist_ok=True)
    failed = False
    total = 0
    for f, text, lines, notes, _ in items:
        rel = os.path.abspath(f).lstrip(os.sep)
        backup = os.path.join(backup_root, rel)
        os.makedirs(os.path.dirname(backup), exist_ok=True)
        shutil.copy2(f, backup)

        removable = set()
        for a, b, e in notes:
            removable.update(range(a, b + 1))
            removable.add(e)
        not_comment = not_comment_line(lines, notes)
        if not_comment is not None:
            failed = True
            print(f"{f}: NO MODIFICADO, la línea {not_comment + 1} iba a eliminarse pero no es un comentario")
            continue
        after = [l for i, l in enumerate(lines) if i not in removable]
        # A trailing @note-end on the last line: drop the line break it leaves behind.
        if after and lines and not lines[-1].endswith(("\n", "\r")) and (len(lines) - 1) in removable:
            after[-1] = after[-1].rstrip("\r\n")

        problem = verify([l.rstrip("\r\n") for l in lines], [l.rstrip("\r\n") for l in after], removable)
        diff_path = backup + ".diff"
        with open(diff_path, "w", encoding="utf-8") as d:
            d.writelines(difflib.unified_diff(lines, after, f"{f} (antes)", f"{f} (después)"))
        if problem:
            failed = True
            print(f"{f}: NO MODIFICADO, falló la verificación: {problem}")
            continue
        with open(f, "w", encoding="utf-8", newline="") as fh:
            fh.write("".join(after))
        # Re-read from disk and verify again what was actually written.
        with open(f, encoding="utf-8", newline="") as fh:
            written = fh.read().splitlines(keepends=True)
        problem = verify([l.rstrip("\r\n") for l in lines], [l.rstrip("\r\n") for l in written], removable)
        if problem:
            shutil.copy2(backup, f)
            failed = True
            print(f"{f}: RESTAURADO desde la copia, falló la verificación tras escribir: {problem}")
            continue
        total += len(notes)
        print(f"{f}: {len(notes)} notas eliminadas ({len(removable)} líneas de comentario). Verificado: 0 líneas de código eliminadas o modificadas.")
    print(f"\nTOTAL: {total} notas eliminadas.")
    print(f"Copia de seguridad y diffs antes/después: {backup_root}")
    return 1 if failed else 0


def main(argv):
    if len(argv) < 2 or argv[0] not in ("--dry-run", "--apply"):
        print(__doc__)
        return 2
    return dry_run(argv[1:]) if argv[0] == "--dry-run" else apply(argv[1:])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
