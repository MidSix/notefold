import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commentSyntaxFromConfig, parseJsonc } from '../../src/languageConfig';

describe('parseJsonc', () => {
  it('strips comments and trailing commas but not string contents', () => {
    const text = `{
      // line comment
      "comments": { "lineComment": "//", /* block */ "blockComment": ["/*", "*/"], },
      "url": "http://x/*y*/",
    }`;
    expect(parseJsonc(text)).toEqual({ comments: { lineComment: '//', blockComment: ['/*', '*/'] }, url: 'http://x/*y*/' });
  });
});

describe('commentSyntaxFromConfig', () => {
  it('reads string and object forms of lineComment', () => {
    expect(commentSyntaxFromConfig({ comments: { lineComment: '#' } })).toEqual({ lineComment: '#' });
    expect(commentSyntaxFromConfig({ comments: { lineComment: { comment: '//', noIndent: true } } })).toEqual({ lineComment: '//' });
  });

  it('reads block-only languages and rejects configs without comments', () => {
    expect(commentSyntaxFromConfig({ comments: { blockComment: ['<!--', '-->'] } })).toEqual({ blockComment: ['<!--', '-->'] });
    expect(commentSyntaxFromConfig({ brackets: [] })).toBeUndefined();
    expect(commentSyntaxFromConfig(null)).toBeUndefined();
  });

  // Sanity check against the real configs shipped with the local VS Code, when available.
  const builtin = '/Applications/Visual Studio Code.app/Contents/Resources/app/extensions';
  it.skipIf(!existsSync(builtin))('parses the built-in configs of the required languages', () => {
    const cases: [string, string, string | undefined][] = [
      ['python', 'language-configuration.json', '#'],
      ['julia', 'language-configuration.json', '#'],
      ['cpp', 'language-configuration.json', '//'],
      ['csharp', 'language-configuration.json', '//'],
      ['java', 'language-configuration.json', '//'],
      ['javascript', 'javascript-language-configuration.json', '//'],
      ['typescript-basics', 'language-configuration.json', '//'],
      ['rust', 'language-configuration.json', '//'],
      ['go', 'language-configuration.json', '//'],
      ['ruby', 'language-configuration.json', '#'],
      ['shellscript', 'language-configuration.json', '#'],
      ['sql', 'language-configuration.json', '--'],
      ['lua', 'language-configuration.json', '--'],
      ['css', 'language-configuration.json', undefined],
    ];
    for (const [ext, file, line] of cases) {
      const syntax = commentSyntaxFromConfig(parseJsonc(readFileSync(`${builtin}/${ext}/${file}`, 'utf8')));
      expect(syntax, ext).toBeDefined();
      expect(syntax!.lineComment, ext).toBe(line);
    }
  });
});
