import { useEffect, useRef } from 'react';
import type { TaskLog } from '../types';

interface LogViewerProps {
  logs: TaskLog[];
}

const logColors: Record<TaskLog['log_type'], string> = {
  info: 'text-cyan-400',
  error: 'text-red-400',
  output: 'text-gray-300',
  commit: 'text-green-400',
};

const logPrefixes: Record<TaskLog['log_type'], string> = {
  info: '[INFO]',
  error: '[ERROR]',
  output: '[OUT]',
  commit: '[COMMIT]',
};

export default function LogViewer({ logs }: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div
      ref={containerRef}
      className="h-64 overflow-y-auto rounded-lg bg-gray-950 border border-gray-700 p-4 font-mono text-sm"
    >
      {logs.length === 0 ? (
        <p className="text-gray-500 italic">No logs yet.</p>
      ) : (
        logs.map((log) => {
          const time = new Date(log.created_at).toLocaleTimeString();
          return (
            <div key={log.id} className="mb-1 leading-relaxed">
              <span className="text-gray-500">{time}</span>{' '}
              <span className={`font-bold ${logColors[log.log_type]}`}>
                {logPrefixes[log.log_type]}
              </span>{' '}
              <span className={logColors[log.log_type]}>{log.message}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
