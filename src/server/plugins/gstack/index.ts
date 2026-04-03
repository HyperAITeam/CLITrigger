import { Router, type Request, type Response } from 'express';
import type { PluginManifest, PluginHelpers } from '../types.js';
import { getAvailableSkills, parseSkillConfig, injectSkills } from '../../services/skill-injector.js';

export const gstackPlugin: PluginManifest = {
  id: 'gstack',
  version: '1.0.0',
  displayName: 'Gstack Skills',
  displayNameKo: 'Gstack 스킬',
  category: 'execution-hook',
  hasPanel: false,
  routePrefix: '/api/gstack',
  configFields: [
    { key: 'enabled', type: 'boolean' },
    { key: 'skills', type: 'json' },
  ],

  createRouter(_helpers: PluginHelpers): Router {
    const router = Router();

    router.get('/skills', (_req: Request, res: Response) => {
      res.json(getAvailableSkills());
    });

    return router;
  },

  async onBeforeExecution(ctx) {
    if (ctx.cliTool !== 'claude') return;

    const { getPluginConfig } = await import('../../db/queries.js');
    const config = getPluginConfig(ctx.project.id, 'gstack');
    if (!config || config.enabled !== '1') return;

    const skillIds = parseSkillConfig(config.skills ?? null);
    if (skillIds.length === 0) return;

    await injectSkills(ctx.workDir, skillIds);
    ctx.log('output', `Injected gstack skills: ${skillIds.join(', ')}`);
  },
};
