import { Fragment, type ReactNode, type ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { MemoryNode } from '../types';

interface MarkdownContentProps {
  content: string;
  className?: string;
  /** Project memory nodes used to resolve `[[title]]` wikilinks. Pass undefined to disable. */
  memoryNodes?: MemoryNode[];
  onSelectMemoryNode?: (nodeId: string) => void;
  onCreateMemoryNode?: (title: string) => void;
  /** Intercept relative file links (e.g. `[label](./foo.md)`). Receives the raw href. */
  onLinkClick?: (href: string) => void;
  /** Rewrite relative image srcs (e.g. `![](./img.png)`) to a fetchable URL. */
  resolveImageSrc?: (src: string) => string;
  /** Enable interactive task list checkboxes. Receives the 0-based index of the
   *  clicked checkbox (in document order) and the new checked state. */
  onCheckboxToggle?: (index: number, checked: boolean) => void;
}

const WIKILINK_PATTERN = /\[\[([^\]\n|#]+)(?:#[^\]\n|]+)?(?:\|([^\]\n]+))?\]\]/g;

interface WikilinkProps {
  title: string;
  alias?: string;
  resolvedId: string | null;
  onSelect?: (id: string) => void;
  onCreate?: (title: string) => void;
}

function WikilinkSpan({ title, alias, resolvedId, onSelect, onCreate }: WikilinkProps) {
  const display = alias || title;
  if (resolvedId) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSelect?.(resolvedId);
        }}
        className="text-accent hover:underline font-medium"
      >
        {display}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onCreate?.(title);
      }}
      className="text-warm-500 underline decoration-dashed hover:text-warm-700"
      title={`Create node "${title}"`}
    >
      {display}
    </button>
  );
}

function renderTextWithWikilinks(
  text: string,
  titleIndex: Map<string, string>,
  onSelect?: (id: string) => void,
  onCreate?: (title: string) => void,
): ReactNode[] {
  const parts: ReactNode[] = [];
  WIKILINK_PATTERN.lastIndex = 0;
  let cursor = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_PATTERN.exec(text)) !== null) {
    const title = match[1].trim();
    if (!title) continue;
    const before = text.slice(cursor, match.index);
    if (before) parts.push(<Fragment key={`t-${key++}`}>{before}</Fragment>);
    const resolvedId = titleIndex.get(title.toLowerCase()) ?? null;
    parts.push(
      <WikilinkSpan
        key={`wl-${key++}`}
        title={title}
        alias={match[2]?.trim() || undefined}
        resolvedId={resolvedId}
        onSelect={onSelect}
        onCreate={onCreate}
      />,
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    parts.push(<Fragment key={`t-${key++}`}>{text.slice(cursor)}</Fragment>);
  }
  return parts.length > 0 ? parts : [text];
}

function processChildren(
  children: ReactNode,
  titleIndex: Map<string, string>,
  onSelect?: (id: string) => void,
  onCreate?: (title: string) => void,
): ReactNode {
  if (typeof children === 'string') {
    return renderTextWithWikilinks(children, titleIndex, onSelect, onCreate);
  }
  if (Array.isArray(children)) {
    return children.map((child, i) =>
      typeof child === 'string'
        ? <Fragment key={i}>{renderTextWithWikilinks(child, titleIndex, onSelect, onCreate)}</Fragment>
        : child
    );
  }
  return children;
}

function isRelativeLink(href: string | undefined): href is string {
  if (!href) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
  if (href.startsWith('#')) return false;
  return true;
}

export default function MarkdownContent({
  content,
  className,
  memoryNodes,
  onSelectMemoryNode,
  onCreateMemoryNode,
  onLinkClick,
  resolveImageSrc,
  onCheckboxToggle,
}: MarkdownContentProps) {
  const titleIndex = new Map<string, string>();
  if (memoryNodes) {
    for (const n of memoryNodes) titleIndex.set(n.title.toLowerCase(), n.id);
  }
  const wikilinksEnabled = memoryNodes !== undefined;

  return (
    <div className={`markdown-content ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (onLinkClick && isRelativeLink(href)) {
              return (
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onLinkClick(href); }}
                >{children}</button>
              );
            }
            return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
          },
          ...(resolveImageSrc ? {
            img: (props: ComponentProps<'img'>) => {
              const src = typeof props.src === 'string' && isRelativeLink(props.src)
                ? resolveImageSrc(props.src)
                : props.src;
              return <img {...props} src={src} className="max-w-full" />;
            },
          } : {}),
          ...(onCheckboxToggle ? {
            input: (props: ComponentProps<'input'>) => {
              if (props.type !== 'checkbox') return <input {...props} />;
              return (
                <input
                  {...props}
                  disabled={false}
                  className="cursor-pointer"
                  onChange={(e) => {
                    const target = e.currentTarget;
                    const container = target.closest('.markdown-content');
                    if (!container) return;
                    const all = container.querySelectorAll('input[type="checkbox"]');
                    const idx = Array.from(all).indexOf(target);
                    if (idx < 0) return;
                    onCheckboxToggle(idx, target.checked);
                  }}
                />
              );
            },
          } : {}),
          ...(wikilinksEnabled ? {
            p: ({ children }) => <p>{processChildren(children, titleIndex, onSelectMemoryNode, onCreateMemoryNode)}</p>,
            li: ({ children }) => <li>{processChildren(children, titleIndex, onSelectMemoryNode, onCreateMemoryNode)}</li>,
            em: ({ children }) => <em>{processChildren(children, titleIndex, onSelectMemoryNode, onCreateMemoryNode)}</em>,
            strong: ({ children }) => <strong>{processChildren(children, titleIndex, onSelectMemoryNode, onCreateMemoryNode)}</strong>,
            td: ({ children }) => <td>{processChildren(children, titleIndex, onSelectMemoryNode, onCreateMemoryNode)}</td>,
            th: ({ children }) => <th>{processChildren(children, titleIndex, onSelectMemoryNode, onCreateMemoryNode)}</th>,
          } : {}),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
