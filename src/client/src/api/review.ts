import { get } from './client';
import type { ReviewQueueResponse, ReviewSummary } from '../types';

export interface ReviewQuery {
  hours?: number;
  statuses?: string[];
}

function buildQuery(query: ReviewQuery): string {
  const params = new URLSearchParams();
  if (query.hours !== undefined) params.set('hours', String(query.hours));
  if (query.statuses && query.statuses.length > 0) params.set('statuses', query.statuses.join(','));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function getReviewQueue(query: ReviewQuery = {}): Promise<ReviewQueueResponse> {
  return get(`/api/review/queue${buildQuery(query)}`);
}

export function getReviewSummary(query: ReviewQuery = {}): Promise<ReviewSummary> {
  return get(`/api/review/summary${buildQuery(query)}`);
}

export interface ReviewDiffFile {
  path: string;
  insertions: number;
  deletions: number;
  binary: boolean;
  status: string;
}

export type ReviewDiffReason = 'todo-not-found' | 'no-branch' | 'branch-missing';

export type ReviewDiffResponse =
  | { available: true; files: ReviewDiffFile[]; defaultBranch: string }
  | { available: false; reason: ReviewDiffReason };

export type ReviewFileDiffResponse =
  | { available: true; diff: string }
  | { available: false; reason: ReviewDiffReason };

export function getReviewDiff(todoId: string): Promise<ReviewDiffResponse> {
  return get(`/api/review/diff/${encodeURIComponent(todoId)}`);
}

export function getReviewFileDiff(todoId: string, path: string): Promise<ReviewFileDiffResponse> {
  return get(`/api/review/diff/${encodeURIComponent(todoId)}/file?path=${encodeURIComponent(path)}`);
}
