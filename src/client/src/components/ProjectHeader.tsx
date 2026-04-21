import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Modal from './Modal';
import type { Project, Todo } from '../types';
import * as projectsApi from '../api/projects';
import * as pluginsApi from '../api/plugins';
import { getCliStatus, refreshCliStatus, type CliToolStatus } from '../api/cli-status';
import { useI18n } from '../i18n';
import { CLI_TOOLS, type CliTool, isModelDeprecated } from '../cli-tools';
import { useModels } from '../hooks/useModels';
import ModelSettings from './ModelSettings';
import { getClientPlugins } from '../plugins/registry';
import { Pencil, FolderOpen, Settings, Play, Square, BarChart3, RotateCcw, AlertTriangle } from 'lucide-react';

interface ProjectHeaderProps {
  project: Project;
  todos: Todo[];
  onStartAll: () => void;
  onStopAll: () => void;
  onProjectUpdate: (project: Project) => void;
}

interface DeprecatedModelBadgeProps {
  model: string;
  onOpenSettings: () => void;
}

function DeprecatedModelBadge({ model, onOpenSettings }: DeprecatedModelBadgeProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const updatePos = useCallback(() => {
    if (!anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pop = popRef.current;
    const pw = pop?.offsetWidth ?? 320;
    const ph = pop?.offsetHeight ?? 200;
    let top = r.bottom + 6;
    let left = r.left;
    if (left + pw > vw - 8) left = vw - 8 - pw;
    if (left < 8) left = 8;
    if (top + ph > vh - 8) top = r.top - ph - 6;
    if (top < 8) top = 8;
    setPos({ top, left });
    setPositioned(true);
  }, []);

  useEffect(() => {
    if (!open) { setPositioned(false); return; }
    updatePos();
    const raf = requestAnimationFrame(updatePos);
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open, updatePos]);

  return (
    <>
      <span
        ref={anchorRef}
        className="badge bg-status-warning/15 text-status-warning inline-flex items-center gap-1 cursor-help"
        tabIndex={0}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <AlertTriangle size={10} />
        {t('header.modelDeprecated') || 'Model deprecated'}
      </span>
      {open && createPortal(
        <div
          ref={popRef}
          role="tooltip"
          className="fixed w-80 p-3 rounded-lg shadow-elevated text-xs leading-relaxed z-tooltip"
          style={{
            top: pos.top,
            left: pos.left,
            opacity: positioned ? 1 : 0,
            backgroundColor: 'var(--color-bg-card)',
            borderColor: 'var(--color-border)',
            borderWidth: '1px',
            color: 'var(--color-text-primary)',
          }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <div className="flex items-center gap-1.5 font-semibold text-status-warning mb-1.5 flex-wrap">
            <AlertTriangle size={12} />
            {t('header.modelDeprecatedTitle')}
            <code className="ml-1 px-1 py-0.5 rounded text-[10px] font-mono" style={{ backgroundColor: 'var(--color-bg-tertiary)' }}>
              {model}
            </code>
          </div>
          <p className="mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            {t('header.modelDeprecatedReason')}
          </p>
          <div className="font-semibold mb-1">{t('header.modelDeprecatedFixHeading')}</div>
          <ul className="list-disc pl-4 space-y-0.5 mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            <li>{t('header.modelDeprecatedFix1')}</li>
            <li>{t('header.modelDeprecatedFix2')}</li>
            <li>{t('header.modelDeprecatedFix3')}</li>
          </ul>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onOpenSettings();
              setOpen(false);
            }}
            className="btn-primary text-xs px-2.5 py-1"
          >
            {t('header.modelDeprecatedOpenSettings')}
          </button>
        </div>,
        document.body
      )}
    </>
  );
}

export default function ProjectHeader({ project, todos, onStartAll, onStopAll, onProjectUpdate }: ProjectHeaderProps) {
  const hasStartable = todos.some(
    (t) => t.status === 'pending' || t.status === 'failed' || t.status === 'stopped'
  );
  const hasRunning = todos.some((t) => t.status === 'running');
  const { t } = useI18n();

  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string>('execution');
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(project.name);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [maxConcurrent, setMaxConcurrent] = useState(project.max_concurrent ?? 3);
  const [defaultMaxTurns, setDefaultMaxTurns] = useState(project.default_max_turns ?? 30);
  const [cliTool, setCliTool] = useState<CliTool>((project.cli_tool as CliTool) || 'claude');
  const [claudeModel, setClaudeModel] = useState(project.claude_model ?? '');
  const [claudeOptions, setClaudeOptions] = useState(project.claude_options ?? '');
  const [sandboxMode, setSandboxMode] = useState<'strict' | 'permissive'>((project.sandbox_mode as 'strict' | 'permissive') || 'strict');
  const [debugLogging, setDebugLogging] = useState(!!project.debug_logging);
  const [showTokenUsage, setShowTokenUsage] = useState(!!project.show_token_usage);
  const [useWorktree, setUseWorktree] = useState(project.use_worktree !== 0);
  const [npmAutoInstall, setNpmAutoInstall] = useState(!!project.npm_auto_install);
  const [showSandboxWarning, setShowSandboxWarning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checkingGit, setCheckingGit] = useState(false);
  const [cliStatuses, setCliStatuses] = useState<CliToolStatus[]>([]);
  const [cliStatusLoaded, setCliStatusLoaded] = useState(false);

  // Plugin configs (replaces per-integration useState)
  const [pluginConfigs, setPluginConfigs] = useState<Record<string, Record<string, any>>>({});

  // CLI fallback chain state
  const [fallbackChain, setFallbackChain] = useState<string[]>(() => {
    try {
      return project.cli_fallback_chain ? JSON.parse(project.cli_fallback_chain) : [];
    } catch { return []; }
  });

  // Load plugin configs from server
  useEffect(() => {
    const plugins = getClientPlugins();
    Promise.all(
      plugins.map(async (p) => {
        try {
          const config = await pluginsApi.getPluginConfig(p.id, project.id);
          return [p.id, config] as const;
        } catch {
          return [p.id, {}] as const;
        }
      })
    ).then((results) => {
      const configs: Record<string, Record<string, any>> = {};
      for (const [id, config] of results) {
        configs[id] = config;
      }
      setPluginConfigs(configs);
    });
  }, [project.id]);

  const { getToolConfig, refresh: refreshModelList } = useModels();

  // Fetch CLI tool installation status when settings panel opens.
  // The status call also triggers server-side model reconciliation if the
  // installed CLI version has changed since last sync, so refresh the cached
  // model list afterwards to reflect any newly discovered / deprecated models.
  useEffect(() => {
    if (!showSettings) return;
    getCliStatus()
      .then((statuses) => {
        setCliStatuses(statuses);
        refreshModelList();
      })
      .catch(() => {})
      .finally(() => setCliStatusLoaded(true));
  }, [showSettings, refreshModelList]);

  const currentCliStatus = cliStatuses.find((s) => s.tool === cliTool);

  const handleRefreshCliStatus = useCallback(() => {
    setCliStatusLoaded(false);
    refreshCliStatus()
      .then((statuses) => {
        setCliStatuses(statuses);
        refreshModelList();
      })
      .catch(() => {})
      .finally(() => setCliStatusLoaded(true));
  }, [refreshModelList]);

  const handleCliToolChange = (newTool: CliTool) => {
    setCliTool(newTool);
    setClaudeModel(''); // Reset model when tool changes
  };

  const toolConfig = getToolConfig(cliTool);

  const handleCheckGit = useCallback(async () => {
    setCheckingGit(true);
    try {
      const updated = await projectsApi.checkGitStatus(project.id);
      onProjectUpdate(updated);
    } catch { /* ignore */ }
    finally { setCheckingGit(false); }
  }, [project.id, onProjectUpdate]);

  const handlePluginConfigChange = (pluginId: string, updates: Record<string, any>) => {
    setPluginConfigs(prev => ({
      ...prev,
      [pluginId]: { ...prev[pluginId], ...updates },
    }));
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      // Save core project settings
      const effectiveMaxConcurrent = (!useWorktree && project.is_git_repo) ? 1 : maxConcurrent;
      const updated = await projectsApi.updateProject(project.id, {
        max_concurrent: effectiveMaxConcurrent,
        default_max_turns: defaultMaxTurns,
        cli_tool: cliTool,
        sandbox_mode: sandboxMode,
        debug_logging: debugLogging ? 1 : 0,
        use_worktree: useWorktree ? 1 : 0,
        npm_auto_install: npmAutoInstall ? 1 : 0,
        show_token_usage: showTokenUsage ? 1 : 0,
        claude_model: claudeModel || null,
        claude_options: claudeOptions || null,
        cli_fallback_chain: fallbackChain.length > 0 ? JSON.stringify(fallbackChain) : null,
        // Keep legacy columns in sync for backward compatibility
        gstack_enabled: pluginConfigs.gstack?.enabled === '1' ? 1 : 0,
        gstack_skills: pluginConfigs.gstack?.skills || null,
        jira_enabled: pluginConfigs.jira?.enabled === '1' ? 1 : 0,
        jira_base_url: pluginConfigs.jira?.base_url || null,
        jira_email: pluginConfigs.jira?.email || null,
        jira_api_token: pluginConfigs.jira?.api_token || null,
        jira_project_key: pluginConfigs.jira?.project_key || null,
        notion_enabled: pluginConfigs.notion?.enabled === '1' ? 1 : 0,
        notion_api_key: pluginConfigs.notion?.api_key || null,
        notion_database_id: pluginConfigs.notion?.database_id || null,
        github_enabled: pluginConfigs.github?.enabled === '1' ? 1 : 0,
        github_token: pluginConfigs.github?.token || null,
        github_owner: pluginConfigs.github?.owner || null,
        github_repo: pluginConfigs.github?.repo || null,
      });

      // Save plugin configs to plugin_configs table
      await Promise.all(
        Object.entries(pluginConfigs).map(([pluginId, config]) =>
          pluginsApi.updatePluginConfig(pluginId, project.id, config)
        )
      );

      onProjectUpdate(updated);
      setShowSettings(false);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleNameSave = async () => {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === project.name) {
      setNameValue(project.name);
      setEditingName(false);
      return;
    }
    try {
      const updated = await projectsApi.updateProject(project.id, { name: trimmed });
      onProjectUpdate(updated);
    } catch {
      setNameValue(project.name);
    }
    setEditingName(false);
  };

  const totalTodos = todos.length;
  const completedTodos = todos.filter(t => t.status === 'completed' || t.status === 'merged').length;
  const runningTodos = todos.filter(t => t.status === 'running').length;
  const progressPct = totalTodos > 0 ? Math.round((completedTodos / totalTodos) * 100) : 0;

  return (
    <div className="mb-6">
      {/* Hero Header Card */}
      <div className="card p-5 sm:p-6">
        {/* Top row: name + actions */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {editingName ? (
              <input
                ref={nameInputRef}
                type="text"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onBlur={handleNameSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleNameSave();
                  if (e.key === 'Escape') { setNameValue(project.name); setEditingName(false); }
                }}
                className="text-lg sm:text-xl font-semibold text-warm-800 bg-transparent border-b-2 border-accent outline-none w-full max-w-md"
                autoFocus
              />
            ) : (
              <h1
                className="text-lg sm:text-xl font-semibold text-warm-800 truncate cursor-pointer hover:text-accent transition-colors group flex items-center gap-2"
                onClick={() => { setEditingName(true); setNameValue(project.name); }}
                title={t('header.editName')}
              >
                {project.name}
                <Pencil size={14} className="opacity-0 group-hover:opacity-50 transition-opacity flex-shrink-0" />
              </h1>
            )}
            <button
              type="button"
              className="mt-0.5 text-[11px] text-warm-400 font-mono truncate hover:text-accent transition-colors cursor-pointer flex items-center gap-1 max-w-full"
              title={t('header.openFolder')}
              onClick={() => projectsApi.openFolder(project.path)}
            >
              <FolderOpen size={12} className="flex-shrink-0" />
              <span className="truncate">{project.path}</span>
            </button>
          </div>

          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="btn-ghost text-sm"
              title={t('header.settings')}
            >
              <Settings size={16} />
            </button>

            <button
              onClick={onStartAll}
              disabled={!hasStartable}
              className="btn-ghost text-sm"
            >
              <Play size={16} />
              {t('header.runAll')}
            </button>

            <button
              onClick={onStopAll}
              disabled={!hasRunning}
              className="btn-ghost text-sm"
            >
              <Square size={16} />
              {t('header.stopAll')}
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="my-4 border-t" style={{ borderColor: 'var(--color-border)' }} />

        {/* Bottom row: meta badges + progress */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex flex-wrap gap-1.5 flex-1">
            {project.is_git_repo ? (
              <>
                <span className="badge bg-warm-200/60 text-warm-600">Git</span>
                <span className="badge bg-warm-200/60 text-warm-600">
                  {t('header.branch')}: {project.default_branch}
                </span>
              </>
            ) : (
              <span className="badge bg-status-warning/10 text-status-warning">{t('header.noGit')}</span>
            )}
            <span className="badge bg-warm-200/60 text-warm-600">
              {getToolConfig((project.cli_tool as CliTool) || 'claude').label}
            </span>
            <span className="badge bg-warm-200/60 text-warm-600">
              {(project.sandbox_mode || 'strict') === 'strict' ? t('header.sandboxBadgeStrict') : t('header.sandboxBadgePermissive')}
            </span>
            {project.claude_model && isModelDeprecated((project.cli_tool as CliTool) || 'claude', project.claude_model) && (
              <DeprecatedModelBadge
                model={project.claude_model}
                onOpenSettings={() => {
                  setSettingsSection('execution');
                  setShowSettings(true);
                }}
              />
            )}
          </div>

          {/* Compact progress */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {runningTodos > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs text-status-running font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-status-running animate-pulse" />
                {runningTodos} {t('projects.active')}
              </span>
            )}
            <span className="text-xs font-medium text-warm-500">
              {progressPct}% <span className="text-warm-400">{completedTodos}/{totalTodos}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="mt-5 card p-6 animate-fade-in">
          {/* Settings section tabs */}
          <div className="flex gap-1 mb-5 p-0.5 rounded-lg" style={{ backgroundColor: 'var(--color-bg-tertiary)' }}>
            {[
              { key: 'execution', label: t('header.config') },
              { key: 'security', label: t('header.sandboxTitle') },
              { key: 'plugins', label: t('tabs.plugins') || 'Plugins' },
            ].map((s) => (
              <button
                key={s.key}
                onClick={() => setSettingsSection(s.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  settingsSection === s.key
                    ? 'text-warm-800 shadow-soft'
                    : 'text-warm-500 hover:text-warm-700'
                }`}
                style={settingsSection === s.key ? { backgroundColor: 'var(--color-bg-card)' } : undefined}
              >
                {s.label}
              </button>
            ))}
          </div>

          {settingsSection === 'execution' && (
          <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
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
                {t('settings.defaultMaxTurns')}
              </label>
              <input
                type="number"
                min={5}
                max={200}
                value={defaultMaxTurns}
                onChange={(e) => setDefaultMaxTurns(Math.min(200, Math.max(5, parseInt(e.target.value, 10) || 30)))}
                className="input-field"
              />
              <p className="text-2xs text-warm-400 mt-1">{t('settings.defaultMaxTurnsHint')}</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-warm-500 mb-2">
                {t('header.cliTool')}
              </label>
              <select
                value={cliTool}
                onChange={(e) => handleCliToolChange(e.target.value as CliTool)}
                className="input-field"
              >
                {CLI_TOOLS.map((tool) => (
                  <option key={tool.value} value={tool.value}>{tool.label}</option>
                ))}
              </select>
              {cliTool === 'claude' && (
                <a
                  href="https://claude.ai/settings/usage"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-1.5 text-xs text-accent hover:text-accent-dark transition-colors"
                >
                  <BarChart3 size={12} />
                  {t('header.usageLimit')}
                </a>
              )}
              {/* CLI installation status indicator */}
              {cliStatusLoaded && currentCliStatus && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${currentCliStatus.installed ? 'bg-status-success' : 'bg-status-error'}`} />
                  <span className="text-2xs text-warm-400">
                    {currentCliStatus.installed
                      ? (currentCliStatus.version || t('header.cliInstalled'))
                      : t('header.cliNotFound')}
                  </span>
                  <button
                    type="button"
                    onClick={handleRefreshCliStatus}
                    className="text-warm-400 hover:text-warm-600 transition-colors ml-1"
                    title={t('header.cliRefresh')}
                  >
                    <RotateCcw size={12} />
                  </button>
                </div>
              )}
              {/* CLI not installed warning banner */}
              {cliStatusLoaded && currentCliStatus && !currentCliStatus.installed && (
                <div className="mt-2 p-2.5 bg-status-warning/5 border border-status-warning/20 rounded-xl">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-status-warning flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-status-warning">
                        {t('header.cliNotInstalled').replace('{tool}', CLI_TOOLS.find((c) => c.value === cliTool)?.label || cliTool)}
                      </p>
                      <code className="block mt-1 text-2xs text-warm-500 bg-warm-100 px-2 py-1 rounded select-all">
                        {t(`header.cliInstallHint.${cliTool}`)}
                      </code>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-warm-500 mb-2">
                {t('header.aiModel')}
              </label>
              <select
                value={claudeModel}
                onChange={(e) => setClaudeModel(e.target.value)}
                className="input-field"
              >
                {toolConfig.models.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
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

          {/* CLI Fallback Chain */}
          <div className="mt-5 p-4 border border-warm-200 rounded-xl">
            <h4 className="text-xs font-semibold text-warm-600 mb-2">
              {t('header.fallbackChainTitle')}
            </h4>
            <p className="text-2xs text-warm-400 mb-3">{t('header.fallbackChainHint')}</p>
            <div className="flex flex-wrap gap-2">
              {CLI_TOOLS.map((tool) => {
                const idx = fallbackChain.indexOf(tool.value);
                const isSelected = idx !== -1;
                return (
                  <button
                    key={tool.value}
                    type="button"
                    onClick={() => {
                      setFallbackChain((prev) =>
                        isSelected
                          ? prev.filter((v) => v !== tool.value)
                          : [...prev, tool.value]
                      );
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      isSelected
                        ? 'bg-accent/10 border-accent text-accent'
                        : 'bg-warm-50 border-warm-200 text-warm-500 hover:border-warm-300'
                    }`}
                  >
                    {isSelected && <span className="mr-1 font-bold">{idx + 1}.</span>}
                    {tool.label}
                  </button>
                );
              })}
            </div>
            {fallbackChain.length > 0 && (
              <p className="text-2xs text-warm-500 mt-2">
                {fallbackChain.map((v) => CLI_TOOLS.find((t) => t.value === v)?.label ?? v).join(' → ')}
              </p>
            )}
          </div>
          </>
          )}

          {settingsSection === 'security' && (
          <>
          {/* Sandbox Mode */}
          <div className="p-4 border border-warm-200 rounded-xl">
            <h4 className="text-sm font-semibold text-warm-700 mb-2">
              {t('header.sandboxTitle')}
            </h4>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setSandboxMode('strict')}
                className={`flex-1 px-4 py-3 rounded-lg border text-left transition-colors ${
                  sandboxMode === 'strict'
                    ? 'bg-status-success/10 border-status-success text-status-success'
                    : 'bg-warm-50 border-warm-200 text-warm-500 hover:border-warm-300'
                }`}
              >
                <div className="text-xs font-semibold">{t('header.sandboxStrict')}</div>
                <div className="text-2xs mt-1 opacity-80">{t('header.sandboxStrictDesc')}</div>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (sandboxMode !== 'permissive') {
                    setShowSandboxWarning(true);
                  }
                }}
                className={`flex-1 px-4 py-3 rounded-lg border text-left transition-colors ${
                  sandboxMode === 'permissive'
                    ? 'bg-status-warning/10 border-status-warning text-status-warning'
                    : 'bg-warm-50 border-warm-200 text-warm-500 hover:border-warm-300'
                }`}
              >
                <div className="text-xs font-semibold">{t('header.sandboxPermissive')}</div>
                <div className="text-2xs mt-1 opacity-80">{t('header.sandboxPermissiveDesc')}</div>
              </button>
            </div>
            {sandboxMode === 'permissive' && (
              <p className="text-2xs text-status-warning mt-2">{t('header.sandboxWarning')}</p>
            )}
          </div>

          {/* Sandbox warning confirmation dialog */}
          {showSandboxWarning && (
            <Modal open onClose={() => setShowSandboxWarning(false)} size="sm">
              <div className="bg-theme-card rounded-2xl p-6 shadow-xl">
                <p className="text-sm text-warm-700 mb-4">{t('header.sandboxWarning')}</p>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setShowSandboxWarning(false)}
                    className="btn-ghost text-sm"
                  >
                    {t('header.cancel')}
                  </button>
                  <button
                    onClick={() => {
                      setSandboxMode('permissive');
                      setShowSandboxWarning(false);
                    }}
                    className="btn-danger text-sm"
                  >
                    {t('header.sandboxPermissive')}
                  </button>
                </div>
              </div>
            </Modal>
          )}

          {/* Worktree Isolation */}
          {project.is_git_repo ? (
            <div className="mt-6 p-4 border border-warm-200 rounded-xl">
              <h4 className="text-sm font-semibold text-warm-700 mb-2">{t('header.worktreeTitle')}</h4>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setUseWorktree(true)}
                  className={`flex-1 px-4 py-3 rounded-lg border text-left transition-colors ${
                    useWorktree
                      ? 'bg-status-success/10 border-status-success text-status-success'
                      : 'bg-warm-50 border-warm-200 text-warm-500 hover:border-warm-300'
                  }`}
                >
                  <div className="text-xs font-semibold">{t('header.worktreeEnabled')}</div>
                  <div className="text-2xs mt-1 opacity-80">{t('header.worktreeEnabledDesc')}</div>
                </button>
                <button
                  type="button"
                  onClick={() => setUseWorktree(false)}
                  className={`flex-1 px-4 py-3 rounded-lg border text-left transition-colors ${
                    !useWorktree
                      ? 'bg-status-warning/10 border-status-warning text-status-warning'
                      : 'bg-warm-50 border-warm-200 text-warm-500 hover:border-warm-300'
                  }`}
                >
                  <div className="text-xs font-semibold">{t('header.worktreeDisabled')}</div>
                  <div className="text-2xs mt-1 opacity-80">{t('header.worktreeDisabledDesc')}</div>
                </button>
              </div>
              {!useWorktree && (
                <p className="text-2xs text-status-warning mt-2">{t('header.worktreeWarning')}</p>
              )}
              <div className="mt-3 pt-3 border-t border-warm-200">
                <label className={`flex items-start gap-2 ${useWorktree ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                  <input
                    type="checkbox"
                    checked={npmAutoInstall}
                    disabled={!useWorktree}
                    onChange={(e) => setNpmAutoInstall(e.target.checked)}
                    className="mt-0.5 rounded"
                  />
                  <div>
                    <div className="text-xs font-medium text-warm-700">{t('header.npmAutoInstallLabel')}</div>
                    <div className="text-2xs text-warm-500 mt-0.5">{t('header.npmAutoInstallHint')}</div>
                  </div>
                </label>
              </div>
            </div>
          ) : null}

          {/* Token Usage Display */}
          <div className="mt-6 p-4 border border-warm-200 rounded-xl">
            <h4 className="text-sm font-semibold text-warm-700 mb-2">{t('header.showTokenUsageTitle')}</h4>
            <p className="text-2xs text-warm-500 mb-3">{t('header.showTokenUsageDesc')}</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showTokenUsage}
                onChange={(e) => setShowTokenUsage(e.target.checked)}
                className="rounded"
              />
              <span className="text-xs text-warm-600">{t('header.showTokenUsageEnable')}</span>
            </label>
          </div>

          {/* Debug Logging */}
          <div className="mt-6 p-4 border border-warm-200 rounded-xl">
            <h4 className="text-sm font-semibold text-warm-700 mb-2">{t('header.debugLoggingTitle')}</h4>
            <p className="text-2xs text-warm-500 mb-3">{t('header.debugLoggingDesc')}</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={debugLogging}
                onChange={(e) => setDebugLogging(e.target.checked)}
                className="rounded"
              />
              <span className="text-xs text-warm-600">{t('header.debugLoggingEnable')}</span>
            </label>
          </div>

          </>
          )}

          {settingsSection === 'plugins' && (
          <>
          {/* Plugin Settings */}
          {getClientPlugins().map((plugin) => (
            <div key={plugin.id} className="mt-6">
              <plugin.SettingsComponent
                project={project}
                config={pluginConfigs[plugin.id] || {}}
                onConfigChange={(updates) => handlePluginConfigChange(plugin.id, updates)}
              />
            </div>
          ))}

          {/* Model Management */}
          <ModelSettings />
          </>
          )}

          {!project.is_git_repo && (
            <div className="mt-5 p-3 bg-status-warning/5 border border-status-warning/20 rounded-xl">
              <p className="text-xs text-warm-600 mb-2">{t('header.noGitHint')}</p>
              <button
                onClick={handleCheckGit}
                disabled={checkingGit}
                className="btn-ghost text-xs"
              >
                {checkingGit ? '...' : t('header.recheckGit')}
              </button>
            </div>
          )}

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
