import { get } from './client';

export interface AnalyticsSummary {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  successRate: number;
  totalCostUsd: number;
  totalTokens: number;
  avgCostPerTask: number;
}

export interface CliToolStats {
  cli_tool: string;
  count: number;
  completed: number;
  failed: number;
  successRate: number;
  totalCostUsd: number;
  totalTokens: number;
}

export interface DailyStats {
  date: string;
  count: number;
  completed: number;
  failed: number;
  costUsd: number;
  tokens: number;
}

export interface StatusCount {
  status: string;
  count: number;
}

export interface AnalyticsData {
  summary: AnalyticsSummary;
  byCliTool: CliToolStats[];
  byDate: DailyStats[];
  byStatus: StatusCount[];
}

export function getAnalytics(projectId: string, period: string = 'all'): Promise<AnalyticsData> {
  return get(`/api/projects/${projectId}/analytics?period=${period}`);
}
