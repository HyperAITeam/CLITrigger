import { useState, useEffect, useRef, type ReactNode } from 'react';
import type { TaskLog } from '../types';
import { useI18n } from '../i18n';

// VS Code Dark Modern terminal color palette (fixed, theme-independent)
const TERM = {
  bg:        '#1e1e1e',
  border:    '#3c3c3c',
  cursor:    '#aeafad',
  timestamp: '#6a9955',
  // prefix colors (bold label)
  prefix: {
    info:    '#569cd6',
    error:   '#f44747',
    output:  '#9cdcfe',
    commit:  '#4ec9b0',
    input:   '#c586c0',
    prompt:  '#c586c0',
    warning: '#dcdcaa',
  },
  // message body colors
  message: {
    info:    '#9cdcfe',
    error:   '#f1807e',
    output:  '#d4d4d4',
    commit:  '#a8c990',
    input:   '#ce9178',
    prompt:  '#c586c0',
    warning: '#dcdcaa',
  },
} as const;

function renderInlineMarkdown(text: string, baseColor: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*)|(`(.+?)`)|(\*(.+?)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1]) {
      // **bold** → gold/highlighted
      parts.push(
        <strong key={key++} style={{ color: '#d7ba7d', fontWeight: 700 }}>
          {match[2]}
        </strong>
      );
    } else if (match[3]) {
      // `code` → string orange, subtle bg
      parts.push(
        <code
          key={key++}
          style={{
            color: '#ce9178',
            background: 'rgba(255,255,255,0.07)',
            padding: '0 3px',
            borderRadius: 3,
            fontSize: '0.7rem',
          }}
        >
          {match[4]}
        </code>
      );
    } else if (match[5]) {
      // *italic* → lighter shade of base
      parts.push(
        <em key={key++} style={{ color: baseColor, opacity: 0.75, fontStyle: 'italic' }}>
          {match[6]}
        </em>
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : [text];
}

interface LogViewerProps {
  logs: TaskLog[];
  interactive?: boolean;
  todoId?: string;
  onSendInput?: (todoId: string, input: string) => void;
}

const logPrefixes: Record<TaskLog['log_type'], string> = {
  info:    '[INF]',
  error:   '[ERR]',
  output:  '[OUT]',
  commit:  '[GIT]',
  input:   '[>>>]',
  prompt:  '[PRM]',
  warning: '[WRN]',
};

export default function LogViewer({ logs, interactive, todoId, onSendInput }: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || !todoId || !onSendInput) return;
    onSendInput(todoId, inputValue);
    setInputValue('');
  };

  const handleCopy = async () => {
    const text = logs
      .map((log) => {
        const time = new Date(log.created_at).toLocaleTimeString();
        return `${time} ${logPrefixes[log.log_type]} ${log.message}`;
      })
      .join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col">
      <div className="relative">
        {logs.length > 0 && (
          <button
            onClick={handleCopy}
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 10,
              padding: '2px 8px',
              fontSize: '10px',
              fontFamily: 'monospace',
              borderRadius: 4,
              background: '#2d2d2d',
              color: '#858585',
              border: '1px solid #3c3c3c',
              cursor: 'pointer',
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#d4d4d4')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#858585')}
          >
            {copied ? t('log.copied') : t('log.copy')}
          </button>
        )}
        <div
          ref={containerRef}
          className="h-48 sm:h-64 overflow-y-auto overflow-x-auto rounded-xl p-3 sm:p-4 font-mono text-xs"
          style={{
            backgroundColor: TERM.bg,
            border: `1px solid ${TERM.border}`,
          }}
        >
          {logs.length === 0 ? (
            <p style={{ color: '#6a9955' }}>{t('log.awaiting')}</p>
          ) : (
            logs.map((log) => {
              const time = new Date(log.created_at).toLocaleTimeString();
              const prefixColor = TERM.prefix[log.log_type];
              const msgColor = TERM.message[log.log_type];
              return (
                <div key={log.id} className="mb-0.5 leading-relaxed">
                  <span style={{ color: TERM.timestamp }}>{time}</span>{' '}
                  <span style={{ color: prefixColor, fontWeight: 700 }}>
                    {logPrefixes[log.log_type]}
                  </span>{' '}
                  <span style={{ color: msgColor }}>
                    {renderInlineMarkdown(log.message, msgColor)}
                  </span>
                </div>
              );
            })
          )}
          {interactive && logs.length > 0 && logs[logs.length - 1].log_type === 'input' && (
            <div className="mb-0.5 leading-relaxed">
              <span className="inline-flex gap-1" style={{ color: '#569cd6' }}>
                <span className="animate-bounce" style={{ animationDelay: '0ms', animationDuration: '1.2s' }}>●</span>
                <span className="animate-bounce" style={{ animationDelay: '200ms', animationDuration: '1.2s' }}>●</span>
                <span className="animate-bounce" style={{ animationDelay: '400ms', animationDuration: '1.2s' }}>●</span>
              </span>
              <span className="ml-2" style={{ color: '#6a9955', fontSize: '0.65rem' }}>{t('log.waitingResponse')}</span>
            </div>
          )}
          <span style={{ color: TERM.cursor }} className="animate-pulse">_</span>
        </div>
      </div>

      {interactive && (
        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            backgroundColor: TERM.bg,
            border: `1px solid ${TERM.border}`,
            borderTop: 'none',
            borderBottomLeftRadius: 12,
            borderBottomRightRadius: 12,
            padding: '6px 16px',
          }}
        >
          <span style={{ color: '#569cd6', fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}>$</span>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#ce9178',
              fontFamily: 'monospace',
              fontSize: 12,
            }}
            placeholder={t('todo.sendPlaceholder')}
            autoFocus
          />
          <button
            type="submit"
            style={{
              color: '#569cd6',
              fontFamily: 'monospace',
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: '0.05em',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#9cdcfe')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#569cd6')}
          >
            SEND
          </button>
        </form>
      )}
    </div>
  );
}
