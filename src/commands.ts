import * as vscode from 'vscode';
import { getCommentSyntax } from './commentSyntax';
import { buildNoteBlock, codeStart, generateId, Note, noteAtLine, NoteContent, withId } from './parser';
import { NoteStore } from './store';
import { NotePreview } from './preview';
import { FoldController } from './folding';

/** Arguments passed by hover links and tree items. */
export interface NoteRef {
  uri: string;
  line: number;
}

const eolOf = (doc: vscode.TextDocument): string => (doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');

async function editorFor(ref: NoteRef | undefined): Promise<vscode.TextEditor | undefined> {
  if (!ref) return vscode.window.activeTextEditor;
  const uri = vscode.Uri.parse(ref.uri);
  const visible = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === ref.uri);
  return visible ?? vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
}

/** Resolves the note from explicit args or from the cursor position. */
async function resolveNote(store: NoteStore, ref?: NoteRef): Promise<{ editor: vscode.TextEditor; note: Note } | undefined> {
  const editor = await editorFor(ref);
  if (!editor) return undefined;
  const { notes } = await store.get(editor.document);
  const note = noteAtLine(notes, ref ? ref.line : editor.selection.active.line);
  if (!note) {
    void vscode.window.showInformationMessage('No hay ninguna nota en esta posición.');
    return undefined;
  }
  return { editor, note };
}

/** Full-line range including the line break, so deleting it removes the line. */
function wholeLines(doc: vscode.TextDocument, first: number, last: number): vscode.Range {
  if (last + 1 < doc.lineCount) return new vscode.Range(first, 0, last + 1, 0);
  // Last line of the file: eat the preceding line break instead.
  const start = first > 0 ? doc.lineAt(first - 1).range.end : new vscode.Position(0, 0);
  return new vscode.Range(start, doc.lineAt(last).range.end);
}

function deleteNoteEdits(edit: vscode.WorkspaceEdit, doc: vscode.TextDocument, note: Note): void {
  edit.delete(doc.uri, wholeLines(doc, note.endLine, note.endLine));
  edit.delete(doc.uri, new vscode.Range(note.startLine, 0, note.bodyEndLine + 1, 0));
}

/**
 * Inserts a note around lines [first, last] as a single undo step: the header
 * goes above `first` (with its indentation) and `@note-end` after `last`.
 * Returns false (after telling the user why) when it cannot be inserted.
 */
export async function insertNote(
  store: NoteStore,
  editor: vscode.TextEditor,
  first: number,
  last: number,
  content: NoteContent,
  cursorInBody: boolean,
): Promise<boolean> {
  const doc = editor.document;
  const syntax = await getCommentSyntax(doc.languageId);
  if (!syntax) {
    void vscode.window.showWarningMessage(
      `NoteFold: el lenguaje "${doc.languageId}" no define sintaxis de comentarios; no se puede insertar una nota.`,
    );
    return false;
  }
  const { notes } = await store.get(doc);
  if (notes.some((n) => first <= n.endLine && last >= n.startLine)) {
    void vscode.window.showWarningMessage('NoteFold: la selección se solapa con una nota existente (no se permiten notas anidadas).');
    return false;
  }

  // Indentation of the first non-blank selected line.
  let indentLine = first;
  while (indentLine < last && doc.lineAt(indentLine).isEmptyOrWhitespace) indentLine++;
  const indent = doc.lineAt(indentLine).text.slice(0, doc.lineAt(indentLine).firstNonWhitespaceCharacterIndex);

  const taken = new Set(notes.map((n) => n.id).filter((id): id is string => !!id));
  const block = buildNoteBlock(syntax, indent, generateId(taken), content)!;
  const eol = eolOf(doc);
  const ok = await editor.edit((b) => {
    b.insert(new vscode.Position(first, 0), block.header.join(eol) + eol);
    b.insert(doc.lineAt(last).range.end, eol + block.footer.join(eol));
  });
  if (ok && cursorInBody) {
    const pos = new vscode.Position(first + block.cursorLine, block.cursorColumn);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));
  }
  return ok;
}

export function revealLine(editor: vscode.TextEditor, line: number): void {
  const col = editor.document.lineAt(line).firstNonWhitespaceCharacterIndex;
  const pos = new vscode.Position(line, col);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

export function registerCommands(store: NoteStore, preview: NotePreview, folds: FoldController): vscode.Disposable[] {
  const add = async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const sel = editor.selection;
    let last = sel.end.line;
    if (!sel.isEmpty && sel.end.character === 0 && last > sel.start.line) last--;
    await insertNote(store, editor, sel.start.line, last, {}, true);
  };

  const edit = async (ref?: NoteRef) => {
    const target = await resolveNote(store, ref);
    if (!target) return;
    const { note } = target;
    const editor = await vscode.window.showTextDocument(target.editor.document, target.editor.viewColumn);
    const doc = editor.document;
    await folds.unfold(editor, note);
    if (note.bodyEndLine === note.startLine + 1) {
      // Empty body: add a line to type into.
      const bodyLine = note.style === 'line' ? `${note.indent}${commentPrefix(doc.lineAt(note.startLine).text)} ` : note.indent;
      await editor.edit((b) => b.insert(new vscode.Position(note.bodyEndLine, 0), bodyLine + eolOf(doc)));
    }
    const line = note.startLine + 1;
    const end = doc.lineAt(line).range.end;
    editor.selection = new vscode.Selection(end, end);
    editor.revealRange(new vscode.Range(note.startLine, 0, line, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  };

  const del = async (ref?: NoteRef) => {
    const target = await resolveNote(store, ref);
    if (!target) return;
    const edit = new vscode.WorkspaceEdit();
    deleteNoteEdits(edit, target.editor.document, target.note);
    await vscode.workspace.applyEdit(edit);
  };

  const deleteAll = async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const { notes } = await store.get(editor.document);
    if (!notes.length) {
      void vscode.window.showInformationMessage('Este archivo no tiene notas.');
      return;
    }
    const answer = await vscode.window.showWarningMessage(
      `¿Borrar las ${notes.length} notas de este archivo? El código anotado se conserva.`,
      { modal: true },
      'Borrar todas',
    );
    if (answer !== 'Borrar todas') return;
    const edit = new vscode.WorkspaceEdit();
    notes.forEach((n) => deleteNoteEdits(edit, editor.document, n));
    await vscode.workspace.applyEdit(edit);
  };

  const navigate = (direction: 1 | -1) => async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const { notes } = await store.get(editor.document);
    if (!notes.length) {
      vscode.window.setStatusBarMessage('NoteFold: no hay notas en este archivo', 2500);
      return;
    }
    const line = editor.selection.active.line;
    const target =
      direction === 1
        ? notes.find((n) => codeStart(n) > line) ?? notes[0]
        : [...notes].reverse().find((n) => codeStart(n) < line) ?? notes[notes.length - 1];
    revealLine(editor, codeStart(target));
  };

  const reveal = async (ref: NoteRef) => {
    const editor = await editorFor(ref);
    if (!editor) return;
    const note = noteAtLine((await store.get(editor.document)).notes, ref.line);
    if (note) revealLine(editor, codeStart(note));
    await vscode.window.showTextDocument(editor.document, editor.viewColumn);
  };

  const open = async (ref?: NoteRef) => {
    const target = await resolveNote(store, ref);
    if (target) await preview.show(target.editor.document, target.note);
  };

  const regenerateId = async (ref: NoteRef) => {
    const editor = await editorFor(ref);
    if (!editor) return;
    const doc = editor.document;
    const { notes } = await store.get(doc);
    const note = notes.find((n) => n.startLine === ref.line);
    if (!note) return;
    const taken = new Set(notes.map((n) => n.id).filter((id): id is string => !!id));
    const line = doc.lineAt(note.startLine);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, line.range, withId(line.text, generateId(taken)));
    await vscode.workspace.applyEdit(edit);
  };

  return [
    vscode.commands.registerCommand('notefold.add', add),
    vscode.commands.registerCommand('notefold.edit', edit),
    vscode.commands.registerCommand('notefold.delete', del),
    vscode.commands.registerCommand('notefold.deleteAll', deleteAll),
    vscode.commands.registerCommand('notefold.next', navigate(1)),
    vscode.commands.registerCommand('notefold.previous', navigate(-1)),
    vscode.commands.registerCommand('notefold.reveal', reveal),
    vscode.commands.registerCommand('notefold.open', open),
    vscode.commands.registerCommand('notefold.regenerateId', regenerateId),
  ];
}

/** Comment prefix as written on a `@note-start` line (e.g. "#", "//"). */
function commentPrefix(startLineText: string): string {
  return startLineText.trim().split('@note-start')[0].trim();
}

/** Quick fix for duplicate ids. */
export class DuplicateIdFixProvider implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    return ctx.diagnostics
      .filter((d) => d.source === 'NoteFold' && d.code === 'duplicate-id')
      .map((d) => {
        const action = new vscode.CodeAction('Regenerar id de la nota', vscode.CodeActionKind.QuickFix);
        action.diagnostics = [d];
        action.command = {
          command: 'notefold.regenerateId',
          title: 'Regenerar id',
          arguments: [{ uri: doc.uri.toString(), line: d.range.start.line } satisfies NoteRef],
        };
        return action;
      });
  }
}
