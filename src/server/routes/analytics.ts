import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/connection.js';

const router = Router();

interface AnalyticsSummary {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  successRate: number;
  totalCostUsd: number;
  totalTokens: number;
  avgCostPerTask: number;
}

interface CliToolStats {
  cli_tool: string;
  count: number;
  completed: number;
  failed: number;
  successRate: number;
  totalCostUsd: number;
  totalTokens: number;
}

interface DailyStats {
  date: string;
  count: number;
  completed: number;
  failed: number;
  costUsd: number;
  tokens: number;
}

function getPeriodFilter(period: string): string {
  switch (period) {
    case '7d': return "AND t.created_at > datetime('now', '-7 days')";
    case '30d': return "AND t.created_at > datetime('now', '-30 days')";
    case '90d': return "AND t.created_at > datetime('now', '-90 days')";
    default: return '';
  }
}

// GET /api/projects/:id/analytics?period=7d|30d|90d|all
router.get('/projects/:id/analytics', (req: Request<{ id: string }>, res: Response) => {
  try {
    const db = getDatabase();
    const projectId = req.params.id;
    const period = (req.query.period as string) || 'all';
    const periodFilter = getPeriodFilter(period);

    // Summary stats
    const summaryRow = db.prepare(`
      SELECT
        COUNT(*) as totalTasks,
        SUM(CASE WHEN t.status = 'completed' OR t.status = 'merged' THEN 1 ELSE 0 END) as completedTasks,
        SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) as failedTasks,
        COALESCE(SUM(t.total_cost_usd), 0) as totalCostUsd,
        COALESCE(SUM(t.total_tokens), 0) as totalTokens
      FROM todos t
      WHERE t.project_id = ? AND t.status NOT IN ('pending') ${periodFilter}
    `).get(projectId) as any;

    const totalTasks = summaryRow?.totalTasks ?? 0;
    const completedTasks = summaryRow?.completedTasks ?? 0;
    const summary: AnalyticsSummary = {
      totalTasks,
      completedTasks,
      failedTasks: summaryRow?.failedTasks ?? 0,
      successRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 1000) / 10 : 0,
      totalCostUsd: Math.round((summaryRow?.totalCostUsd ?? 0) * 10000) / 10000,
      totalTokens: summaryRow?.totalTokens ?? 0,
      avgCostPerTask: totalTasks > 0 ? Math.round(((summaryRow?.totalCostUsd ?? 0) / totalTasks) * 10000) / 10000 : 0,
    };

    // By CLI tool
    const byCliTool = db.prepare(`
      SELECT
        COALESCE(t.cli_tool, 'unknown') as cli_tool,
        COUNT(*) as count,
        SUM(CASE WHEN t.status = 'completed' OR t.status = 'merged' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) as failed,
        COALESCE(SUM(t.total_cost_usd), 0) as totalCostUsd,
        COALESCE(SUM(t.total_tokens), 0) as totalTokens
      FROM todos t
      WHERE t.project_id = ? AND t.status NOT IN ('pending') ${periodFilter}
      GROUP BY COALESCE(t.cli_tool, 'unknown')
      ORDER BY count DESC
    `).all(projectId) as any[];

    const cliTools: CliToolStats[] = byCliTool.map((row: any) => ({
      cli_tool: row.cli_tool,
      count: row.count,
      completed: row.completed,
      failed: row.failed,
      successRate: row.count > 0 ? Math.round((row.completed / row.count) * 1000) / 10 : 0,
      totalCostUsd: Math.round((row.totalCostUsd ?? 0) * 10000) / 10000,
      totalTokens: row.totalTokens ?? 0,
    }));

    // By date (daily aggregation)
    const byDate = db.prepare(`
      SELECT
        date(t.created_at) as date,
        COUNT(*) as count,
        SUM(CASE WHEN t.status = 'completed' OR t.status = 'merged' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) as failed,
        COALESCE(SUM(t.total_cost_usd), 0) as costUsd,
        COALESCE(SUM(t.total_tokens), 0) as tokens
      FROM todos t
      WHERE t.project_id = ? AND t.status NOT IN ('pending') ${periodFilter}
      GROUP BY date(t.created_at)
      ORDER BY date ASC
    `).all(projectId) as any[];

    const daily: DailyStats[] = byDate.map((row: any) => ({
      date: row.date,
      count: row.count,
      completed: row.completed,
      failed: row.failed,
      costUsd: Math.round((row.costUsd ?? 0) * 10000) / 10000,
      tokens: row.tokens ?? 0,
    }));

    // By status breakdown
    const byStatus = db.prepare(`
      SELECT t.status, COUNT(*) as count
      FROM todos t
      WHERE t.project_id = ? AND t.status NOT IN ('pending') ${periodFilter}
      GROUP BY t.status
      ORDER BY count DESC
    `).all(projectId) as any[];

    res.json({ summary, byCliTool: cliTools, byDate: daily, byStatus });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch analytics';
    res.status(500).json({ error: message });
  }
});

export default router;
