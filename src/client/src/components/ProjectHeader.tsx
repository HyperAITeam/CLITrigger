import { useState } from 'react';
import type { Project, Todo } from '../types';
import * as projectsApi from '../api/projects';

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
          <h1 className="text-2xl sm:text-3xl font-mono font-bold text-white truncate">
            {project.name}
          </h1>
          <p className="mt-1 text-xs text-street-400 font-mono truncate">{project.path}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs font-mono">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan">
              BRANCH: {project.default_branch}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-neon-yellow/10 border border-neon-yellow/30 text-neon-yellow">
              WORKERS: {project.max_concurrent ?? 3}
            </span>
            {project.claude_model && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-neon-purple/10 border border-neon-purple/30 text-neon-purple">
                MODEL: {project.claude_model}
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-2 sm:gap-3 flex-shrink-0">
          {/* Settings */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="street-btn bg-street-700 border-2 border-street-500 px-4 py-3 text-xs text-street-300 hover:border-neon-cyan hover:text-neon-cyan"
            title="Settings"
          >
            CFG
          </button>

          {/* Start All */}
          <button
            onClick={onStartAll}
            disabled={!hasStartable}
            className="street-btn relative bg-neon-green px-5 sm:px-8 py-3 text-xs text-street-900 hover:bg-neon-green/80 hover:shadow-neon-green disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {hasStartable && (
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full bg-neon-green opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 bg-white" />
              </span>
            )}
            RUN ALL
          </button>

          {/* Stop All */}
          <button
            onClick={onStopAll}
            disabled={!hasRunning}
            className="street-btn bg-neon-pink px-5 sm:px-8 py-3 text-xs text-white hover:bg-neon-pink/80 hover:shadow-neon-pink disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none"
          >
            KILL ALL
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="mt-5 bg-street-800 border-2 border-street-500 p-6 animate-slide-up"
          style={{ clipPath: 'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px))' }}
        >
          <h3 className="text-xs font-mono font-bold text-neon-cyan tracking-[0.2em] uppercase mb-5">
            &gt; PROJECT_CONFIG
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div>
              <label className="block text-xs font-mono text-street-400 mb-2 uppercase tracking-wider">
                Max Workers
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={maxConcurrent}
                onChange={(e) => setMaxConcurrent(Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                className="street-input"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-street-400 mb-2 uppercase tracking-wider">
                Claude Model
              </label>
              <select
                value={claudeModel}
                onChange={(e) => setClaudeModel(e.target.value)}
                className="street-input"
              >
                <option value="">Default</option>
                <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                <option value="claude-opus-4-6">Claude Opus 4.6</option>
                <option value="claude-haiku-4-5">Claude Haiku 4.5</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-mono text-street-400 mb-2 uppercase tracking-wider">
                CLI Flags
              </label>
              <input
                type="text"
                value={claudeOptions}
                onChange={(e) => setClaudeOptions(e.target.value)}
                placeholder="--verbose"
                className="street-input"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={() => setShowSettings(false)}
              className="font-mono text-xs text-street-400 hover:text-white px-4 py-2 transition-colors uppercase tracking-wider"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="street-btn bg-neon-cyan px-6 py-2.5 text-xs text-street-900 hover:bg-neon-cyan/80 disabled:opacity-50"
            >
              {saving ? 'SAVING...' : 'SAVE'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
