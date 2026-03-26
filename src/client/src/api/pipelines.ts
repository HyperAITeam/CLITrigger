import { get, post, del } from './client';
import type { Pipeline, PipelineWithPhases, PipelinePhase, PipelineLog, DiffResult } from '../types';

export function getPipelines(projectId: string): Promise<Pipeline[]> {
  return get(`/api/projects/${projectId}/pipelines`);
}

export function createPipeline(
  projectId: string,
  data: { title: string; description: string }
): Promise<Pipeline> {
  return post(`/api/projects/${projectId}/pipelines`, data);
}

export function getPipeline(id: string): Promise<PipelineWithPhases> {
  return get(`/api/pipelines/${id}`);
}

export function deletePipeline(id: string): Promise<void> {
  return del(`/api/pipelines/${id}`);
}

export function startPipeline(id: string): Promise<PipelineWithPhases> {
  return post(`/api/pipelines/${id}/start`);
}

export function stopPipeline(id: string): Promise<Pipeline> {
  return post(`/api/pipelines/${id}/stop`);
}

export function skipPhase(id: string): Promise<PipelineWithPhases> {
  return post(`/api/pipelines/${id}/skip-phase`);
}

export function retryPhase(id: string): Promise<PipelineWithPhases> {
  return post(`/api/pipelines/${id}/retry-phase`);
}

export function getPipelineLogs(id: string, phase?: string): Promise<PipelineLog[]> {
  const url = phase ? `/api/pipelines/${id}/logs?phase=${phase}` : `/api/pipelines/${id}/logs`;
  return get(url);
}

export function getPipelinePhases(id: string): Promise<PipelinePhase[]> {
  return get(`/api/pipelines/${id}/phases`);
}

export function mergePipeline(id: string): Promise<{ success: boolean; result?: unknown }> {
  return post(`/api/pipelines/${id}/merge`);
}

export function getPipelineDiff(id: string): Promise<DiffResult> {
  return get(`/api/pipelines/${id}/diff`);
}

export function cleanupPipeline(id: string): Promise<{ success: boolean; worktreeRemoved: boolean; branchDeleted: boolean }> {
  return post(`/api/pipelines/${id}/cleanup`);
}
