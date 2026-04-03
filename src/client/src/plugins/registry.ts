import type { ClientPluginManifest } from './types';
import type { Project } from '../types';

const plugins = new Map<string, ClientPluginManifest>();

export function registerClientPlugin(manifest: ClientPluginManifest): void {
  plugins.set(manifest.id, manifest);
}

export function getClientPlugins(): ClientPluginManifest[] {
  return Array.from(plugins.values());
}

export function getClientPlugin(id: string): ClientPluginManifest | undefined {
  return plugins.get(id);
}

export function getPluginsWithTabs(project: Project): ClientPluginManifest[] {
  return getClientPlugins().filter(p => p.hasTab && p.isEnabled(project));
}

export function getPluginTranslations(): { en: Record<string, string>; ko: Record<string, string> } {
  const en: Record<string, string> = {};
  const ko: Record<string, string> = {};
  for (const plugin of plugins.values()) {
    Object.assign(en, plugin.translations.en);
    Object.assign(ko, plugin.translations.ko);
  }
  return { en, ko };
}
