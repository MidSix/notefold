import * as path from 'path';
import * as vscode from 'vscode';
import { codeEnd, codeStart, Note, noteAtLine } from './parser';
import { NoteStore } from './store';

export const PREVIEW_SCHEME = 'notefold-note';

interface Target {
  doc: vscode.Uri;
  id?: string;
  line: number;
}

/**
 * Shows a note in the built-in Markdown preview, through a read-only virtual
 * document (`notefold-note:` scheme) that follows the note as the file changes.
 */
export class NotePreview implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;
  private readonly targets = new Map<string, Target>();
  private readonly disposables: vscode.Disposable[];

  constructor(private readonly store: NoteStore) {
    this.disposables = [
      this.emitter,
      vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, this),
      store.onDidUpdate((doc) => {
        for (const [key, t] of this.targets) {
          if (t.doc.toString() === doc.uri.toString()) this.emitter.fire(vscode.Uri.parse(key));
        }
      }),
    ];
  }

  async show(doc: vscode.TextDocument, note: Note): Promise<void> {
    const name = `${path.basename(doc.uri.path)} · nota ${note.id ?? `L${note.startLine + 1}`}.md`;
    const uri = vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: `/${name}`, query: doc.uri.toString() });
    this.targets.set(uri.toString(), { doc: doc.uri, id: note.id, line: note.startLine });
    this.emitter.fire(uri);
    try {
      await vscode.commands.executeCommand('markdown.showPreviewToSide', uri);
    } catch {
      // Markdown extension disabled: fall back to the raw text.
      await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside, preview: true });
    }
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const t = this.targets.get(uri.toString());
    if (!t) return '_Nota no disponible._';
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === t.doc.toString())
      ?? (await vscode.workspace.openTextDocument(t.doc));
    const { notes } = await this.store.get(doc);
    const note = (t.id && notes.find((n) => n.id === t.id)) || noteAtLine(notes, t.line);
    if (!note) return '_La nota ya no existe._';
    t.line = note.startLine;
    const first = codeStart(note) + 1;
    const last = codeEnd(note) + 1;
    const where = first === last ? `línea ${first}` : `líneas ${first}–${last}`;
    return `${note.body || '_(nota vacía)_'}\n\n---\n\n_${path.basename(doc.uri.path)}, ${where}_\n`;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
