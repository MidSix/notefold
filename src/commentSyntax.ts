import * as vscode from 'vscode';
import { commentSyntaxFromConfig, parseJsonc } from './languageConfig';
import type { CommentSyntax } from './parser';

// The VS Code API has no getter for a language's configuration, so we read the
// `language-configuration.json` that installed extensions (built-in ones
// included) declare in `contributes.languages[].configuration`.

let index: Map<string, vscode.Uri[]> | undefined;
const cache = new Map<string, Promise<CommentSyntax | undefined>>();

function buildIndex(): Map<string, vscode.Uri[]> {
  const map = new Map<string, vscode.Uri[]>();
  for (const ext of vscode.extensions.all) {
    const languages: unknown = ext.packageJSON?.contributes?.languages;
    if (!Array.isArray(languages)) continue;
    for (const lang of languages) {
      if (typeof lang?.id !== 'string' || typeof lang.configuration !== 'string') continue;
      const uri = vscode.Uri.joinPath(ext.extensionUri, lang.configuration);
      map.set(lang.id, [...(map.get(lang.id) ?? []), uri]);
    }
  }
  return map;
}

async function load(languageId: string): Promise<CommentSyntax | undefined> {
  index ??= buildIndex();
  for (const uri of index.get(languageId) ?? []) {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const syntax = commentSyntaxFromConfig(parseJsonc(new TextDecoder().decode(bytes)));
      if (syntax) return syntax;
    } catch {
      // Unreadable or invalid config: try the next contributor.
    }
  }
  return undefined;
}

/** Comment tokens for a language, or undefined if the language exposes none. */
export function getCommentSyntax(languageId: string): Promise<CommentSyntax | undefined> {
  let p = cache.get(languageId);
  if (!p) {
    p = load(languageId);
    cache.set(languageId, p);
  }
  return p;
}

export function registerCommentSyntaxInvalidation(): vscode.Disposable {
  return vscode.extensions.onDidChange(() => {
    index = undefined;
    cache.clear();
  });
}
