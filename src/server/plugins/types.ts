import type { Router } from 'express';
import type { Project } from '../db/queries.js';

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

export interface ExecutionContext {
  project: Project;
  todoId: string;
  workDir: string;
  cliTool: string;
  log: (type: string, message: string) => void;
}

export interface PluginManifest {
  id: string;
  version: string;
  displayName: string;
  displayNameKo: string;
  category: 'external-service' | 'execution-hook';
  configFields: PluginConfigField[];
  hasPanel: boolean;
  routePrefix?: string;
  createRouter?: (helpers: PluginHelpers) => Router;
  onBeforeExecution?: (ctx: ExecutionContext) => Promise<void>;
}
