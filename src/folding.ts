import * as vscode from 'vscode';
import { displayMode } from './config';
import { Note } from './parser';
import { isSupported, NoteStore } from './store';

// Folding strategy
// ----------------
// Decorations cannot hide lines, so in `fold` mode we contribute a folding
// range per note (from `@note-start` to `@note-body-end`) and collapse it with
// the built-in `editor.fold` command. The remaining visible marker lines are
// dimmed by the decoration manager.
//
// - Notes are folded the first time they are seen in an editor (on open, when
//   pasted, after undoing a delete...), unless the cursor is inside them.
// - Moving the cursor into a folded note unfolds it (native VS Code behaviour);
//   when the cursor leaves the note's header/body it is folded again.
// - The provider returns `undefined` (not `[]`) when a document has no notes,
//   so VS Code keeps its indentation-based fallback for that document.
// - VS Code keeps a collapsed region even after the provider stops returning
//   it, so leaving `fold` mode unfolds the notes explicitly (the active editor
//   right away, other documents when they next become active).

const noteKeys = (notes: readonly Note[]): string[] => {
  const count = new Map<string, number>();
  return notes.map((n) => {
    const base = n.id ?? `@${n.startLine}`;
    const k = (count.get(base) ?? 0) + 1;
    count.set(base, k);
    return `${base}#${k}`;
  });
};

const inHeader = (n: Note, line: number): boolean => line >= n.startLine && line <= n.bodyEndLine;

export class FoldController implements vscode.FoldingRangeProvider, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeFoldingRanges = this.changeEmitter.event;

  /** Document version whose ranges VS Code last received from us. */
  private readonly provided = new Map<string, number>();
  /** Note keys already handled per document (folded once, or seen while being edited). */
  private readonly seen = new Map<string, Set<string>>();
  /** Per editor: key of the note whose header/body contains the cursor. */
  private readonly cursorNote = new WeakMap<vscode.TextEditor, string | undefined>();
  private readonly disposables: vscode.Disposable[] = [this.changeEmitter];
  /** Documents whose notes may still be folded after leaving `fold` mode. */
  private readonly needsUnfold = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly store: NoteStore) {
    this.disposables.push(
      vscode.languages.registerFoldingRangeProvider({ pattern: '**' }, this),
      store.onDidUpdate((doc) => {
        if (vscode.window.activeTextEditor?.document === doc) this.scheduleAutoFold();
      }),
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.scheduleAutoFold();
        void this.unfoldPending();
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => this.onSelection(e.textEditor)),
      vscode.workspace.onDidCloseTextDocument((d) => {
        this.seen.delete(d.uri.toString());
        this.needsUnfold.delete(d.uri.toString());
        this.provided.delete(d.uri.toString());
      }),
    );
  }

  async provideFoldingRanges(doc: vscode.TextDocument): Promise<vscode.FoldingRange[] | undefined> {
    if (displayMode() !== 'fold' || !isSupported(doc)) return undefined;
    const version = doc.version;
    const { notes } = await this.store.get(doc);
    if (!notes.length) return undefined;
    this.provided.set(doc.uri.toString(), version);
    this.scheduleAutoFold();
    return notes
      .filter((n) => n.bodyEndLine > n.startLine)
      .map((n) => new vscode.FoldingRange(n.startLine, n.bodyEndLine, vscode.FoldingRangeKind.Comment));
  }

  /** Call when the display mode changes. */
  async refresh(): Promise<void> {
    if (displayMode() !== 'fold') {
      this.seen.forEach((_, uri) => this.needsUnfold.add(uri));
      await this.unfoldPending();
    }
    this.seen.clear();
    this.changeEmitter.fire();
  }

  private async unfoldPending(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || displayMode() === 'fold' || !this.needsUnfold.delete(editor.document.uri.toString())) return;
    const notes = (await this.store.get(editor.document)).notes;
    if (!notes.length || vscode.window.activeTextEditor !== editor) return;
    await vscode.commands.executeCommand('editor.unfold', { selectionLines: notes.map((n) => n.startLine), levels: 1 });
  }

  async unfold(editor: vscode.TextEditor, note: Note): Promise<void> {
    if (displayMode() !== 'fold' || vscode.window.activeTextEditor !== editor) return;
    await vscode.commands.executeCommand('editor.unfold', { selectionLines: [note.startLine], levels: 1 });
  }

  private scheduleAutoFold(): void {
    // Give VS Code time to apply the ranges we just returned before folding.
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.autoFold(), 120);
  }

  /** Folds notes of the active editor that have not been handled yet. */
  private async autoFold(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || displayMode() !== 'fold') return;
    const doc = editor.document;
    const notes = this.store.peek(doc)?.notes;
    // Only fold when VS Code already has our ranges for this exact version;
    // otherwise `editor.fold` would collapse an enclosing region instead.
    if (!notes?.length || this.provided.get(doc.uri.toString()) !== doc.version) return;

    const uri = doc.uri.toString();
    const seen = this.seen.get(uri) ?? new Set<string>();
    this.seen.set(uri, seen);
    const keys = noteKeys(notes);
    const cursorLines = editor.selections.map((s) => s.active.line);
    const lines: number[] = [];
    notes.forEach((n, i) => {
      if (seen.has(keys[i])) return;
      seen.add(keys[i]);
      if (n.bodyEndLine > n.startLine && !cursorLines.some((l) => inHeader(n, l))) lines.push(n.startLine);
    });
    if (lines.length) await this.fold(editor, lines);
  }

  private onSelection(editor: vscode.TextEditor): void {
    if (displayMode() !== 'fold' || editor !== vscode.window.activeTextEditor) return;
    const notes = this.store.peek(editor.document)?.notes;
    if (!notes) return;
    const line = editor.selection.active.line;
    const keys = noteKeys(notes);
    const idx = notes.findIndex((n) => inHeader(n, line));
    const current = idx >= 0 ? keys[idx] : undefined;
    const previous = this.cursorNote.get(editor);
    this.cursorNote.set(editor, current);
    if (!previous || previous === current) return;
    const left = notes[keys.indexOf(previous)];
    if (left && this.provided.get(editor.document.uri.toString()) === editor.document.version) {
      void this.fold(editor, [left.startLine]);
    }
  }

  private async fold(editor: vscode.TextEditor, lines: number[]): Promise<void> {
    if (vscode.window.activeTextEditor !== editor) return;
    await vscode.commands.executeCommand('editor.fold', { selectionLines: lines, levels: 1 });
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }
}
