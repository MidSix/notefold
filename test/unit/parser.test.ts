import { describe, expect, it } from 'vitest';
import {
  buildNoteBlock,
  canAnnotate,
  commentingRanges,
  commentLines,
  wholeLineSelection,
  noteTitle,
  codeEnd,
  codeStart,
  CommentSyntax,
  detectEol,
  generateId,
  noteAtLine,
  parseNotes,
  withId,
} from '../../src/parser';

const PY: CommentSyntax = { lineComment: '#' };
const C: CommentSyntax = { lineComment: '//', blockComment: ['/*', '*/'] };
const SQL: CommentSyntax = { lineComment: '--', blockComment: ['/*', '*/'] };
const LUA: CommentSyntax = { lineComment: '--', blockComment: ['--[[', ']]'] };
const JULIA: CommentSyntax = { lineComment: '#', blockComment: ['#=', '=#'] };
const CSS: CommentSyntax = { blockComment: ['/*', '*/'] };
const HTML: CommentSyntax = { blockComment: ['<!--', '-->'] };

const src = (...lines: string[]) => lines.join('\n');

describe('parseNotes – basic', () => {
  it('returns nothing for files without notes', () => {
    expect(parseNotes(src('x = 1', '# just a comment', 'y = 2'), PY)).toEqual({ notes: [], problems: [] });
    expect(parseNotes('', PY)).toEqual({ notes: [], problems: [] });
  });

  it('returns nothing when the language has no comment syntax', () => {
    expect(parseNotes(src('# @note-start', '# a', '# @note-body-end', 'x', '# @note-end'), {}).notes).toEqual([]);
  });

  it('parses the spec example (multi-line range)', () => {
    const text = src(
      '# @note-start',
      '# Aquí calculamos la media ponderada.',
      '# - `w` son los pesos',
      '# - se normaliza al final',
      '# @note-body-end',
      'total = sum(w * x for w, x in zip(ws, xs))',
      'normalized = total / sum(ws)',
      '# @note-end',
    );
    const { notes, problems } = parseNotes(text, PY);
    expect(problems).toEqual([]);
    expect(notes).toHaveLength(1);
    const n = notes[0];
    expect(n).toMatchObject({ id: undefined, style: 'line', indent: '', startLine: 0, bodyEndLine: 4, endLine: 7 });
    expect(codeStart(n)).toBe(5);
    expect(codeEnd(n)).toBe(6);
    expect(n.body).toBe('Aquí calculamos la media ponderada.\n- `w` son los pesos\n- se normaliza al final');
  });

  it('parses a single-line range and the id', () => {
    const text = src('int a;', '// @note-start id=a1b2', '// uno', '// @note-body-end', 'int b = 2;', '// @note-end');
    const [n] = parseNotes(text, C).notes;
    expect(n.id).toBe('a1b2');
    expect(codeStart(n)).toBe(4);
    expect(codeEnd(n)).toBe(4);
    expect(n.body).toBe('uno');
  });

  it('allows an empty body', () => {
    const [n] = parseNotes(src('# @note-start id=x', '# @note-body-end', 'a', '# @note-end'), PY).notes;
    expect(n.body).toBe('');
  });

  it('parses several consecutive notes', () => {
    const one = ['# @note-start id=a', '# A', '# @note-body-end', 'a = 1', '# @note-end'];
    const two = ['# @note-start id=b', '# B', '# @note-body-end', 'b = 1', 'c = 1', '# @note-end'];
    const { notes, problems } = parseNotes(src(...one, 'mid = 0', ...two), PY);
    expect(problems).toEqual([]);
    expect(notes.map((n) => [n.id, n.startLine, n.endLine])).toEqual([
      ['a', 0, 4],
      ['b', 6, 11],
    ]);
  });
});

describe('parseNotes – languages', () => {
  const lineBlock = (lc: string) => src(`${lc} @note-start id=z`, `${lc} body`, `${lc} @note-body-end`, 'code', `${lc} @note-end`);

  it.each([
    ['python/ruby/shell/julia', PY, '#'],
    ['c/cpp/java/js/ts/rust/go/c#', C, '//'],
    ['sql', SQL, '--'],
    ['lua', LUA, '--'],
    ['julia', JULIA, '#'],
  ])('%s line comments', (_name, syntax, lc) => {
    const { notes, problems } = parseNotes(lineBlock(lc), syntax);
    expect(problems).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id: 'z', body: 'body', style: 'line' });
  });

  it('does not confuse lua block comment opener with the line prefix', () => {
    const text = src('--[[ @note-start id=q', 'texto', '@note-body-end ]]', 'x = 1', '--[[ @note-end ]]');
    const [n] = parseNotes(text, LUA).notes;
    expect(n).toMatchObject({ id: 'q', style: 'block', body: 'texto' });
  });

  it('parses CSS block-comment notes', () => {
    const text = src(
      '.a {',
      '  /* @note-start id=css1',
      '  Colores del **botón**',
      '    - anidado',
      '  @note-body-end */',
      '  color: red;',
      '  /* @note-end */',
      '}',
    );
    const { notes, problems } = parseNotes(text, CSS);
    expect(problems).toEqual([]);
    expect(notes[0]).toMatchObject({ id: 'css1', style: 'block', indent: '  ', startLine: 1, bodyEndLine: 4, endLine: 6 });
    expect(notes[0].body).toBe('Colores del **botón**\n  - anidado');
  });

  it('parses HTML block-comment notes', () => {
    const text = src('<!-- @note-start id=h', 'Cabecera', '@note-body-end -->', '<h1>Hola</h1>', '<!-- @note-end -->');
    expect(parseNotes(text, HTML).notes[0]).toMatchObject({ id: 'h', body: 'Cabecera' });
  });

  it('accepts block style in a language that also has line comments', () => {
    const text = src('/* @note-start id=b', 'cuerpo', '@note-body-end */', 'int x;', '/* @note-end */');
    expect(parseNotes(text, C).notes[0]).toMatchObject({ style: 'block', body: 'cuerpo' });
  });

  it('ignores a one-line block comment that mentions @note-start', () => {
    const text = src('/* @note-start id=b */', 'int x;');
    expect(parseNotes(text, CSS)).toEqual({ notes: [], problems: [] });
  });
});

describe('parseNotes – indentation and formatters', () => {
  it('tolerates arbitrary and inconsistent indentation', () => {
    const text = src(
      'def f():',
      '    # @note-start id=i',
      '  # primera',
      '        #   - lista',
      '    # @note-body-end',
      '    return 1',
      '      # @note-end',
    );
    const [n] = parseNotes(text, PY).notes;
    expect(n.indent).toBe('    ');
    expect(n.body).toBe('primera\n  - lista');
  });

  it('tolerates spacing changes inside comments (#@note-start, ##, tabs)', () => {
    const text = src('#@note-start   id=s', '##texto', '#\t@note-body-end', 'x', '#    @note-end   ');
    const { notes, problems } = parseNotes(text, PY);
    expect(problems).toEqual([]);
    expect(notes[0]).toMatchObject({ id: 's', body: 'texto' });
  });

  it('keeps markdown structure: blank comment lines and blank lines inside the body', () => {
    const text = src('// @note-start', '// Título', '//', '', '// ```js', '// code()', '// ```', '// @note-body-end', 'x();', '// @note-end');
    expect(parseNotes(text, C).notes[0].body).toBe('Título\n\n\n```js\ncode()\n```');
  });
});

describe('parseNotes – line endings', () => {
  it('handles CRLF exactly like LF', () => {
    const lines = ['# @note-start id=c', '# hola', '# @note-body-end', 'x = 1', 'y = 2', '# @note-end', ''];
    const lf = parseNotes(lines.join('\n'), PY);
    const crlf = parseNotes(lines.join('\r\n'), PY);
    expect(crlf).toEqual(lf);
    expect(crlf.notes[0].body).toBe('hola');
    expect(crlf.notes[0].body).not.toContain('\r');
  });

  it('detects the document EOL', () => {
    expect(detectEol('a\r\nb')).toBe('\r\n');
    expect(detectEol('a\nb')).toBe('\n');
    expect(detectEol('single line')).toBe('\n');
  });
});

describe('parseNotes – malformed blocks', () => {
  it('missing @note-end: ignored, warning on the start only', () => {
    const text = src('# @note-start id=a', '# body', '# @note-body-end', 'x = 1', 'y = 2');
    const { notes, problems } = parseNotes(text, PY);
    expect(notes).toEqual([]);
    expect(problems).toEqual([expect.objectContaining({ line: 0, kind: 'missing-end' })]);
  });

  it('missing @note-start: one warning, the @note-end is not reported twice', () => {
    const text = src('# body', '# @note-body-end', 'x = 1', '# @note-end');
    const { notes, problems } = parseNotes(text, PY);
    expect(notes).toEqual([]);
    expect(problems).toEqual([expect.objectContaining({ line: 1, kind: 'missing-start' })]);
  });

  it('lone @note-end is reported as orphan', () => {
    const { problems } = parseNotes(src('x', '// @note-end'), C);
    expect(problems).toEqual([expect.objectContaining({ line: 1, kind: 'orphan-end' })]);
  });

  it('missing @note-body-end (code reached): ignored with warning', () => {
    const text = src('# @note-start', '# body', 'x = 1', '# @note-end');
    const { notes, problems } = parseNotes(text, PY);
    expect(notes).toEqual([]);
    expect(problems.map((p) => [p.line, p.kind])).toEqual([
      [0, 'missing-body-end'],
      [3, 'orphan-end'],
    ]);
  });

  it('a broken note does not prevent parsing the following valid note', () => {
    const text = src(
      '# @note-start id=broken',
      '# body',
      '# @note-body-end',
      'x = 1',
      // @note-end deleted by hand
      '# @note-start id=ok',
      '# fine',
      '# @note-body-end',
      'y = 2',
      '# @note-end',
    );
    const { notes, problems } = parseNotes(text, PY);
    expect(notes.map((n) => n.id)).toEqual(['ok']);
    expect(problems.map((p) => p.kind)).toEqual(['missing-end']);
  });

  it('empty annotated range is ignored with a warning', () => {
    const { notes, problems } = parseNotes(src('# @note-start', '# a', '# @note-body-end', '# @note-end', 'x'), PY);
    expect(notes).toEqual([]);
    expect(problems).toEqual([expect.objectContaining({ line: 0, kind: 'empty-range' })]);
  });

  it('nested notes: outer wins, inner is reported', () => {
    const text = src(
      '# @note-start id=outer',
      '# outer',
      '# @note-body-end',
      'a = 1',
      '# @note-start id=inner',
      '# inner',
      '# @note-body-end',
      'b = 1',
      '# @note-end',
      'c = 1',
      '# @note-end',
    );
    const { notes, problems } = parseNotes(text, PY);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id: 'outer', startLine: 0, endLine: 10 });
    expect(problems).toEqual([expect.objectContaining({ line: 4, kind: 'nested' })]);
  });

  it('duplicate ids (copy/paste) keep both notes and flag the second', () => {
    const block = ['# @note-start id=dup', '# x', '# @note-body-end', 'x = 1', '# @note-end'];
    const { notes, problems } = parseNotes(src(...block, ...block), PY);
    expect(notes).toHaveLength(2);
    expect(problems).toEqual([expect.objectContaining({ line: 5, kind: 'duplicate-id' })]);
  });

  it('marker text in ordinary code is not a marker', () => {
    const text = src('s = "# @note-start"', 'print("@note-end")');
    expect(parseNotes(text, PY)).toEqual({ notes: [], problems: [] });
  });
});

describe('helpers', () => {
  it('buildNoteBlock round-trips through the parser (line and block styles)', () => {
    for (const syntax of [PY, C, SQL, CSS, HTML, LUA]) {
      const b = buildNoteBlock(syntax, '  ', 'abc123')!;
      const lines = [...b.header, '  code();', ...b.footer];
      lines[b.cursorLine] = lines[b.cursorLine].slice(0, b.cursorColumn) + 'hola';
      const { notes, problems } = parseNotes(lines.join('\n'), syntax);
      expect(problems).toEqual([]);
      expect(notes[0]).toMatchObject({ id: 'abc123', body: 'hola', indent: '  ', startLine: 0, endLine: 4 });
    }
    expect(buildNoteBlock({}, '', 'x')).toBeUndefined();
  });

  it('generateId returns unused 6-char ids', () => {
    let k = 0;
    const seq = [0, 0, 0.5];
    const id = generateId(new Set(['000000']), () => seq[k++]);
    expect(id).toHaveLength(6);
    expect(id).not.toBe('000000');
  });

  it('withId replaces or inserts the id', () => {
    expect(withId('  # @note-start id=old', 'new')).toBe('  # @note-start id=new');
    expect(withId('# @note-start', 'new')).toBe('# @note-start id=new');
  });

  it('noteAtLine finds the note covering a line', () => {
    const { notes } = parseNotes(src('x', '# @note-start', '# a', '# @note-body-end', 'y', '# @note-end'), PY);
    expect(noteAtLine(notes, 0)).toBeUndefined();
    expect(noteAtLine(notes, 1)).toBe(notes[0]);
    expect(noteAtLine(notes, 5)).toBe(notes[0]);
  });
});

describe('performance', () => {
  it('parses a large file quickly', () => {
    const block = ['# @note-start id=p', '# body', '# @note-body-end', 'x = 1', '# @note-end'];
    const lines: string[] = [];
    for (let i = 0; i < 20000; i++) lines.push(i % 50 === 0 ? block.join('\n') : `value_${i} = ${i}`);
    const text = lines.join('\n');
    const t = performance.now();
    const { notes } = parseNotes(text, PY);
    expect(performance.now() - t).toBeLessThan(200);
    expect(notes).toHaveLength(400);
  });
});

describe('colours', () => {
  it('parses color= and defaults to blue', () => {
    const block = (attrs: string) => src(`# @note-start ${attrs}`, '# x', '# @note-body-end', 'a', '# @note-end');
    expect(parseNotes(block('id=a color=green'), PY).notes[0].color).toBe('green');
    expect(parseNotes(block('color=RED id=a'), PY).notes[0]).toMatchObject({ color: 'red', id: 'a' });
    expect(parseNotes(block('id=a'), PY).notes[0].color).toBe('blue');
    expect(parseNotes(block('id=a color=pink'), PY).notes[0].color).toBe('blue');
  });
});

describe('buildNoteBlock with content', () => {
  it('writes a multi-line body and the colour (line comments)', () => {
    const b = buildNoteBlock(PY, '    ', 'abc123', { body: 'Título\r\n\n- uno  \n', color: 'yellow' })!;
    expect(b.header).toEqual([
      '    # @note-start id=abc123 color=yellow',
      '    # Título',
      '    # ',
      '    # - uno',
      '    # @note-body-end',
    ]);
    expect(b.footer).toEqual(['    # @note-end']);
    expect(b.cursorLine).toBe(3);
    const { notes } = parseNotes([...b.header, '    x = 1', ...b.footer].join('\n'), PY);
    expect(notes[0]).toMatchObject({ color: 'yellow', body: 'Título\n\n- uno' });
  });

  it('turns two trailing spaces (Markdown hard break) into a trailing backslash', () => {
    const b = buildNoteBlock(PY, '', 'i', { body: 'línea uno  \nlínea dos   \nfin  ' })!;
    expect(b.header.slice(1, -1)).toEqual(['# línea uno\\', '# línea dos\\', '# fin']);
    const { notes } = parseNotes([...b.header, 'x', ...b.footer].join('\n'), PY);
    expect(notes[0].body).toBe('línea uno\\\nlínea dos\\\nfin');
  });

  it('omits color= for the default colour', () => {
    expect(buildNoteBlock(C, '', 'i', { color: 'blue' })!.header[0]).toBe('// @note-start id=i');
  });

  it('neutralises the closing token inside block-comment bodies', () => {
    const b = buildNoteBlock(CSS, '', 'i', { body: 'usa /* y */ aquí' })!;
    expect(b.header[1]).toBe('usa /* y * / aquí');
    const { notes, problems } = parseNotes([...b.header, 'a {}', ...b.footer].join('\n'), CSS);
    expect(problems).toEqual([]);
    expect(notes).toHaveLength(1);
  });
});

describe('commentLines / commentingRanges', () => {
  it('detects line comments, block comments and multi-line blocks', () => {
    const lines = ['int a;', '// c', '  /* b', '   still */', 'int b; /* open', 'x */', 'int c; /* closed */', '/* one */'];
    expect(commentLines(lines, C)).toEqual([false, true, true, true, false, true, false, true]);
  });

  it('excludes comments and every line of existing notes', () => {
    const text = src(
      'a = 1', // 0
      '# comment', // 1
      'b = 2', // 2
      'c = 3', // 3
      '# @note-start id=n', // 4
      '# body', // 5
      '# @note-body-end', // 6
      'd = 4', // 7
      '# @note-end', // 8
      'e = 5', // 9
    );
    const { notes } = parseNotes(text, PY);
    const ranges = commentingRanges(text, PY, notes);
    expect(ranges).toEqual([
      [0, 0],
      [2, 3],
      [9, 9],
    ]);
    expect(canAnnotate(ranges, 2, 3)).toBe(true);
    expect(canAnnotate(ranges, 0, 2)).toBe(false); // crosses a comment
    expect(canAnnotate(ranges, 7, 7)).toBe(false); // inside a note
  });
});

describe('wholeLineSelection', () => {
  const p = (line: number, character: number) => ({ line, character });
  it('recognises a line-number click selection', () => {
    expect(wholeLineSelection(p(4, 0), p(5, 0), 9, 3)).toBe(4);
    expect(wholeLineSelection(p(9, 0), p(9, 3), 9, 3)).toBe(9); // last line
  });
  it('ignores other selections', () => {
    expect(wholeLineSelection(p(4, 0), p(4, 0), 9, 3)).toBeUndefined(); // plain click
    expect(wholeLineSelection(p(4, 2), p(5, 0), 9, 3)).toBeUndefined();
    expect(wholeLineSelection(p(4, 0), p(6, 0), 9, 3)).toBeUndefined(); // two lines
    expect(wholeLineSelection(p(9, 0), p(9, 0), 9, 0)).toBeUndefined(); // empty last line
  });
});

describe('noteTitle', () => {
  it('takes the first non-empty line without Markdown markers', () => {
    expect(noteTitle('\n## Suma de prefijos\nmás texto')).toBe('Suma de prefijos');
    expect(noteTitle('- punto\\')).toBe('punto');
    expect(noteTitle('')).toBe('(nota vacía)');
  });
  it('truncates long titles', () => {
    expect(noteTitle('abcdefghij', 6)).toBe('abcde…');
    expect(noteTitle('abc', 6)).toBe('abc');
  });
});
