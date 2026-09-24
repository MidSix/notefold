import * as vscode from 'vscode';
import { PALETTE } from './colors';
import { displayMode, gutterBar, hideMarkers, inlineTitle } from './config';
import { codeEnd, codeStart, markerLooks, Note, NOTE_COLORS, NoteColor, noteAtLine, noteTitle, noteWithMarkerAt } from './parser';
import { NoteStore } from './store';

// Every annotated code line gets a vertical bar in the gutter, in the note's
// colour, and nothing else: no background, so the code reads as usual. Gutter
// icons cannot use ThemeColor, so the bar is an SVG with a light and a dark
// variant; the overview ruler mark uses a theme colour.
//
// The first annotated line also shows the note's title as faint "ghost text"
// after the code (like GitLens blame); hovering it shows the whole note.
//
// Marker lines (@note-start / @note-body-end / @note-end) can be made
// invisible (`notefold.hideMarkers`). VS Code cannot remove a line from the
// view, so they remain as blank-looking lines; they reappear while the note
// is being edited, when the cursor is on a marker, or when the mouse rests on
// one. There is no mouse-move API: the hover provider tells us where the mouse
// stopped (`revealAt`), and since nothing tells us when it leaves, the markers
// hide again when the mouse stops on another line or after REVEAL_MS.

const REVEAL_MS = 2000;

function barSvg(color: string): vscode.Uri {
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect x="12" y="0" width="3" height="16" fill="${color}"/></svg>`;
  return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(xml).toString('base64')}`);
}

interface Types {
  hidden: vscode.TextEditorDecorationType;
  markerDim: vscode.TextEditorDecorationType;
  blockDim: vscode.TextEditorDecorationType;
  /** Gutter bar + overview ruler mark, one per colour. */
  code: Record<NoteColor, vscode.TextEditorDecorationType>;
  /** Note title after the first annotated line (text and colour per instance). */
  title: vscode.TextEditorDecorationType;
}

function createTypes(): Types {
  const code = {} as Record<NoteColor, vscode.TextEditorDecorationType>;
  for (const color of NOTE_COLORS) {
    const bar = gutterBar();
    code[color] = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor(`notefold.${color}Ruler`),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      gutterIconSize: 'cover',
      light: bar ? { gutterIconPath: barSvg(PALETTE[color].light) } : undefined,
      dark: bar ? { gutterIconPath: barSvg(PALETTE[color].dark) } : undefined,
    });
  }
  return {
    hidden: vscode.window.createTextEditorDecorationType({ opacity: '0', isWholeLine: true }),
    markerDim: vscode.window.createTextEditorDecorationType({ opacity: '0.45', isWholeLine: true }),
    // `textDecoration` is the documented way to inject extra CSS (smaller font).
    blockDim: vscode.window.createTextEditorDecorationType({ opacity: '0.3', textDecoration: 'none; font-size: 0.85em', isWholeLine: true }),
    code,
    title: vscode.window.createTextEditorDecorationType({
      after: { margin: '0 0 0 2.5em', fontStyle: 'italic' },
    }),
  };
}

const allTypes = (t: Types): vscode.TextEditorDecorationType[] => [t.hidden, t.markerDim, t.blockDim, t.title, ...Object.values(t.code)];

const lines = (from: number, to: number): vscode.Range[] => {
  const out: vscode.Range[] = [];
  for (let l = from; l <= to; l++) out.push(new vscode.Range(l, 0, l, 0));
  return out;
};

export class DecorationManager implements vscode.Disposable {
  private types = createTypes();
  /** Note whose markers are shown because the mouse rests on one of them. */
  private revealed?: { uri: string; lines: number[] };
  private revealTimer: ReturnType<typeof setTimeout> | undefined;
  /** Per editor: what the last render depended on in the cursor position. */
  private readonly cursorState = new WeakMap<vscode.TextEditor, string>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly store: NoteStore) {
    this.disposables.push(
      store.onDidUpdate((doc) => this.renderDocument(doc)),
      vscode.window.onDidChangeVisibleTextEditors(() => this.renderAll()),
      vscode.window.onDidChangeActiveColorTheme(() => this.reset()),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (displayMode() === 'off') return;
        const notes = this.store.peek(e.textEditor.document)?.notes;
        if (notes && cursorState(notes, e.textEditor) !== this.cursorState.get(e.textEditor)) this.render(e.textEditor);
      }),
    );
  }

  /** Called by the hover provider with the position where the mouse stopped. */
  revealAt(doc: vscode.TextDocument, line: number): void {
    if (!hideMarkers() || displayMode() === 'off') return;
    const n = noteWithMarkerAt(this.store.peek(doc)?.notes ?? [], line);
    const uri = doc.uri.toString();
    const next = n ? { uri, lines: [n.startLine, n.bodyEndLine, n.endLine] } : undefined;
    const same = next && this.revealed?.uri === uri && this.revealed.lines[0] === next.lines[0];
    clearTimeout(this.revealTimer);
    if (next) this.revealTimer = setTimeout(() => this.setRevealed(undefined), REVEAL_MS);
    if (!same && (next || this.revealed)) this.setRevealed(next);
  }

  private setRevealed(value: { uri: string; lines: number[] } | undefined): void {
    const uris = new Set([this.revealed?.uri, value?.uri].filter((u): u is string => !!u));
    this.revealed = value;
    vscode.window.visibleTextEditors.filter((e) => uris.has(e.document.uri.toString())).forEach((e) => this.render(e));
  }

  /** Recreates decoration types (configuration or theme change) and redraws. */
  reset(): void {
    allTypes(this.types).forEach((t) => t.dispose());
    this.types = createTypes();
    this.renderAll();
  }

  renderAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      void this.store.get(editor.document).then(() => this.render(editor));
    }
  }

  private renderDocument(doc: vscode.TextDocument): void {
    vscode.window.visibleTextEditors.filter((e) => e.document === doc).forEach((e) => this.render(e));
  }

  private render(editor: vscode.TextEditor): void {
    const notes = this.store.peek(editor.document)?.notes;
    if (!notes) return; // Stale: keep the current decorations (they follow edits).
    const mode = displayMode();
    const cursorLines = editor.selections.map((sel) => sel.active.line);
    this.cursorState.set(editor, cursorState(notes, editor));

    const hidden: vscode.Range[] = [];
    const markerDim: vscode.Range[] = [];
    const blockDim: vscode.Range[] = [];
    const code = Object.fromEntries(NOTE_COLORS.map((c) => [c, [] as vscode.Range[]])) as Record<NoteColor, vscode.Range[]>;
    const titles: vscode.DecorationOptions[] = [];
    const showTitles = inlineTitle();

    const revealed = this.revealed?.uri === editor.document.uri.toString() ? this.revealed.lines : [];
    const looks = markerLooks(notes, [...cursorLines, ...revealed], mode, hideMarkers());
    for (const [line, look] of looks) (look === 'hidden' ? hidden : look === 'faint' ? blockDim : markerDim).push(...lines(line, line));

    for (const n of notes) {
      // Dim mode: the body is dimmed too unless the note is being edited.
      const editing = cursorLines.some((l) => l >= n.startLine && l <= n.bodyEndLine);
      if (mode === 'dim' && !editing) blockDim.push(...lines(n.startLine + 1, n.bodyEndLine - 1));
      // One range per line so the gutter bar is drawn on every annotated line.
      code[n.color].push(...lines(codeStart(n), codeEnd(n)));
      if (showTitles) {
        const end = editor.document.lineAt(codeStart(n)).range.end;
        titles.push({
          range: new vscode.Range(end, end),
          renderOptions: {
            after: { contentText: `💬 ${noteTitle(n.body, 60)}`, color: new vscode.ThemeColor(`notefold.${n.color}Ruler`) },
          },
        });
      }
    }

    const t = this.types;
    editor.setDecorations(t.hidden, hidden);
    editor.setDecorations(t.markerDim, markerDim);
    editor.setDecorations(t.blockDim, blockDim);
    for (const c of NOTE_COLORS) editor.setDecorations(t.code[c], code[c]);
    editor.setDecorations(t.title, titles);
  }

  dispose(): void {
    clearTimeout(this.revealTimer);
    allTypes(this.types).forEach((t) => t.dispose());
    this.disposables.forEach((d) => d.dispose());
  }
}

/**
 * The parts of the cursor position that affect rendering: which note is being
 * edited and whether a cursor sits on a marker line.
 */
function cursorState(notes: readonly Note[], editor: vscode.TextEditor): string {
  return editor.selections
    .map((sel) => {
      const n = noteAtLine(notes, sel.active.line);
      if (!n) return '-';
      const l = sel.active.line;
      const onMarker = l === n.startLine || l === n.bodyEndLine || l === n.endLine;
      return `${n.startLine}:${l <= n.bodyEndLine ? 'edit' : ''}:${onMarker ? l : ''}`;
    })
    .join('|');
}
