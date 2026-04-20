import { get, post, put, del } from './client';
import type { PlannerItem, PlannerTag, Todo, Schedule, ImageMeta } from '../types';

export function getPlannerItems(projectId: string): Promise<PlannerItem[]> {
  return get(`/api/projects/${projectId}/planner`);
}

export function getPlannerTags(projectId: string): Promise<PlannerTag[]> {
  return get(`/api/projects/${projectId}/planner/tags`);
}

export function updatePlannerTag(
  projectId: string, name: string, data: { color?: string; new_name?: string }
): Promise<PlannerTag[]> {
  return put(`/api/projects/${projectId}/planner/tags/${encodeURIComponent(name)}`, data);
}

export function deletePlannerTag(projectId: string, name: string): Promise<void> {
  return del(`/api/projects/${projectId}/planner/tags/${encodeURIComponent(name)}`);
}

export function createPlannerItem(
  projectId: string,
  data: { title: string; description?: string; tags?: string; due_date?: string; priority?: number }
): Promise<PlannerItem> {
  return post(`/api/projects/${projectId}/planner`, data);
}

export function updatePlannerItem(
  id: string,
  data: { title?: string; description?: string; tags?: string; due_date?: string; status?: string; priority?: number }
): Promise<PlannerItem> {
  return put(`/api/planner/${id}`, data);
}

export function deletePlannerItem(id: string): Promise<void> {
  return del(`/api/planner/${id}`);
}

export function convertToTodo(
  id: string,
  data: { cli_tool?: string; cli_model?: string; max_turns?: number }
): Promise<{ plannerItem: PlannerItem; todo: Todo }> {
  return post(`/api/planner/${id}/convert-to-todo`, data);
}

export function uploadPlannerImages(id: string, images: Array<{ name: string; data: string }>): Promise<{ images: ImageMeta[] }> {
  return post(`/api/planner/${id}/images`, { images });
}

export function deletePlannerImage(plannerItemId: string, imageId: string): Promise<void> {
  return del(`/api/planner/${plannerItemId}/images/${imageId}`);
}

export function getPlannerImageUrl(plannerItemId: string, imageId: string): string {
  return `/api/planner/${plannerItemId}/images/${imageId}`;
}

export function convertToSchedule(
  id: string,
  data: { cron_expression?: string; schedule_type: 'recurring' | 'once'; run_at?: string; cli_tool?: string; cli_model?: string }
): Promise<{ plannerItem: PlannerItem; schedule: Schedule }> {
  return post(`/api/planner/${id}/convert-to-schedule`, data);
}

export interface PlannerExportItem {
  title: string;
  description: string | null;
  tags: string[];
  due_date: string | null;
  status: string;
  priority: number;
}

export interface PlannerExportPayload {
  version: number;
  exported_at: string;
  project_name: string;
  items: PlannerExportItem[];
  tags: Array<{ name: string; color: string }>;
}

export async function exportPlanner(projectId: string): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`/api/projects/${projectId}/planner/export`, { credentials: 'include' });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let message = text;
    try { const json = JSON.parse(text); if (json.error) message = json.error; } catch { /* not JSON */ }
    throw new Error(message || 'Export failed');
  }

  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match ? match[1] : `planner-${projectId}.json`;
  const blob = await res.blob();
  return { blob, filename };
}

export function importPlanner(
  projectId: string,
  payload: PlannerExportPayload
): Promise<{ imported_items: number; imported_tags: number }> {
  return post(`/api/projects/${projectId}/planner/import`, payload);
}
