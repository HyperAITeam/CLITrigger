process.env.DB_PATH = ':memory:';

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDatabase, closeDatabase } from '../../db/connection.js';
import { getSetting } from '../../db/app-settings.js';
import { migrateAllProjectWikis } from '../wiki-migration.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-migration-'));
const wikiDir = path.join(root, '.clitrigger', 'wiki');

afterAll(() => {
  closeDatabase();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('migrateAllProjectWikis', () => {
  it('writes missing node files once, keeps existing files, drops the old README', () => {
    const db = getDatabase();
    db.prepare(`INSERT INTO projects (id, name, path) VALUES ('p1', 'one', ?), ('p2', 'gone', ?)`)
      .run(root, path.join(root, 'missing-drive'));
    const node = db.prepare(`INSERT INTO memory_nodes (id, project_id, title, body, tags) VALUES (?, 'p1', ?, ?, ?)`);
    node.run('n1', '포트 함정', '3000 is taken', JSON.stringify(['GPU최적화', 'x']));
    node.run('n2', 'Untagged note', 'body', null);
    db.prepare(`INSERT INTO memory_edges (id, project_id, from_node_id, to_node_id, relation_type) VALUES ('e1', 'p1', 'n1', 'n2', 'related')`).run();

    fs.mkdirSync(path.join(wikiDir, '_untagged'), { recursive: true });
    fs.writeFileSync(path.join(wikiDir, '_untagged', 'untagged-note.md'), 'edited by hand');
    fs.writeFileSync(path.join(wikiDir, 'README.md'), '# Project Wiki (auto-generated)\n...');

    migrateAllProjectWikis();

    const written = fs.readFileSync(path.join(wikiDir, 'gpu최적화', '포트-함정.md'), 'utf-8');
    expect(written).toContain('tags: ["GPU최적화", "x"]');
    expect(written).toContain('    - to: "Untagged note"');
    expect(written).toContain('# 포트 함정\n\n3000 is taken');
    expect(fs.readFileSync(path.join(wikiDir, '_untagged', 'untagged-note.md'), 'utf-8')).toBe('edited by hand');
    expect(fs.existsSync(path.join(wikiDir, 'README.md'))).toBe(false);
    expect(getSetting('wiki.migrated.p1')).toBe('1');
    expect(getSetting('wiki.migrated.p2')).toBeNull();

    // Runs only once: a doc the user deletes afterwards is not brought back.
    fs.unlinkSync(path.join(wikiDir, 'gpu최적화', '포트-함정.md'));
    migrateAllProjectWikis();
    expect(fs.existsSync(path.join(wikiDir, 'gpu최적화', '포트-함정.md'))).toBe(false);
  });
});
