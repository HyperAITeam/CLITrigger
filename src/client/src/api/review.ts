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
