import { useState, useCallback, useEffect, useRef } from 'react';
import type { Project, Todo } from '../types';
import * as projectsApi from '../api/projects';
import * as pluginsApi from '../api/plugins';
import { getCliStatus, refreshCliStatus, type CliToolStatus } from '../api/cli-status';
import { useI18n } from '../i18n';
import { CLI_TOOLS, type CliTool } from '../cli-tools';
import { useModels } from '../hooks/useModels';
import ModelSettings from './ModelSettings';
import { getClientPlugins } from '../plugins/registry';

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

  // Fetch CLI tool installation status when settings panel opens
  useEffect(() => {
    if (!showSettings) return;
    getCliStatus()
      .then(setCliStatuses)
      .catch(() => {})
      .finally(() => setCliStatusLoaded(true));
  }, [showSettings]);

  const currentCliStatus = cliStatuses.find((s) => s.tool === cliTool);

  const handleRefreshCliStatus = useCallback(() => {
    setCliStatusLoaded(false);
    refreshCliStatus()
      .then(setCliStatuses)
      .catch(() => {})
      .finally(() => setCliStatusLoaded(true));
  }, []);

  const { getToolConfig } = useModels();

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
                <svg className="w-3.5 h-3.5 opacity-0 group-hover:opacity-50 transition-opacity flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </h1>
            )}
            <button
              type="button"
              className="mt-0.5 text-[11px] text-warm-400 font-mono truncate hover:text-accent transition-colors cursor-pointer flex items-center gap-1 max-w-full"
              title={t('header.openFolder')}
              onClick={() => projectsApi.openFolder(project.path)}
            >
              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
              <span className="truncate">{project.path}</span>
            </button>
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
              <p className="text-[10px] text-warm-400 mt-1">{t('settings.defaultMaxTurnsHint')}</p>
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
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                  {t('header.usageLimit')}
                </a>
              )}
              {/* CLI installation status indicator */}
              {cliStatusLoaded && currentCliStatus && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${currentCliStatus.installed ? 'bg-status-success' : 'bg-status-error'}`} />
                  <span className="text-[10px] text-warm-400">
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
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.182" />
                    </svg>
                  </button>
                </div>
              )}
              {/* CLI not installed warning banner */}
              {cliStatusLoaded && currentCliStatus && !currentCliStatus.installed && (
                <div className="mt-2 p-2.5 bg-status-warning/5 border border-status-warning/20 rounded-xl">
                  <div className="flex items-start gap-2">
                    <svg className="w-4 h-4 text-status-warning flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                    <div>
                      <p className="text-xs font-medium text-status-warning">
                        {t('header.cliNotInstalled').replace('{tool}', CLI_TOOLS.find((c) => c.value === cliTool)?.label || cliTool)}
                      </p>
                      <code className="block mt-1 text-[10px] text-warm-500 bg-warm-100 px-2 py-1 rounded select-all">
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
            <p className="text-[10px] text-warm-400 mb-3">{t('header.fallbackChainHint')}</p>
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
              <p className="text-[10px] text-warm-500 mt-2">
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
                <div className="text-[10px] mt-1 opacity-80">{t('header.sandboxStrictDesc')}</div>
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
                <div className="text-[10px] mt-1 opacity-80">{t('header.sandboxPermissiveDesc')}</div>
              </button>
            </div>
            {sandboxMode === 'permissive' && (
              <p className="text-[10px] text-status-warning mt-2">{t('header.sandboxWarning')}</p>
            )}
          </div>

          {/* Sandbox warning confirmation dialog */}
          {showSandboxWarning && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-theme-card rounded-2xl p-6 max-w-sm mx-4 shadow-xl">
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
            </div>
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
                  <div className="text-[10px] mt-1 opacity-80">{t('header.worktreeEnabledDesc')}</div>
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
                  <div className="text-[10px] mt-1 opacity-80">{t('header.worktreeDisabledDesc')}</div>
                </button>
              </div>
              {!useWorktree && (
                <p className="text-[10px] text-status-warning mt-2">{t('header.worktreeWarning')}</p>
              )}
            </div>
          ) : null}

          {/* Token Usage Display */}
          <div className="mt-6 p-4 border border-warm-200 rounded-xl">
            <h4 className="text-sm font-semibold text-warm-700 mb-2">{t('header.showTokenUsageTitle')}</h4>
            <p className="text-[10px] text-warm-500 mb-3">{t('header.showTokenUsageDesc')}</p>
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
            <p className="text-[10px] text-warm-500 mb-3">{t('header.debugLoggingDesc')}</p>
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
