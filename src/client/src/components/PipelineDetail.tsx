import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { PipelineWithPhases, PipelineLog, DiffResult } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import * as pipelinesApi from '../api/pipelines';
import PhaseTimeline from './PhaseTimeline';

interface PipelineDetailProps {
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  connected: boolean;
}

const PHASE_LABELS: Record<string, string> = {
  planning: '계획 (Planning)',
  implementation: '구현 (Implementation)',
  review: '리뷰 (Review)',
  feedback_impl: '피드백 반영 (Feedback)',
  documentation: '문서화 (Documentation)',
};

const logColors: Record<string, string> = {
  info: 'text-neon-cyan',
  error: 'text-neon-pink',
  output: 'text-street-300',
  commit: 'text-neon-green',
};

const logPrefixes: Record<string, string> = {
  info: '[INF]',
  error: '[ERR]',
  output: '[OUT]',
  commit: '[GIT]',
};

export default function PipelineDetail({ onEvent, connected }: PipelineDetailProps) {
  const { id, pipelineId } = useParams<{ id: string; pipelineId: string }>();
  const [pipeline, setPipeline] = useState<PipelineWithPhases | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
  const [logs, setLogs] = useState<PipelineLog[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [diffData, setDiffData] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load pipeline data
  useEffect(() => {
    if (!pipelineId) return;
    pipelinesApi.getPipeline(pipelineId)
      .then((data) => {
        setPipeline(data);
        // Auto-select current or first phase
        if (data.current_phase) {
          setSelectedPhase(data.current_phase);
        } else if (data.phases.length > 0) {
          const lastCompleted = [...data.phases].reverse().find(p => p.status === 'completed');
          setSelectedPhase(lastCompleted?.phase_type || data.phases[0].phase_type);
        }
      })
      .catch(() => setError('Pipeline not found'))
      .finally(() => setLoading(false));
  }, [pipelineId]);

  // Load logs when phase changes
  useEffect(() => {
    if (!pipelineId || !selectedPhase) return;
    setLogsLoaded(false);
    pipelinesApi.getPipelineLogs(pipelineId, selectedPhase)
      .then((data) => {
        setLogs(data);
        setLogsLoaded(true);
      })
      .catch(() => setLogs([]));
  }, [pipelineId, selectedPhase]);

  // WebSocket events
  useEffect(() => {
    return onEvent((event) => {
      if (!pipelineId) return;

      if (event.type === 'pipeline:status-changed' && event.pipelineId === pipelineId) {
        setPipeline((prev) => prev ? {
          ...prev,
          status: event.status as PipelineWithPhases['status'],
          current_phase: event.currentPhase ?? null,
        } : prev);
        if (event.currentPhase && event.status === 'running') {
          setSelectedPhase(event.currentPhase);
        }
      }

      if (event.type === 'pipeline:phase-changed' && event.pipelineId === pipelineId) {
        setPipeline((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            phases: prev.phases.map((p) =>
              p.phase_type === event.phaseType
                ? { ...p, status: event.status as typeof p.status }
                : p
            ),
          };
        });
      }

      if (event.type === 'pipeline:log' && event.pipelineId === pipelineId) {
        if (event.phaseType === selectedPhase) {
          const newLog: PipelineLog = {
            id: `ws-${Date.now()}-${Math.random()}`,
            pipeline_id: pipelineId,
            phase_type: event.phaseType || '',
            log_type: (event.logType as PipelineLog['log_type']) || 'output',
            message: event.message || '',
            created_at: new Date().toISOString(),
          };
          setLogs((prev) => [...prev, newLog]);
        }
      }

      if (event.type === 'pipeline:commit' && event.pipelineId === pipelineId) {
        if (event.phaseType === selectedPhase) {
          const newLog: PipelineLog = {
            id: `ws-commit-${Date.now()}-${Math.random()}`,
            pipeline_id: pipelineId,
            phase_type: event.phaseType || '',
            log_type: 'commit',
            message: `[${event.commitHash || ''}] ${event.message || ''}`,
            created_at: new Date().toISOString(),
          };
          setLogs((prev) => [...prev, newLog]);
        }
      }
    });
  }, [onEvent, pipelineId, selectedPhase]);

  // Auto-scroll logs
  useEffect(() => {
    const el = document.getElementById('pipeline-log-container');
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const handleStart = useCallback(async () => {
    if (!pipelineId) return;
    try {
      const data = await pipelinesApi.startPipeline(pipelineId);
      setPipeline(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start');
    }
  }, [pipelineId]);

  const handleStop = useCallback(async () => {
    if (!pipelineId) return;
    try {
      await pipelinesApi.stopPipeline(pipelineId);
      // Refresh
      const data = await pipelinesApi.getPipeline(pipelineId);
      setPipeline(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop');
    }
  }, [pipelineId]);

  const handleSkip = useCallback(async () => {
    if (!pipelineId) return;
    try {
      const data = await pipelinesApi.skipPhase(pipelineId);
      setPipeline(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to skip');
    }
  }, [pipelineId]);

  const handleRetry = useCallback(async () => {
    if (!pipelineId) return;
    try {
      const data = await pipelinesApi.retryPhase(pipelineId);
      setPipeline(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry');
    }
  }, [pipelineId]);

  const handleMerge = useCallback(async () => {
    if (!pipelineId) return;
    setMerging(true);
    try {
      await pipelinesApi.mergePipeline(pipelineId);
      const data = await pipelinesApi.getPipeline(pipelineId);
      setPipeline(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      setMerging(false);
    }
  }, [pipelineId]);

  const handleViewDiff = useCallback(async () => {
    if (!pipelineId) return;
    if (showDiff) { setShowDiff(false); return; }
    setDiffLoading(true);
    try {
      const data = await pipelinesApi.getPipelineDiff(pipelineId);
      setDiffData(data);
      setShowDiff(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load diff');
    } finally {
      setDiffLoading(false);
    }
  }, [pipelineId, showDiff]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="text-center py-20 font-mono text-neon-green animate-flicker">
          LOADING<span className="animate-pulse">_</span>
        </div>
      </div>
    );
  }

  if (error && !pipeline) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="street-card p-16 text-center">
          <p className="text-neon-pink font-mono text-lg">// ERROR: {error}</p>
          <Link to={`/projects/${id}`} className="mt-6 inline-block font-mono text-sm text-neon-green hover:underline">
            &lt;-- BACK TO PROJECT
          </Link>
        </div>
      </div>
    );
  }

  if (!pipeline) return null;

  const selectedPhaseData = pipeline.phases.find(p => p.phase_type === selectedPhase);
  const canStart = pipeline.status === 'pending' || pipeline.status === 'paused' || pipeline.status === 'failed';
  const canStop = pipeline.status === 'running';
  const canMerge = pipeline.status === 'completed';
  const canSkip = pipeline.status === 'running' || pipeline.status === 'paused';
  const canRetry = pipeline.status === 'failed';
  const canViewDiff = pipeline.status === 'completed' || pipeline.status === 'failed' || pipeline.status === 'merged';

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* Navigation */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to={`/projects/${id}`}
          className="inline-flex items-center gap-1.5 font-mono text-xs text-street-400 hover:text-neon-green transition-colors tracking-wider uppercase"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          PROJECT
        </Link>
        <span className="text-street-600 font-mono">/</span>
        <span className="font-mono text-xs text-neon-cyan truncate">PIPELINE</span>

        {connected && (
          <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-xs text-neon-green">
            <span className="h-1.5 w-1.5 bg-neon-green animate-pulse" />
            LIVE
          </span>
        )}
      </div>

      <div className="h-px bg-gradient-to-r from-neon-cyan/50 via-street-600 to-transparent mb-6" />

      {/* Pipeline header */}
      <div className="street-card p-5 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-mono font-bold text-white mb-1">{pipeline.title}</h1>
            <p className="text-sm text-street-400 font-mono whitespace-pre-wrap leading-relaxed">
              {pipeline.description}
            </p>
            {pipeline.branch_name && (
              <span className="inline-block mt-2 px-2 py-1 bg-neon-cyan/10 border border-neon-cyan/20 text-neon-cyan text-[10px] font-mono">
                BRANCH: {pipeline.branch_name}
              </span>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            {/* Status */}
            <span className={`inline-flex items-center border px-3 py-1 text-xs font-mono font-bold tracking-widest ${
              pipeline.status === 'running' ? 'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/50 animate-pulse' :
              pipeline.status === 'completed' ? 'bg-neon-green/10 text-neon-green border-neon-green/50' :
              pipeline.status === 'failed' ? 'bg-neon-pink/10 text-neon-pink border-neon-pink/50' :
              pipeline.status === 'paused' ? 'bg-neon-yellow/10 text-neon-yellow border-neon-yellow/50' :
              pipeline.status === 'merged' ? 'bg-neon-purple/10 text-neon-purple border-neon-purple/50' :
              'bg-street-600 text-street-300 border-street-500'
            }`}>
              {pipeline.status === 'running' && <span className="mr-1.5 h-1.5 w-1.5 bg-neon-cyan animate-ping" />}
              {pipeline.status.toUpperCase()}
            </span>
          </div>
        </div>
      </div>

      {/* Phase timeline */}
      {pipeline.phases.length > 0 && (
        <div className="street-card p-4 mb-6">
          <h3 className="text-[10px] font-mono font-bold text-street-500 tracking-[0.2em] uppercase mb-2">
            PIPELINE PHASES
          </h3>
          <PhaseTimeline
            phases={pipeline.phases}
            currentPhase={pipeline.current_phase}
            selectedPhase={selectedPhase}
            onSelectPhase={(phase) => {
              setSelectedPhase(phase);
              setLogsLoaded(false);
            }}
          />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 mb-6">
        {canStart && (
          <button onClick={handleStart} className="street-btn px-4 py-2 text-xs font-mono bg-neon-green/10 text-neon-green border border-neon-green/50 hover:bg-neon-green/20">
            {pipeline.status === 'pending' ? 'START PIPELINE' : pipeline.status === 'paused' ? 'RESUME' : 'RETRY'}
          </button>
        )}
        {canStop && (
          <button onClick={handleStop} className="street-btn px-4 py-2 text-xs font-mono bg-neon-pink/10 text-neon-pink border border-neon-pink/50 hover:bg-neon-pink/20">
            PAUSE
          </button>
        )}
        {canSkip && (
          <button onClick={handleSkip} className="street-btn px-4 py-2 text-xs font-mono bg-neon-yellow/10 text-neon-yellow border border-neon-yellow/50 hover:bg-neon-yellow/20">
            SKIP PHASE
          </button>
        )}
        {canRetry && (
          <button onClick={handleRetry} className="street-btn px-4 py-2 text-xs font-mono bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/50 hover:bg-neon-cyan/20">
            RETRY PHASE
          </button>
        )}
        {canViewDiff && (
          <button onClick={handleViewDiff} disabled={diffLoading} className="street-btn px-4 py-2 text-xs font-mono bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/50 hover:bg-neon-cyan/20 disabled:opacity-30">
            {showDiff ? 'HIDE DIFF' : 'VIEW DIFF'}
          </button>
        )}
        {canMerge && (
          <button onClick={handleMerge} disabled={merging} className="street-btn px-4 py-2 text-xs font-mono bg-neon-purple/10 text-neon-purple border border-neon-purple/50 hover:bg-neon-purple/20 disabled:opacity-30">
            {merging ? 'MERGING...' : 'MERGE'}
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="py-2 px-3 mb-4 bg-neon-pink/10 border border-neon-pink/30 font-mono text-xs text-neon-pink">
          ! {error}
          <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Diff viewer */}
      {showDiff && diffData && (
        <div className="street-card p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[10px] font-mono font-bold text-street-500 tracking-[0.2em] uppercase">
              DIFF OUTPUT
            </h4>
            <div className="flex gap-4 text-[10px] font-mono tracking-wider">
              <span className="text-street-400">{diffData.stats.files_changed} FILES</span>
              <span className="text-neon-green">+{diffData.stats.insertions}</span>
              <span className="text-neon-pink">-{diffData.stats.deletions}</span>
            </div>
          </div>
          <pre className="h-80 overflow-auto bg-street-900 border-2 border-street-600 p-4 font-mono text-xs leading-relaxed">
            {diffData.diff ? diffData.diff.split('\n').map((line, i) => {
              let className = 'text-street-400';
              if (line.startsWith('+') && !line.startsWith('+++')) className = 'text-neon-green';
              else if (line.startsWith('-') && !line.startsWith('---')) className = 'text-neon-pink';
              else if (line.startsWith('@@')) className = 'text-neon-cyan';
              else if (line.startsWith('diff ')) className = 'text-neon-yellow font-bold';
              return <div key={i} className={className}>{line}</div>;
            }) : <span className="text-street-500 italic">// No changes detected.</span>}
          </pre>
        </div>
      )}

      {/* Phase detail + logs */}
      {selectedPhase && (
        <div className="street-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[10px] font-mono font-bold text-street-500 tracking-[0.2em] uppercase">
              {PHASE_LABELS[selectedPhase] || selectedPhase} — LOG
            </h3>
            {selectedPhaseData?.status && (
              <span className={`text-[10px] font-mono font-bold tracking-wider ${
                selectedPhaseData.status === 'running' ? 'text-neon-cyan' :
                selectedPhaseData.status === 'completed' ? 'text-neon-green' :
                selectedPhaseData.status === 'failed' ? 'text-neon-pink' :
                selectedPhaseData.status === 'skipped' ? 'text-neon-yellow' :
                'text-street-500'
              }`}>
                {selectedPhaseData.status.toUpperCase()}
              </span>
            )}
          </div>

          {/* Phase output (collapsed) */}
          {selectedPhaseData?.output && (
            <details className="mb-3">
              <summary className="text-[10px] font-mono text-neon-cyan cursor-pointer hover:underline tracking-wider">
                PHASE OUTPUT (click to expand)
              </summary>
              <pre className="mt-2 max-h-60 overflow-auto bg-street-900 border border-street-700 p-3 font-mono text-xs text-street-300 leading-relaxed whitespace-pre-wrap">
                {selectedPhaseData.output}
              </pre>
            </details>
          )}

          {/* Log viewer */}
          <div
            id="pipeline-log-container"
            className="h-80 overflow-y-auto bg-street-900 border-2 border-street-600 p-4 font-mono text-xs"
          >
            {!logsLoaded ? (
              <p className="text-street-500 animate-pulse">// Loading logs...</p>
            ) : logs.length === 0 ? (
              <p className="text-street-500">// Awaiting output...</p>
            ) : (
              logs.map((log) => {
                const time = new Date(log.created_at).toLocaleTimeString();
                return (
                  <div key={log.id} className="mb-0.5 leading-relaxed">
                    <span className="text-street-600">{time}</span>{' '}
                    <span className={`font-bold ${logColors[log.log_type] || 'text-street-300'}`}>
                      {logPrefixes[log.log_type] || '[???]'}
                    </span>{' '}
                    <span className={logColors[log.log_type] || 'text-street-300'}>{log.message}</span>
                  </div>
                );
              })
            )}
            <span className="text-neon-green animate-pulse">_</span>
          </div>
        </div>
      )}
    </div>
  );
}
