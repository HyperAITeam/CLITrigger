import type { PluginManifest } from '../types.js';
import { createRouter } from './router.js';

export const jiraPlugin: PluginManifest = {
  id: 'jira',
  version: '1.0.0',
  displayName: 'Jira',
  displayNameKo: 'Jira',
  category: 'external-service',
  hasPanel: true,
  routePrefix: '/api/jira',
  configFields: [
    { key: 'enabled', type: 'boolean' },
    { key: 'base_url', type: 'string', required: true },
    { key: 'email', type: 'string', required: true },
    { key: 'api_token', type: 'string', required: true, sensitive: true },
    { key: 'project_key', type: 'string' },
  ],
  createRouter,
};
