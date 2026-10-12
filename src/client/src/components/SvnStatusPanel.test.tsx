import { describe, it, expect } from 'vitest';
import { partitionSections } from './SvnStatusPanel';
import type { SvnFile } from '../api/svn';

const t = (key: string) => key;
const file = (path: string, changelist?: string, status = 'M'): SvnFile =>
  ({ path, index: ' ', working_dir: status, ...(changelist ? { changelist } : {}) });

describe('partitionSections', () => {
  const files = [file('a', 'beta'), file('b', 'alpha'), file('c'), file('d', undefined, '?')];

  it('sorts named changelists alphabetically before built-in buckets by default', () => {
    expect(partitionSections(files, [], [], t).map((s) => s.key))
      .toEqual(['cl:alpha', 'cl:beta', 'default', 'unversioned']);
  });

  it('puts user-ordered keys first and keeps the rest in built-in order', () => {
    expect(partitionSections(files, ['empty'], ['default', 'cl:beta'], t).map((s) => s.key))
      .toEqual(['default', 'cl:beta', 'cl:alpha', 'cl:empty', 'unversioned']);
  });
});
