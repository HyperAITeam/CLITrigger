import { get, post, put, del } from './client';
import type { Schedule, ScheduleRun } from '../types';

export function getSchedules(projectId: string): Promise<Schedule[]> {
  return get(`/api/projects/${projectId}/schedules`);
}

export function createSchedule(
  projectId: string,
  data: { title: string; description?: string; cron_expression?: string; cli_tool?: string; cli_model?: string; skip_if_running?: boolean; schedule_type?: string; run_at?: string }
): Promise<Schedule> {
  return post(`/api/projects/${projectId}/schedules`, data);
}

export function updateSchedule(
  id: string,
  data: { title?: string; description?: string; cron_expression?: string; cli_tool?: string; cli_model?: string; skip_if_running?: boolean; schedule_type?: string; run_at?: string }
): Promise<Schedule> {
  return put(`/api/schedules/${id}`, data);
}

export function scheduleFromTodo(todoId: string, runAt: string): Promise<Schedule> {
  return post(`/api/todos/${todoId}/schedule`, { run_at: runAt });
}

export function deleteSchedule(id: string): Promise<void> {
  return del(`/api/schedules/${id}`);
}

export function activateSchedule(id: string): Promise<Schedule> {
  return post(`/api/schedules/${id}/activate`);
}

export function pauseSchedule(id: string): Promise<Schedule> {
  return post(`/api/schedules/${id}/pause`);
}

export function getScheduleRuns(id: string): Promise<ScheduleRun[]> {
  return get(`/api/schedules/${id}/runs`);
}

export function triggerSchedule(id: string): Promise<ScheduleRun> {
  return post(`/api/schedules/${id}/trigger`);
}
