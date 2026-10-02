import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../db/schema.js';

let testDb: Database.Database;

vi.mock('../../db/connection.js', () => ({
  getDatabase: () => testDb,
}));

const queries = await import('../../db/queries.js');
const { parseLoopConfig, decideNextLoopStep, buildLoopFollowUp, buildLoopRulesBlock, findPhraseInLatestRound, runCheckCommand } = await import('../task-loop.js');

const baseFacts = { round: 1, checkExitCode: null, phraseFound: false, headChanged: null, totalCostUsd: null };

describe('Task Loop', () => {
  describe('parseLoopConfig', () => {
    it('normalizes a full config and clamps maxRounds', () => {
      expect(parseLoopConfig('{"maxRounds":999,"check":" npm test ","donePhrase":"","rules":"one thing at a time","maxCostUsd":"2.5","stopWhenNoChanges":false,"resume":true}')).toEqual({
        maxRounds: 50,
        check: 'npm test',
        rules: 'one thing at a time',
        maxCostUsd: 2.5,
        stopWhenNoChanges: false,
        resume: true,
      });
      expect(parseLoopConfig('{"maxRounds":0}')).toEqual({ maxRounds: 1, stopWhenNoChanges: true });
    });

    it('returns null for null, malformed JSON, and missing maxRounds', () => {
      expect(parseLoopConfig(null)).toBeNull();
      expect(parseLoopConfig('not json')).toBeNull();
      expect(parseLoopConfig('{"check":"npm test"}')).toBeNull();
      expect(parseLoopConfig('[1]')).toBeNull();
    });
  });

  describe('decideNextLoopStep', () => {
    const withCheck = { maxRounds: 3, check: 'npm test', stopWhenNoChanges: true };

    it('is done when the check passes or the phrase is found', () => {
      expect(decideNextLoopStep(withCheck, { ...baseFacts, checkExitCode: 0 }).kind).toBe('done');
      expect(decideNextLoopStep({ maxRounds: 3, donePhrase: 'DONE' }, { ...baseFacts, phraseFound: true }).kind).toBe('done');
    });

    it('continues while the check fails and rounds remain', () => {
      const step = decideNextLoopStep(withCheck, { ...baseFacts, checkExitCode: 1, headChanged: true });
      expect(step.kind).toBe('continue');
      expect(step.reason).toContain('code 1');
    });

    it('stops on cost cap, stall, and exhausted rounds with a done rule', () => {
      expect(decideNextLoopStep({ ...withCheck, maxCostUsd: 1 }, { ...baseFacts, checkExitCode: 1, totalCostUsd: 1.2 }).kind).toBe('stop');
      expect(decideNextLoopStep(withCheck, { ...baseFacts, checkExitCode: 1, headChanged: false }).kind).toBe('stop');
      expect(decideNextLoopStep(withCheck, { ...baseFacts, round: 3, checkExitCode: 1, headChanged: true }).kind).toBe('stop');
    });

    it('treats a loop without done rules as "run N rounds"', () => {
      const plain = { maxRounds: 2, stopWhenNoChanges: false };
      expect(decideNextLoopStep(plain, { ...baseFacts, round: 1 }).kind).toBe('continue');
      expect(decideNextLoopStep(plain, { ...baseFacts, round: 2 }).kind).toBe('done');
    });
  });

  describe('prompt builders', () => {
    it('follow-up restates the task and includes check output', () => {
      const text = buildLoopFollowUp('Make tests pass', { maxRounds: 5, check: 'npm test' }, 2, 'verification command exited with code 1', { exitCode: 1, outputTail: '3 failing' });
      expect(text).toContain('round 2 of 5');
      expect(text).toContain('<user_task>\nMake tests pass\n</user_task>');
      expect(text).toContain('<check_output>\n3 failing\n</check_output>');
    });

    it('rules block carries the user rules and done phrase', () => {
      const block = buildLoopRulesBlock({ maxRounds: 4, donePhrase: '<promise>DONE</promise>', rules: 'never touch src/legacy' }, 3);
      expect(block).toContain('round 3 of 4');
      expect(block).toContain('<promise>DONE</promise>');
      expect(block).toContain('never touch src/legacy');
    });
  });

  describe('findPhraseInLatestRound', () => {
    beforeEach(() => {
      testDb = new Database(':memory:');
      testDb.pragma('journal_mode = WAL');
      initDatabase(testDb);
    });

    afterEach(() => {
      testDb.close();
    });

    it('only matches agent output of the latest round, never the prompt', () => {
      const project = queries.createProject('Test Project', '/tmp/test-project');
      const todo = queries.createTodo(project.id, 'Task');
      queries.createTaskLog(todo.id, 'assistant', 'DONE', 1);
      queries.createTaskLog(todo.id, 'prompt', 'say DONE when finished', 2);
      queries.createTaskLog(todo.id, 'assistant', 'still working', 2);
      expect(findPhraseInLatestRound(todo.id, 'DONE')).toBe(false);

      queries.createTaskLog(todo.id, 'assistant', 'all good. DONE', 2);
      expect(findPhraseInLatestRound(todo.id, 'DONE')).toBe(true);
    });
  });

  describe('runCheckCommand', () => {
    it('reports exit codes without throwing', async () => {
      const ok = await runCheckCommand('node -e "process.exit(0)"', process.cwd());
      expect(ok.exitCode).toBe(0);
      const failing = await runCheckCommand('node -e "console.log(\'nope\'); process.exit(3)"', process.cwd());
      expect(failing.exitCode).toBe(3);
      expect(failing.outputTail).toContain('nope');
    });
  });
});
