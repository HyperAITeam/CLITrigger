import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { scanVault, invalidateVaultRoot, setVaultRootWatched } from '../file-scanner.js';
import { affectsVaultScan } from '../vault-watcher.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-scan-cache-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function makeRoot(name: string): string {
  const root = path.join(tmp, name);
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'a.md'), '---\ntitle: Alpha\n---\nsee [[b]] #one');
  fs.writeFileSync(path.join(root, 'sub', 'b.md'), 'bee');
  fs.writeFileSync(path.join(root, 'sub', 'skip.txt'), 'not a doc');
  return root;
}

const titles = (files: { relativePath: string; title: string }[]) =>
  files.map((f) => `${f.relativePath}:${f.title}`).sort();

describe('scanVault cache', () => {
  it('parses docs async and returns sorted relative paths', async () => {
    const root = makeRoot('basic');
    const files = await scanVault(root);
    expect(files.map((f) => f.relativePath)).toEqual(['a.md', 'sub/b.md']);
    const a = files.find((f) => f.relativePath === 'a.md')!;
    expect(a).toMatchObject({ title: 'Alpha', tags: ['one'], wikilinks: ['b'], kind: 'md' });
  });

  it('reuses the root result only while watched, until invalidated', async () => {
    const root = makeRoot('watched');
    setVaultRootWatched(root, true);
    await scanVault(root);
    fs.writeFileSync(path.join(root, 'c.md'), 'new');
    expect(titles(await scanVault(root))).toEqual(['a.md:Alpha', 'sub/b.md:b']); // cached
    invalidateVaultRoot(root);
    expect(titles(await scanVault(root))).toContain('c.md:c');
    setVaultRootWatched(root, false);
    fs.writeFileSync(path.join(root, 'd.md'), 'unwatched');
    expect(titles(await scanVault(root))).toContain('d.md:d'); // unwatched → always rescans
  });

  it('re-parses only files whose mtime/size changed', async () => {
    const root = makeRoot('incremental');
    await scanVault(root);
    fs.writeFileSync(path.join(root, 'a.md'), '---\ntitle: Alpha two\n---\nchanged');
    const files = await scanVault(root);
    expect(files.find((f) => f.relativePath === 'a.md')!.title).toBe('Alpha two');
  });

  it('coalesces concurrent scans of one root and hands out independent copies', async () => {
    const root = makeRoot('flight');
    const [x, y] = await Promise.all([scanVault(root), scanVault(root)]);
    expect(titles(x)).toEqual(titles(y));
    x[0].tags = ['mutated'];
    expect((await scanVault(root))[0].tags).not.toEqual(['mutated']);
  });

  it('returns [] for a missing root', async () => {
    expect(await scanVault(path.join(tmp, 'nope'))).toEqual([]);
  });
});

describe('affectsVaultScan', () => {
  it('only docs, .vaultignore and extension-less paths drop the cache', () => {
    expect(affectsVaultScan(null)).toBe(true);
    expect(affectsVaultScan('docs/Guide.MD')).toBe(true);
    expect(affectsVaultScan('a/page.htm')).toBe(true);
    expect(affectsVaultScan('.vaultignore')).toBe(true);
    expect(affectsVaultScan('Engine/Source')).toBe(true);
    expect(affectsVaultScan('Intermediate/Build/x.obj')).toBe(false);
    expect(affectsVaultScan('Content/Map.uasset')).toBe(false);
  });
});
