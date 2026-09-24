import * as vscode from 'vscode';
import { PALETTE } from './colors';
import { getCommentSyntax } from './commentSyntax';
import { insertNote } from './commands';
import { gutterAddButton } from './config';
import { canAnnotate, commentingRanges, DEFAULT_COLOR, NOTE_COLORS, NoteColor } from './parser';
import { isSupported, NoteStore } from './store';

// "+" in the gutter, via the Comments API (the same mechanism CodeTour uses).
//
// - Commenting ranges = lines that are neither comments nor part of a note, so
//   VS Code only offers the "+" there.
// - Clicking "+" (or dragging over several lines / clicking inside a selection)
//   opens VS Code's comment widget: a Markdown input, colour dots in its title
//   bar (the chosen one framed) and "Crear nota" / "Cancelar" buttons.
// - "Crear nota" writes the note above the first line of the range using the
//   language's comment syntax, then discards the temporary comment thread.

export class GutterNotes implements vscode.Disposable {
  private readonly controller = vscode.comments.createCommentController('codeNotes', 'Code Notes');
  private readonly colors = new WeakMap<vscode.CommentThread, NoteColor>();
  private readonly disposables: vscode.Disposable[] = [this.controller];

  constructor(private readonly store: NoteStore) {
    this.controller.options = {
      prompt: 'Añadir nota…',
      placeHolder: 'Escribe la nota en Markdown. Elige el color con los puntos de arriba.',
    };
    this.applyProvider();
    this.disposables.push(
      vscode.commands.registerCommand('codeNotes.gutter.create', (reply: vscode.CommentReply) => this.create(reply)),
      vscode.commands.registerCommand('codeNotes.gutter.cancel', (arg: vscode.CommentReply | vscode.CommentThread) =>
        ('thread' in arg ? arg.thread : arg).dispose(),
      ),
      // Each colour has two buttons: a plain dot and a framed one for the
      // selected colour. `thread.contextValue` decides which one is shown.
      ...NOTE_COLORS.flatMap((color) =>
        [`codeNotes.gutter.color.${color}`, `codeNotes.gutter.selected.${color}`].map((id) =>
          vscode.commands.registerCommand(id, (arg: vscode.CommentReply | vscode.CommentThread) =>
            this.setColor('thread' in arg ? arg.thread : arg, color),
          ),
        ),
      ),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('codeNotes.gutterAddButton')) this.applyProvider();
      }),
    );
  }

  private applyProvider(): void {
    // Re-assigning the provider also makes VS Code re-query the ranges.
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (doc) => (gutterAddButton() ? this.ranges(doc) : []),
    };
  }

  private async ranges(doc: vscode.TextDocument): Promise<vscode.Range[]> {
    if (!isSupported(doc)) return [];
    const syntax = await getCommentSyntax(doc.languageId);
    if (!syntax) return [];
    const { notes } = await this.store.get(doc);
    return commentingRanges(doc.getText(), syntax, notes).map(
      ([a, b]) => new vscode.Range(a, 0, b, doc.lineAt(b).text.length),
    );
  }

  private setColor(thread: vscode.CommentThread, color: NoteColor): void {
    this.colors.set(thread, color);
    thread.contextValue = `codeNotes.color.${color}`;
    thread.label = `Color: ${PALETTE[color].label}`;
  }

  private async create({ thread, text }: vscode.CommentReply): Promise<void> {
    if (!text.trim()) {
      void vscode.window.showInformationMessage('Code Notes: escribe el texto de la nota antes de crearla.');
      return;
    }
    const doc = await vscode.workspace.openTextDocument(thread.uri);
    const editor =
      vscode.window.visibleTextEditors.find((e) => e.document === doc) ?? (await vscode.window.showTextDocument(doc));

    // The range may come from a selection made bottom-up or top-down: the
    // note always goes above its first line.
    const range = thread.range;
    let last = range.end.line;
    if (last > range.start.line && range.end.character === 0) last--;
    const first = range.start.line;

    const syntax = await getCommentSyntax(doc.languageId);
    if (syntax) {
      const { notes } = await this.store.get(doc);
      if (!canAnnotate(commentingRanges(doc.getText(), syntax, notes), first, last)) {
        void vscode.window.showWarningMessage(
          'Code Notes: las líneas elegidas incluyen comentarios o forman parte de otra nota; no se pueden anidar notas.',
        );
        return;
      }
    }
    const color = this.colors.get(thread) ?? DEFAULT_COLOR;
    if (await insertNote(this.store, editor, first, last, { body: text, color }, false)) thread.dispose();
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
