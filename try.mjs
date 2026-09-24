// Opens a VS Code window with the extension loaded, without a debugger.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const r = spawnSync(
  'code',
  [
    '--new-window',
    '--disable-extensions',
    `--extensionDevelopmentPath=${root}`,
    path.join(root, 'examples'),
    path.join(root, 'examples', 'demo.py'),
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(r.status ?? 1);
