import { Router, type Request, type Response } from 'express';
import { getProjectById, getPluginConfig, setPluginConfigs } from '../db/queries.js';
import { getAllPlugins, getPlugin } from '../plugins/registry.js';

const router = Router();

// GET /api/plugins - list all registered plugins
router.get('/', (_req: Request, res: Response) => {
  const plugins = getAllPlugins().map(p => ({
    id: p.id,
    version: p.version,
    displayName: p.displayName,
    displayNameKo: p.displayNameKo,
    category: p.category,
    configFields: p.configFields,
    hasPanel: p.hasPanel,
  }));
  res.json(plugins);
});

// GET /api/plugins/:pluginId/config/:projectId - get plugin config for project
router.get('/:pluginId/config/:projectId', (req: Request<{ pluginId: string; projectId: string }>, res: Response) => {
  const project = getProjectById(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const plugin = getPlugin(req.params.pluginId);
  if (!plugin) {
    res.status(404).json({ error: 'Plugin not found' });
    return;
  }

  const config = getPluginConfig(req.params.projectId, req.params.pluginId);
  // Mask sensitive fields
  const masked: Record<string, string | null> = { ...config };
  if (config) {
    for (const field of plugin.configFields) {
      if (field.sensitive && config[field.key]) {
        masked[field.key] = '••••••••';
      }
    }
  }
  res.json(masked || {});
});

// PUT /api/plugins/:pluginId/config/:projectId - update plugin config
router.put('/:pluginId/config/:projectId', (req: Request<{ pluginId: string; projectId: string }>, res: Response) => {
  const project = getProjectById(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const plugin = getPlugin(req.params.pluginId);
  if (!plugin) {
    res.status(404).json({ error: 'Plugin not found' });
    return;
  }

  const updates = req.body as Record<string, string | null>;
  if (!updates || typeof updates !== 'object') {
    res.status(400).json({ error: 'Request body must be an object' });
    return;
  }

  // Filter out masked values (don't overwrite with mask string)
  const filtered: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value !== '••••••••') {
      filtered[key] = value;
    }
  }

  setPluginConfigs(req.params.projectId, req.params.pluginId, filtered);
  const config = getPluginConfig(req.params.projectId, req.params.pluginId);
  res.json(config || {});
});

export default router;
