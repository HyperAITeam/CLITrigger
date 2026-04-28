import type { PluginManifest } from '../types.js';
import { createRouter } from './router.js';

export const harnessPlugin: PluginManifest = {
  id: 'harness',
  version: '1.0.0',
  displayName: 'Harness',
  displayNameKo: '하네스',
  category: 'external-service',
  hasPanel: true,
  routePrefix: '/api/harness',
  configFields: [],
  createRouter,
};
