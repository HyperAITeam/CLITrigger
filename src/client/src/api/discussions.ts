import { get, post, put, del } from './client';
import type { DiscussionAgent, Discussion, DiscussionMessage, DiscussionLog, DiscussionWithMessages, DiffResult } from '../types';

// ── Agents ──

export function getAgents(projectId: string): Promise<DiscussionAgent[]> {
  return get(`/api/projects/${projectId}/agents`);
}

export function createAgent(projectId: string, data: {
  name: string;
  role: string;
  system_prompt: string;
  cli_tool?: string;
  cli_model?: string;
  avatar_color?: string;
}): Promise<DiscussionAgent> {
  return post(`/api/projects/${projectId}/agents`, data);
}

export function updateAgent(id: string, data: Partial<{
  name: string;
  role: string;
  system_prompt: string;
  cli_tool: string | null;
  cli_model: string | null;
  avatar_color: string | null;
  sort_order: number;
}>): Promise<DiscussionAgent> {
  return put(`/api/agents/${id}`, data);
}

export function deleteAgent(id: string): Promise<void> {
  return del(`/api/agents/${id}`);
}

// ── Discussions ──

export function getDiscussions(projectId: string): Promise<Discussion[]> {
  return get(`/api/projects/${projectId}/discussions`);
}

export function createDiscussion(projectId: string, data: {
  title: string;
  description: string;
  agent_ids: string[];
  max_rounds?: number;
}): Promise<Discussion> {
  return post(`/api/projects/${projectId}/discussions`, data);
}

export function getDiscussion(id: string): Promise<DiscussionWithMessages> {
  return get(`/api/discussions/${id}`);
}

export function deleteDiscussion(id: string): Promise<void> {
  return del(`/api/discussions/${id}`);
}

export function startDiscussion(id: string): Promise<DiscussionWithMessages> {
  return post(`/api/discussions/${id}/start`);
}

export function stopDiscussion(id: string): Promise<Discussion> {
  return post(`/api/discussions/${id}/stop`);
}

export function injectMessage(id: string, content: string): Promise<DiscussionMessage> {
  return post(`/api/discussions/${id}/inject`, { content });
}

export function skipTurn(id: string): Promise<DiscussionWithMessages> {
  return post(`/api/discussions/${id}/skip-turn`);
}

export function triggerImplementation(id: string, agentId: string): Promise<DiscussionWithMessages> {
  return post(`/api/discussions/${id}/implement`, { agent_id: agentId });
}

export function getDiscussionMessages(id: string): Promise<DiscussionMessage[]> {
  return get(`/api/discussions/${id}/messages`);
}

export function getDiscussionLogs(id: string, messageId?: string): Promise<DiscussionLog[]> {
  const qs = messageId ? `?message_id=${messageId}` : '';
  return get(`/api/discussions/${id}/logs${qs}`);
}

export function mergeDiscussion(id: string): Promise<{ success: boolean }> {
  return post(`/api/discussions/${id}/merge`);
}

export function getDiscussionDiff(id: string): Promise<DiffResult> {
  return get(`/api/discussions/${id}/diff`);
}

export function cleanupDiscussion(id: string): Promise<{ success: boolean }> {
  return post(`/api/discussions/${id}/cleanup`);
}
