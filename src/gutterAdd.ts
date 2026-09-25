import * as vscode from 'vscode';
import { PALETTE } from './colors';
import { getCommentSyntax } from './commentSyntax';
import { insertNote } from './commands';
import { gutterAddButton } from './config';
import { canAnnotate, commentingRanges, DEFAULT_COLOR, editedNoteHeader, Note, NOTE_COLORS, NoteColor } from './parser';
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
// - "Editar nota" opens the same widget on an existing note, anchored to its
//   @note-start line: one comment in editing mode holding the current body,
//   the same colour dots and "Guardar" / "Cancelar" buttons.

const EDIT_DELAY_MS = 150;

export class GutterNotes implements vscode.Disposable {
  private readonly controller = vscode.comments.createCommentController('notefold', 'NoteFold');
  private readonly colors = new WeakMap<vscode.CommentThread, NoteColor>();
  /** The open edit widget (at most one): its thread, comment and the note it edits. */
  private editing?: { thread: vscode.CommentThread; comment: vscode.Comment; id?: string };
  private readonly disposables: vscode.Disposable[] = [this.controller];

  constructor(private readonly store: NoteStore) {
    this.controller.options = {
      prompt: 'Añadir nota…',
      placeHolder: 'Escribe la nota en Markdown. Elige el color con los puntos de arriba.',
    };
    this.applyProvider();
    this.disposables.push(
      vscode.commands.registerCommand('notefold.gutter.create', (reply: vscode.CommentReply) => this.create(reply)),
      vscode.commands.registerCommand('notefold.gutter.cancel', (arg: vscode.CommentReply | vscode.CommentThread) =>
        ('thread' in arg ? arg.thread : arg).dispose(),
      ),
      // Each colour has two buttons: a plain dot and a framed one for the
      // selected colour. `thread.contextValue` decides which one is shown.
      ...NOTE_COLORS.flatMap((color) =>
        [`notefold.gutter.color.${color}`, `notefold.gutter.selected.${color}`].map((id) =>
          vscode.commands.registerCommand(id, (arg: vscode.CommentReply | vscode.CommentThread) =>
            this.setColor('thread' in arg ? arg.thread : arg, color),
          ),
        ),
      ),
      vscode.commands.registerCommand('notefold.gutter.save', (comment: vscode.Comment) => this.save(comment)),
      vscode.commands.registerCommand('notefold.gutter.cancelEdit', () => this.closeEditor()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('notefold.gutterAddButton')) this.applyProvider();
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
    thread.contextValue = `notefold.color.${color}`;
    thread.label = `Color: ${PALETTE[color].label}`;
  }

  private async create({ thread, text }: vscode.CommentReply): Promise<void> {
    if (!text.trim()) {
      void vscode.window.showInformationMessage('NoteFold: escribe el texto de la nota antes de crearla.');
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
          'NoteFold: las líneas elegidas incluyen comentarios o forman parte de otra nota; no se pueden anidar notas.',
        );
        return;
      }
    }
    const color = this.colors.get(thread) ?? DEFAULT_COLOR;
    if (await insertNote(this.store, editor, first, last, { body: text, color }, false)) thread.dispose();
  }

  /** Opens the note form on an existing note, filled with its body and colour. */
  edit(doc: vscode.TextDocument, note: Note): vscode.Comment {
    this.closeEditor();
    const line = new vscode.Range(note.startLine, 0, note.startLine, 0);
    const comment: vscode.Comment = {
      body: note.body,
      mode: vscode.CommentMode.Preview,
      author: { name: 'Editar nota' },
      contextValue: 'notefold.editing',
    };
    const thread = this.controller.createCommentThread(doc.uri, line, [comment]);
    thread.canReply = false;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    this.setColor(thread, note.color);
    this.editing = { thread, comment, id: note.id };
    // VS Code sizes the input to its text (90-450 px, then it scrolls), but a
    // comment created already in editing mode is measured before the widget
    // has a width: every character wraps and the input jumps to its maximum.
    // Switching to editing once the widget is on screen measures it properly.
    setTimeout(() => {
      if (this.editing?.comment !== comment) return;
      comment.mode = vscode.CommentMode.Editing;
      thread.comments = [comment];
    }, EDIT_DELAY_MS);
    return comment;
  }

  private closeEditor(): void {
    this.editing?.thread.dispose();
    this.editing = undefined;
  }

  /** "Guardar": VS Code has already copied the edited text into `comment.body`. */
  private async save(comment: vscode.Comment): Promise<void> {
    const editing = this.editing;
    if (!editing || editing.comment !== comment) return;
    const text = typeof comment.body === 'string' ? comment.body : comment.body.value;
    if (!text.trim()) {
      void vscode.window.showInformationMessage('NoteFold: la nota no puede quedar vacía. Para quitarla usa "Borrar nota".');
      return;
    }
    const { thread } = editing;
    const doc = await vscode.workspace.openTextDocument(thread.uri);
    // The file may have changed while the form was open: find the note again.
    const { notes } = await this.store.get(doc);
    const note =
      (editing.id && notes.find((n) => n.id === editing.id)) || notes.find((n) => n.startLine === thread.range.start.line);
    if (!note) {
      void vscode.window.showWarningMessage('NoteFold: ya no se encuentra la nota que estabas editando.');
      return;
    }
    const header = editedNoteHeader(doc.lineAt(note.startLine).text, doc.lineAt(note.bodyEndLine).text, note, {
      body: text,
      color: this.colors.get(thread) ?? note.color,
    });
    const edit = new vscode.WorkspaceEdit();
    const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    edit.replace(doc.uri, new vscode.Range(note.startLine, 0, note.bodyEndLine, doc.lineAt(note.bodyEndLine).text.length), header.join(eol));
    if (await vscode.workspace.applyEdit(edit)) this.closeEditor();
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
