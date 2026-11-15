import { useMemo } from 'react';
import { parseInline, parseMarkdown, type MdBlock } from './mdParse';

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((p, i) =>
        p.kind === 'code' ? (
          <code key={i}>{p.text}</code>
        ) : p.kind === 'strong' ? (
          <strong key={i}>{p.text}</strong>
        ) : p.kind === 'em' ? (
          <em key={i}>{p.text}</em>
        ) : p.kind === 'link' ? (
          <span key={i} className="md-link">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function Block({ b }: { b: MdBlock }) {
  switch (b.kind) {
    case 'heading': {
      const H = `h${Math.min(6, b.level + 1)}` as 'h2' | 'h3' | 'h4' | 'h5';
      return (
        <H id={`md-${b.id}`}>
          <Inline text={b.text} />
        </H>
      );
    }
    case 'paragraph':
      return (
        <p>
          <Inline text={b.text} />
        </p>
      );
    case 'list': {
      const L = b.ordered ? 'ol' : 'ul';
      return (
        <L>
          {b.items.map((it, i) => (
            <li key={i}>
              <Inline text={it} />
            </li>
          ))}
        </L>
      );
    }
    case 'table':
      return (
        <div className="md-table">
          <table>
            <thead>
              <tr>
                {b.head.map((c, i) => (
                  <th key={i}>
                    <Inline text={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>
                      <Inline text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'code':
      return (
        <pre>
          <code>{b.text}</code>
        </pre>
      );
    default:
      return <hr />;
  }
}

/** One of the app's own Markdown documents, shown as text (never as HTML). */
export function Markdown({ source, skipTitle = false }: { source: string; skipTitle?: boolean }) {
  const blocks = useMemo(() => {
    const all = parseMarkdown(source);
    return skipTitle && all[0]?.kind === 'heading' && all[0].level === 1 ? all.slice(1) : all;
  }, [source, skipTitle]);
  return (
    <div className="md">
      {blocks.map((b, i) => (
        <Block key={i} b={b} />
      ))}
    </div>
  );
}

/** The document's second-level headings (a contents list). */
export function headingsOf(source: string): { id: string; text: string }[] {
  return parseMarkdown(source)
    .filter((b): b is Extract<MdBlock, { kind: 'heading' }> => b.kind === 'heading' && b.level === 2)
    .map((b) => ({ id: b.id, text: b.text }));
}
