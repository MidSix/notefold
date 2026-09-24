import * as vscode from 'vscode';
import { PALETTE } from './colors';
import { displayMode, gutterBar, inlineTitle } from './config';
import { codeEnd, codeStart, Note, NOTE_COLORS, NoteColor, noteAtLine, noteTitle } from './parser';
import { NoteStore } from './store';

// Every annotated code line gets a vertical bar in the gutter, in the note's
// colour, and nothing else: no background, so the code reads as usual. Gutter
// icons cannot use ThemeColor, so the bar is an SVG with a light and a dark
// variant; the overview ruler mark uses a theme colour.
//
// The first annotated line also shows the note's title as faint "ghost text"
// after the code (like GitLens blame); hovering it shows the whole note.

function barSvg(color: string): vscode.Uri {
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect x="12" y="0" width="3" height="16" fill="${color}"/></svg>`;
  return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(xml).toString('base64')}`);
}

interface Types {
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
      overviewRulerColor: new vscode.ThemeColor(`codeNotes.${color}Ruler`),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      gutterIconSize: 'cover',
      light: bar ? { gutterIconPath: barSvg(PALETTE[color].light) } : undefined,
      dark: bar ? { gutterIconPath: barSvg(PALETTE[color].dark) } : undefined,
    });
  }
  return {
    markerDim: vscode.window.createTextEditorDecorationType({ opacity: '0.45', isWholeLine: true }),
    // `textDecoration` is the documented way to inject extra CSS (smaller font).
    blockDim: vscode.window.createTextEditorDecorationType({ opacity: '0.3', textDecoration: 'none; font-size: 0.85em', isWholeLine: true }),
    code,
    title: vscode.window.createTextEditorDecorationType({
      after: { margin: '0 0 0 2.5em', fontStyle: 'italic' },
    }),
  };
}

const allTypes = (t: Types): vscode.TextEditorDecorationType[] => [t.markerDim, t.blockDim, t.title, ...Object.values(t.code)];

const lines = (from: number, to: number): vscode.Range[] => {
  const out: vscode.Range[] = [];
  for (let l = from; l <= to; l++) out.push(new vscode.Range(l, 0, l, 0));
  return out;
};

export class DecorationManager implements vscode.Disposable {
  private types = createTypes();
  /** Per editor: start line of the note being edited (cursor in its header/body). */
  private readonly activeNote = new WeakMap<vscode.TextEditor, number | undefined>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly store: NoteStore) {
    this.disposables.push(
      store.onDidUpdate((doc) => this.renderDocument(doc)),
      vscode.window.onDidChangeVisibleTextEditors(() => this.renderAll()),
      vscode.window.onDidChangeActiveColorTheme(() => this.reset()),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (displayMode() !== 'dim') return;
        const notes = this.store.peek(e.textEditor.document)?.notes;
        if (!notes) return;
        const note = activeNote(notes, e.textEditor.selection.active.line);
        if (note?.startLine !== this.activeNote.get(e.textEditor)) this.render(e.textEditor);
      }),
    );
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
    const active = activeNote(notes, editor.selection.active.line);
    this.activeNote.set(editor, active?.startLine);

    const markerDim: vscode.Range[] = [];
    const blockDim: vscode.Range[] = [];
    const code = Object.fromEntries(NOTE_COLORS.map((c) => [c, [] as vscode.Range[]])) as Record<NoteColor, vscode.Range[]>;
    const titles: vscode.DecorationOptions[] = [];
    const showTitles = inlineTitle();

    for (const n of notes) {
      const markers = [...lines(n.startLine, n.startLine), ...lines(n.bodyEndLine, n.bodyEndLine), ...lines(n.endLine, n.endLine)];
      if (mode === 'fold' || (mode === 'dim' && n === active)) markerDim.push(...markers);
      else if (mode === 'dim') blockDim.push(...lines(n.startLine, n.bodyEndLine), ...lines(n.endLine, n.endLine));
      // One range per line so the gutter bar is drawn on every annotated line.
      code[n.color].push(...lines(codeStart(n), codeEnd(n)));
      if (showTitles) {
        const end = editor.document.lineAt(codeStart(n)).range.end;
        titles.push({
          range: new vscode.Range(end, end),
          renderOptions: {
            after: { contentText: `💬 ${noteTitle(n.body, 60)}`, color: new vscode.ThemeColor(`codeNotes.${n.color}Ruler`) },
          },
        });
      }
    }

    const t = this.types;
    editor.setDecorations(t.markerDim, markerDim);
    editor.setDecorations(t.blockDim, blockDim);
    for (const c of NOTE_COLORS) editor.setDecorations(t.code[c], code[c]);
    editor.setDecorations(t.title, titles);
  }

  dispose(): void {
    allTypes(this.types).forEach((t) => t.dispose());
    this.disposables.forEach((d) => d.dispose());
  }
}

/** The note whose header/body contains the line (the one being edited). */
function activeNote(notes: readonly Note[], line: number): Note | undefined {
  const n = noteAtLine(notes, line);
  return n && line <= n.bodyEndLine ? n : undefined;
}
