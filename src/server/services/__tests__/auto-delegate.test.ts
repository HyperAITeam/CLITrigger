import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../db/schema.js';

// We need to mock the connection module so queries use our in-memory DB
let testDb: Database.Database;

vi.mock('../../db/connection.js', () => ({
  getDatabase: () => testDb,
}));

// Import AFTER mock setup
const queries = await import('../../db/queries.js');
const { parseAutoDelegate, maybeCreateReviewTodo } = await import('../auto-delegate.js');

describe('Auto Delegate', () => {
  beforeEach(() => {
    testDb = new Database(':memory:');
    testDb.pragma('journal_mode = WAL');
    initDatabase(testDb);
  });

  afterEach(() => {
    testDb.close();
  });

  describe('parseAutoDelegate', () => {
    it('parses a valid rule', () => {
      expect(parseAutoDelegate('{"from":"claude","to":"codex"}')).toEqual({ from: 'claude', to: 'codex' });
    });

    it('returns null for null, malformed JSON, and invalid tools', () => {
      expect(parseAutoDelegate(null)).toBeNull();
      expect(parseAutoDelegate('not json')).toBeNull();
      expect(parseAutoDelegate('{"from":"claude"}')).toBeNull();
      expect(parseAutoDelegate('{"from":"raw-shell","to":"codex"}')).toBeNull();
      expect(parseAutoDelegate('{"from":"claude","to":"gpt"}')).toBeNull();
    });
  });

  describe('maybeCreateReviewTodo', () => {
    function createProjectWithRule(rule: string | null) {
      const project = queries.createProject('Test Project', '/tmp/test-project');
      return queries.updateProject(project.id, { auto_delegate: rule })!;
    }

    it('creates a review todo when the rule matches', () => {
      const project = createProjectWithRule('{"from":"claude","to":"codex"}');
      const parent = queries.createTodo(project.id, 'Add login', undefined, 2, 'claude', undefined, undefined, undefined, undefined, 1);

      const review = maybeCreateReviewTodo(project.id, parent.id);

      expect(review).not.toBeNull();
      expect(review!.title).toBe('Review: Add login');
      expect(review!.cli_tool).toBe('codex');
      expect(review!.depends_on).toBe(parent.id);
      expect(review!.delegated_from).toBe(parent.id);
      expect(review!.priority).toBe(2);
      expect(review!.use_worktree).toBe(1);
      expect(review!.status).toBe('pending');
      expect(review!.description).toContain(project.default_branch);
    });

    it('returns null when no rule is configured', () => {
      const project = createProjectWithRule(null);
      const parent = queries.createTodo(project.id, 'Task', undefined, 0, 'claude');
      expect(maybeCreateReviewTodo(project.id, parent.id)).toBeNull();
    });

    it('resolves the from-match via the project default cli_tool', () => {
      const project = createProjectWithRule('{"from":"claude","to":"codex"}');
      // parent has no cli_tool; project.cli_tool defaults to 'claude'
      const parent = queries.createTodo(project.id, 'Task');
      expect(maybeCreateReviewTodo(project.id, parent.id)).not.toBeNull();
    });

    it('returns null when the completed cli does not match from', () => {
      const project = createProjectWithRule('{"from":"claude","to":"codex"}');
      const parent = queries.createTodo(project.id, 'Task', undefined, 0, 'codex');
      expect(maybeCreateReviewTodo(project.id, parent.id)).toBeNull();
    });

    it('never delegates a delegated review todo (loop guard, covers from === to)', () => {
      const project = createProjectWithRule('{"from":"claude","to":"claude"}');
      const parent = queries.createTodo(project.id, 'Task', undefined, 0, 'claude');
      const review = maybeCreateReviewTodo(project.id, parent.id)!;
      expect(review).not.toBeNull();
      // The review todo itself completes → must not spawn another review
      expect(maybeCreateReviewTodo(project.id, review.id)).toBeNull();
    });

    it('does not create a second review for the same parent (retry dedupe)', () => {
      const project = createProjectWithRule('{"from":"claude","to":"codex"}');
      const parent = queries.createTodo(project.id, 'Task', undefined, 0, 'claude');
      expect(maybeCreateReviewTodo(project.id, parent.id)).not.toBeNull();
      expect(maybeCreateReviewTodo(project.id, parent.id)).toBeNull();
    });
  });
});
