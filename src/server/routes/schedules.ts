import { Router, Request, Response } from 'express';
import cron from 'node-cron';
import * as queries from '../db/queries.js';
import { scheduler } from '../services/scheduler.js';

const router = Router();

// POST /api/projects/:id/schedules - create schedule
router.post('/projects/:id/schedules', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const { title, description, cron_expression, cli_tool, cli_model, skip_if_running } = req.body;
    if (!title || !cron_expression) {
      res.status(400).json({ error: 'Title and cron_expression are required' });
      return;
    }

    if (!cron.validate(cron_expression)) {
      res.status(400).json({ error: 'Invalid cron expression' });
      return;
    }

    const schedule = queries.createSchedule(
      req.params.id, title, description, cron_expression,
      cli_tool, cli_model, skip_if_running !== undefined ? (skip_if_running ? 1 : 0) : 1
    );

    // Auto-register the cron job since new schedules are active by default
    scheduler.registerJob(schedule);

    res.status(201).json(schedule);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id/schedules - list schedules for project
router.get('/projects/:id/schedules', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const schedules = queries.getSchedulesByProjectId(req.params.id);
    res.json(schedules);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/schedules/:id - get single schedule
router.get('/schedules/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const schedule = queries.getScheduleById(req.params.id);
    if (!schedule) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }
    res.json(schedule);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// PUT /api/schedules/:id - update schedule
router.put('/schedules/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const existing = queries.getScheduleById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }

    const { title, description, cron_expression, cli_tool, cli_model, skip_if_running } = req.body;

    if (cron_expression !== undefined && !cron.validate(cron_expression)) {
      res.status(400).json({ error: 'Invalid cron expression' });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (cron_expression !== undefined) updates.cron_expression = cron_expression;
    if (cli_tool !== undefined) updates.cli_tool = cli_tool;
    if (cli_model !== undefined) updates.cli_model = cli_model;
    if (skip_if_running !== undefined) updates.skip_if_running = skip_if_running ? 1 : 0;

    const schedule = queries.updateSchedule(req.params.id, updates);

    // Re-register cron job if expression changed and schedule is active
    if (schedule && schedule.is_active && cron_expression !== undefined) {
      scheduler.registerJob(schedule);
    }

    res.json(schedule);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/schedules/:id - delete schedule
router.delete('/schedules/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const schedule = queries.getScheduleById(req.params.id);
    if (!schedule) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }

    scheduler.unregisterJob(req.params.id);
    queries.deleteSchedule(req.params.id);
    res.status(204).send();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/schedules/:id/activate - activate schedule
router.post('/schedules/:id/activate', (req: Request<{ id: string }>, res: Response) => {
  try {
    const schedule = scheduler.activateSchedule(req.params.id);
    if (!schedule) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }
    res.json(schedule);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/schedules/:id/pause - pause schedule
router.post('/schedules/:id/pause', (req: Request<{ id: string }>, res: Response) => {
  try {
    const schedule = scheduler.pauseSchedule(req.params.id);
    if (!schedule) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }
    res.json(schedule);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/schedules/:id/runs - get execution history
router.get('/schedules/:id/runs', (req: Request<{ id: string }>, res: Response) => {
  try {
    const schedule = queries.getScheduleById(req.params.id);
    if (!schedule) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }

    const limit = parseInt(req.query.limit as string || '50', 10);
    const runs = queries.getScheduleRunsByScheduleId(req.params.id, limit);
    res.json(runs);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/schedules/:id/trigger - manually trigger a schedule run
router.post('/schedules/:id/trigger', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const run = await scheduler.triggerSchedule(req.params.id);
    if (!run) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }
    res.json(run);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
