import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import type { TaskLog } from '../types';
import { useI18n } from '../i18n';
import MarkdownContent from './MarkdownContent';

// VS Code Dark Modern terminal color palette (fixed, theme-independent)
const TERM = {
  bg:        '#1e1e1e',
  border:    '#3c3c3c',
  cursor:    '#aeafad',
  timestamp: '#6a9955',
  // prefix colors (bold label)
  prefix: {
    info:        '#569cd6',
    error:       '#f44747',
    output:      '#9cdcfe',
    commit:      '#4ec9b0',
    input:       '#c586c0',
    prompt:      '#c586c0',
    warning:     '#dcdcaa',
    assistant:   '#b392f0',
    tool_use:    '#79c0ff',
    tool_result: '#56d364',
  } as Record<string, string>,
  // message body colors
  message: {
    info:        '#9cdcfe',
    error:       '#f1807e',
    output:      '#d4d4d4',
    commit:      '#a8c990',
    input:       '#ce9178',
    prompt:      '#c586c0',
    warning:     '#dcdcaa',
    assistant:   '#e6e6e6',
    tool_use:    '#8b949e',
    tool_result: '#7ee787',
  } as Record<string, string>,
} as const;

const logPrefixes: Record<string, string> = {
  info:        '[INF]',
  error:       '[ERR]',
  output:      '[OUT]',
  commit:      '[GIT]',
  input:       '[>>>]',
  prompt:      '[PRM]',
  warning:     '[WRN]',
  assistant:   '[CLU]',
  tool_use:    '[USE]',
  tool_result: '[RES]',
};

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
      parts.push(
        <strong key={key++} style={{ color: '#d7ba7d', fontWeight: 700 }}>
          {match[2]}
        </strong>
      );
    } else if (match[3]) {
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

/** Parse tool_use JSON or legacy [Tool: X] format */
function tryParseToolUse(msg: string): { tool: string; summary: string; input?: Record<string, unknown> } | null {
  try {
    const p = JSON.parse(msg);
    if (p && typeof p.tool === 'string') return p;
  } catch { /* not JSON */ }
  const m = msg.match(/^\[Tool:\s*(\w+)\](.*)$/);
  if (m) return { tool: m[1], summary: m[2].trim() };
  return null;
}

interface LogViewerProps {
  logs: TaskLog[];
  interactive?: boolean;
  todoId?: string;
  onSendInput?: (todoId: string, input: string) => void;
  embedded?: boolean;
}

export default function LogViewer({ logs, interactive, todoId, onSendInput, embedded }: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [copied, setCopied] = useState(false);
  const [waitingForResponse, setWaitingForResponse] = useState(false);
  const waitingSinceRef = useRef<number>(0);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const { t } = useI18n();

  // Auto-detect view mode: chat if any assistant/tool_use logs exist
  const hasChatLogs = useMemo(
    () => logs.some(l => l.log_type === 'assistant' || l.log_type === 'tool_use'),
    [logs],
  );
  const [viewMode, setViewMode] = useState<'chat' | 'raw'>('chat');

  // Update default when chat logs first appear
  useEffect(() => {
    if (hasChatLogs) setViewMode('chat');
    else setViewMode('raw');
  }, [hasChatLogs]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  // Clear waiting indicator when meaningful output arrives
  useEffect(() => {
    if (!waitingForResponse || logs.length === 0) return;
    const elapsed = Date.now() - waitingSinceRef.current;
    const lastLog = logs[logs.length - 1];
    if (lastLog.log_type === 'output' || lastLog.log_type === 'error' || lastLog.log_type === 'commit' || lastLog.log_type === 'assistant') {
      if (elapsed >= 1000) {
        setWaitingForResponse(false);
      } else {
        const timer = setTimeout(() => setWaitingForResponse(false), 1000 - elapsed);
        return () => clearTimeout(timer);
      }
    }
  }, [logs, waitingForResponse]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || !todoId || !onSendInput) return;
    onSendInput(todoId, inputValue);
    setInputValue('');
    setWaitingForResponse(true);
    waitingSinceRef.current = Date.now();
  };

  const handleCopy = async () => {
    const text = logs
      .map((log) => {
        const time = new Date(log.created_at).toLocaleTimeString();
        if (viewMode === 'chat') {
          if (log.log_type === 'assistant') return `${time} [Claude]\n${log.message}\n`;
          if (log.log_type === 'tool_use') {
            const td = tryParseToolUse(log.message);
            return td ? `${time} [Tool: ${td.tool}] ${td.summary}` : `${time} [USE] ${log.message}`;
          }
          if (log.log_type === 'tool_result') return `${time} [Result] ${log.message.slice(0, 200)}`;
        }
        return `${time} ${logPrefixes[log.log_type] || '[???]'} ${log.message}`;
      })
      .join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleTool = (id: string) => {
    setExpandedTools(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // --- Render helpers ---

  const renderRawLog = (log: TaskLog) => {
    const time = new Date(log.created_at).toLocaleTimeString();
    const prefixColor = TERM.prefix[log.log_type] || TERM.prefix.output;
    const msgColor = TERM.message[log.log_type] || TERM.message.output;
    return (
      <div key={log.id} className="mb-0.5 leading-relaxed">
        <span style={{ color: TERM.timestamp }}>{time}</span>{' '}
        <span style={{ color: prefixColor, fontWeight: 700 }}>
          {logPrefixes[log.log_type] || '[???]'}
        </span>{' '}
        <span style={{ color: msgColor }}>
          {renderInlineMarkdown(log.message, msgColor)}
        </span>
      </div>
    );
  };

  const renderChatLog = (log: TaskLog) => {
    // Assistant text → markdown block
    if (log.log_type === 'assistant') {
      return (
        <div key={log.id} style={{
          borderLeft: '3px solid #b392f0',
          background: 'rgba(179, 146, 240, 0.06)',
          borderRadius: 8,
          padding: '8px 12px',
          margin: '6px 0',
        }}>
          <MarkdownContent content={log.message} className="markdown-content-dark" />
        </div>
      );
    }

    // Tool use → compact collapsible
    if (log.log_type === 'tool_use') {
      const td = tryParseToolUse(log.message);
      const isExpanded = expandedTools.has(log.id);
      if (td) {
        return (
          <div key={log.id} style={{ margin: '2px 0', fontSize: '0.7rem' }}>
            <button
              onClick={() => toggleTool(log.id)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '2px 4px',
                fontFamily: 'monospace',
                fontSize: '0.7rem',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                textAlign: 'left',
                borderRadius: 4,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <span style={{ color: '#6a9955', fontSize: '0.6rem' }}>{isExpanded ? '\u25BE' : '\u25B8'}</span>
              <span style={{ color: '#79c0ff', fontWeight: 600 }}>{td.tool}</span>
              <span style={{ color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {td.summary}
              </span>
            </button>
            {isExpanded && td.input && (
              <pre style={{
                background: 'rgba(0,0,0,0.25)',
                border: '1px solid #3c3c3c',
                borderRadius: 6,
                padding: '6px 10px',
                margin: '2px 0 2px 18px',
                fontSize: '0.65rem',
                color: '#8b949e',
                overflow: 'auto',
                maxHeight: 200,
              }}>
                {JSON.stringify(td.input, null, 2)}
              </pre>
            )}
          </div>
        );
      }
      // Fallback: render as raw if parse failed
      return renderRawLog(log);
    }

    // Tool result → dimmed, collapsible
    if (log.log_type === 'tool_result') {
      const isExpanded = expandedTools.has(log.id);
      const preview = log.message.split('\n').slice(0, 3).join('\n');
      return (
        <div key={log.id} style={{ margin: '1px 0 1px 18px', fontSize: '0.65rem' }}>
          <button
            onClick={() => toggleTool(log.id)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '1px 4px',
              fontFamily: 'monospace',
              fontSize: '0.65rem',
              color: '#56d364',
              opacity: 0.5,
            }}
          >
            {isExpanded ? '\u25BE Result' : '\u25B8 Result'}
          </button>
          {isExpanded && (
            <pre style={{
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid #3c3c3c',
              borderRadius: 6,
              padding: '4px 8px',
              margin: '2px 0',
              fontSize: '0.6rem',
              color: '#7ee787',
              opacity: 0.6,
              overflow: 'auto',
              maxHeight: 300,
            }}>
              {log.message}
            </pre>
          )}
          {!isExpanded && preview !== log.message && (
            <span style={{ color: '#56d364', opacity: 0.3, marginLeft: 8 }}>
              {preview.slice(0, 80)}...
            </span>
          )}
        </div>
      );
    }

    // Legacy 'output' → check for [Tool: X] pattern in chat mode
    if (log.log_type === 'output') {
      const td = tryParseToolUse(log.message);
      if (td) {
        const isExpanded = expandedTools.has(log.id);
        return (
          <div key={log.id} style={{ margin: '2px 0', fontSize: '0.7rem' }}>
            <button
              onClick={() => toggleTool(log.id)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '2px 4px',
                fontFamily: 'monospace',
                fontSize: '0.7rem',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <span style={{ color: '#6a9955', fontSize: '0.6rem' }}>{isExpanded ? '\u25BE' : '\u25B8'}</span>
              <span style={{ color: '#79c0ff', fontWeight: 600 }}>{td.tool}</span>
              <span style={{ color: '#8b949e' }}>{td.summary}</span>
            </button>
            {isExpanded && td.input && (
              <pre style={{
                background: 'rgba(0,0,0,0.25)',
                border: '1px solid #3c3c3c',
                borderRadius: 6,
                padding: '6px 10px',
                margin: '2px 0 2px 18px',
                fontSize: '0.65rem',
                color: '#8b949e',
                overflow: 'auto',
                maxHeight: 200,
              }}>
                {JSON.stringify(td.input, null, 2)}
              </pre>
            )}
          </div>
        );
      }
    }

    // Everything else (info, error, commit, warning, plain output, input, prompt) → flat line
    return renderRawLog(log);
  };

  // --- Toggle button styles ---
  const toggleBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '1px 6px',
    fontSize: '9px',
    fontFamily: 'monospace',
    borderRadius: 3,
    background: active ? '#3c3c3c' : 'transparent',
    color: active ? '#d4d4d4' : '#858585',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s',
  });

  return (
    <div className="flex flex-col">
      <div className="relative">
        {logs.length > 0 && !embedded && (
          <div style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}>
            {/* View mode toggle */}
            <div style={{
              display: 'flex',
              borderRadius: 4,
              border: '1px solid #3c3c3c',
              overflow: 'hidden',
            }}>
              <button
                onClick={() => setViewMode('chat')}
                style={toggleBtnStyle(viewMode === 'chat')}
              >
                {t('log.viewChat')}
              </button>
              <button
                onClick={() => setViewMode('raw')}
                style={toggleBtnStyle(viewMode === 'raw')}
              >
                {t('log.viewRaw')}
              </button>
            </div>
            {/* Copy button */}
            <button
              onClick={handleCopy}
              style={{
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
          </div>
        )}
        <div
          ref={containerRef}
          className={embedded ? "max-h-64 overflow-y-auto overflow-x-auto font-mono text-xs" : "h-48 sm:h-64 overflow-y-auto overflow-x-auto rounded-xl p-3 sm:p-4 font-mono text-xs"}
          style={embedded ? undefined : {
            backgroundColor: TERM.bg,
            border: `1px solid ${TERM.border}`,
          }}
        >
          {logs.length === 0 ? (
            <p style={{ color: '#6a9955' }}>{t('log.awaiting')}</p>
          ) : (
            logs.map((log) => viewMode === 'chat' ? renderChatLog(log) : renderRawLog(log))
          )}
          {interactive && waitingForResponse && (
            <div className="mb-0.5 leading-relaxed">
              <span className="inline-flex gap-1" style={{ color: '#569cd6' }}>
                <span className="animate-bounce" style={{ animationDelay: '0ms', animationDuration: '1.2s' }}>&#x25CF;</span>
                <span className="animate-bounce" style={{ animationDelay: '200ms', animationDuration: '1.2s' }}>&#x25CF;</span>
                <span className="animate-bounce" style={{ animationDelay: '400ms', animationDuration: '1.2s' }}>&#x25CF;</span>
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
          style={embedded ? {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 0',
            marginTop: 4,
          } : {
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
