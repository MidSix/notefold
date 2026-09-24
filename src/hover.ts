import * as vscode from 'vscode';
import type { NoteRef } from './commands';
import { showNoteOnLineNumberClick } from './config';
import { codeStart, Note, noteAtLine, wholeLineSelection } from './parser';
import { NoteStore } from './store';

const ACTIONS = ['notefold.open', 'notefold.edit', 'notefold.delete'];

const commandLink = (label: string, command: string, ref: NoteRef): string =>
  `[${label}](command:${command}?${encodeURIComponent(JSON.stringify([ref]))})`;

/**
 * Shows a note's hover:
 * - when hovering its `@note-start` line, or the ghost-text title after the
 *   first annotated line (never on the code itself, so it keeps its usual
 *   hovers and nothing pops up while typing);
 * - when the line number of an annotated line is clicked (next to the gutter
 *   bar). VS Code has no API for clicks on the gutter itself, but a click on
 *   a line number selects that whole line, which we can detect.
 */
export class NoteHoverProvider implements vscode.HoverProvider, vscode.Disposable {
  /** Note to show on the next hover request, set by a line-number click. */
  private forced?: { uri: string; line: number; until: number };
  private readonly disposables: vscode.Disposable[];

  constructor(
    private readonly store: NoteStore,
    /** Told where the mouse rests, so hidden markers can be revealed. */
    private readonly onMouseAt: (doc: vscode.TextDocument, line: number) => void = () => {},
  ) {
    this.disposables = [
      vscode.languages.registerHoverProvider({ pattern: '**' }, this),
      vscode.window.onDidChangeTextEditorSelection((e) => void this.onSelection(e)),
    ];
  }

  private async onSelection(e: vscode.TextEditorSelectionChangeEvent): Promise<void> {
    if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse || e.selections.length !== 1 || !showNoteOnLineNumberClick()) return;
    const doc = e.textEditor.document;
    const sel = e.selections[0];
    const last = doc.lineCount - 1;
    const line = wholeLineSelection(sel.start, sel.end, last, doc.lineAt(last).text.length);
    if (line === undefined) return;
    const note = noteAtLine((await this.store.get(doc)).notes, line);
    if (!note || (line > note.startLine && line <= note.bodyEndLine) || line === note.endLine) return;
    this.forced = { uri: doc.uri.toString(), line, until: Date.now() + 1500 };
    await vscode.commands.executeCommand('editor.action.showHover');
  }

  async provideHover(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Hover | undefined> {
    this.onMouseAt(doc, pos.line);
    const { notes } = await this.store.get(doc);
    const forced = this.forced;
    this.forced = undefined;
    if (forced && forced.uri === doc.uri.toString() && Date.now() < forced.until) {
      const note = noteAtLine(notes, forced.line);
      if (note) return this.hover(doc, note, pos);
    }
    // Hovering the ghost text after the code reports the end-of-line position.
    const atLineEnd = pos.character >= doc.lineAt(pos.line).text.length;
    const note = notes.find((n) => n.startLine === pos.line || (atLineEnd && codeStart(n) === pos.line));
    return note && this.hover(doc, note, pos);
  }

  private hover(doc: vscode.TextDocument, note: Note, pos: vscode.Position): vscode.Hover {
    // The note body is user content: rendered untrusted, no HTML, no command links.
    const body = new vscode.MarkdownString(note.body || '_(nota vacía)_');
    body.isTrusted = false;
    body.supportHtml = false;

    // Action links live in a separate string that may only run our own commands.
    const ref: NoteRef = { uri: doc.uri.toString(), line: note.startLine };
    const actions = new vscode.MarkdownString(
      `$(comment) ${commandLink('Abrir', 'notefold.open', ref)} · ` +
        `${commandLink('Editar', 'notefold.edit', ref)} · ${commandLink('Borrar', 'notefold.delete', ref)}`,
      true,
    );
    actions.isTrusted = { enabledCommands: ACTIONS };

    return new vscode.Hover([body, actions], doc.lineAt(pos.line).range);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
