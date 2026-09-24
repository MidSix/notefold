import * as vscode from 'vscode';
import type { NoteRef } from './commands';
import { codeEnd, codeStart, Note, noteTitle } from './parser';
import { NoteStore } from './store';

interface Item {
  uri: vscode.Uri;
  note: Note;
}

export class NotesTreeProvider implements vscode.TreeDataProvider<Item>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly disposables: vscode.Disposable[];

  constructor(private readonly store: NoteStore) {
    this.disposables = [
      this.emitter,
      vscode.window.onDidChangeActiveTextEditor(() => this.emitter.fire()),
      store.onDidUpdate((doc) => {
        if (doc === vscode.window.activeTextEditor?.document) this.emitter.fire();
      }),
    ];
  }

  async getChildren(element?: Item): Promise<Item[]> {
    const doc = vscode.window.activeTextEditor?.document;
    if (element || !doc) return [];
    const { notes } = await this.store.get(doc);
    return notes.map((note) => ({ uri: doc.uri, note }));
  }

  getTreeItem({ uri, note }: Item): vscode.TreeItem {
    const item = new vscode.TreeItem(noteTitle(note.body));
    const first = codeStart(note) + 1;
    const last = codeEnd(note) + 1;
    item.description = first === last ? `L${first}` : `L${first}–${last}`;
    item.tooltip = new vscode.MarkdownString(note.body || '_(nota vacía)_');
    item.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(`notefold.${note.color}Ruler`));
    const ref: NoteRef = { uri: uri.toString(), line: note.startLine };
    item.command = { command: 'notefold.reveal', title: 'Ir a la nota', arguments: [ref] };
    return item;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
