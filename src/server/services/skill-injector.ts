import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GSTACK_SKILLS, type GstackSkillMeta } from '../resources/gstack-skills/skills-manifest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESOURCES_DIR = path.resolve(__dirname, '../resources/gstack-skills');

/**
 * Returns the list of all available gstack skills.
 */
export function getAvailableSkills(): GstackSkillMeta[] {
  return GSTACK_SKILLS;
}

/**
 * Parse the JSON-encoded skill IDs from DB column.
 * Returns empty array for null/invalid input.
 */
export function parseSkillConfig(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id: unknown) => typeof id === 'string');
  } catch {
    return [];
  }
}

/**
 * Inject selected gstack skill files into a target directory.
 * Creates .claude/skills/gstack-{id}/SKILL.md for each selected skill.
 * Also copies the gstack LICENSE file.
 */
export async function injectSkills(targetDir: string, skillIds: string[]): Promise<void> {
  if (skillIds.length === 0) return;

  const validIds = skillIds.filter((id) =>
    GSTACK_SKILLS.some((s) => s.id === id)
  );
  if (validIds.length === 0) return;

  const skillsDir = path.join(targetDir, '.claude', 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  // Copy LICENSE
  const licenseSrc = path.join(RESOURCES_DIR, 'LICENSE');
  const licenseDest = path.join(skillsDir, 'gstack-LICENSE');
  if (fs.existsSync(licenseSrc)) {
    fs.copyFileSync(licenseSrc, licenseDest);
  }

  // Copy each selected skill
  for (const id of validIds) {
    const srcFile = path.join(RESOURCES_DIR, id, 'SKILL.md');
    if (!fs.existsSync(srcFile)) continue;

    const destDir = path.join(skillsDir, `gstack-${id}`);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(srcFile, path.join(destDir, 'SKILL.md'));
  }
}
