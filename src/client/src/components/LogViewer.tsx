import { useEffect, useRef } from 'react';
import type { TaskLog } from '../types';
import { useI18n } from '../i18n';

interface LogViewerProps {
  logs: TaskLog[];
}

const logColors: Record<TaskLog['log_type'], string> = {
  info: 'text-blue-400',
  error: 'text-red-400',
  output: 'text-warm-300',
  commit: 'text-green-400',
};

const logPrefixes: Record<TaskLog['log_type'], string> = {
  info: '[INF]',
  error: '[ERR]',
  output: '[OUT]',
  commit: '[GIT]',
};

export default function LogViewer({ logs }: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div
      ref={containerRef}
      className="h-64 overflow-y-auto bg-warm-800 rounded-xl border border-warm-700 p-4 font-mono text-xs"
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
  );
}
