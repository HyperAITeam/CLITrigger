import * as queries from '../db/queries.js';
import type { CliTool } from './cli-adapters.js';
import { runHeadless } from './headless-cli.js';

export interface ExtractedActionItem {
  title: string;
  description: string;
  priority: number;
}

const PROMPT_HEADER =
  'You will read a multi-agent design discussion and extract a clean list of action items that capture the agreed-upon work.\n\n' +
  'Output rules — read carefully:\n' +
  '- Respond with ONLY a JSON array, no prose, no code fences.\n' +
  '- Each element: { "title": string, "description": string, "priority": integer }\n' +
  '- title: <= 80 chars, imperative ("Add X", "Refactor Y"), language matches the discussion.\n' +
  '- description: 1–3 short sentences with the rationale or constraint from the discussion. Empty string if none.\n' +
  '- priority: 0 (low) | 1 (medium) | 2 (high) | 3 (urgent). Use the discussion\'s emphasis. Default 1 if unsure.\n' +
  '- 3–10 items. Merge duplicates. Drop pure questions or unresolved options.\n' +
  '- If the discussion has no actionable consensus, return [].\n\n' +
  '--- DISCUSSION TRANSCRIPT ---\n';

function buildTranscript(discussionId: string): string {
  const discussion = queries.getDiscussionById(discussionId);
  if (!discussion) throw new Error('Discussion not found');

  const messages = queries.getDiscussionMessages(discussionId).filter((m) => m.content && m.content.trim());
  if (messages.length === 0) {
    throw new Error('Discussion has no completed messages to extract from');
  }

  const lines: string[] = [];
  lines.push(`Topic: ${discussion.title}`);
  if (discussion.description) lines.push(`Brief: ${discussion.description}`);
  lines.push('');

  for (const m of messages) {
    lines.push(`[Round ${m.round_number}] ${m.agent_name} (${m.role}):`);
    lines.push(m.content!.trim());
    lines.push('');
  }
  return lines.join('\n');
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) return fenceMatch[1].trim();
  return trimmed;
}

function safeParseItems(raw: string): ExtractedActionItem[] {
  const cleaned = stripCodeFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return [];
    try { parsed = JSON.parse(arrayMatch[0]); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];

  const items: ExtractedActionItem[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const title = typeof e.title === 'string' ? e.title.trim() : '';
    if (!title) continue;
    const description = typeof e.description === 'string' ? e.description.trim() : '';
    let priority = typeof e.priority === 'number' ? Math.round(e.priority) : 1;
    if (priority < 0) priority = 0;
    if (priority > 3) priority = 3;
    items.push({ title: title.slice(0, 200), description, priority });
  }
  return items;
}

function resolveCliTool(value: unknown): CliTool {
  if (value === 'claude' || value === 'antigravity' || value === 'codex') return value;
  if (value) console.warn(`[discussion-extractor] Unknown cli_tool "${String(value)}", falling back to claude`);
  return 'claude';
}

export async function extractActionItems(discussionId: string): Promise<ExtractedActionItem[]> {
  const discussion = queries.getDiscussionById(discussionId);
  if (!discussion) throw new Error('Discussion not found');
  const project = queries.getProjectById(discussion.project_id);
  const cliTool = resolveCliTool(project?.cli_tool);

  const transcript = buildTranscript(discussionId);
  const prompt = PROMPT_HEADER + transcript;
  const raw = await runHeadless(cliTool, prompt, 120_000);
  return safeParseItems(raw);
}
