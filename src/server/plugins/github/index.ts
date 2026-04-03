import type { PluginManifest } from '../types.js';
import { createRouter } from './router.js';

export const githubPlugin: PluginManifest = {
  id: 'github',
  version: '1.0.0',
  displayName: 'GitHub',
  displayNameKo: 'GitHub',
  category: 'external-service',
  hasPanel: true,
  routePrefix: '/api/github',
  configFields: [
    { key: 'enabled', type: 'boolean' },
    { key: 'token', type: 'string', required: true, sensitive: true },
    { key: 'owner', type: 'string', required: true },
    { key: 'repo', type: 'string', required: true },
  ],
  createRouter,
};
