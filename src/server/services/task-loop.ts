import { exec } from 'child_process';
import { promisify } from 'util';
import * as queries from '../db/queries.js';

const execAsync = promisify(exec);

export const LOOP_MAX_ROUNDS_LIMIT = 50;
const CHECK_TIMEOUT_MS = 10 * 60 * 1000;
const CHECK_OUTPUT_TAIL_CHARS = 4000;

/**
 * Per-todo loop rules, stored as JSON in todos.loop_config (null = loop off).
 * Done rules (check / donePhrase) end the loop as completed; stop rules
 * (maxCostUsd / stopWhenNoChanges / maxRounds) end it as failed.
 */
export interface LoopConfig {
  maxRounds: number;
  check?: string;
  donePhrase?: string;
  rules?: string;
  maxCostUsd?: number;
  stopWhenNoChanges?: boolean;
  resume?: boolean;
}

export type LoopStep =
  | { kind: 'done'; reason: string }
  | { kind: 'continue'; reason: string }
  | { kind: 'stop'; reason: string };

export interface LoopRoundFacts {
  round: number;
  /** Exit code of the check command; null when no check is configured. */
  checkExitCode: number | null;
  phraseFound: boolean;
  /** null when HEAD is not tracked (non-git project or rule disabled). */
  headChanged: boolean | null;
  totalCostUsd: number | null;
}

export interface CheckResult {
  exitCode: number;
  outputTail: string;
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= CHECK_OUTPUT_TAIL_CHARS ? trimmed : '…' + trimmed.slice(-CHECK_OUTPUT_TAIL_CHARS);
}

/** Parse and normalize a loop_config JSON string. Malformed input means loop off. */
export function parseLoopConfig(raw: string | null | undefined): LoopConfig | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;

  const maxRounds = Number(input.maxRounds);
  if (!Number.isFinite(maxRounds)) return null;
  const config: LoopConfig = {
    maxRounds: Math.min(LOOP_MAX_ROUNDS_LIMIT, Math.max(1, Math.floor(maxRounds))),
    // Absent means on; only an explicit false turns the stall guard off.
    stopWhenNoChanges: input.stopWhenNoChanges !== false,
  };

  const check = cleanString(input.check);
  if (check) config.check = check;
  const donePhrase = cleanString(input.donePhrase);
  if (donePhrase) config.donePhrase = donePhrase;
  const rules = cleanString(input.rules);
  if (rules) config.rules = rules;
  const maxCostUsd = Number(input.maxCostUsd);
  if (Number.isFinite(maxCostUsd) && maxCostUsd > 0) config.maxCostUsd = maxCostUsd;
  if (input.resume === true) config.resume = true;

  return config;
}

/** Decide what happens after a round exited successfully. */
export function decideNextLoopStep(config: LoopConfig, facts: LoopRoundFacts): LoopStep {
  const hasDoneRule = !!config.check || !!config.donePhrase;

  if (config.check && facts.checkExitCode === 0) {
    return { kind: 'done', reason: 'verification command passed' };
  }
  if (config.donePhrase && facts.phraseFound) {
    return { kind: 'done', reason: `done phrase "${config.donePhrase}" found in output` };
  }
  if (config.maxCostUsd !== undefined && facts.totalCostUsd !== null && facts.totalCostUsd >= config.maxCostUsd) {
    return { kind: 'stop', reason: `cost cap reached ($${facts.totalCostUsd.toFixed(2)} >= $${config.maxCostUsd})` };
  }
  if (config.stopWhenNoChanges && facts.headChanged === false) {
    return { kind: 'stop', reason: 'round produced no new commits' };
  }
  if (facts.round >= config.maxRounds) {
    return hasDoneRule
      ? { kind: 'stop', reason: `max rounds (${config.maxRounds}) reached without satisfying the done rule` }
      : { kind: 'done', reason: `all ${config.maxRounds} rounds completed` };
  }

  const reason = config.check
    ? `verification command exited with code ${facts.checkExitCode}`
    : config.donePhrase
      ? 'done phrase not found'
      : `round ${facts.round} of ${config.maxRounds} finished`;
  return { kind: 'continue', reason };
}

/** Appended to every round's prompt so the agent knows the loop contract. */
export function buildLoopRulesBlock(config: LoopConfig, round: number): string {
  const lines = [`This task runs in an automated loop (round ${round} of ${config.maxRounds}).`];
  if (config.check) {
    lines.push(`After each round the verification command \`${config.check}\` is run in the working directory; the loop ends when it exits 0.`);
  }
  if (config.donePhrase) {
    lines.push(`The loop also ends when your final message contains exactly: ${config.donePhrase}. Only say it when the task is truly complete.`);
  }
  if (!config.check && !config.donePhrase) {
    lines.push(`The loop runs for ${config.maxRounds} rounds; make meaningful progress each round.`);
  }
  lines.push('Commit your work before finishing each round so progress carries over to the next one.');
  if (config.rules) {
    lines.push('', 'Additional rules for every round:', config.rules);
  }
  return `\n\n<loop_rules>\n${lines.join('\n')}\n</loop_rules>`;
}

/**
 * Follow-up prompt for round N+1. Restates the original task so a fresh
 * context (resume off) has everything it needs; the loop rules block is
 * appended separately by the orchestrator like on every round.
 */
export function buildLoopFollowUp(taskBody: string, config: LoopConfig, nextRound: number, previousReason: string, check: CheckResult | null): string {
  let text = `Automated loop round ${nextRound} of ${config.maxRounds}. The original task:\n\n<user_task>\n${taskBody}\n</user_task>\n\nPrevious round result: ${previousReason}.`;
  if (check) {
    text += `\n\nVerification command \`${config.check}\` exited with code ${check.exitCode}. Output (tail):\n<check_output>\n${check.outputTail || '(no output)'}\n</check_output>`;
  }
  text += '\n\nReview the current state of the working tree (`git log`, `git diff`) and continue the task. Fix whatever still fails.';
  return text;
}

/** True when the agent's output in the latest round contains the phrase. */
export function findPhraseInLatestRound(todoId: string, phrase: string): boolean {
  const logs = queries.getTaskLogsByTodoId(todoId);
  if (logs.length === 0) return false;
  const latestRound = logs.reduce((max, log) => Math.max(max, log.round_number ?? 1), 1);
  return logs.some((log) =>
    (log.round_number ?? 1) === latestRound
    && (log.log_type === 'assistant' || log.log_type === 'output')
    && log.message.includes(phrase),
  );
}

/** Run the check command in cwd; never throws, a failure to run counts as a failed check. */
export async function runCheckCommand(command: string, cwd: string): Promise<CheckResult> {
  try {
    const { stdout, stderr } = await execAsync(command, { cwd, timeout: CHECK_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    return { exitCode: 0, outputTail: tail(`${stdout}\n${stderr}`) };
  } catch (err) {
    const error = err as { code?: number | string; killed?: boolean; stdout?: string; stderr?: string; message?: string };
    const exitCode = typeof error.code === 'number' ? error.code : 1;
    let output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`.trim() || error.message || '';
    if (error.killed) output += `\n(check command timed out after ${CHECK_TIMEOUT_MS / 60000} minutes)`;
    return { exitCode, outputTail: tail(output) };
  }
}
