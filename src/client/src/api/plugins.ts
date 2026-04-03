import { get, put } from './client';

export interface PluginInfo {
  id: string;
  version: string;
  displayName: string;
  displayNameKo: string;
  category: string;
  configFields: Array<{ key: string; type: string; sensitive?: boolean; required?: boolean }>;
  hasPanel: boolean;
}

export function getPlugins(): Promise<PluginInfo[]> {
  return get('/api/plugins');
}

export function getPluginConfig(pluginId: string, projectId: string): Promise<Record<string, string | null>> {
  return get(`/api/plugins/${pluginId}/config/${projectId}`);
}

export function updatePluginConfig(pluginId: string, projectId: string, config: Record<string, string | null>): Promise<Record<string, string | null>> {
  return put(`/api/plugins/${pluginId}/config/${projectId}`, config);
}
