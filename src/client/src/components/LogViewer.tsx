import { useState, useEffect, useRef } from 'react';
import type { TaskLog } from '../types';

interface LogViewerProps {
  logs: TaskLog[];
  interactive?: boolean;
  todoId?: string;
  onSendInput?: (todoId: string, input: string) => void;
}

const logColors: Record<TaskLog['log_type'], string> = {
  info: 'text-neon-cyan',
  error: 'text-neon-pink',
  output: 'text-street-300',
  commit: 'text-neon-green',
  input: 'text-neon-yellow',
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

  return (
    <div className="flex flex-col">
      <div
        ref={containerRef}
        className="h-64 overflow-y-auto bg-street-900 border-2 border-street-600 p-4 font-mono text-xs"
      >
        {logs.length === 0 ? (
          <p className="text-street-500">// Awaiting output...</p>
        ) : (
          logs.map((log) => {
            const time = new Date(log.created_at).toLocaleTimeString();
            return (
              <div key={log.id} className="mb-0.5 leading-relaxed">
                <span className="text-street-600">{time}</span>{' '}
                <span className={`font-bold ${logColors[log.log_type]}`}>
                  {logPrefixes[log.log_type]}
                </span>{' '}
                <span className={logColors[log.log_type]}>{log.message}</span>
              </div>
            );
          })
        )}
        {/* Blinking cursor at bottom */}
        <span className="text-neon-green animate-pulse">_</span>
      </div>

      {interactive && (
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 bg-street-900 border-2 border-t-0 border-street-600 px-4 py-2"
        >
          <span className="text-neon-green font-mono font-bold text-xs">$</span>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="flex-1 bg-transparent border-none outline-none text-neon-yellow font-mono text-xs placeholder-street-600"
            placeholder="Type a message to Claude..."
            autoFocus
          />
          <button
            type="submit"
            className="text-neon-green hover:text-neon-green/80 text-xs font-mono font-bold tracking-wider"
          >
            SEND
          </button>
        </form>
      )}
    </div>
  );
}
