import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const EXAMPLES = path.resolve(__dirname, '../../../../examples');

async function waitFor(cond: () => boolean | Promise<boolean>, what: string, ms = 6000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`Timed out waiting for: ${what}`);
}

async function open(language: string, content: string): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument({ language, content });
  return vscode.window.showTextDocument(doc);
}

async function openExample(name: string): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument(path.join(EXAMPLES, name));
  return vscode.window.showTextDocument(doc);
}

function place(editor: vscode.TextEditor, line: number, char = 0, toLine = line, toChar = char): void {
  editor.selection = new vscode.Selection(line, char, toLine, toChar);
}

const lineOf = (doc: vscode.TextDocument, needle: string): number =>
  doc.getText().split(/\r?\n/).findIndex((l) => l.includes(needle));

const isVisible = (editor: vscode.TextEditor, line: number): boolean =>
  editor.visibleRanges.some((r) => r.start.line <= line && line <= r.end.line);

suite('Code Notes', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('sebastian-moreno.code-notes')!.activate();
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  const languages: [string, string, string][] = [
    ['python', '# @note-start', '# @note-end'],
    ['julia', '# @note-start', '# @note-end'],
    ['c', '// @note-start', '// @note-end'],
    ['cpp', '// @note-start', '// @note-end'],
    ['csharp', '// @note-start', '// @note-end'],
    ['java', '// @note-start', '// @note-end'],
    ['javascript', '// @note-start', '// @note-end'],
    ['typescript', '// @note-start', '// @note-end'],
    ['rust', '// @note-start', '// @note-end'],
    ['go', '// @note-start', '// @note-end'],
    ['ruby', '# @note-start', '# @note-end'],
    ['shellscript', '# @note-start', '# @note-end'],
    ['sql', '-- @note-start', '-- @note-end'],
    ['lua', '-- @note-start', '-- @note-end'],
    ['css', '/* @note-start', '/* @note-end */'],
    ['html', '<!-- @note-start', '<!-- @note-end -->'],
  ];

  for (const [lang, start, end] of languages) {
    test(`add note uses the ${lang} comment syntax`, async () => {
      const editor = await open(lang, 'first\nsecond\nthird');
      place(editor, 1);
      await vscode.commands.executeCommand('codeNotes.add');
      const lines = editor.document.getText().split('\n');
      assert.strictEqual(lines[0], 'first');
      assert.ok(lines[1].startsWith(`${start} id=`), lines[1]);
      assert.ok(lines[3].includes('@note-body-end'), lines[3]);
      assert.strictEqual(lines[4], 'second');
      assert.strictEqual(lines[5], end);
      assert.strictEqual(lines[6], 'third');
      assert.strictEqual(editor.selection.active.line, 2, 'cursor goes into the body');
    });
  }

  test('add note: multi-line selection, indentation, single undo', async () => {
    const original = 'def f():\n    a = 1\n    b = 2\n    return a + b\n';
    const editor = await open('python', original);
    place(editor, 1, 2, 3, 0); // ends at column 0 of line 3 -> lines 1..2
    await vscode.commands.executeCommand('codeNotes.add');
    await editor.edit((b) => b.insert(editor.selection.active, 'hola'), { undoStopBefore: false, undoStopAfter: false });
    const lines = editor.document.getText().split('\n');
    assert.match(lines[1], /^ {4}# @note-start id=[a-z0-9]{6}$/);
    assert.strictEqual(lines[2], '    # hola');
    assert.strictEqual(lines[3], '    # @note-body-end');
    assert.strictEqual(lines[6], '    # @note-end');
    assert.strictEqual(lines[7], '    return a + b');
    await vscode.commands.executeCommand('undo');
    await vscode.commands.executeCommand('undo');
    assert.strictEqual(editor.document.getText(), original);
  });

  test('add note keeps CRLF line endings', async () => {
    const editor = await open('javascript', 'let a = 1;\r\nlet b = 2;\r\n');
    assert.strictEqual(editor.document.eol, vscode.EndOfLine.CRLF);
    place(editor, 0);
    await vscode.commands.executeCommand('codeNotes.add');
    const text = editor.document.getText();
    assert.strictEqual(text.split('\r\n').length, 7);
    assert.ok(!/[^\r]\n/.test(text), 'no bare LF');
  });

  test('add note refuses languages without comments and overlapping notes', async () => {
    const plain = await open('plaintext', 'hello');
    await vscode.commands.executeCommand('codeNotes.add');
    assert.strictEqual(plain.document.getText(), 'hello');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');

    const text = '# @note-start id=aaaaaa\n# x\n# @note-body-end\na = 1\n# @note-end\nb = 2\n';
    const editor = await open('python', text);
    place(editor, 3, 0, 5, 1);
    await vscode.commands.executeCommand('codeNotes.add');
    assert.strictEqual(editor.document.getText(), text);
  });

  test('delete note keeps the code and is one undo step', async () => {
    const text = 'x = 0\n# @note-start id=aaaaaa\n# body\n# @note-body-end\na = 1\nb = 2\n# @note-end\ny = 3';
    const editor = await open('python', text);
    place(editor, 4);
    await vscode.commands.executeCommand('codeNotes.delete');
    assert.strictEqual(editor.document.getText(), 'x = 0\na = 1\nb = 2\ny = 3');
    await vscode.commands.executeCommand('undo');
    assert.strictEqual(editor.document.getText(), text);
  });

  test('delete note at the end of the file', async () => {
    const editor = await open('python', '# @note-start\n# body\n# @note-body-end\na = 1\n# @note-end');
    place(editor, 3);
    await vscode.commands.executeCommand('codeNotes.delete');
    assert.strictEqual(editor.document.getText(), 'a = 1');
  });

  const hoverText = async (doc: vscode.TextDocument, line: number, char: number): Promise<string> => {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, new vscode.Position(line, char));
    return hovers.flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : c.value))).join('\n');
  };

  test('hover on the @note-start line shows the note with action links', async () => {
    const editor = await openExample('demo.py');
    const text = await hoverText(editor.document, lineOf(editor.document, 'id=k3x9qa'), 8);
    assert.ok(text.includes('**media ponderada**'), text);
    assert.ok(text.includes('command:codeNotes.edit'), text);
    assert.ok(text.includes('command:codeNotes.delete'), text);
  });

  test('annotated code lines have no note hover', async () => {
    const editor = await openExample('demo.py');
    const text = await hoverText(editor.document, lineOf(editor.document, 'total = sum'), 6);
    assert.ok(!text.includes('media ponderada'), text);
  });

  test('hover at the end of the first annotated line (ghost title) shows the note', async () => {
    const editor = await openExample('demo.py');
    const line = lineOf(editor.document, 'total = sum');
    const end = editor.document.lineAt(line).text.length;
    assert.ok((await hoverText(editor.document, line, end)).includes('media ponderada'));
    const second = line + 1; // not the first annotated line
    assert.ok(!(await hoverText(editor.document, second, editor.document.lineAt(second).text.length)).includes('media ponderada'));
  });

  test('folded regions are not highlighted (editor.foldingHighlight default)', () => {
    assert.strictEqual(vscode.workspace.getConfiguration('editor').get('foldingHighlight'), false);
  });

  test('fold mode: notes are folded, unfold on cursor enter, refold on leave', async () => {
    const editor = await openExample('demo.py');
    const start = lineOf(editor.document, 'id=k3x9qa');
    const body = start + 1;
    await waitFor(() => !isVisible(editor, body), 'note body folded');
    assert.ok(isVisible(editor, start), 'start line stays visible');
    assert.ok(isVisible(editor, start + 5), 'annotated code visible');

    place(editor, body, 4);
    await waitFor(() => isVisible(editor, body), 'unfolded when the cursor enters');

    place(editor, start + 6, 0);
    await waitFor(() => !isVisible(editor, body), 'folded again when the cursor leaves');
  });

  test('edit command places the cursor in the body and unfolds', async () => {
    const editor = await openExample('demo.cpp');
    const start = lineOf(editor.document, 'id=c9v1re');
    await waitFor(() => !isVisible(editor, start + 1), 'folded');
    place(editor, start + 10);
    await vscode.commands.executeCommand('codeNotes.edit');
    assert.strictEqual(editor.selection.active.line, start + 1);
    await waitFor(() => isVisible(editor, start + 1), 'unfolded for editing');
  });

  test('dim / off modes do not fold; switching back to fold folds again', async () => {
    const editor = await openExample('demo.py');
    const body = lineOf(editor.document, 'id=k3x9qa') + 1;
    await waitFor(() => !isVisible(editor, body), 'folded');
    const cfg = vscode.workspace.getConfiguration('codeNotes');
    try {
      await cfg.update('displayMode', 'dim', vscode.ConfigurationTarget.Global);
      await waitFor(() => isVisible(editor, body), 'dim mode shows the body');
      await cfg.update('displayMode', 'fold', vscode.ConfigurationTarget.Global);
      await waitFor(() => !isVisible(editor, body), 'fold mode folds again');
    } finally {
      await cfg.update('displayMode', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('malformed block produces a warning diagnostic', async () => {
    const editor = await openExample('demo.py');
    const bad = lineOf(editor.document, 'id=bad001');
    await waitFor(
      () => vscode.languages.getDiagnostics(editor.document.uri).some((d) => d.range.start.line === bad && d.code === 'missing-end'),
      'missing-end diagnostic',
    );
  });

  test('duplicate ids get a quick fix that regenerates the id', async () => {
    const block = '# @note-start id=dupdup\n# x\n# @note-body-end\na = 1\n# @note-end\n';
    const editor = await open('python', block + block);
    const doc = editor.document;
    await waitFor(() => vscode.languages.getDiagnostics(doc.uri).some((d) => d.code === 'duplicate-id'), 'duplicate diagnostic');
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider',
      doc.uri,
      new vscode.Range(5, 0, 5, 0),
    );
    const fix = actions.find((a) => a.title === 'Regenerar id de la nota');
    assert.ok(fix?.command, 'quick fix offered');
    await vscode.commands.executeCommand(fix.command.command, ...(fix.command.arguments ?? []));
    const ids = doc.getText().match(/id=\w+/g)!;
    assert.strictEqual(ids.length, 2);
    assert.notStrictEqual(ids[0], ids[1]);
  });

  test('next / previous navigate between notes and wrap around', async () => {
    const editor = await openExample('demo.cpp');
    const first = lineOf(editor.document, 'std::vector<long long> build_prefix');
    const second = lineOf(editor.document, 'std::printf');
    place(editor, 0);
    await vscode.commands.executeCommand('codeNotes.next');
    assert.strictEqual(editor.selection.active.line, first);
    await vscode.commands.executeCommand('codeNotes.next');
    assert.strictEqual(editor.selection.active.line, second);
    await vscode.commands.executeCommand('codeNotes.next');
    assert.strictEqual(editor.selection.active.line, first, 'wraps');
    await vscode.commands.executeCommand('codeNotes.previous');
    assert.strictEqual(editor.selection.active.line, second, 'wraps backwards');
  });

  test('open note shows it in a side preview document', async () => {
    const editor = await openExample('demo.cpp');
    place(editor, lineOf(editor.document, 'std::printf'));
    await vscode.commands.executeCommand('codeNotes.open');
    await waitFor(
      () => vscode.workspace.textDocuments.some((d) => d.uri.scheme === 'code-note' && d.getText().includes('Indentación distinta')),
      'virtual note document',
    );
  });

  test('open note passes LaTeX and Mermaid intact to the Markdown preview (Julia)', async () => {
    const editor = await openExample('demo.jl');
    assert.strictEqual(editor.document.languageId, 'julia');
    place(editor, lineOf(editor.document, 'y .= a .* x .+ b'));
    await vscode.commands.executeCommand('codeNotes.open');
    let text = '';
    await waitFor(() => {
      text = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'code-note' && d.getText().includes('Broadcast'))?.getText() ?? '';
      return !!text;
    }, 'virtual note document');
    assert.ok(text.includes('$$\ny_i = a \\, x_i + b \\qquad \\forall\\, i \\in 1,\\dots,n\n$$'), text);
    assert.ok(text.includes('```mermaid\nflowchart LR\n    A["y .= a .* x .+ b"]'), text);
  });

  test('block-comment languages (CSS) are parsed and hovered', async () => {
    const editor = await openExample('demo.css');
    const text = await hoverText(editor.document, lineOf(editor.document, 'id=css7aa'), 6);
    assert.ok(text.includes('Color principal del botón'), text);
  });

  // The gutter "+" opens a comment thread; here we fake the thread VS Code
  // would create and call the "Crear nota" button's command directly.
  const fakeThread = (uri: vscode.Uri, range: vscode.Range) => {
    const t = {
      uri,
      range,
      label: undefined as string | undefined,
      contextValue: undefined as string | undefined,
      disposed: false,
      dispose: () => (t.disposed = true),
    };
    return t;
  };

  test('gutter: creates the note above the first line, with body and colour', async () => {
    const editor = await open('python', 'def f():\n    a = 1\n    b = 2\n    c = 3\n    return a\n');
    // Selection made bottom-up (line 3 -> 1): the thread range is normalised by VS Code.
    const thread = fakeThread(editor.document.uri, new vscode.Range(1, 0, 3, 9));
    await vscode.commands.executeCommand('codeNotes.gutter.color.green', thread);
    assert.strictEqual(thread.label, 'Color: Verde');
    assert.strictEqual(thread.contextValue, 'codeNotes.color.green', 'drives which dot is framed');
    await vscode.commands.executeCommand('codeNotes.gutter.create', { thread, text: 'Suma **todo**\n\n- paso 1' });
    const lines = editor.document.getText().split('\n');
    assert.match(lines[1], /^ {4}# @note-start id=[a-z0-9]{6} color=green$/);
    assert.deepStrictEqual(lines.slice(2, 9), [
      '    # Suma **todo**',
      '    # ',
      '    # - paso 1',
      '    # @note-body-end',
      '    a = 1',
      '    b = 2',
      '    c = 3',
    ]);
    assert.strictEqual(lines[9], '    # @note-end');
    assert.ok(thread.disposed, 'temporary thread is discarded');
    await vscode.commands.executeCommand('undo');
    assert.ok(!editor.document.getText().includes('@note'), 'one undo step');
  });

  test('gutter: uses each language syntax (C++ and CSS)', async () => {
    const cpp = await open('cpp', 'int a = 1;\n');
    await vscode.commands.executeCommand('codeNotes.gutter.create', { thread: fakeThread(cpp.document.uri, new vscode.Range(0, 0, 0, 0)), text: 'hola' });
    assert.match(cpp.document.getText(), /^\/\/ @note-start id=\w+\n\/\/ hola\n\/\/ @note-body-end\nint a = 1;\n\/\/ @note-end\n$/);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');

    const css = await open('css', 'a { color: red; }\n');
    await vscode.commands.executeCommand('codeNotes.gutter.create', { thread: fakeThread(css.document.uri, new vscode.Range(0, 0, 0, 0)), text: 'rojo' });
    assert.match(css.document.getText(), /^\/\* @note-start id=\w+\nrojo\n@note-body-end \*\/\na \{ color: red; \}\n\/\* @note-end \*\/\n$/);
  });

  test('gutter: refuses ranges with comments or inside notes, and empty text', async () => {
    const text = 'a = 1\n# comentario\nb = 2\n# @note-start id=aaaaaa\n# x\n# @note-body-end\nc = 3\n# @note-end\n';
    const editor = await open('python', text);
    for (const range of [new vscode.Range(0, 0, 2, 0 + 5), new vscode.Range(6, 0, 6, 0)]) {
      const thread = fakeThread(editor.document.uri, range);
      await vscode.commands.executeCommand('codeNotes.gutter.create', { thread, text: 'nota' });
      assert.strictEqual(editor.document.getText(), text);
      assert.ok(!thread.disposed, 'thread stays open so the user can fix or cancel');
    }
    await vscode.commands.executeCommand('codeNotes.gutter.create', { thread: fakeThread(editor.document.uri, new vscode.Range(0, 0, 0, 0)), text: '  ' });
    assert.strictEqual(editor.document.getText(), text);
  });
});
