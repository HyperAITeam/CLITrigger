import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../schema.js';

// We need to mock the connection module so queries use our in-memory DB
let testDb: Database.Database;

vi.mock('../connection.js', () => ({
  getDatabase: () => testDb,
}));

// Import queries AFTER mock setup
const queries = await import('../queries.js');

describe('Database Queries', () => {
  beforeEach(() => {
    testDb = new Database(':memory:');
    testDb.pragma('journal_mode = WAL');
    initDatabase(testDb);
  });

  afterEach(() => {
    testDb.close();
  });

  // ── Projects ──

  describe('Projects', () => {
    it('should create a project', () => {
      const project = queries.createProject('Test Project', '/tmp/test-project');
      expect(project).toBeDefined();
      expect(project.id).toBeTruthy();
      expect(project.name).toBe('Test Project');
      expect(project.path).toBe('/tmp/test-project');
      expect(project.default_branch).toBe('main');
      expect(project.max_concurrent).toBe(3);
    });

    it('should create a project with custom default branch', () => {
      const project = queries.createProject('Test', '/tmp/test', 'develop');
      expect(project.default_branch).toBe('develop');
    });

    it('should get all projects', () => {
      queries.createProject('Project A', '/tmp/a');
      queries.createProject('Project B', '/tmp/b');
      const all = queries.getAllProjects();
      expect(all).toHaveLength(2);
    });

    it('should get project by id', () => {
      const created = queries.createProject('Test', '/tmp/test');
      const found = queries.getProjectById(created.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe('Test');
    });

    it('should return undefined for non-existent project', () => {
      const found = queries.getProjectById('non-existent-id');
      expect(found).toBeUndefined();
    });

    it('should update a project', () => {
      const project = queries.createProject('Old Name', '/tmp/test');
      const updated = queries.updateProject(project.id, { name: 'New Name', max_concurrent: 5 });
      expect(updated).toBeDefined();
      expect(updated!.name).toBe('New Name');
      expect(updated!.max_concurrent).toBe(5);
    });

    it('should return project unchanged when no updates provided', () => {
      const project = queries.createProject('Test', '/tmp/test');
      const same = queries.updateProject(project.id, {});
      expect(same!.name).toBe('Test');
    });

    it('should sync non-running todos and schedules that still match previous project CLI defaults', () => {
      const project = queries.createProject('Test', '/tmp/test-sync');
      queries.updateProject(project.id, { cli_tool: 'claude', claude_model: 'claude-opus-4-6' });

      const pendingTodo = queries.createTodo(project.id, 'Pending task', undefined, 0, 'claude', 'claude-opus-4-6');
      const runningTodo = queries.createTodo(project.id, 'Running task', undefined, 0, 'claude', 'claude-opus-4-6');
      const customTodo = queries.createTodo(project.id, 'Custom task', undefined, 0, 'codex', 'o3');
      queries.updateTodoStatus(runningTodo.id, 'running');

      const schedule = queries.createSchedule(project.id, 'Nightly', undefined, '0 0 * * *', 'claude', 'claude-opus-4-6');
      const customSchedule = queries.createSchedule(project.id, 'Custom', undefined, '0 1 * * *', 'codex', 'o3');

      const result = queries.syncProjectCliDefaults(
        project.id,
        'claude',
        'claude-opus-4-6',
        'gemini',
        'gemini-2.5-pro'
      );

      expect(result.updatedTodos).toBe(1);
      expect(result.updatedSchedules).toBe(1);

      expect(queries.getTodoById(pendingTodo.id)?.cli_tool).toBe('gemini');
      expect(queries.getTodoById(pendingTodo.id)?.cli_model).toBe('gemini-2.5-pro');
      expect(queries.getTodoById(runningTodo.id)?.cli_tool).toBe('claude');
      expect(queries.getTodoById(customTodo.id)?.cli_tool).toBe('codex');
      expect(queries.getScheduleById(schedule.id)?.cli_tool).toBe('gemini');
      expect(queries.getScheduleById(customSchedule.id)?.cli_tool).toBe('codex');
    });

    it('should delete a project', () => {
      const project = queries.createProject('Test', '/tmp/test');
      const deleted = queries.deleteProject(project.id);
      expect(deleted).toBe(true);
      expect(queries.getProjectById(project.id)).toBeUndefined();
    });

    it('should return false when deleting non-existent project', () => {
      const deleted = queries.deleteProject('non-existent');
      expect(deleted).toBe(false);
    });

    it('should enforce unique path constraint', () => {
      queries.createProject('A', '/tmp/unique');
      expect(() => queries.createProject('B', '/tmp/unique')).toThrow();
    });
  });

  // ── Todos ──

  describe('Todos', () => {
    let projectId: string;

    beforeEach(() => {
      const project = queries.createProject('Test Project', '/tmp/test-' + Date.now());
      projectId = project.id;
    });

    it('should create a todo', () => {
      const todo = queries.createTodo(projectId, 'Fix bug');
      expect(todo).toBeDefined();
      expect(todo.title).toBe('Fix bug');
      expect(todo.status).toBe('pending');
      expect(todo.priority).toBe(0);
      expect(todo.project_id).toBe(projectId);
    });

    it('should create a todo with description and priority', () => {
      const todo = queries.createTodo(projectId, 'Feature', 'Add login', 5);
      expect(todo.description).toBe('Add login');
      expect(todo.priority).toBe(5);
    });

    it('should get todos by project id', () => {
      queries.createTodo(projectId, 'Task 1');
      queries.createTodo(projectId, 'Task 2');
      const todos = queries.getTodosByProjectId(projectId);
      expect(todos).toHaveLength(2);
    });

    it('should get todo by id', () => {
      const created = queries.createTodo(projectId, 'Task');
      const found = queries.getTodoById(created.id);
      expect(found).toBeDefined();
      expect(found!.title).toBe('Task');
    });

    it('should update a todo', () => {
      const todo = queries.createTodo(projectId, 'Old Title');
      const updated = queries.updateTodo(todo.id, { title: 'New Title', priority: 10 });
      expect(updated!.title).toBe('New Title');
      expect(updated!.priority).toBe(10);
    });

    it('should update todo status', () => {
      const todo = queries.createTodo(projectId, 'Task');
      const updated = queries.updateTodoStatus(todo.id, 'running');
      expect(updated!.status).toBe('running');
    });

    it('should get todos by status', () => {
      queries.createTodo(projectId, 'Task 1');
      queries.createTodo(projectId, 'Task 2');
      const todo3 = queries.createTodo(projectId, 'Task 3');
      queries.updateTodoStatus(todo3.id, 'running');

      const pending = queries.getTodosByStatus('pending');
      expect(pending).toHaveLength(2);

      const running = queries.getTodosByStatus('running');
      expect(running).toHaveLength(1);
    });

    it('should delete a todo', () => {
      const todo = queries.createTodo(projectId, 'Task');
      expect(queries.deleteTodo(todo.id)).toBe(true);
      expect(queries.getTodoById(todo.id)).toBeUndefined();
    });

    it('should return false when deleting non-existent todo', () => {
      expect(queries.deleteTodo('non-existent')).toBe(false);
    });

    it('should cascade delete todos when project is deleted', () => {
      const todo = queries.createTodo(projectId, 'Task');
      queries.deleteProject(projectId);
      expect(queries.getTodoById(todo.id)).toBeUndefined();
    });
  });

  // ── Task Logs ──

  describe('Task Logs', () => {
    let todoId: string;

    beforeEach(() => {
      const project = queries.createProject('Test', '/tmp/log-test-' + Date.now());
      const todo = queries.createTodo(project.id, 'Task');
      todoId = todo.id;
    });

    it('should create a task log', () => {
      const log = queries.createTaskLog(todoId, 'output', 'Hello world');
      expect(log).toBeDefined();
      expect(log.todo_id).toBe(todoId);
      expect(log.log_type).toBe('output');
      expect(log.message).toBe('Hello world');
    });

    it('should get task logs by todo id', () => {
      queries.createTaskLog(todoId, 'output', 'Line 1');
      queries.createTaskLog(todoId, 'error', 'Line 2');
      queries.createTaskLog(todoId, 'commit', 'commit abc123');

      const logs = queries.getTaskLogsByTodoId(todoId);
      expect(logs).toHaveLength(3);
      expect(logs[0].log_type).toBe('output');
      expect(logs[2].log_type).toBe('commit');
    });

    it('should clean old logs', () => {
      queries.createTaskLog(todoId, 'output', 'Recent log');
      // Manually insert an old log
      const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      testDb.prepare(
        `INSERT INTO task_logs (id, todo_id, log_type, message, created_at) VALUES (?, ?, ?, ?, ?)`
      ).run('old-log-id', todoId, 'output', 'Old log', oldDate);

      const deleted = queries.cleanOldLogs(30);
      expect(deleted).toBe(1);

      const remaining = queries.getTaskLogsByTodoId(todoId);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].message).toBe('Recent log');
    });
  });
});
