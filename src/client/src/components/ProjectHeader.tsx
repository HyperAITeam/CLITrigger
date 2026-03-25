import { useState } from 'react';
import type { Project, Todo } from '../types';
import * as projectsApi from '../api/projects';
import { useI18n } from '../i18n';

interface ProjectHeaderProps {
  project: Project;
  todos: Todo[];
  onStartAll: () => void;
  onStopAll: () => void;
  onProjectUpdate: (project: Project) => void;
}

export default function ProjectHeader({ project, todos, onStartAll, onStopAll, onProjectUpdate }: ProjectHeaderProps) {
  const hasStartable = todos.some(
    (t) => t.status === 'pending' || t.status === 'failed' || t.status === 'stopped'
  );
  const hasRunning = todos.some((t) => t.status === 'running');
  const { t } = useI18n();

  const [showSettings, setShowSettings] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState(project.max_concurrent ?? 3);
  const [claudeModel, setClaudeModel] = useState(project.claude_model ?? '');
  const [claudeOptions, setClaudeOptions] = useState(project.claude_options ?? '');
  const [saving, setSaving] = useState(false);

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const updated = await projectsApi.updateProject(project.id, {
        max_concurrent: maxConcurrent,
        claude_model: claudeModel || null,
        claude_options: claudeOptions || null,
      });
      onProjectUpdate(updated);
      setShowSettings(false);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold text-warm-800 truncate">
            {project.name}
          </h1>
          <p className="mt-1 text-xs text-warm-400 font-mono truncate">{project.path}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="badge bg-status-running/10 text-status-running">
              {t('header.branch')}: {project.default_branch}
            </span>
            <span className="badge bg-accent-gold/10 text-accent-goldDark">
              {t('header.workers')}: {project.max_concurrent ?? 3}
            </span>
            {project.claude_model && (
              <span className="badge bg-status-merged/10 text-status-merged">
                {t('header.model')}: {project.claude_model}
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="btn-ghost text-sm"
            title={t('header.settings')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          <button
            onClick={onStartAll}
            disabled={!hasStartable}
            className="btn-primary text-sm"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            {t('header.runAll')}
          </button>

          <button
            onClick={onStopAll}
            disabled={!hasRunning}
            className="btn-danger text-sm"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h12v12H6z" />
            </svg>
            {t('header.stopAll')}
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="mt-5 card p-6 animate-slide-up">
          <h3 className="text-sm font-semibold text-warm-700 mb-5">
            {t('header.config')}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div>
              <label className="block text-xs font-medium text-warm-500 mb-2">
                {t('header.maxWorkers')}
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={maxConcurrent}
                onChange={(e) => setMaxConcurrent(Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                className="input-field"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-warm-500 mb-2">
                {t('header.claudeModel')}
              </label>
              <select
                value={claudeModel}
                onChange={(e) => setClaudeModel(e.target.value)}
                className="input-field"
              >
                <option value="">Default</option>
                <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                <option value="claude-opus-4-6">Claude Opus 4.6</option>
                <option value="claude-haiku-4-5">Claude Haiku 4.5</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-warm-500 mb-2">
                {t('header.cliFlags')}
              </label>
              <input
                type="text"
                value={claudeOptions}
                onChange={(e) => setClaudeOptions(e.target.value)}
                placeholder="--verbose"
                className="input-field"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={() => setShowSettings(false)}
              className="btn-ghost text-sm"
            >
              {t('header.cancel')}
            </button>
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="btn-primary text-sm"
            >
              {saving ? t('header.saving') : t('header.save')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
