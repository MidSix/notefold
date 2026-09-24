import * as vscode from 'vscode';
import { DuplicateIdFixProvider, registerCommands } from './commands';
import { registerCommentSyntaxInvalidation } from './commentSyntax';
import { DecorationManager } from './decorations';
import { FoldController } from './folding';
import { GutterNotes } from './gutterAdd';
import { NoteHoverProvider } from './hover';
import { NotesTreeProvider } from './notesTree';
import { NotePreview } from './preview';
import { NoteStore } from './store';

export function activate(context: vscode.ExtensionContext): void {
  const store = new NoteStore();
  const folds = new FoldController(store);
  const decorations = new DecorationManager(store);
  const preview = new NotePreview(store);
  const tree = new NotesTreeProvider(store);
  const all: vscode.DocumentSelector = { pattern: '**' };

  context.subscriptions.push(
    store,
    folds,
    decorations,
    preview,
    tree,
    new GutterNotes(store),
    registerCommentSyntaxInvalidation(),
    ...registerCommands(store, preview, folds),
    new NoteHoverProvider(store),
    vscode.languages.registerCodeActionsProvider(all, new DuplicateIdFixProvider(), {
      providedCodeActionKinds: DuplicateIdFixProvider.kinds,
    }),
    vscode.window.registerTreeDataProvider('codeNotes.fileNotes', tree),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('codeNotes')) return;
      decorations.reset();
      if (e.affectsConfiguration('codeNotes.displayMode')) void folds.refresh();
    }),
  );

  decorations.renderAll();
}

export function deactivate(): void {}
