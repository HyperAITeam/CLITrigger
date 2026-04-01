import { getModels, type ModelMap, type ModelOption } from './api/models';

export type CliTool = 'claude' | 'gemini' | 'codex';

export interface CliToolConfig {
  value: CliTool;
  label: string;
  models: { value: string; label: string }[];
}

// Static fallback used when server is unreachable
const DEFAULT_CLI_TOOLS: CliToolConfig[] = [
  {
    value: 'claude',
    label: 'Claude Code',
    models: [
      { value: '', label: 'Default' },
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
      { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ],
  },
  {
    value: 'gemini',
    label: 'Gemini CLI',
    models: [
      { value: '', label: 'Default (Gemini 2.5 Pro)' },
    ],
  },
  {
    value: 'codex',
    label: 'Codex CLI',
    models: [
      { value: '', label: 'Default' },
      { value: 'gpt-4.1', label: 'GPT-4.1' },
      { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
      { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
      { value: 'o3', label: 'o3' },
      { value: 'o4-mini', label: 'o4-mini' },
    ],
  },
];

export const CLI_TOOLS = DEFAULT_CLI_TOOLS;

let cachedModels: ModelMap | null = null;
let loadPromise: Promise<void> | null = null;

export function loadModels(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = getModels()
    .then((models) => { cachedModels = models; })
    .catch(() => { cachedModels = null; });
  return loadPromise;
}

export function refreshModels(): Promise<void> {
  loadPromise = null;
  cachedModels = null;
  return loadModels();
}

export function getToolConfig(tool: CliTool): CliToolConfig {
  const base = DEFAULT_CLI_TOOLS.find((t) => t.value === tool) ?? DEFAULT_CLI_TOOLS[0];
  if (cachedModels && cachedModels[tool]) {
    return {
      ...base,
      models: cachedModels[tool].map((m: ModelOption) => ({ value: m.value, label: m.label })),
    };
  }
  return base;
}
