// Pure note-block parser. No `vscode` imports so it can be unit tested.
//
// Line-comment style (preferred when the language has line comments):
//
//   # @note-start id=a1b2
//   # Markdown body...
//   # @note-body-end
//   annotated code
//   # @note-end
//
// Block-comment style (languages without line comments, e.g. CSS/HTML):
//
//   /* @note-start id=a1b2
//   Markdown body...
//   @note-body-end */
//   annotated code
//   /* @note-end */
//
// Nesting policy: notes cannot be nested or overlap. When a `@note-start`
// appears inside the annotated code of another note, the outer note wins and
// the inner block is reported as invalid (its markers are consumed by the
// outer note). If the outer note turns out to be unterminated, it is discarded
// and scanning resumes right after its start, so inner notes are recovered.

export interface CommentSyntax {
  lineComment?: string;
  blockComment?: [string, string];
}

export type NoteStyle = 'line' | 'block';

/** Colour categories a note can use (`@note-start color=green`). Blue is the default. */
export const NOTE_COLORS = ['blue', 'green', 'yellow', 'red', 'purple'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
export const DEFAULT_COLOR: NoteColor = 'blue';

export interface Note {
  /** Optional id from `@note-start id=...`. */
  id?: string;
  /** From `color=...`; unknown or missing values fall back to blue. */
  color: NoteColor;
  style: NoteStyle;
  /** Leading whitespace of the `@note-start` line. */
  indent: string;
  /** Line of `@note-start` (0-based). */
  startLine: number;
  /** Line of `@note-body-end`. Body lines are startLine+1 .. bodyEndLine-1. */
  bodyEndLine: number;
  /** Line of `@note-end`. Annotated code is bodyEndLine+1 .. endLine-1. */
  endLine: number;
  /** Markdown body with comment prefixes and common indentation removed. */
  body: string;
}

export type ProblemKind =
  | 'missing-body-end'
  | 'missing-end'
  | 'missing-start'
  | 'orphan-end'
  | 'nested'
  | 'empty-range'
  | 'duplicate-id';

export interface ParseProblem {
  line: number;
  kind: ProblemKind;
  message: string;
}

export interface ParseResult {
  notes: Note[];
  problems: ParseProblem[];
}

export const codeStart = (n: Note): number => n.bodyEndLine + 1;
export const codeEnd = (n: Note): number => n.endLine - 1;

type MarkerKind = 'start' | 'bodyEnd' | 'end';
interface Marker {
  kind: MarkerKind;
  style: NoteStyle;
  id?: string;
  color?: NoteColor;
}

const MARKER_TOKEN = '@note-';

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class Matcher {
  private readonly lineStart?: RegExp;
  private readonly lineBodyEnd?: RegExp;
  private readonly lineEnd?: RegExp;
  private readonly lineBody?: RegExp;
  private readonly blockStart?: RegExp;
  private readonly blockBodyEnd?: RegExp;
  private readonly blockEnd?: RegExp;
  private readonly blockClose?: string;

  constructor(syntax: CommentSyntax) {
    if (syntax.lineComment) {
      // Allow the prefix to be repeated (`##`, `///`) and any spacing around it,
      // since formatters sometimes normalise comment spacing.
      const lc = `(?:${escapeRe(syntax.lineComment)})+`;
      this.lineStart = new RegExp(`^\\s*${lc}\\s*@note-start\\b(.*)$`);
      this.lineBodyEnd = new RegExp(`^\\s*${lc}\\s*@note-body-end\\s*$`);
      this.lineEnd = new RegExp(`^\\s*${lc}\\s*@note-end\\s*$`);
      this.lineBody = new RegExp(`^\\s*${lc}(.*)$`);
    }
    if (syntax.blockComment) {
      const [open, close] = syntax.blockComment.map(escapeRe);
      this.blockStart = new RegExp(`^\\s*${open}\\s*@note-start\\b(.*)$`);
      this.blockBodyEnd = new RegExp(`^\\s*@note-body-end\\s*${close}\\s*$`);
      this.blockEnd = new RegExp(`^\\s*${open}\\s*@note-end\\s*${close}\\s*$`);
      this.blockClose = syntax.blockComment[1];
    }
  }

  get usable(): boolean {
    return !!(this.lineStart || this.blockStart);
  }

  marker(line: string): Marker | undefined {
    if (!line.includes(MARKER_TOKEN)) return undefined;
    let m: RegExpExecArray | null;
    if (this.lineStart && (m = this.lineStart.exec(line))) {
      return { kind: 'start', style: 'line', ...parseAttrs(m[1]) };
    }
    if (this.lineBodyEnd?.test(line)) return { kind: 'bodyEnd', style: 'line' };
    if (this.lineEnd?.test(line)) return { kind: 'end', style: 'line' };
    // A block start that also closes the comment on the same line is not ours.
    if (this.blockStart && (m = this.blockStart.exec(line)) && !m[1].includes(this.blockClose!)) {
      return { kind: 'start', style: 'block', ...parseAttrs(m[1]) };
    }
    if (this.blockBodyEnd?.test(line)) return { kind: 'bodyEnd', style: 'block' };
    if (this.blockEnd?.test(line)) return { kind: 'end', style: 'block' };
    return undefined;
  }

  /** Content after the line-comment prefix, '' for blank lines, undefined for code. */
  lineBodyContent(line: string): string | undefined {
    if (line.trim() === '') return '';
    const m = this.lineBody!.exec(line);
    return m ? m[1] : undefined;
  }
}

function parseAttrs(rest: string): { id?: string; color?: NoteColor } {
  const id = /(?:^|\s)id=([A-Za-z0-9_-]+)/.exec(rest)?.[1];
  const color = /(?:^|\s)color=([A-Za-z]+)/.exec(rest)?.[1]?.toLowerCase();
  return { id, color: (NOTE_COLORS as readonly string[]).includes(color ?? '') ? (color as NoteColor) : undefined };
}

export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

export function detectEol(text: string): '\n' | '\r\n' {
  const i = text.indexOf('\n');
  return i > 0 && text[i - 1] === '\r' ? '\r\n' : '\n';
}

/** Removes the smallest common leading whitespace of non-blank lines. */
function dedent(lines: string[]): string[] {
  let min = Infinity;
  for (const l of lines) {
    if (l.trim() === '') continue;
    const ws = /^\s*/.exec(l)![0].length;
    if (ws < min) min = ws;
  }
  if (min === Infinity) min = 0;
  return lines.map((l) => (l.trim() === '' ? '' : l.slice(min).trimEnd()));
}

type BlockOutcome =
  | { ok: true; note: Note; problems: ParseProblem[]; next: number }
  | { ok: false; problem: ParseProblem; next: number; silence: number[] };

function parseBlockAt(lines: string[], s: number, start: Marker, mt: Matcher): BlockOutcome {
  const fail = (kind: ProblemKind, message: string, next = s + 1, silence: number[] = []): BlockOutcome => ({
    ok: false,
    problem: { line: s, kind, message },
    next,
    silence,
  });

  // Body: until @note-body-end of the same style.
  const raw: string[] = [];
  let i = s + 1;
  for (; ; i++) {
    if (i >= lines.length) return fail('missing-body-end', 'Nota sin `@note-body-end`: se ignora.');
    const m = mt.marker(lines[i]);
    if (m) {
      if (m.kind === 'bodyEnd' && m.style === start.style) break;
      return fail('missing-body-end', 'Nota sin `@note-body-end`: se ignora.');
    }
    if (start.style === 'line') {
      const content = mt.lineBodyContent(lines[i]);
      if (content === undefined) return fail('missing-body-end', 'Nota sin `@note-body-end`: se ignora.');
      raw.push(content);
    } else {
      raw.push(lines[i]);
    }
  }
  const bodyEndLine = i;

  // Annotated code: until the matching @note-end.
  const problems: ParseProblem[] = [];
  let depth = 0;
  for (i = bodyEndLine + 1; ; i++) {
    if (i >= lines.length) {
      return fail('missing-end', 'Nota sin `@note-end`: se ignora.', s + 1, [bodyEndLine]);
    }
    const m = mt.marker(lines[i]);
    if (!m) continue;
    if (m.kind === 'start') {
      depth++;
      problems.push({ line: i, kind: 'nested', message: 'Notas anidadas no permitidas: la nota exterior prevalece y esta se ignora.' });
    } else if (m.kind === 'end') {
      if (depth === 0) break;
      depth--;
    }
    // A stray @note-body-end inside the code range is harmless; ignore it.
  }
  const endLine = i;
  if (endLine === bodyEndLine + 1) {
    return fail('empty-range', 'La nota no anota ninguna línea de código: se ignora.', endLine + 1);
  }

  const body = dedent(raw);
  while (body.length && body[body.length - 1] === '') body.pop();
  while (body.length && body[0] === '') body.shift();

  return {
    ok: true,
    note: {
      id: start.id,
      color: start.color ?? DEFAULT_COLOR,
      style: start.style,
      indent: /^\s*/.exec(lines[s])![0],
      startLine: s,
      bodyEndLine,
      endLine,
      body: body.join('\n'),
    },
    problems,
    next: endLine + 1,
  };
}

export function parseNotes(text: string, syntax: CommentSyntax): ParseResult {
  const result: ParseResult = { notes: [], problems: [] };
  const mt = new Matcher(syntax);
  if (!mt.usable || !text.includes(MARKER_TOKEN)) return result;

  const lines = splitLines(text);
  const silenced = new Set<number>();
  let i = 0;
  while (i < lines.length) {
    const m = mt.marker(lines[i]);
    if (!m) {
      i++;
      continue;
    }
    if (m.kind === 'start') {
      const out = parseBlockAt(lines, i, m, mt);
      if (out.ok) {
        result.notes.push(out.note);
        result.problems.push(...out.problems);
      } else {
        result.problems.push(out.problem);
        out.silence.forEach((l) => silenced.add(l));
      }
      i = out.next;
      continue;
    }
    if (!silenced.has(i)) {
      if (m.kind === 'bodyEnd') {
        result.problems.push({ line: i, kind: 'missing-start', message: '`@note-body-end` sin `@note-start`: el bloque se ignora.' });
        // Report the whole orphan block once: silence its @note-end.
        for (let j = i + 1; j < lines.length; j++) {
          const n = mt.marker(lines[j]);
          if (n?.kind === 'end') silenced.add(j);
          if (n) break;
        }
      } else {
        result.problems.push({ line: i, kind: 'orphan-end', message: '`@note-end` sin `@note-start`: se ignora.' });
      }
    }
    i++;
  }

  const seen = new Set<string>();
  for (const n of result.notes) {
    if (!n.id) continue;
    if (seen.has(n.id)) {
      result.problems.push({ line: n.startLine, kind: 'duplicate-id', message: `Id de nota duplicado (${n.id}).` });
    }
    seen.add(n.id);
  }
  result.problems.sort((a, b) => a.line - b.line);
  return result;
}

export function noteAtLine(notes: readonly Note[], line: number): Note | undefined {
  return notes.find((n) => line >= n.startLine && line <= n.endLine);
}

export function generateId(taken: ReadonlySet<string>, random: () => number = Math.random): string {
  for (;;) {
    const id = Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0');
    if (!taken.has(id)) return id;
  }
}

export interface NoteBlockText {
  /** Lines inserted before the annotated code. */
  header: string[];
  /** Lines inserted after the annotated code. */
  footer: string[];
  /** Index within `header` and column where the cursor should go (end of the body). */
  cursorLine: number;
  cursorColumn: number;
}

export interface NoteContent {
  /** Markdown body; may span several lines. Empty = one empty body line. */
  body?: string;
  color?: NoteColor;
}

/** Builds the text of a new note. Prefers line comments. */
export function buildNoteBlock(syntax: CommentSyntax, indent: string, id: string, content: NoteContent = {}): NoteBlockText | undefined {
  const attrs = `id=${id}${content.color && content.color !== DEFAULT_COLOR ? ` color=${content.color}` : ''}`;
  const body = (content.body ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+$/, '')
    .split('\n')
    // A Markdown hard break written as two trailing spaces would be lost to
    // trimming (ours, or "trim trailing whitespace" on save): use `\` instead.
    .map((l) => l.replace(/(\S) {2,}$/, '$1\\').trimEnd());
  let header: string[];
  let footer: string[];
  if (syntax.lineComment) {
    const lc = syntax.lineComment;
    header = [`${indent}${lc} @note-start ${attrs}`, ...body.map((l) => `${indent}${lc} ${l}`), `${indent}${lc} @note-body-end`];
    footer = [`${indent}${lc} @note-end`];
  } else if (syntax.blockComment) {
    const [open, close] = syntax.blockComment;
    // The body lives inside the comment: break any closing token it contains.
    const safe = body.map((l) => l.split(close).join(close.split('').join(' ')));
    header = [`${indent}${open} @note-start ${attrs}`, ...safe.map((l) => `${indent}${l}`), `${indent}@note-body-end ${close}`];
    footer = [`${indent}${open} @note-end ${close}`];
  } else {
    return undefined;
  }
  const cursorLine = header.length - 2;
  return { header, footer, cursorLine, cursorColumn: header[cursorLine].length };
}

/**
 * Which lines are comments (line comments, or inside/starting a block comment).
 * A heuristic line scanner: good enough to decide where notes may be created.
 */
export function commentLines(lines: readonly string[], syntax: CommentSyntax): boolean[] {
  const out: boolean[] = [];
  const [open, close] = syntax.blockComment ?? ['', ''];
  let inBlock = false;
  for (const line of lines) {
    const t = line.trim();
    if (inBlock) {
      out.push(true);
      if (line.includes(close)) inBlock = false;
      continue;
    }
    if (syntax.lineComment && t.startsWith(syntax.lineComment)) {
      out.push(true);
      continue;
    }
    if (open && t.startsWith(open)) {
      out.push(true);
      inBlock = !t.slice(open.length).includes(close);
      continue;
    }
    out.push(false);
    // Code that opens a block comment which continues on the next lines.
    if (open) {
      const at = line.lastIndexOf(open);
      if (at >= 0 && !line.slice(at + open.length).includes(close)) inBlock = true;
    }
  }
  return out;
}

/**
 * Lines where a new note may be added: not a comment and not part of an
 * existing note block. Returned as inclusive [first, last] line pairs.
 */
export function commentingRanges(text: string, syntax: CommentSyntax, notes: readonly Note[]): [number, number][] {
  const lines = splitLines(text);
  const blocked = commentLines(lines, syntax);
  for (const n of notes) for (let l = n.startLine; l <= n.endLine; l++) blocked[l] = true;
  const ranges: [number, number][] = [];
  for (let l = 0; l < lines.length; l++) {
    if (blocked[l]) continue;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === l - 1) last[1] = l;
    else ranges.push([l, l]);
  }
  return ranges;
}

/** True when every line in [first, last] may receive a new note. */
export function canAnnotate(ranges: readonly [number, number][], first: number, last: number): boolean {
  return ranges.some(([a, b]) => a <= first && last <= b);
}

/** Replaces or adds the `id=` on a `@note-start` line. */
export function withId(startLineText: string, id: string): string {
  if (/(^|\s)id=[A-Za-z0-9_-]+/.test(startLineText)) {
    return startLineText.replace(/((?:^|\s)id=)[A-Za-z0-9_-]+/, `$1${id}`);
  }
  return startLineText.replace(/@note-start\b/, `@note-start id=${id}`);
}

/**
 * Whether a selection is exactly one whole line, as VS Code selects it when
 * the line number is clicked: (l, 0) → (l + 1, 0), or (l, 0) → end of the
 * last line. Returns that line, or undefined.
 */
export function wholeLineSelection(
  start: { line: number; character: number },
  end: { line: number; character: number },
  lastLine: number,
  lastLineLength: number,
): number | undefined {
  if (start.character !== 0) return undefined;
  if (end.line === start.line + 1 && end.character === 0) return start.line;
  if (start.line === lastLine && end.line === lastLine && end.character === lastLineLength && lastLineLength > 0) return start.line;
  return undefined;
}

/** First meaningful line of the Markdown body, without heading/list markers. */
export function noteTitle(body: string, maxLength = Infinity): string {
  const line = body.split('\n').find((l) => l.trim()) ?? '';
  const title = line.replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s*)/, '').replace(/\\$/, '').trim() || '(nota vacía)';
  return title.length > maxLength ? `${title.slice(0, maxLength - 1).trimEnd()}…` : title;
}
