// Validate the LaTeX (KaTeX) and Mermaid inside NoteFold bodies with the
// same engines VS Code's Markdown preview uses. Called by check_notes.py with
// JSON on stdin: [{file, line, body}], prints JSON [{file, line, msg}].
// Dependencies are installed once into ~/.cache/code-notes-render.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const cache = path.join(os.homedir(), '.cache', 'code-notes-render');
if (!fs.existsSync(path.join(cache, 'node_modules', 'mermaid'))) {
  fs.mkdirSync(cache, { recursive: true });
  execSync('npm install --silent --no-audit --no-fund --prefix . katex mermaid jsdom', { cwd: cache, stdio: 'ignore' });
}
const require = createRequire(path.join(cache, 'index.js'));
const katex = require('katex');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const mermaidPath = path.join(cache, 'node_modules', 'mermaid', 'dist', 'mermaid.core.mjs');
const { default: mermaid } = await import(pathToFileURL(mermaidPath).href);

const notes = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = [];
for (const { file, line, body } of notes) {
  const noCode = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const display = [...noCode.matchAll(/\$\$([\s\S]+?)\$\$/g)].map((m) => [m[1], true]);
  const inline = [...noCode.replace(/\$\$[\s\S]+?\$\$/g, '').matchAll(/\$([^$\n]+?)\$/g)].map((m) => [m[1], false]);
  for (const [tex, displayMode] of [...display, ...inline]) {
    try {
      katex.renderToString(tex, { displayMode, throwOnError: true });
    } catch (e) {
      out.push({ file, line, msg: `LaTeX inválido «${tex.trim().slice(0, 60)}»: ${String(e.message).replace(/^KaTeX parse error: /, '').slice(0, 120)}` });
    }
  }
  for (const m of body.matchAll(/```mermaid\n([\s\S]*?)```/g)) {
    try {
      await mermaid.parse(m[1]);
    } catch (e) {
      out.push({ file, line, msg: `Mermaid inválido: ${String(e.message).split('\n').slice(0, 3).join(' ').slice(0, 200)}` });
    }
  }
}
process.stdout.write(JSON.stringify(out));
