import type { Router } from 'express';

export interface PluginConfigField {
  key: string;
  type: 'string' | 'boolean' | 'json';
  sensitive?: boolean;
  required?: boolean;
}

export interface PluginHelpers {
  getConfig: (projectId: string) => Record<string, string | null> | null;
  isEnabled: (projectId: string) => boolean;
}

export interface PluginManifest {
  id: string;
  version: string;
  displayName: string;
  displayNameKo: string;
  category: 'external-service';
  configFields: PluginConfigField[];
  hasPanel: boolean;
  routePrefix?: string;
  createRouter?: (helpers: PluginHelpers) => Router;
}
