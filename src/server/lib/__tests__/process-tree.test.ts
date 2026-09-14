import { describe, it, expect } from 'vitest';
import { buildProcessTree, parseWindowsJson, parsePosixPs, type RawProcess, type ProcessNode } from '../process-tree.js';

function raw(pid: number, ppid: number, name = `p${pid}`): RawProcess {
  return { pid, ppid, name, command: name, memoryBytes: 0 };
}

function flattenPids(node: ProcessNode): number[] {
  return [node.pid, ...node.children.flatMap(flattenPids)];
}

describe('buildProcessTree', () => {
  it('builds a three-level tree, sorts children by pid and drops orphans', () => {
    const all = [raw(1, 0, 'cmd.exe'), raw(2, 1, 'claude.exe'), raw(4, 2, 'npm'), raw(3, 2, 'git'), raw(9, 999, 'orphan')];
    const tree = buildProcessTree(all, 1)!;
    expect(tree.name).toBe('cmd.exe');
    expect(tree.children.map((child) => child.name)).toEqual(['claude.exe']);
    expect(tree.children[0].children.map((child) => child.pid)).toEqual([3, 4]);
    expect(flattenPids(tree)).not.toContain(9);
  });

  it('returns null when the root pid is not in the dump', () => {
    expect(buildProcessTree([raw(1, 0)], 42)).toBeNull();
  });

  it('terminates on ppid cycles and never repeats a pid', () => {
    const all = [raw(1, 2), raw(2, 1), raw(5, 5), raw(3, 1)];
    const pids = flattenPids(buildProcessTree(all, 1)!);
    expect(new Set(pids).size).toBe(pids.length);
    expect(pids).toEqual([1, 2, 3]);
  });
});

describe('parseWindowsJson', () => {
  it('accepts a single bare object and maps a null CommandLine to an empty string', () => {
    const rows = parseWindowsJson('{"ProcessId":7,"ParentProcessId":1,"Name":"x.exe","WorkingSetSize":10,"CommandLine":null}');
    expect(rows).toEqual([{ pid: 7, ppid: 1, name: 'x.exe', memoryBytes: 10, command: '' }]);
  });

  it('strips a leading BOM before parsing an array', () => {
    const rows = parseWindowsJson('﻿[{"ProcessId":7,"ParentProcessId":1,"Name":"x.exe","WorkingSetSize":10,"CommandLine":"x"}]');
    expect(rows).toHaveLength(1);
  });

  it('truncates long command lines', () => {
    const long = 'a'.repeat(300);
    const [row] = parseWindowsJson(`[{"ProcessId":1,"ParentProcessId":0,"Name":"n","WorkingSetSize":0,"CommandLine":"${long}"}]`);
    expect(row.command).toHaveLength(201);
    expect(row.command.endsWith('…')).toBe(true);
  });

  it('returns an empty list for empty output', () => {
    expect(parseWindowsJson('')).toEqual([]);
  });
});

describe('parsePosixPs', () => {
  it('parses the numeric columns and keeps spaces inside args', () => {
    const rows = parsePosixPs('  123     1  45678 /usr/bin/node /home/u/my dir/claude --flag\n\n 7 1 0 sleep 1\n');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      pid: 123,
      ppid: 1,
      memoryBytes: 45678 * 1024,
      name: 'node',
      command: '/usr/bin/node /home/u/my dir/claude --flag',
    });
  });
});
