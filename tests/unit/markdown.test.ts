import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, slug } from '@ui/components/mdParse';
import guideMd from '../../docs/user-guide.md?raw';
import licencesMd from '../../LICENSES.md?raw';

describe('the app’s Markdown reader', () => {
  it('reads headings, paragraphs, lists, tables, code and rules', () => {
    const blocks = parseMarkdown(
      [
        '# Title',
        '',
        'One line',
        'and its continuation.',
        '',
        '- first',
        '  carried on',
        '- second',
        '',
        '1. one',
        '2. two',
        '',
        '| A | B |',
        '|---|:---|',
        '| 1 | 2 |',
        '',
        '```',
        'code <b>here</b>',
        '```',
        '---',
        '## Getting started',
      ].join('\n'),
    );
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'list', 'table', 'code', 'rule', 'heading']);
    expect(blocks[1]).toEqual({ kind: 'paragraph', text: 'One line and its continuation.' });
    expect(blocks[2]).toEqual({ kind: 'list', ordered: false, items: ['first carried on', 'second'] });
    expect(blocks[3]).toMatchObject({ ordered: true, items: ['one', 'two'] });
    expect(blocks[4]).toEqual({ kind: 'table', head: ['A', 'B'], rows: [['1', '2']] });
    expect(blocks[5]).toEqual({ kind: 'code', text: 'code <b>here</b>' });
    expect(blocks[7]).toMatchObject({ level: 2, id: 'getting-started' });
  });

  it('reads inline marks and keeps link text without the address', () => {
    expect(parseInline('Press **Ctrl+S**, see `docs` and [the guide](docs/user-guide.md) *now*.')).toEqual([
      { kind: 'text', text: 'Press ' },
      { kind: 'strong', text: 'Ctrl+S' },
      { kind: 'text', text: ', see ' },
      { kind: 'code', text: 'docs' },
      { kind: 'text', text: ' and ' },
      { kind: 'link', text: 'the guide' },
      { kind: 'text', text: ' ' },
      { kind: 'em', text: 'now' },
      { kind: 'text', text: '.' },
    ]);
    expect(slug('Where *Pigmento* keeps things')).toBe('where-pigmento-keeps-things');
  });

  it('reads the bundled user guide and licences into sections and tables', () => {
    const guide = parseMarkdown(guideMd);
    const sections = guide.filter((b) => b.kind === 'heading' && b.level === 2).map((b) => (b.kind === 'heading' ? b.text : ''));
    expect(sections).toContain('Getting started');
    expect(sections).toContain('Keyboard shortcuts');
    const licences = parseMarkdown(licencesMd);
    const table = licences.find((b) => b.kind === 'table');
    expect(table?.kind === 'table' && table.rows.some((r) => r[0] === 'Electron')).toBe(true);
  });
});
