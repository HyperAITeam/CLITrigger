import { useState, useEffect, useRef } from 'react';
import type { TaskLog } from '../types';
import { useI18n } from '../i18n';

interface LogViewerProps {
  logs: TaskLog[];
  interactive?: boolean;
  todoId?: string;
  onSendInput?: (todoId: string, input: string) => void;
}

const logColors: Record<TaskLog['log_type'], string> = {
  info: 'text-blue-400',
  error: 'text-red-400',
  output: 'text-gray-300',
  commit: 'text-green-400',
  input: 'text-amber-400',
};

const logPrefixes: Record<TaskLog['log_type'], string> = {
  info: '[INF]',
  error: '[ERR]',
  output: '[OUT]',
  commit: '[GIT]',
  input: '[>>>]',
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
            className="absolute top-2 right-2 z-10 px-2 py-1 text-[10px] font-mono rounded-md bg-warm-700 hover:bg-warm-600 text-warm-300 border border-warm-600 transition-colors"
          >
            {copied ? t('log.copied') : t('log.copy')}
          </button>
        )}
      <div
        ref={containerRef}
        className="h-48 sm:h-64 overflow-y-auto overflow-x-auto bg-warm-800 rounded-xl border border-warm-700 p-3 sm:p-4 font-mono text-xs"
      >
        {logs.length === 0 ? (
          <p className="text-warm-500">{t('log.awaiting')}</p>
        ) : (
          logs.map((log) => {
            const time = new Date(log.created_at).toLocaleTimeString();
            return (
              <div key={log.id} className="mb-0.5 leading-relaxed">
                <span className="text-warm-600">{time}</span>{' '}
                <span className={`font-bold ${logColors[log.log_type]}`}>
                  {logPrefixes[log.log_type]}
                </span>{' '}
                <span className={logColors[log.log_type]}>{log.message}</span>
              </div>
            );
          })
        )}
        <span className="text-accent-gold animate-pulse">_</span>
      </div>
      </div>

      {interactive && (
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 bg-warm-800 border border-t-0 border-warm-700 rounded-b-xl px-4 py-2"
        >
          <span className="text-accent-gold font-mono font-bold text-xs">$</span>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="flex-1 bg-transparent border-none outline-none text-amber-400 font-mono text-xs placeholder-warm-600"
            placeholder={t('todo.sendPlaceholder')}
            autoFocus
          />
          <button
            type="submit"
            className="text-accent-gold hover:text-accent-gold/80 text-xs font-mono font-bold tracking-wider"
          >
            SEND
          </button>
        </form>
      )}
    </div>
  );
}
