import { get, post } from './client';

export interface CliToolStatus {
  tool: string;
  installed: boolean;
  version: string | null;
}

export function getCliStatus(): Promise<CliToolStatus[]> {
  return get('/api/cli/status');
}

export interface ShellOption {
  id: string;
  name: string;
}

export function getShells(): Promise<ShellOption[]> {
  return get('/api/cli/shells');
}

export function refreshCliStatus(): Promise<CliToolStatus[]> {
  return post('/api/cli/status/refresh');
}

export interface UsageWindow { percent: number; resetsAt: number }
export interface CliUsage { fiveHour: UsageWindow | null; weekly: UsageWindow | null; updatedAt: number }
export interface UsageSnapshot { claude: CliUsage | null; codex: CliUsage | null }

export function getCliUsage(refresh = false): Promise<UsageSnapshot> {
  return get(`/api/cli/usage${refresh ? '?refresh=1' : ''}`);
}
