import { describe, it, expect, vi } from 'vitest';

const STATUS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<status>
<target path="C:/wc">
<entry path="C:/wc/src/plain.ts">
<wc-status item="modified" props="none" revision="10">
</wc-status>
</entry>
<entry path="C:/wc/new.txt">
<wc-status item="unversioned" props="none">
</wc-status>
</entry>
</target>
<changelist name="ui&amp;fix">
<entry path="C:/wc/src/App.tsx">
<wc-status item="modified" props="none" revision="10">
</wc-status>
</entry>
</changelist>
</status>`;

const INFO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<info>
<entry revision="10" path=".">
<url>https://example.com/svn/repo/trunk</url>
<relative-url>^/trunk</relative-url>
<repository><root>https://example.com/svn/repo</root></repository>
</entry>
</info>`;

const UPDATE_STDOUT = [
  "Updating 'C:/wc':",
  'U    C:/wc/src/plain.ts',
  'C    C:/wc/src/충돌.c',
  ' C   C:/wc/props-conflict.txt',
  '   C C:/wc/tree-dir',
  'G    C:/wc/merged.txt',
  'Updated to revision 42.',
  'Summary of conflicts:',
  '  Text conflicts: 1',
].join('\n');

vi.mock('../../lib/svn.js', () => ({
  runSvn: vi.fn(async (args: string[]) => {
    if (args[0] === 'status') return { stdout: STATUS_XML, stderr: '' };
    if (args[0] === 'info') return { stdout: INFO_XML, stderr: '' };
    if (args[0] === 'update') return { stdout: UPDATE_STDOUT, stderr: '' };
    return { stdout: '', stderr: '' };
  }),
  isSvnRepository: vi.fn(async () => true),
}));

import { svnManager } from '../svn-manager.js';

describe('svnManager.getStatus changelist parsing', () => {
  it('attaches the changelist name to member files and leaves others without one', async () => {
    const status = await svnManager.getStatus('C:/wc');
    const byPath = new Map(status.files.map((f) => [f.path, f]));

    // Member of <changelist name="ui&amp;fix"> — name captured and unescaped.
    expect(byPath.get('src/App.tsx')?.changelist).toBe('ui&fix');
    // Plain <target> entries carry no changelist.
    expect(byPath.get('src/plain.ts')?.working_dir).toBe('M');
    expect(byPath.get('src/plain.ts')?.changelist).toBeUndefined();
    expect(byPath.get('new.txt')?.working_dir).toBe('?');
    expect(byPath.get('new.txt')?.changelist).toBeUndefined();
  });
});

describe('svnManager.update conflict parsing', () => {
  it('collects text/prop/tree conflicts and skips clean/summary lines', async () => {
    const result = await svnManager.update('C:/wc');
    expect(result.revision).toBe('42');
    expect(result.conflicts).toEqual(['src/충돌.c', 'props-conflict.txt', 'tree-dir']);
  });
});
