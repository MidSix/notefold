import type { CommentSyntax } from './parser';

// Minimal JSONC reader for language-configuration.json files:
// strips // and /* */ comments and trailing commas outside strings.

export function parseJsonc(text: string): unknown {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/**
 * Extracts comment tokens from a parsed language-configuration.json.
 * `lineComment` may be a string or (newer VS Code) `{ comment: string }`.
 */
export function commentSyntaxFromConfig(config: unknown): CommentSyntax | undefined {
  const comments = (config as { comments?: { lineComment?: unknown; blockComment?: unknown } } | null)?.comments;
  if (!comments || typeof comments !== 'object') return undefined;
  const result: CommentSyntax = {};
  const lc = comments.lineComment;
  const line = typeof lc === 'string' ? lc : (lc as { comment?: unknown } | undefined)?.comment;
  if (typeof line === 'string' && line.trim()) result.lineComment = line.trim();
  const bc = comments.blockComment;
  if (Array.isArray(bc) && bc.length === 2 && bc.every((t) => typeof t === 'string' && t.trim())) {
    result.blockComment = [bc[0].trim(), bc[1].trim()];
  }
  return result.lineComment || result.blockComment ? result : undefined;
}
