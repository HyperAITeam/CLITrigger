import type { Express } from 'express';
import type { PluginManifest, PluginHelpers } from './types.js';
import { getPluginConfig, isPluginEnabled } from '../db/queries.js';

const plugins = new Map<string, PluginManifest>();

export function registerPlugin(manifest: PluginManifest): void {
  if (plugins.has(manifest.id)) {
    throw new Error(`Plugin "${manifest.id}" already registered`);
  }
  plugins.set(manifest.id, manifest);
}

export function getPlugin(id: string): PluginManifest | undefined {
  return plugins.get(id);
}

export function getAllPlugins(): PluginManifest[] {
  return Array.from(plugins.values());
}

export function getExecutionHookPlugins(): PluginManifest[] {
  return getAllPlugins().filter(p => p.category === 'execution-hook' && p.onBeforeExecution);
}

export function mountPluginRoutes(app: Express): void {
  for (const plugin of plugins.values()) {
    if (!plugin.createRouter) continue;

    const helpers: PluginHelpers = {
      getConfig: (projectId) => getPluginConfig(projectId, plugin.id),
      isEnabled: (projectId) => isPluginEnabled(projectId, plugin.id),
    };

    const router = plugin.createRouter(helpers);
    const prefix = plugin.routePrefix || `/api/plugins/${plugin.id}`;
    app.use(prefix, router);
  }
}
