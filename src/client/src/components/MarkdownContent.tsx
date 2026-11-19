import type { ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownContentProps {
  content: string;
  className?: string;
  /** Intercept relative file links (e.g. `[label](./foo.md)`). Receives the raw href. */
  onLinkClick?: (href: string) => void;
  /** Rewrite relative image srcs (e.g. `![](./img.png)`) to a fetchable URL. */
  resolveImageSrc?: (src: string) => string;
  /** Enable interactive task list checkboxes. Receives the 0-based index of the
   *  clicked checkbox (in document order) and the new checked state. */
  onCheckboxToggle?: (index: number, checked: boolean) => void;
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
  onLinkClick,
  resolveImageSrc,
  onCheckboxToggle,
}: MarkdownContentProps) {
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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
