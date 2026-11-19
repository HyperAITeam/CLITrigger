import { describe, it, expect, vi, afterEach } from 'vitest';

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
import { runSvn } from '../../lib/svn.js';

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

describe('svnManager.getDiff against a revision', () => {
  it('passes -r REV so the working copy is compared to that revision', async () => {
    const { runSvn } = await import('../../lib/svn.js');
    await svnManager.getDiff('C:/wc', undefined, '40');
    expect(vi.mocked(runSvn)).toHaveBeenCalledWith(
      ['diff', '--internal-diff', '-r', '40', 'C:/wc'],
      'C:/wc',
    );
  });

  it('rejects a non-numeric revision', async () => {
    await expect(svnManager.getDiff('C:/wc', undefined, '40; rm')).rejects.toThrow('Invalid revision');
  });
});

describe('svnManager.update conflict parsing', () => {
  it('collects text/prop/tree conflicts and skips clean/summary lines', async () => {
    const result = await svnManager.update('C:/wc');
    expect(result.revision).toBe('42');
    expect(result.conflicts).toEqual(['src/충돌.c', 'props-conflict.txt', 'tree-dir']);
  });

  it('relativizes progress lines passed to onLine and leaves other lines intact', async () => {
    const seen: string[] = [];
    vi.mocked(runSvn).mockImplementationOnce(async (_args, _cwd, onLine) => {
      UPDATE_STDOUT.split('\n').forEach((line) => onLine!(line));
      return { stdout: UPDATE_STDOUT, stderr: '' };
    });
    await svnManager.update('C:/wc', undefined, (line) => seen.push(line));
    expect(seen).toContain('U    src/plain.ts');
    expect(seen).toContain("Updating 'C:/wc':");
  });
});

// ── Property-only changes (e.g. an svn:externals bump on a directory) ──────
// These need per-test status output, so they swap the mock implementation and
// put the shared default back afterwards.
const mockedRunSvn = vi.mocked(runSvn);
const defaultRunSvn = mockedRunSvn.getMockImplementation()!;
type RunSvnResult = Awaited<ReturnType<typeof runSvn>>;
const ok = (stdout: string) => ({ stdout, stderr: '' }) as RunSvnResult;
const statusXml = (entries: string) => `<?xml version="1.0"?><status><target path="C:/wc">${entries}</target></status>`;
const entry = (path: string, item: string, props = 'none') =>
  `<entry path="${path}"><wc-status item="${item}" props="${props}" revision="10"/></entry>`;
const withStatus = (entries: string, otherStdout = '') =>
  mockedRunSvn.mockImplementation(async (args: string[]) => (args[0] === 'status' ? ok(statusXml(entries)) : ok(otherStdout)));

describe('svnManager property-only changes', () => {
  afterEach(() => {
    mockedRunSvn.mockImplementation(defaultRunSvn);
    mockedRunSvn.mockClear();
  });

  it('surfaces a directory whose only change is a property as M', async () => {
    withStatus(entry('C:/wc/libs', 'normal', 'modified') + entry('C:/wc/a.txt', 'modified') + entry('C:/wc/ext', 'external'));
    const status = await svnManager.getStatus('C:/wc');
    expect(status.files).toEqual([
      { path: 'libs', index: ' ', working_dir: 'M' },
      { path: 'a.txt', index: ' ', working_dir: 'M' },
    ]);
  });

  it('reverts props-only directories with --depth empty and the rest with -R', async () => {
    withStatus(entry('libs', 'normal', 'modified') + entry('a.txt', 'modified'));
    await svnManager.revert('C:/wc', ['libs', 'a.txt']);
    expect(mockedRunSvn).toHaveBeenCalledWith(['revert', '--depth', 'empty', 'libs'], 'C:/wc');
    expect(mockedRunSvn).toHaveBeenCalledWith(['revert', '-R', 'a.txt'], 'C:/wc');
  });

  it('commits with --depth empty only when the selection holds a props-only directory', async () => {
    withStatus(entry('libs', 'normal', 'modified'), 'Committed revision 11.');
    const result = await svnManager.commit('C:/wc', 'bump externals', ['libs', 'a.txt']);
    expect(result.revision).toBe('11');
    expect(mockedRunSvn).toHaveBeenLastCalledWith(['commit', '-m', 'bump externals', '--depth', 'empty', 'libs', 'a.txt'], 'C:/wc');

    withStatus(entry('a.txt', 'modified'), 'Committed revision 12.');
    await svnManager.commit('C:/wc', 'plain', ['a.txt']);
    expect(mockedRunSvn).toHaveBeenLastCalledWith(['commit', '-m', 'plain', 'a.txt'], 'C:/wc');
  });
});

describe('svnManager paths and selections', () => {
  afterEach(() => {
    mockedRunSvn.mockImplementation(defaultRunSvn);
    mockedRunSvn.mockClear();
  });

  it('unescapes XML in status paths', async () => {
    withStatus(entry('C:/wc/R&amp;D/a&apos;b.txt', 'modified'));
    expect((await svnManager.getStatus('C:/wc')).files.map((f) => f.path)).toEqual(["R&D/a'b.txt"]);
  });

  it("passes paths containing '@' with a trailing '@' so svn doesn't read a peg revision", async () => {
    withStatus(entry('icon@2x.png', 'modified'));
    await svnManager.revert('C:/wc', ['icon@2x.png']);
    expect(mockedRunSvn).toHaveBeenCalledWith(['revert', '-R', 'icon@2x.png@'], 'C:/wc');
    // svn diff is the exception: it takes the path literally.
    await svnManager.getDiff('C:/wc', 'icon@2x.png');
    expect(mockedRunSvn).toHaveBeenLastCalledWith(['diff', '--internal-diff', 'icon@2x.png'], 'C:/wc');
  });

  it('adds selected unversioned files and deletes selected missing ones before committing', async () => {
    withStatus(entry('new.txt', 'unversioned') + entry('gone.txt', 'missing') + entry('a.txt', 'modified'), 'Committed revision 13.');
    const result = await svnManager.commit('C:/wc', 'msg', ['new.txt', 'gone.txt', 'a.txt']);
    expect(result).toEqual({ revision: '13' });
    expect(mockedRunSvn).toHaveBeenCalledWith(['add', '--parents', '--force', 'new.txt'], 'C:/wc');
    expect(mockedRunSvn).toHaveBeenCalledWith(['delete', 'gone.txt'], 'C:/wc');
    expect(mockedRunSvn).toHaveBeenLastCalledWith(['commit', '-m', 'msg', 'new.txt', 'gone.txt', 'a.txt'], 'C:/wc');
  });

  it('counts replaced and broken-lock rows, not summary lines, and falls back to svn info for the revision', async () => {
    const localized = ['R    C:/wc/re.txt', '  B  C:/wc/locked.txt', '  Text conflicts: 1', '리비전 99로 갱신했습니다.'].join('\n');
    mockedRunSvn.mockImplementation(async (args: string[], _cwd, onLine) => {
      if (args[0] === 'info') return ok(INFO_XML);
      localized.split('\n').forEach((line) => onLine?.(line));
      return ok(localized);
    });
    const seen: string[] = [];
    const result = await svnManager.update('C:/wc', undefined, (line) => seen.push(line));
    expect(seen.slice(0, 2)).toEqual(['R    re.txt', '  B  locked.txt']);
    expect(result).toEqual({ revision: '10', conflicts: [] });
  });

  it('pages the log by revision below the last one shown', async () => {
    await svnManager.getLog('C:/wc', { before: '120', limit: 50 });
    expect(mockedRunSvn).toHaveBeenLastCalledWith(['log', '--xml', '-r', '119:1', '-l', '51', 'C:/wc'], 'C:/wc');
    mockedRunSvn.mockClear();
    expect(await svnManager.getLog('C:/wc', { before: '1' })).toEqual({ commits: [], hasMore: false });
    expect(mockedRunSvn).not.toHaveBeenCalled();
  });
});
