import { useState, useCallback, useEffect } from 'react';
import type { Project, Todo, GstackSkill } from '../types';
import * as projectsApi from '../api/projects';
import * as gstackApi from '../api/gstack';
import * as jiraApi from '../api/jira';
import { useI18n } from '../i18n';
import { CLI_TOOLS, type CliTool } from '../cli-tools';
import { useModels } from '../hooks/useModels';
import ModelSettings from './ModelSettings';

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
  const { t, lang } = useI18n();

  const [showSettings, setShowSettings] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState(project.max_concurrent ?? 3);
  const [cliTool, setCliTool] = useState<CliTool>((project.cli_tool as CliTool) || 'claude');
  const [claudeModel, setClaudeModel] = useState(project.claude_model ?? '');
  const [claudeOptions, setClaudeOptions] = useState(project.claude_options ?? '');
  const [saving, setSaving] = useState(false);
  const [checkingGit, setCheckingGit] = useState(false);

  // Jira state
  const [jiraEnabled, setJiraEnabled] = useState(!!project.jira_enabled);
  const [jiraBaseUrl, setJiraBaseUrl] = useState(project.jira_base_url ?? '');
  const [jiraEmail, setJiraEmail] = useState(project.jira_email ?? '');
  const [jiraApiToken, setJiraApiToken] = useState(project.jira_api_token ?? '');
  const [jiraProjectKey, setJiraProjectKey] = useState(project.jira_project_key ?? '');
  const [jiraTesting, setJiraTesting] = useState(false);
  const [jiraTestResult, setJiraTestResult] = useState<'ok' | 'fail' | null>(null);

  // gstack state
  const [gstackEnabled, setGstackEnabled] = useState(!!project.gstack_enabled);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(() => {
    try {
      return project.gstack_skills ? JSON.parse(project.gstack_skills) : [];
    } catch { return []; }
  });
  const [availableSkills, setAvailableSkills] = useState<GstackSkill[]>([]);

  useEffect(() => {
    gstackApi.getAvailableSkills().then(setAvailableSkills).catch(() => {});
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

  const handleToggleSkill = (skillId: string) => {
    setSelectedSkills((prev) =>
      prev.includes(skillId) ? prev.filter((s) => s !== skillId) : [...prev, skillId]
    );
  };

  const handleTestJira = async () => {
    setJiraTesting(true);
    setJiraTestResult(null);
    try {
      await projectsApi.updateProject(project.id, {
        jira_enabled: 1,
        jira_base_url: jiraBaseUrl || null,
        jira_email: jiraEmail || null,
        jira_api_token: jiraApiToken || null,
        jira_project_key: jiraProjectKey || null,
      });
      const result = await jiraApi.testConnection(project.id);
      setJiraTestResult(result.ok ? 'ok' : 'fail');
    } catch {
      setJiraTestResult('fail');
    } finally {
      setJiraTesting(false);
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const updated = await projectsApi.updateProject(project.id, {
        max_concurrent: maxConcurrent,
        cli_tool: cliTool,
        claude_model: claudeModel || null,
        claude_options: claudeOptions || null,
        gstack_enabled: gstackEnabled ? 1 : 0,
        gstack_skills: selectedSkills.length > 0 ? JSON.stringify(selectedSkills) : null,
        jira_enabled: jiraEnabled ? 1 : 0,
        jira_base_url: jiraBaseUrl || null,
        jira_email: jiraEmail || null,
        jira_api_token: jiraApiToken || null,
        jira_project_key: jiraProjectKey || null,
      });
      onProjectUpdate(updated);
      setShowSettings(false);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const isClaudeCli = cliTool === 'claude';

  return (
    <div className="mb-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold text-warm-800 truncate">
            {project.name}
          </h1>
          <p className="mt-1 text-xs text-warm-400 font-mono truncate">{project.path}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {project.is_git_repo ? (
              <>
                <span className="badge bg-status-success/10 text-status-success">Git</span>
                <span className="badge bg-status-running/10 text-status-running">
                  {t('header.branch')}: {project.default_branch}
                </span>
              </>
            ) : (
              <span className="badge bg-status-warning/10 text-status-warning">{t('header.noGit')}</span>
            )}
            <span className="badge bg-accent-gold/10 text-accent-goldDark">
              {t('header.workers')}: {project.max_concurrent ?? 3}
            </span>
            <span className="badge bg-status-merged/10 text-status-merged">
              {getToolConfig((project.cli_tool as CliTool) || 'claude').label}
            </span>
            {project.claude_model && (
              <span className="badge bg-status-merged/10 text-status-merged">
                {t('header.model')}: {project.claude_model}
              </span>
            )}
            {project.gstack_enabled ? (
              <span className="badge bg-status-success/10 text-status-success">gstack</span>
            ) : null}
            {project.jira_enabled ? (
              <span className="badge bg-blue-100 text-blue-700">Jira</span>
            ) : null}
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
                  className="inline-flex items-center gap-1 mt-1.5 text-xs text-purple-500 hover:text-purple-700 transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                  {t('header.usageLimit')}
                </a>
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

          {/* gstack Skills Section */}
          <div className="mt-6 p-4 border border-warm-200 rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-warm-700">
                {t('header.gstackTitle')}
              </h4>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={gstackEnabled}
                  onChange={(e) => setGstackEnabled(e.target.checked)}
                  disabled={!isClaudeCli}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-warm-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-warm-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-status-success peer-disabled:opacity-50" />
              </label>
            </div>

            {!isClaudeCli && (
              <p className="text-xs text-warm-400 mb-3">{t('header.gstackClaudeOnly')}</p>
            )}

            {isClaudeCli && gstackEnabled && availableSkills.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                {availableSkills.map((skill) => (
                  <label
                    key={skill.id}
                    className="flex items-start gap-2 p-2 rounded-lg hover:bg-warm-50 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSkills.includes(skill.id)}
                      onChange={() => handleToggleSkill(skill.id)}
                      className="mt-0.5 rounded border-warm-300 text-status-success focus:ring-status-success"
                    />
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-warm-700">{skill.name}</span>
                      <p className="text-xs text-warm-400 truncate">
                        {lang === 'ko' ? skill.descriptionKo : skill.description}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            )}

            <p className="text-xs text-warm-300">
              {t('header.gstackCredit')}
            </p>
          </div>

          {/* Jira Integration Section */}
          <div className="mt-6 p-4 border border-warm-200 rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-warm-700">
                {t('header.jiraTitle')}
              </h4>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={jiraEnabled}
                  onChange={(e) => setJiraEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-warm-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-warm-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500 peer-disabled:opacity-50" />
              </label>
            </div>

            {jiraEnabled && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs font-medium text-warm-500 mb-1">
                      {t('header.jiraBaseUrl')}
                    </label>
                    <input
                      type="url"
                      value={jiraBaseUrl}
                      onChange={(e) => setJiraBaseUrl(e.target.value)}
                      placeholder={t('header.jiraBaseUrlPlaceholder')}
                      className="input-field text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-warm-500 mb-1">
                      {t('header.jiraProjectKey')}
                    </label>
                    <input
                      type="text"
                      value={jiraProjectKey}
                      onChange={(e) => setJiraProjectKey(e.target.value.toUpperCase())}
                      placeholder={t('header.jiraProjectKeyPlaceholder')}
                      className="input-field text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-warm-500 mb-1">
                      {t('header.jiraEmail')}
                    </label>
                    <input
                      type="email"
                      value={jiraEmail}
                      onChange={(e) => setJiraEmail(e.target.value)}
                      placeholder={t('header.jiraEmailPlaceholder')}
                      className="input-field text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-warm-500 mb-1">
                      {t('header.jiraApiToken')}
                    </label>
                    <input
                      type="password"
                      value={jiraApiToken}
                      onChange={(e) => setJiraApiToken(e.target.value)}
                      placeholder={t('header.jiraApiTokenPlaceholder')}
                      className="input-field text-sm"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleTestJira}
                    disabled={jiraTesting || !jiraBaseUrl || !jiraEmail || !jiraApiToken}
                    className="btn-ghost text-xs"
                  >
                    {jiraTesting ? t('header.jiraTesting') : t('header.jiraTestConnection')}
                  </button>
                  {jiraTestResult === 'ok' && (
                    <span className="text-xs text-status-success font-medium">{t('header.jiraConnected')}</span>
                  )}
                  {jiraTestResult === 'fail' && (
                    <span className="text-xs text-status-error font-medium">{t('header.jiraFailed')}</span>
                  )}
                </div>

                <p className="text-xs text-warm-300 mt-2">
                  {t('header.jiraTokenHint')}
                </p>
              </>
            )}
          </div>

          {/* Model Management */}
          <ModelSettings />

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
