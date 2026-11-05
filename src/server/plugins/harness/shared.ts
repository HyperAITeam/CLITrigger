import { promises as fs } from 'fs';
import { safeJoin, exists, listSubdirectories, readJsonOrEmpty, readTextOrEmpty, atomicWriteJson, atomicWriteText } from './io.js';
import type { HarnessSkill } from './types.js';

// Skills: <base>/<name>/SKILL.md. Claude uses .claude/skills; Codex and
// Antigravity both read .agents/skills. A disabled skill is SKILL.md renamed to
// SKILL.md.disabled — every CLI only discovers the exact filename.

function skillPath(projectPath: string, base: string[], name: string): string {
  // safeJoin rejects names that escape the skills directory ("../" etc.).
  return safeJoin(projectPath, ...base, name, 'SKILL.md');
}

// Pull `description:` out of the SKILL.md frontmatter for list rendering.
// Best-effort: a missing/garbled frontmatter just yields no description.
function parseSkillDescription(content: string): string | undefined {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return undefined;
  const desc = fm[1].match(/^description:\s*(.+)$/m);
  return desc ? desc[1].trim() : undefined;
}

export async function readSkills(projectPath: string, base: string[]): Promise<HarnessSkill[]> {
  const names = await listSubdirectories(safeJoin(projectPath, ...base));
  const skills: HarnessSkill[] = [];
  for (const name of names) {
    const active = skillPath(projectPath, base, name);
    let filePath = active;
    let content = await readTextOrEmpty(active);
    if (!content) {
      filePath = `${active}.disabled`;
      content = await readTextOrEmpty(filePath);
    }
    if (!content) continue;
    skills.push({
      name,
      description: parseSkillDescription(content),
      path: filePath,
      content,
      enabled: filePath === active,
    });
  }
  return skills;
}

export async function writeSkill(projectPath: string, base: string[], name: string, content: string): Promise<void> {
  const active = skillPath(projectPath, base, name);
  // Editing a disabled skill must not silently re-enable it.
  const parked = `${active}.disabled`;
  const target = !(await exists(active)) && (await exists(parked)) ? parked : active;
  await atomicWriteText(target, content);
}

export async function toggleSkill(projectPath: string, base: string[], name: string, enabled: boolean): Promise<void> {
  const active = skillPath(projectPath, base, name);
  const parked = `${active}.disabled`;
  const [from, to] = enabled ? [parked, active] : [active, parked];
  if (await exists(from)) await fs.rename(from, to);
}

// Hooks in a JSON file's `hooks` key ({ Event: [entries] }) — Claude's
// settings.json and Codex's hooks.json share this shape. Neither has a
// per-entry off switch, so disabled entries are parked in a sibling
// hooks.disabled.json (same shape) that the CLI never reads.

type JsonWithHooks = { hooks?: Record<string, unknown>; [k: string]: unknown };

export async function writeHooksBlock(filePath: string, hooks: Record<string, unknown> | null): Promise<void> {
  const existing = await readJsonOrEmpty<JsonWithHooks>(filePath);
  // Replace the hooks block wholesale (a merge can't express deletions);
  // null removes the key entirely. The rest of the file is preserved.
  const next: JsonWithHooks = { ...existing };
  if (hooks === null) delete next.hooks;
  else next.hooks = hooks;
  await atomicWriteJson(filePath, next);
}

export async function toggleParkedHook(
  filePath: string,
  disabledPath: string,
  event: string,
  index: number,
  enabled: boolean,
): Promise<void> {
  const file = await readJsonOrEmpty<JsonWithHooks>(filePath);
  const hooks: Record<string, unknown> = { ...(file.hooks ?? {}) };
  const disabled = await readJsonOrEmpty<Record<string, unknown>>(disabledPath);

  const [from, to] = enabled ? [disabled, hooks] : [hooks, disabled];
  const source = Array.isArray(from[event]) ? [...(from[event] as unknown[])] : [];
  const [entry] = source.splice(index, 1);
  // Stale index (UI out of date): no-op; the caller re-reads the snapshot.
  if (entry === undefined) return;
  if (source.length > 0) from[event] = source;
  else delete from[event];
  to[event] = [...(Array.isArray(to[event]) ? (to[event] as unknown[]) : []), entry];

  const next: JsonWithHooks = { ...file };
  if (Object.keys(hooks).length > 0) next.hooks = hooks;
  else delete next.hooks;
  await atomicWriteJson(filePath, next);
  if (Object.keys(disabled).length > 0) await atomicWriteJson(disabledPath, disabled);
  else await fs.rm(disabledPath, { force: true });
}
