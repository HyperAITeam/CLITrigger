process.env.DB_PATH = ':memory:';

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { getDatabase, closeDatabase } = await import('../../db/connection.js');
const queries = await import('../../db/queries.js');
const {
  resolveVaultPath, scanProjectVault, normalizeVaultLinks, getProjectVaultTags, setVaultPathTags, moveVaultPathTags,
} = await import('../vault-roots.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-roots-'));
const projA = path.join(tmp, 'a');
const projB = path.join(tmp, 'b');
const shared = path.join(tmp, 'shared');
for (const dir of [projA, projB, shared]) fs.mkdirSync(dir);
fs.writeFileSync(path.join(projA, 'own.md'), 'see [[spec]]');
fs.writeFileSync(path.join(shared, 'spec.md'), 'shared spec');
fs.writeFileSync(path.join(shared, 'secret.md'), 'hidden');
fs.writeFileSync(path.join(shared, '.vaultignore'), '/secret.md\n');

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function linkProject(id: string, root: string, alias: string) {
  getDatabase().prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)').run(id, id, root);
  const project = queries.getProjectById(id)!;
  const normalized = normalizeVaultLinks(JSON.stringify([{ alias, path: shared }]), project);
  if ('error' in normalized) throw new Error(normalized.error);
  return queries.updateProject(id, { vault_links: normalized.value })!;
}

describe('linked doc folders', () => {
  const a = linkProject('pa', projA, 'team');
  const b = linkProject('pb', projB, 'docs');

  it('resolves @alias paths into the linked folder and refuses escapes', () => {
    expect(resolveVaultPath(a, '@team/spec.md')!.abs).toBe(fs.realpathSync.native(path.join(shared, 'spec.md')));
    expect(resolveVaultPath(a, '@team')!.rel).toBe('');
    expect(resolveVaultPath(a, '@team/../a/own.md')).toBeNull();
    expect(resolveVaultPath(a, '@other/x.md')!.root).toBe(path.resolve(projA));
  });

  it('scans linked docs under @alias with the folder\'s own .vaultignore', async () => {
    expect((await scanProjectVault(a)).map((f) => f.relativePath).sort()).toEqual(['@team/spec.md', 'own.md']);
  });

  it('shares app tags between every project linking the folder', () => {
    setVaultPathTags(a, '@team/spec.md', ['api']);
    expect(getProjectVaultTags(b).files).toEqual({ '@docs/spec.md': ['api'] });
    moveVaultPathTags(b, '@docs/spec.md', '@docs/spec2.md');
    expect(getProjectVaultTags(a).files).toEqual({ '@team/spec2.md': ['api'] });
    expect(queries.getVaultTags('pa').files).toEqual({});
  });

  it('validates links: overlap, duplicate alias, missing folder; stored links skip the disk', () => {
    const err = (raw: unknown) => {
      const r = normalizeVaultLinks(JSON.stringify(raw), a);
      return 'error' in r ? r.error : null;
    };
    expect(err([{ alias: 'x', path: path.join(projA, 'sub') }])).toMatch(/not found/);
    expect(err([{ alias: 'x', path: tmp }])).toMatch(/overlaps/);
    expect(err([{ alias: 'x', path: shared }, { alias: 'X', path: shared }])).toMatch(/Duplicate/);
    expect(err([{ alias: 'a/b', path: shared }])).toMatch(/Invalid alias/);
    const stored = JSON.parse(a.vault_links!);
    expect(normalizeVaultLinks(JSON.stringify(stored), { ...a, path: path.join(tmp, 'missing') })).toEqual({ value: a.vault_links });
  });
});
