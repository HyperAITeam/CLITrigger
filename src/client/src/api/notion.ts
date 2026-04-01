import { get, post } from './client';
import type { NotionQueryResult } from '../types';

export function testConnection(projectId: string): Promise<{ ok: boolean; name: string; type: string }> {
  return get(`/api/notion/${projectId}/test`);
}

export function queryPages(projectId: string, params?: { startCursor?: string; search?: string; filter?: any }): Promise<NotionQueryResult> {
  return post(`/api/notion/${projectId}/pages`, params || {});
}

export function getPage(projectId: string, pageId: string): Promise<any> {
  return get(`/api/notion/${projectId}/page/${pageId}`);
}

export function getPageBlocks(projectId: string, pageId: string): Promise<{ results: any[] }> {
  return get(`/api/notion/${projectId}/page/${pageId}/blocks`);
}

export function updatePage(projectId: string, pageId: string, properties: Record<string, any>): Promise<any> {
  return post(`/api/notion/${projectId}/page/${pageId}/update`, { properties });
}

export function createPage(projectId: string, data: { title: string; properties?: Record<string, any> }): Promise<any> {
  return post(`/api/notion/${projectId}/create`, data);
}

export function importPage(projectId: string, pageId: string): Promise<{ title: string; description: string; pageId: string }> {
  return post(`/api/notion/${projectId}/import/${pageId}`);
}

export function getSchema(projectId: string): Promise<{ title: string; properties: Record<string, any> }> {
  return get(`/api/notion/${projectId}/schema`);
}
