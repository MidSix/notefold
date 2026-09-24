import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '../../..');
  // When launched from a VS Code terminal this is set and would make the test
  // instance start as plain Node.
  delete process.env.ELECTRON_RUN_AS_NODE;
  try {
    await runTests({
      extensionDevelopmentPath: root,
      extensionTestsPath: path.resolve(__dirname, 'suite/index'),
      // Other installed extensions are disabled; built-in languages stay available.
      // A short user-data-dir: the IPC socket path must stay under ~103 chars.
      launchArgs: [
        path.join(root, 'examples'),
        '--disable-extensions',
        `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'cn-'))}`,
      ],
      vscodeExecutablePath: process.env.VSCODE_PATH,
    });
  } catch (err) {
    console.error('Integration tests failed', err);
    process.exit(1);
  }
}

void main();
