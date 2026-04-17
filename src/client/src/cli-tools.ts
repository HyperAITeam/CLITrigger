import { getModels, type ModelMap, type ModelOption } from './api/models';

export type CliTool = 'claude' | 'gemini' | 'codex';

export interface CliModelOption {
  value: string;
  label: string;
  deprecated?: boolean;
}

export interface CliToolConfig {
  value: CliTool;
  label: string;
  models: CliModelOption[];
  supportsInteractive: boolean;
}

// Static fallback used when server is unreachable
const DEFAULT_CLI_TOOLS: CliToolConfig[] = [
  {
    value: 'claude',
    label: 'Claude Code',
    supportsInteractive: true,
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
    supportsInteractive: true,
    models: [
      { value: '', label: 'Default (Gemini 2.5 Pro)' },
    ],
  },
  {
    value: 'codex',
    label: 'Codex CLI',
    supportsInteractive: true,
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
    const active: CliModelOption[] = [];
    const deprecated: CliModelOption[] = [];
    for (const m of cachedModels[tool] as ModelOption[]) {
      if (m.deprecated) {
        deprecated.push({ value: m.value, label: `${m.label} (deprecated)`, deprecated: true });
      } else {
        active.push({ value: m.value, label: m.label });
      }
    }
    return { ...base, models: [...active, ...deprecated] };
  }
  return base;
}

/**
 * Return true when the given model value is marked deprecated in the live
 * server model list. Used by UI components to show a warning badge next to
 * the currently-saved selection without altering the dropdown options.
 */
export function isModelDeprecated(tool: CliTool, modelValue: string): boolean {
  if (!cachedModels || !cachedModels[tool]) return false;
  const found = (cachedModels[tool] as ModelOption[]).find((m) => m.value === modelValue);
  return !!found?.deprecated;
}
