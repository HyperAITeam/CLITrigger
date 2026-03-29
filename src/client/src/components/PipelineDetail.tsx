import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { PipelineWithPhases, PipelineLog, DiffResult } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import * as pipelinesApi from '../api/pipelines';
import PhaseTimeline from './PhaseTimeline';
import { useI18n } from '../i18n';

interface PipelineDetailProps {
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  connected: boolean;
}

const PHASE_LABEL_KEYS: Record<string, string> = {
  planning: 'pipeline.planningFull',
  implementation: 'pipeline.implementationFull',
  review: 'pipeline.reviewFull',
  feedback_impl: 'pipeline.feedbackFull',
  documentation: 'pipeline.documentationFull',
};

const logColors: Record<string, string> = {
  info: 'text-status-running',
  error: 'text-status-error',
  output: 'text-warm-600',
  commit: 'text-status-success',
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
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();

  // Load pipeline data
  useEffect(() => {
    if (!pipelineId) return;
    pipelinesApi.getPipeline(pipelineId)
      .then((data) => {
        setPipeline(data);
        if (data.current_phase) {
          setSelectedPhase(data.current_phase);
        } else if (data.phases.length > 0) {
          const lastCompleted = [...data.phases].reverse().find(p => p.status === 'completed');
          setSelectedPhase(lastCompleted?.phase_type || data.phases[0].phase_type);
        }
      })
      .catch(() => setError(t('pipeline.notFound')))
      .finally(() => setLoading(false));
  }, [pipelineId, t]);

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

  const handleCleanup = useCallback(async () => {
    if (!pipelineId) return;
    setCleaning(true);
    try {
      await pipelinesApi.cleanupPipeline(pipelineId);
      const data = await pipelinesApi.getPipeline(pipelineId);
      setPipeline(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cleanup failed');
    } finally {
      setCleaning(false);
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
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="text-center py-20 text-warm-500 animate-fade-in">
          {t('detail.loading')}
        </div>
      </div>
    );
  }

  if (error && !pipeline) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="card p-16 text-center animate-fade-in">
          <p className="text-status-error font-medium text-lg">{error}</p>
          <Link to={`/projects/${id}`} className="mt-4 inline-block text-sm text-accent-gold hover:text-accent-goldDark transition-colors">
            {t('pipeline.backToProject')}
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
  const canCleanup = pipeline.status !== 'running' && pipeline.status !== 'pending' && (pipeline.worktree_path || pipeline.branch_name);

  const statusBadge = () => {
    const map: Record<string, string> = {
      running: 'bg-status-running/10 text-status-running',
      completed: 'bg-status-success/10 text-status-success',
      failed: 'bg-status-error/10 text-status-error',
      paused: 'bg-status-warning/10 text-status-warning',
      merged: 'bg-status-merged/10 text-status-merged',
      stopped: 'bg-status-warning/10 text-status-warning',
    };
    return map[pipeline.status] || 'bg-warm-200 text-warm-500';
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Navigation */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to={`/projects/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-warm-500 hover:text-accent-gold transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t('detail.back')}
        </Link>
        <span className="text-warm-300">/</span>
        <span className="text-sm text-warm-700 truncate font-medium">{t('tabs.pipelines')}</span>

        {connected && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-status-success">
            <span className="h-1.5 w-1.5 rounded-full bg-status-success animate-pulse" />
            {t('detail.live')}
          </span>
        )}
      </div>

      {/* Pipeline header */}
      <div className="card p-5 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-warm-800 mb-1">{pipeline.title}</h1>
            <p className="text-sm text-warm-500 whitespace-pre-wrap leading-relaxed">
              {pipeline.description}
            </p>
            {pipeline.branch_name && (
              <span className="inline-flex items-center gap-1 mt-2 px-2.5 py-0.5 rounded-full text-[10px] font-medium font-mono bg-accent-gold/10 text-accent-gold">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.193-9.193a4.5 4.5 0 00-6.364 0l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                </svg>
                {pipeline.branch_name}
              </span>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${statusBadge()}`}>
              {pipeline.status === 'running' && <span className="h-1.5 w-1.5 rounded-full bg-status-running animate-pulse" />}
              {t(`status.${pipeline.status === 'paused' ? 'stopped' : pipeline.status}` as any)}
            </span>
          </div>
        </div>
      </div>

      {/* Phase timeline */}
      {pipeline.phases.length > 0 && (
        <div className="card p-4 mb-6">
          <h3 className="text-xs font-semibold text-warm-500 uppercase tracking-wider mb-2">
            {t('pipeline.phases')}
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
          <button onClick={handleStart} className="btn-primary text-xs py-2">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            {pipeline.status === 'pending' ? t('pipeline.start') : pipeline.status === 'paused' ? t('pipeline.resume') : t('pipeline.retry')}
          </button>
        )}
        {canStop && (
          <button onClick={handleStop} className="btn-danger text-xs py-2">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
            {t('pipeline.pause')}
          </button>
        )}
        {canSkip && (
          <button onClick={handleSkip} className="btn-secondary text-xs py-2">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            </svg>
            {t('pipeline.skipPhase')}
          </button>
        )}
        {canRetry && (
          <button onClick={handleRetry} className="btn-secondary text-xs py-2">
            {t('pipeline.retryPhase')}
          </button>
        )}
        {canViewDiff && (
          <button onClick={handleViewDiff} disabled={diffLoading} className="btn-secondary text-xs py-2 disabled:opacity-40">
            {showDiff ? t('pipeline.hideDiff') : t('pipeline.viewDiff')}
          </button>
        )}
        {canMerge && (
          <button onClick={handleMerge} disabled={merging} className="btn-primary text-xs py-2 disabled:opacity-40">
            {merging ? t('pipeline.merging') : t('pipeline.merge')}
          </button>
        )}
        {canCleanup && (
          <button onClick={handleCleanup} disabled={cleaning} className="btn-danger text-xs py-2 disabled:opacity-40">
            {cleaning ? t('pipeline.cleaning') : t('pipeline.cleanup')}
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="py-2.5 px-4 mb-4 bg-status-error/5 border border-status-error/20 rounded-xl text-sm text-status-error flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-xs underline ml-3 hover:no-underline">dismiss</button>
        </div>
      )}

      {/* Diff viewer */}
      {showDiff && diffData && (
        <div className="card p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-warm-500 uppercase tracking-wider">
              {t('pipeline.diffOutput')}
            </h4>
            <div className="flex gap-3 text-xs font-mono">
              <span className="text-warm-500">{diffData.stats.files_changed} {t('pipeline.files')}</span>
              <span className="text-status-success">+{diffData.stats.insertions}</span>
              <span className="text-status-error">-{diffData.stats.deletions}</span>
            </div>
          </div>
          <pre className="h-80 overflow-auto bg-warm-50 border border-warm-200 rounded-xl p-4 font-mono text-xs leading-relaxed">
            {diffData.diff ? diffData.diff.split('\n').map((line, i) => {
              let className = 'text-warm-500';
              if (line.startsWith('+') && !line.startsWith('+++')) className = 'text-status-success';
              else if (line.startsWith('-') && !line.startsWith('---')) className = 'text-status-error';
              else if (line.startsWith('@@')) className = 'text-status-running';
              else if (line.startsWith('diff ')) className = 'text-accent-gold font-semibold';
              return <div key={i} className={className}>{line}</div>;
            }) : <span className="text-warm-400 italic">{t('pipeline.noChanges')}</span>}
          </pre>
        </div>
      )}

      {/* Phase detail + logs */}
      {selectedPhase && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-warm-500 uppercase tracking-wider">
              {t(PHASE_LABEL_KEYS[selectedPhase] as any) || selectedPhase} — LOG
            </h3>
            {selectedPhaseData?.status && (
              <span className={`text-[10px] font-semibold tracking-wider uppercase ${
                selectedPhaseData.status === 'running' ? 'text-status-running' :
                selectedPhaseData.status === 'completed' ? 'text-status-success' :
                selectedPhaseData.status === 'failed' ? 'text-status-error' :
                selectedPhaseData.status === 'skipped' ? 'text-status-warning' :
                'text-warm-400'
              }`}>
                {t(`status.${selectedPhaseData.status === 'skipped' ? 'stopped' : selectedPhaseData.status === 'running' ? 'running' : selectedPhaseData.status === 'completed' ? 'completed' : selectedPhaseData.status === 'failed' ? 'failed' : 'pending'}` as any)}
              </span>
            )}
          </div>

          {/* Phase output (collapsed) */}
          {selectedPhaseData?.output && (
            <details className="mb-3">
              <summary className="text-xs text-accent-gold cursor-pointer hover:underline font-medium">
                {t('pipeline.phaseOutput')}
              </summary>
              <pre className="mt-2 max-h-60 overflow-auto bg-warm-50 border border-warm-200 rounded-xl p-3 font-mono text-xs text-warm-600 leading-relaxed whitespace-pre-wrap">
                {selectedPhaseData.output}
              </pre>
            </details>
          )}

          {/* Log viewer */}
          <div
            id="pipeline-log-container"
            className="h-80 overflow-y-auto bg-warm-50 border border-warm-200 rounded-xl p-4 font-mono text-xs"
          >
            {!logsLoaded ? (
              <p className="text-warm-400 animate-pulse">{t('pipeline.loadingLogs')}</p>
            ) : logs.length === 0 ? (
              <p className="text-warm-400">{t('pipeline.awaitingOutput')}</p>
            ) : (
              logs.map((log) => {
                const time = new Date(log.created_at).toLocaleTimeString();
                return (
                  <div key={log.id} className="mb-0.5 leading-relaxed">
                    <span className="text-warm-300">{time}</span>{' '}
                    <span className={`font-bold ${logColors[log.log_type] || 'text-warm-600'}`}>
                      {logPrefixes[log.log_type] || '[???]'}
                    </span>{' '}
                    <span className={logColors[log.log_type] || 'text-warm-600'}>{log.message}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
