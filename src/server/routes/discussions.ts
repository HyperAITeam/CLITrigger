import { Router, Request, Response } from 'express';
import { createGit } from '../lib/git.js';
import fs from 'fs';
import * as queries from '../db/queries.js';
import { discussionOrchestrator } from '../services/discussion-orchestrator.js';
import { worktreeManager } from '../services/worktree-manager.js';

const router = Router();

const FULL_EDITABLE_DISCUSSION_FIELDS = ['title', 'description', 'max_rounds', 'agent_ids', 'auto_implement', 'implement_agent_id'] as const;
const LIMITED_EDITABLE_DISCUSSION_FIELDS = ['title', 'description'] as const;
const RUNNABLE_DISCUSSION_STATUSES = new Set(['pending', 'failed']);
const LIMITED_EDIT_DISCUSSION_STATUSES = new Set(['paused', 'completed']);

type EditableDiscussionField = (typeof FULL_EDITABLE_DISCUSSION_FIELDS)[number];

interface DiscussionPayload {
  title: string;
  description: string;
  agent_ids: string[];
  max_rounds: number;
  auto_implement: boolean;
  implement_agent_id: string | null;
}

function parseDiscussionAgentIds(agentIdsJson: string): string[] {
  try {
    const parsed = JSON.parse(agentIdsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getDiscussionAgents(discussion: queries.Discussion): queries.DiscussionAgent[] {
  return parseDiscussionAgentIds(discussion.agent_ids)
    .map((agentId) => queries.getDiscussionAgentById(agentId))
    .filter((agent): agent is queries.DiscussionAgent => !!agent);
}

function buildDiscussionResponse(discussion: queries.Discussion) {
  const messages = queries.getDiscussionMessages(discussion.id);
  const agents = getDiscussionAgents(discussion);
  return { ...discussion, messages, agents };
}

function normalizeDiscussionPayload(input: Record<string, unknown>): DiscussionPayload {
  const parsedMaxRounds = typeof input.max_rounds === 'number' ? input.max_rounds : Number(input.max_rounds);

  return {
    title: typeof input.title === 'string' ? input.title.trim() : '',
    description: typeof input.description === 'string' ? input.description.trim() : '',
    agent_ids: Array.isArray(input.agent_ids) ? input.agent_ids.filter((value): value is string => typeof value === 'string') : [],
    max_rounds: parsedMaxRounds,
    auto_implement: Boolean(input.auto_implement),
    implement_agent_id: typeof input.implement_agent_id === 'string' && input.implement_agent_id.trim()
      ? input.implement_agent_id.trim()
      : null,
  };
}

function validateDiscussionPayload(payload: DiscussionPayload): string | null {
  if (!payload.title || !payload.description) {
    return 'title and description are required';
  }

  if (payload.agent_ids.length < 2) {
    return 'At least 2 agents are required';
  }

  if (!Number.isInteger(payload.max_rounds) || payload.max_rounds < 1) {
    return 'max_rounds must be at least 1';
  }

  if (payload.auto_implement) {
    if (!payload.implement_agent_id) {
      return 'implement_agent_id is required when auto_implement is enabled';
    }

    if (!payload.agent_ids.includes(payload.implement_agent_id)) {
      return 'implement_agent_id must be one of the selected agents';
    }
  }

  return null;
}

function getAllowedDiscussionUpdateFields(status: string): readonly EditableDiscussionField[] | null {
  if (RUNNABLE_DISCUSSION_STATUSES.has(status)) {
    return FULL_EDITABLE_DISCUSSION_FIELDS;
  }

  if (LIMITED_EDIT_DISCUSSION_STATUSES.has(status)) {
    return LIMITED_EDITABLE_DISCUSSION_FIELDS;
  }

  return null;
}

function pickDiscussionUpdates(body: Record<string, unknown>, allowedFields: readonly EditableDiscussionField[]) {
  const updates: Partial<Record<EditableDiscussionField, unknown>> = {};

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      updates[field] = body[field];
    }
  }

  return updates;
}

// ── Discussion Agents ──

// POST /api/projects/:id/agents - create agent persona
router.post('/projects/:id/agents', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const { name, role, system_prompt, cli_tool, cli_model, avatar_color, can_implement } = req.body;
    if (!name || !role || !system_prompt) {
      res.status(400).json({ error: 'name, role, and system_prompt are required' });
      return;
    }

    const agent = queries.createDiscussionAgent(req.params.id, name, role, system_prompt, cli_tool, cli_model, avatar_color, Boolean(can_implement));
    res.status(201).json(agent);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id/agents - list agents for project
router.get('/projects/:id/agents', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const agents = queries.getDiscussionAgentsByProjectId(req.params.id);
    res.json(agents);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// PUT /api/agents/:id - update agent
router.put('/agents/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const agent = queries.getDiscussionAgentById(req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const updated = queries.updateDiscussionAgent(req.params.id, req.body);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/agents/:id - delete agent
router.delete('/agents/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const deleted = queries.deleteDiscussionAgent(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.status(204).send();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// ── Discussions ──

// POST /api/projects/:id/discussions - create discussion
router.post('/projects/:id/discussions', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    const payload = normalizeDiscussionPayload({
      ...req.body,
      max_rounds: req.body.max_rounds ?? 3,
    });

    const validationError = validateDiscussionPayload(payload);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const discussion = queries.createDiscussion(
      req.params.id,
      payload.title,
      payload.description,
      payload.agent_ids,
      payload.max_rounds,
      payload.auto_implement,
      payload.implement_agent_id ?? undefined
    );
    res.status(201).json(discussion);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id/discussions - list discussions for project
router.get('/projects/:id/discussions', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const discussions = queries.getDiscussionsByProjectId(req.params.id);
    res.json(discussions);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/discussions/:id - get discussion detail with messages and agents
router.get('/discussions/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const discussion = queries.getDiscussionById(req.params.id);
    if (!discussion) {
      res.status(404).json({ error: 'Discussion not found' });
      return;
    }

    res.json(buildDiscussionResponse(discussion));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// PUT /api/discussions/:id - update discussion metadata
router.put('/discussions/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const discussion = queries.getDiscussionById(req.params.id);
    if (!discussion) {
      res.status(404).json({ error: 'Discussion not found' });
      return;
    }

    const allowedFields = getAllowedDiscussionUpdateFields(discussion.status);
    if (!allowedFields) {
      res.status(409).json({ error: `Cannot edit a discussion while status is ${discussion.status}` });
      return;
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    const rawUpdates = pickDiscussionUpdates(req.body as Record<string, unknown>, allowedFields);
    if (Object.keys(rawUpdates).length === 0) {
      res.status(400).json({ error: 'No editable fields were provided' });
      return;
    }

    const mergedPayload = normalizeDiscussionPayload({
      title: discussion.title,
      description: discussion.description,
      agent_ids: parseDiscussionAgentIds(discussion.agent_ids),
      max_rounds: discussion.max_rounds,
      auto_implement: discussion.auto_implement === 1,
      implement_agent_id: discussion.implement_agent_id,
      ...rawUpdates,
    });

    const validationError = validateDiscussionPayload(mergedPayload);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const updates: Partial<Pick<queries.Discussion, 'title' | 'description' | 'max_rounds' | 'agent_ids' | 'auto_implement' | 'implement_agent_id'>> = {};

    if (rawUpdates.title !== undefined) {
      updates.title = mergedPayload.title;
    }
    if (rawUpdates.description !== undefined) {
      updates.description = mergedPayload.description;
    }
    if (rawUpdates.max_rounds !== undefined) {
      updates.max_rounds = mergedPayload.max_rounds;
    }
    if (rawUpdates.agent_ids !== undefined) {
      updates.agent_ids = JSON.stringify(mergedPayload.agent_ids);
    }
    if (rawUpdates.auto_implement !== undefined) {
      updates.auto_implement = mergedPayload.auto_implement ? 1 : 0;
    }
    if (rawUpdates.implement_agent_id !== undefined || (rawUpdates.auto_implement !== undefined && !mergedPayload.auto_implement)) {
      updates.implement_agent_id = mergedPayload.auto_implement ? mergedPayload.implement_agent_id : null;
    }

    const updated = queries.updateDiscussion(discussion.id, updates);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/discussions/:id - delete discussion
router.delete('/discussions/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const discussion = queries.getDiscussionById(req.params.id);
    if (!discussion) {
      res.status(404).json({ error: 'Discussion not found' });
      return;
    }

    if (discussion.status === 'running' && discussion.process_pid) {
      await discussionOrchestrator.stopDiscussion(discussion.id);
    }

    queries.deleteDiscussion(req.params.id);
    res.status(204).send();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/discussions/:id/start - start or resume discussion
router.post('/discussions/:id/start', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const discussion = queries.getDiscussionById(req.params.id);
    if (!discussion) {
      res.status(404).json({ error: 'Discussion not found' });
      return;
    }

    await discussionOrchestrator.startDiscussion(discussion.id);

    const updated = queries.getDiscussionById(discussion.id);
    res.json(buildDiscussionResponse(updated!));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/discussions/:id/stop - pause discussion
router.post('/discussions/:id/stop', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const discussion = queries.getDiscussionById(req.params.id);
    if (!discussion) {
      res.status(404).json({ error: 'Discussion not found' });
      return;
    }

    await discussionOrchestrator.stopDiscussion(discussion.id);

    const updated = queries.getDiscussionById(discussion.id);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/discussions/:id/inject - user injects message
router.post('/discussions/:id/inject', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const discussion = queries.getDiscussionById(req.params.id);
    if (!discussion) {
      res.status(404).json({ error: 'Discussion not found' });
      return;
    }

    const { content } = req.body;
    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const message = await discussionOrchestrator.injectUserMessage(discussion.id, content);
    res.status(201).json(message);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/discussions/:id/skip-turn - skip current agent turn
router.post('/discussions/:id/skip-turn', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const discussion = queries.getDiscussionById(req.params.id);
    if (!discussion) {
      res.status(404).json({ error: 'Discussion not found' });
      return;
    }

    await discussionOrchestrator.skipCurrentTurn(discussion.id);

    const updated = queries.getDiscussionById(discussion.id);
    res.json(buildDiscussionResponse(updated!));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/discussions/:id/implement - trigger implementation round
router.post('/discussions/:id/implement', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const discussion = queries.getDiscussionById(req.params.id);
    if (!discussion) {
      res.status(404).json({ error: 'Discussion not found' });
      return;
    }

    const { agent_id } = req.body;
    if (!agent_id) {
      res.status(400).json({ error: 'agent_id is required' });
      return;
    }

    await discussionOrchestrator.triggerImplementation(discussion.id, agent_id);

    const updated = queries.getDiscussionById(discussion.id);
    res.json(buildDiscussionResponse(updated!));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/discussions/:id/messages - get all messages
router.get('/discussions/:id/messages', (req: Request<{ id: string }>, res: Response) => {
  try {
    const discussion = queries.getDiscussionById(req.params.id);
    if (!discussion) {
      res.status(404).json({ error: 'Discussion not found' });
      return;
    }

    const messages = queries.getDiscussionMessages(discussion.id);
    res.json(messages);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/discussions/:id/logs - get logs (optional message_id filter)
router.get('/discussions/:id/logs', (req: Request<{ id: string }>, res: Response) => {
  try {
    const discussion = queries.getDiscussionById(req.params.id);
    if (!discussion) {
      res.status(404).json({ error: 'Discussion not found' });
      return;
    }

    const messageId = req.query.message_id as string | undefined;
    const logs = queries.getDiscussionLogs(discussion.id, messageId);
    res.json(logs);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/discussions/:id/merge - merge discussion branch
router.post('/discussions/:id/merge', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const discussion = queries.getDiscussionById(req.params.id);
    if (!discussion) {
      res.status(404).json({ error: 'Discussion not found' });
      return;
    }

    if (discussion.status !== 'completed') {
      res.status(400).json({ error: 'Can only merge completed discussions' });
      return;
    }

    if (!discussion.branch_name) {
      res.status(400).json({ error: 'Discussion has no branch to merge' });
      return;
    }

    const project = queries.getProjectById(discussion.project_id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const git = createGit(project.path);
    const defaultBranch = project.default_branch || 'main';

    await git.checkout(defaultBranch);

    try {
      const mergeResult = await git.merge([discussion.branch_name]);
      queries.updateDiscussionStatus(discussion.id, 'merged');

      if (discussion.worktree_path) {
        try {
          await worktreeManager.cleanupWorktree(project.path, discussion.worktree_path, discussion.branch_name);
          queries.updateDiscussion(discussion.id, { worktree_path: null, branch_name: null });
        } catch {
          // Non-fatal
        }
      }

      res.json({ success: true, result: mergeResult });
    } catch (mergeErr: unknown) {
      try {
        await git.merge(['--abort']);
      } catch {
        // May fail if no merge in progress
      }
      const errMsg = mergeErr instanceof Error ? mergeErr.message : 'Merge failed';
      res.status(409).json({ error: 'Merge conflict', details: errMsg });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/discussions/:id/diff - get git diff
router.get('/discussions/:id/diff', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const discussion = queries.getDiscussionById(req.params.id);
    if (!discussion) {
      res.status(404).json({ error: 'Discussion not found' });
      return;
    }

    if (!discussion.worktree_path) {
      res.status(404).json({ error: 'No worktree path for this discussion' });
      return;
    }

    if (!fs.existsSync(discussion.worktree_path)) {
      res.status(404).json({ error: 'Worktree directory no longer exists' });
      return;
    }

    const project = queries.getProjectById(discussion.project_id);
    const defaultBranch = project?.default_branch || 'main';

    const git = createGit(discussion.worktree_path);
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

// POST /api/discussions/:id/cleanup - remove worktree and branch
router.post('/discussions/:id/cleanup', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const discussion = queries.getDiscussionById(req.params.id);
    if (!discussion) {
      res.status(404).json({ error: 'Discussion not found' });
      return;
    }

    if (discussion.status === 'running') {
      res.status(400).json({ error: 'Cannot cleanup a running discussion. Stop it first.' });
      return;
    }

    const project = queries.getProjectById(discussion.project_id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const result = { worktreeRemoved: false, branchDeleted: false };

    if (discussion.worktree_path || discussion.branch_name) {
      const cleanup = await worktreeManager.cleanupWorktree(
        project.path,
        discussion.worktree_path || '',
        discussion.branch_name || ''
      );
      result.worktreeRemoved = cleanup.worktreeRemoved;
      result.branchDeleted = cleanup.branchDeleted;

      queries.updateDiscussion(discussion.id, { worktree_path: null, branch_name: null });
    }

    res.json({ success: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
