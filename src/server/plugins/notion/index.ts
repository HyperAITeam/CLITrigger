import type { PluginManifest } from '../types.js';
import { createRouter } from './router.js';

export const notionPlugin: PluginManifest = {
  id: 'notion',
  version: '1.0.0',
  displayName: 'Notion',
  displayNameKo: 'Notion',
  category: 'external-service',
  hasPanel: true,
  routePrefix: '/api/notion',
  configFields: [
    { key: 'enabled', type: 'boolean' },
    { key: 'api_key', type: 'string', required: true, sensitive: true },
    { key: 'database_id', type: 'string', required: true },
  ],
  createRouter,
};
