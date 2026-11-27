import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isRealpathWithinRoot } from './path-safety.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'path-safety-'));
const root = path.join(tmp, 'root');
const outside = path.join(tmp, 'outside');
fs.mkdirSync(root);
fs.mkdirSync(outside);
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Creating symlinks needs Developer Mode / admin on Windows — skip there if denied.
function trySymlink(target: string, link: string): boolean {
  try { fs.symlinkSync(target, link, 'file'); return true; } catch { return false; }
}

describe('isRealpathWithinRoot', () => {
  it('allows existing and not-yet-created paths inside the root', () => {
    fs.writeFileSync(path.join(root, 'a.md'), 'a');
    expect(isRealpathWithinRoot(root, path.join(root, 'a.md'))).toBe(true);
    expect(isRealpathWithinRoot(root, path.join(root, 'new', 'b.md'))).toBe(true);
  });

  it('refuses a dangling symlink pointing outside the root', () => {
    const link = path.join(root, 'x.md');
    if (!trySymlink(path.join(outside, 'not-yet.md'), link)) return;
    expect(isRealpathWithinRoot(root, link)).toBe(false);
  });

  it('refuses a live symlink pointing outside the root', () => {
    fs.writeFileSync(path.join(outside, 'secret.md'), 's');
    const link = path.join(root, 'y.md');
    if (!trySymlink(path.join(outside, 'secret.md'), link)) return;
    expect(isRealpathWithinRoot(root, link)).toBe(false);
  });
});
