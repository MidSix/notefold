import * as vscode from 'vscode';
import { getCommentSyntax } from './commentSyntax';
import { parseNotes, ParseResult } from './parser';

const IGNORED_SCHEMES = new Set(['output', 'debug', 'notefold-note', 'vscode-scm', 'comment']);
const EMPTY: ParseResult = { notes: [], problems: [] };

interface Entry {
  version: number;
  languageId: string;
  result: ParseResult;
}

export const isSupported = (doc: vscode.TextDocument): boolean => !IGNORED_SCHEMES.has(doc.uri.scheme);

/**
 * Parses documents on demand and caches the result per document version and
 * language. Edits are debounced; everything else reads the cache.
 */
export class NoteStore implements vscode.Disposable {
  private readonly cache = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<ParseResult>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly emitter = new vscode.EventEmitter<vscode.TextDocument>();
  readonly onDidUpdate = this.emitter.event;
  readonly diagnostics = vscode.languages.createDiagnosticCollection('notefold');
  private readonly disposables: vscode.Disposable[] = [this.emitter, this.diagnostics];

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.contentChanges.length && isSupported(e.document)) this.schedule(e.document);
      }),
      // Language changes arrive as close + open of the same document.
      vscode.workspace.onDidOpenTextDocument((d) => isSupported(d) && void this.get(d)),
      vscode.workspace.onDidCloseTextDocument((d) => this.forget(d.uri)),
    );
  }

  /** Last parse result if it is up to date, without parsing. */
  peek(doc: vscode.TextDocument): ParseResult | undefined {
    const e = this.cache.get(doc.uri.toString());
    return e && e.version === doc.version && e.languageId === doc.languageId ? e.result : undefined;
  }

  /** Up-to-date parse result, parsing now if needed. */
  get(doc: vscode.TextDocument): Promise<ParseResult> {
    if (!isSupported(doc)) return Promise.resolve(EMPTY);
    const cached = this.peek(doc);
    if (cached) return Promise.resolve(cached);
    const key = `${doc.uri.toString()}@${doc.version}:${doc.languageId}`;
    let p = this.pending.get(key);
    if (!p) {
      p = this.parse(doc).finally(() => this.pending.delete(key));
      this.pending.set(key, p);
    }
    return p;
  }

  private schedule(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    clearTimeout(this.timers.get(key));
    const delay = doc.lineCount > 5000 ? 500 : 150;
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        if (!doc.isClosed) void this.get(doc);
      }, delay),
    );
  }

  private async parse(doc: vscode.TextDocument): Promise<ParseResult> {
    const { version, languageId } = doc;
    const syntax = await getCommentSyntax(languageId);
    if (doc.isClosed) return EMPTY;
    // The document may have changed while the syntax was loading.
    if (doc.version !== version || doc.languageId !== languageId) return this.get(doc);
    const result = syntax ? parseNotes(doc.getText(), syntax) : EMPTY;
    this.cache.set(doc.uri.toString(), { version, languageId, result });
    this.publishDiagnostics(doc, result);
    this.emitter.fire(doc);
    return result;
  }

  private publishDiagnostics(doc: vscode.TextDocument, result: ParseResult): void {
    this.diagnostics.set(
      doc.uri,
      result.problems.map((p) => {
        const d = new vscode.Diagnostic(
          doc.lineAt(p.line).range,
          p.message,
          p.kind === 'duplicate-id' ? vscode.DiagnosticSeverity.Information : vscode.DiagnosticSeverity.Warning,
        );
        d.source = 'NoteFold';
        d.code = p.kind;
        return d;
      }),
    );
  }

  private forget(uri: vscode.Uri): void {
    const key = uri.toString();
    this.cache.delete(key);
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.diagnostics.delete(uri);
  }

  dispose(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.disposables.forEach((d) => d.dispose());
  }
}
