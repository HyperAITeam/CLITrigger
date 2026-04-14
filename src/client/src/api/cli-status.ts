import { get, post } from './client';

export interface CliToolStatus {
  tool: string;
  installed: boolean;
  version: string | null;
}

export function getCliStatus(): Promise<CliToolStatus[]> {
  return get('/api/cli/status');
}

export function refreshCliStatus(): Promise<CliToolStatus[]> {
  return post('/api/cli/status/refresh');
}
