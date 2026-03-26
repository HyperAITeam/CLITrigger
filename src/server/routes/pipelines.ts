import { Router, Request, Response } from 'express';
import simpleGit from 'simple-git';
import fs from 'fs';
import * as queries from '../db/queries.js';
import { pipelineOrchestrator } from '../services/pipeline-orchestrator.js';
import { worktreeManager } from '../services/worktree-manager.js';

const router = Router();

// POST /api/projects/:id/pipelines - create pipeline
router.post('/projects/:id/pipelines', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const { title, description } = req.body;
    if (!title || !description) {
      res.status(400).json({ error: 'Title and description are required' });
      return;
    }

    const pipeline = queries.createPipeline(req.params.id, title, description);
    res.status(201).json(pipeline);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id/pipelines - list pipelines for project
router.get('/projects/:id/pipelines', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const pipelines = queries.getPipelinesByProjectId(req.params.id);
    res.json(pipelines);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/pipelines/:id - get pipeline detail with phases
router.get('/pipelines/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const pipeline = queries.getPipelineById(req.params.id);
    if (!pipeline) {
      res.status(404).json({ error: 'Pipeline not found' });
      return;
    }

    const phases = queries.getPipelinePhases(pipeline.id);
    res.json({ ...pipeline, phases });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/pipelines/:id - delete pipeline
router.delete('/pipelines/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const pipeline = queries.getPipelineById(req.params.id);
    if (!pipeline) {
      res.status(404).json({ error: 'Pipeline not found' });
      return;
    }

    // Stop if running
    if (pipeline.status === 'running' && pipeline.process_pid) {
      await pipelineOrchestrator.stopPipeline(pipeline.id);
    }

    queries.deletePipeline(req.params.id);
    res.status(204).send();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/pipelines/:id/start - start or resume pipeline
router.post('/pipelines/:id/start', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const pipeline = queries.getPipelineById(req.params.id);
    if (!pipeline) {
      res.status(404).json({ error: 'Pipeline not found' });
      return;
    }

    if (pipeline.status === 'paused' || pipeline.status === 'failed') {
      await pipelineOrchestrator.resumePipeline(pipeline.id);
    } else {
      await pipelineOrchestrator.startPipeline(pipeline.id);
    }

    const updated = queries.getPipelineById(pipeline.id);
    const phases = queries.getPipelinePhases(pipeline.id);
    res.json({ ...updated, phases });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/pipelines/:id/stop - pause pipeline
router.post('/pipelines/:id/stop', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const pipeline = queries.getPipelineById(req.params.id);
    if (!pipeline) {
      res.status(404).json({ error: 'Pipeline not found' });
      return;
    }

    await pipelineOrchestrator.stopPipeline(pipeline.id);

    const updated = queries.getPipelineById(pipeline.id);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/pipelines/:id/skip-phase - skip current phase
router.post('/pipelines/:id/skip-phase', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const pipeline = queries.getPipelineById(req.params.id);
    if (!pipeline) {
      res.status(404).json({ error: 'Pipeline not found' });
      return;
    }

    await pipelineOrchestrator.skipPhase(pipeline.id);

    const updated = queries.getPipelineById(pipeline.id);
    const phases = queries.getPipelinePhases(pipeline.id);
    res.json({ ...updated, phases });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/pipelines/:id/retry-phase - retry failed phase
router.post('/pipelines/:id/retry-phase', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const pipeline = queries.getPipelineById(req.params.id);
    if (!pipeline) {
      res.status(404).json({ error: 'Pipeline not found' });
      return;
    }

    await pipelineOrchestrator.retryPhase(pipeline.id);

    const updated = queries.getPipelineById(pipeline.id);
    const phases = queries.getPipelinePhases(pipeline.id);
    res.json({ ...updated, phases });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/pipelines/:id/logs - get logs (optional phase filter)
router.get('/pipelines/:id/logs', (req: Request<{ id: string }>, res: Response) => {
  try {
    const pipeline = queries.getPipelineById(req.params.id);
    if (!pipeline) {
      res.status(404).json({ error: 'Pipeline not found' });
      return;
    }

    const phase = req.query.phase as string | undefined;
    const logs = queries.getPipelineLogs(req.params.id, phase);
    res.json(logs);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/pipelines/:id/phases - get all phases with outputs
router.get('/pipelines/:id/phases', (req: Request<{ id: string }>, res: Response) => {
  try {
    const pipeline = queries.getPipelineById(req.params.id);
    if (!pipeline) {
      res.status(404).json({ error: 'Pipeline not found' });
      return;
    }

    const phases = queries.getPipelinePhases(req.params.id);
    res.json(phases);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/pipelines/:id/merge - merge pipeline branch
router.post('/pipelines/:id/merge', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const pipeline = queries.getPipelineById(req.params.id);
    if (!pipeline) {
      res.status(404).json({ error: 'Pipeline not found' });
      return;
    }

    if (pipeline.status !== 'completed') {
      res.status(400).json({ error: 'Can only merge completed pipelines' });
      return;
    }

    if (!pipeline.branch_name) {
      res.status(400).json({ error: 'Pipeline has no branch to merge' });
      return;
    }

    const project = queries.getProjectById(pipeline.project_id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const git = simpleGit(project.path);
    const defaultBranch = project.default_branch || 'main';

    await git.checkout(defaultBranch);

    try {
      const mergeResult = await git.merge([pipeline.branch_name]);
      queries.updatePipelineStatus(pipeline.id, 'merged');

      // Auto-cleanup worktree and branch after successful merge
      if (pipeline.worktree_path) {
        try {
          await worktreeManager.cleanupWorktree(project.path, pipeline.worktree_path, pipeline.branch_name);
          queries.updatePipeline(pipeline.id, { worktree_path: null, branch_name: null });
        } catch {
          // Non-fatal: merge succeeded even if cleanup fails
        }
      }

      res.json({ success: true, result: mergeResult });
    } catch (mergeErr: unknown) {
      try {
        await git.merge(['--abort']);
      } catch {
        // May fail if no merge in progress
      }
      const message = mergeErr instanceof Error ? mergeErr.message : 'Merge failed';
      res.status(409).json({ error: 'Merge conflict', details: message });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/pipelines/:id/diff - get git diff
router.get('/pipelines/:id/diff', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const pipeline = queries.getPipelineById(req.params.id);
    if (!pipeline) {
      res.status(404).json({ error: 'Pipeline not found' });
      return;
    }

    if (!pipeline.worktree_path) {
      res.status(404).json({ error: 'No worktree path for this pipeline' });
      return;
    }

    if (!fs.existsSync(pipeline.worktree_path)) {
      res.status(404).json({ error: 'Worktree directory no longer exists' });
      return;
    }

    const project = queries.getProjectById(pipeline.project_id);
    const defaultBranch = project?.default_branch || 'main';

    const git = simpleGit(pipeline.worktree_path);
    const diff = await git.diff([`${defaultBranch}...HEAD`]);
    const diffStat = await git.diff([`${defaultBranch}...HEAD`, '--stat']);

    let files_changed = 0;
    let insertions = 0;
    let deletions = 0;

    const statMatch = diffStat.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
    if (statMatch) {
      files_changed = parseInt(statMatch[1], 10) || 0;
      insertions = parseInt(statMatch[2], 10) || 0;
      deletions = parseInt(statMatch[3], 10) || 0;
    }

    res.json({ diff, stats: { files_changed, insertions, deletions } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/pipelines/:id/cleanup - remove worktree and branch for a pipeline
router.post('/pipelines/:id/cleanup', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const pipeline = queries.getPipelineById(req.params.id);
    if (!pipeline) {
      res.status(404).json({ error: 'Pipeline not found' });
      return;
    }

    if (pipeline.status === 'running') {
      res.status(400).json({ error: 'Cannot cleanup a running pipeline. Stop it first.' });
      return;
    }

    const project = queries.getProjectById(pipeline.project_id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const result = { worktreeRemoved: false, branchDeleted: false };

    if (pipeline.worktree_path || pipeline.branch_name) {
      const cleanup = await worktreeManager.cleanupWorktree(
        project.path,
        pipeline.worktree_path || '',
        pipeline.branch_name || ''
      );
      result.worktreeRemoved = cleanup.worktreeRemoved;
      result.branchDeleted = cleanup.branchDeleted;

      // Clear worktree info from DB
      queries.updatePipeline(pipeline.id, { worktree_path: null, branch_name: null });
    }

    res.json({ success: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
