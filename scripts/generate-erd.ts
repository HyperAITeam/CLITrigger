#!/usr/bin/env tsx
/**
 * ERD generator.
 *
 * Parses src/server/db/schema.ts and writes a Mermaid erDiagram to docs/ERD.md.
 * Output is deterministic so `--check` can verify it against the committed file.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SCHEMA_PATH = join(ROOT, 'src/server/db/schema.ts');
const OUTPUT_PATH = join(ROOT, 'docs/ERD.md');

interface Column {
  name: string;
  type: string;
  isPK: boolean;
  isFK: boolean;
  notNull: boolean;
  unique: boolean;
  defaultValue?: string;
  references?: { table: string; column: string; onDelete?: string };
}

interface Table {
  name: string;
  columns: Column[];
  uniqueConstraints: string[][];
}

interface Migration {
  table: string;
  column: string;
  definition: string;
}

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out.filter(Boolean);
}

function parseColumnLine(line: string): Column | null {
  const match = /^(\w+)\s+([A-Z]+)\b(.*)$/i.exec(line);
  if (!match) return null;
  const [, name, type, rest] = match;

  const isPK = /\bPRIMARY\s+KEY\b/i.test(rest);
  const notNull = /\bNOT\s+NULL\b/i.test(rest);
  const unique = /\bUNIQUE\b/i.test(rest) && !/UNIQUE\s*\(/i.test(rest);

  let defaultValue: string | undefined;
  const defaultMatch = /\bDEFAULT\s+('[^']*'|"[^"]*"|\([^)]*\)|\S+)/i.exec(rest);
  if (defaultMatch) defaultValue = defaultMatch[1];

  let references: Column['references'];
  const refMatch = /\bREFERENCES\s+(\w+)\s*\(\s*(\w+)\s*\)(?:\s+ON\s+DELETE\s+([A-Z\s]+?)(?=\s*(?:$|REFERENCES|\bDEFAULT\b|,)))?/i.exec(
    rest
  );
  if (refMatch) {
    references = {
      table: refMatch[1],
      column: refMatch[2],
      onDelete: refMatch[3]?.trim().toUpperCase(),
    };
  }

  return {
    name,
    type: type.toUpperCase(),
    isPK,
    isFK: Boolean(references),
    notNull,
    unique,
    defaultValue,
    references,
  };
}

function parseUniqueLine(line: string): string[] | null {
  const match = /^UNIQUE\s*\(\s*([^)]+)\)/i.exec(line);
  if (!match) return null;
  return match[1].split(',').map((s) => s.trim());
}

function parseTable(name: string, body: string): Table {
  const entries = splitTopLevelCommas(body);
  const columns: Column[] = [];
  const uniqueConstraints: string[][] = [];

  for (const entry of entries) {
    const unique = parseUniqueLine(entry);
    if (unique) {
      uniqueConstraints.push(unique);
      continue;
    }
    const col = parseColumnLine(entry);
    if (col) columns.push(col);
  }

  return { name, columns, uniqueConstraints };
}

function extractSchemaSql(source: string): string {
  const execMatch = /db\.exec\(`([\s\S]*?)`\)/.exec(source);
  if (!execMatch) throw new Error('Could not find db.exec(`...`) block in schema.ts');
  return execMatch[1];
}

function parseTables(source: string): Table[] {
  const sql = extractSchemaSql(source);
  const tables: Table[] = [];
  const re = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)\s*\(([\s\S]*?)\);/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    tables.push(parseTable(m[1], m[2]));
  }
  return tables;
}

function parseMigrations(source: string): Migration[] {
  const arrMatch = /const\s+migrations\s*=\s*\[([\s\S]*?)\];/.exec(source);
  if (!arrMatch) return [];
  const body = arrMatch[1];
  const entries: Migration[] = [];
  const re =
    /\{\s*table:\s*'([^']+)'\s*,\s*column:\s*'([^']+)'\s*,\s*definition:\s*(['"])((?:\\.|(?!\3).)*)\3\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    entries.push({ table: m[1], column: m[2], definition: m[4] });
  }
  return entries;
}

function mergeMigrations(tables: Table[], migrations: Migration[]): void {
  const byName = new Map(tables.map((t) => [t.name, t]));
  for (const mig of migrations) {
    const table = byName.get(mig.table);
    if (!table) continue;
    if (table.columns.some((c) => c.name === mig.column)) continue;
    const synthetic = parseColumnLine(`${mig.column} ${mig.definition}`);
    if (synthetic) table.columns.push(synthetic);
  }
}

function relationArrow(onDelete?: string): string {
  if (onDelete === 'SET NULL') return '|o--o{';
  return '||--o{';
}

function renderMermaid(tables: Table[]): string {
  const lines: string[] = ['erDiagram'];

  for (const t of tables) {
    for (const col of t.columns) {
      if (!col.references) continue;
      const arrow = relationArrow(col.references.onDelete);
      lines.push(`    ${col.references.table} ${arrow} ${t.name} : "${col.name}"`);
    }
  }

  lines.push('');

  for (const t of tables) {
    lines.push(`    ${t.name} {`);
    for (const col of t.columns) {
      const marks: string[] = [];
      if (col.isPK) marks.push('PK');
      else if (col.isFK) marks.push('FK');
      if (col.unique && !col.isPK) marks.push('UK');
      const suffix = marks.length ? ' ' + marks.join(',') : '';
      lines.push(`        ${col.type} ${col.name}${suffix}`);
    }
    lines.push('    }');
  }

  return lines.join('\n');
}

function renderDoc(tables: Table[], mermaid: string): string {
  const tableCount = tables.length;
  const columnCount = tables.reduce((sum, t) => sum + t.columns.length, 0);
  const fkCount = tables.reduce(
    (sum, t) => sum + t.columns.filter((c) => c.isFK).length,
    0
  );

  return `# Database ERD

<!-- AUTO-GENERATED FROM src/server/db/schema.ts — DO NOT EDIT MANUALLY -->
<!-- To regenerate: npm run docs:erd -->
<!-- CI verifies this file is in sync: npm run docs:erd:check -->

Source: \`src/server/db/schema.ts\`
Stats: ${tableCount} tables, ${columnCount} columns, ${fkCount} foreign keys

## Diagram

\`\`\`mermaid
${mermaid}
\`\`\`

## Domain Groupings

- **Todo Execution**: \`projects\` → \`todos\` → \`task_logs\`
- **Scheduling**: \`projects\` → \`schedules\` → \`schedule_runs\` → \`todos\`
- **Discussion**: \`projects\` → \`discussion_agents\` / \`discussions\` → \`discussion_messages\` / \`discussion_logs\`
- **Session**: \`projects\` → \`sessions\` → \`session_logs\`
- **Planner**: \`projects\` → \`planner_items\` / \`planner_tags\`
- **Plugin Config**: \`projects\` → \`plugin_configs\` (implicit FK, see notes)
- **CLI Registry**: \`cli_models\`, \`cli_versions\` (standalone)

## Notes

- \`plugin_configs.project_id\` has no SQL \`REFERENCES\` declaration but conceptually points to \`projects.id\`. It is a generic key-value table used by the plugin system.
- Relationships: \`||--o{\` = parent required (ON DELETE CASCADE), \`|o--o{\` = parent optional (ON DELETE SET NULL).
- Columns added via \`ALTER TABLE\` migrations in \`schema.ts\` are merged into their parent tables in declaration order.
- Composite \`UNIQUE(...)\` constraints are omitted from the diagram; see \`schema.ts\` for the full definition.
`;
}

function generate(): string {
  const source = readFileSync(SCHEMA_PATH, 'utf8');
  const tables = parseTables(source);
  const migrations = parseMigrations(source);
  mergeMigrations(tables, migrations);
  const mermaid = renderMermaid(tables);
  return renderDoc(tables, mermaid);
}

function main(): void {
  const check = process.argv.includes('--check');
  const generated = generate();

  if (check) {
    let existing: string;
    try {
      existing = readFileSync(OUTPUT_PATH, 'utf8');
    } catch {
      console.error(`ERD file missing: ${OUTPUT_PATH}`);
      console.error('Run: npm run docs:erd');
      process.exit(1);
    }
    if (existing !== generated) {
      console.error('docs/ERD.md is out of sync with src/server/db/schema.ts');
      console.error('Run: npm run docs:erd (and commit the result)');
      process.exit(1);
    }
    console.log('docs/ERD.md is up to date.');
    return;
  }

  writeFileSync(OUTPUT_PATH, generated);
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
