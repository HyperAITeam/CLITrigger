import cron, { type ScheduledTask } from 'node-cron';
import * as queries from '../db/queries.js';
import { orchestrator } from './orchestrator.js';
import { broadcaster } from '../websocket/broadcaster.js';

export class Scheduler {
  private jobs: Map<string, ScheduledTask> = new Map();

  /**
   * Initialize all active schedules on server startup.
   */
  initialize(): void {
    const activeSchedules = queries.getActiveSchedules();
    for (const schedule of activeSchedules) {
      this.registerJob(schedule);
    }
    if (activeSchedules.length > 0) {
      console.log(`Scheduler initialized: ${activeSchedules.length} active schedule(s)`);
    }
  }

  /**
   * Register a cron job for a schedule.
   */
  registerJob(schedule: queries.Schedule): void {
    // Unregister existing job if any
    this.unregisterJob(schedule.id);

    if (!cron.validate(schedule.cron_expression)) {
      console.error(`Invalid cron expression for schedule "${schedule.title}": ${schedule.cron_expression}`);
      return;
    }

    const task = cron.schedule(schedule.cron_expression, () => {
      this.executeSchedule(schedule.id).catch((err) => {
        console.error(`Schedule "${schedule.title}" execution error:`, err);
      });
    });

    this.jobs.set(schedule.id, task);
  }

  /**
   * Unregister a cron job.
   */
  unregisterJob(scheduleId: string): void {
    const job = this.jobs.get(scheduleId);
    if (job) {
      job.stop();
      this.jobs.delete(scheduleId);
    }
  }

  /**
   * Core execution logic — called by cron callback.
   */
  private async executeSchedule(scheduleId: string): Promise<void> {
    const schedule = queries.getScheduleById(scheduleId);
    if (!schedule || !schedule.is_active) return;

    const now = new Date().toISOString();

    // Check skip-if-running condition
    if (schedule.skip_if_running) {
      const scheduleTodos = queries.getTodosByScheduleId(scheduleId);
      const hasRunning = scheduleTodos.some((t) => t.status === 'running');
      if (hasRunning) {
        const run = queries.createScheduleRun(scheduleId, null, 'skipped', 'previous_run_still_active');
        broadcaster.broadcast({
          type: 'schedule:run-skipped',
          scheduleId,
          runId: run.id,
          reason: 'previous_run_still_active',
        });
        queries.updateScheduleLastRun(scheduleId, now);
        return;
      }
    }

    // Create todo from schedule template
    const timestamp = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const todoTitle = `[Schedule] ${schedule.title} - ${timestamp}`;
    const todo = queries.createTodo(
      schedule.project_id,
      todoTitle,
      schedule.description ?? undefined,
      0,
      schedule.cli_tool ?? undefined,
      schedule.cli_model ?? undefined,
      scheduleId,
    );

    // Create run record
    const run = queries.createScheduleRun(scheduleId, todo.id, 'triggered');

    // Update last run
    queries.updateScheduleLastRun(scheduleId, now);

    // Broadcast
    broadcaster.broadcast({
      type: 'schedule:run-triggered',
      scheduleId,
      runId: run.id,
      todoId: todo.id,
    });

    // Start the todo
    try {
      await orchestrator.startTodo(todo.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Schedule "${schedule.title}" failed to start todo: ${message}`);
      queries.updateScheduleRun(run.id, { status: 'failed', completed_at: new Date().toISOString() });
    }
  }

  /**
   * Manually trigger a schedule run (for testing / on-demand).
   */
  async triggerSchedule(scheduleId: string): Promise<queries.ScheduleRun | null> {
    const schedule = queries.getScheduleById(scheduleId);
    if (!schedule) return null;

    // Temporarily treat as active for manual trigger
    const origActive = schedule.is_active;
    if (!origActive) {
      // Allow manual trigger even if paused — just don't check is_active in executeSchedule
    }

    await this.executeSchedule(scheduleId);

    // Return the latest run
    const runs = queries.getScheduleRunsByScheduleId(scheduleId, 1);
    return runs[0] ?? null;
  }

  /**
   * Activate a schedule and register its cron job.
   */
  activateSchedule(scheduleId: string): queries.Schedule | undefined {
    const schedule = queries.updateScheduleStatus(scheduleId, 1);
    if (schedule) {
      this.registerJob(schedule);
      broadcaster.broadcast({ type: 'schedule:status-changed', scheduleId, isActive: true });
    }
    return schedule;
  }

  /**
   * Pause a schedule and unregister its cron job.
   */
  pauseSchedule(scheduleId: string): queries.Schedule | undefined {
    const schedule = queries.updateScheduleStatus(scheduleId, 0);
    if (schedule) {
      this.unregisterJob(scheduleId);
      broadcaster.broadcast({ type: 'schedule:status-changed', scheduleId, isActive: false });
    }
    return schedule;
  }

  /**
   * Stop all cron jobs (for server shutdown).
   */
  stopAll(): void {
    for (const [, job] of this.jobs) {
      job.stop();
    }
    this.jobs.clear();
  }
}

export const scheduler = new Scheduler();
