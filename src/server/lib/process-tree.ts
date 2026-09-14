import { execFile } from 'child_process';
import path from 'path';

export interface RawProcess {
  pid: number;
  ppid: number;
  name: string;
  command: string;
  memoryBytes: number;
}

export interface ProcessNode {
  pid: number;
  name: string;
  command: string;
  memoryBytes: number;
  children: ProcessNode[];
}

export type ProcessTreeResult =
  | { available: true; generatedAt: string; trees: Record<string, ProcessNode | null> }
  | { available: false; reason: string };

// A full enumeration costs 1.5–2.5 s on Windows and WMI is the bottleneck
// (filtering by ParentProcessId is not cheaper), so callers fetch once per
// click and this module only shares one dump between near-simultaneous calls.
const CACHE_TTL_MS = 3_000;
const TIMEOUT_MS = 15_000;
const MAX_BUFFER = 32 * 1024 * 1024;
const COMMAND_MAX_LENGTH = 200;
const MAX_DEPTH = 32;

// UTF-8 so Korean paths in command lines survive the CP949 console default;
// -InputObject so a single-row result stays a JSON array (piping unwraps it).
const WINDOWS_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$rows = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, WorkingSetSize, CommandLine)',
  'ConvertTo-Json -InputObject $rows -Compress',
].join('; ');

interface ProcessDump {
  at: string;
  processes: RawProcess[];
}

let cache: { startedAt: number; promise: Promise<ProcessDump> } | null = null;

function truncate(text: string): string {
  return text.length > COMMAND_MAX_LENGTH ? text.slice(0, COMMAND_MAX_LENGTH) + '…' : text;
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true, encoding: 'utf8' },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

export function parseWindowsJson(stdout: string): RawProcess[] {
  const text = stdout.replace(/^﻿/, '').trim();
  if (!text) return [];
  const parsed: unknown = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const result: RawProcess[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    if (typeof record.ProcessId !== 'number') continue;
    result.push({
      pid: record.ProcessId,
      ppid: typeof record.ParentProcessId === 'number' ? record.ParentProcessId : 0,
      name: typeof record.Name === 'string' ? record.Name : '',
      // CommandLine is null for protected processes.
      command: truncate(typeof record.CommandLine === 'string' ? record.CommandLine : ''),
      memoryBytes: typeof record.WorkingSetSize === 'number' ? record.WorkingSetSize : 0,
    });
  }
  return result;
}

export function parsePosixPs(stdout: string): RawProcess[] {
  const result: RawProcess[] = [];
  for (const line of stdout.split('\n')) {
    // Three numeric columns, then args verbatim (may contain spaces).
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const command = match[4].trim();
    result.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      memoryBytes: Number(match[3]) * 1024, // rss is reported in KiB
      name: path.basename(command.split(' ')[0] || ''),
      command: truncate(command),
    });
  }
  return result;
}

export function buildProcessTree(all: RawProcess[], rootPid: number): ProcessNode | null {
  const root = all.find((entry) => entry.pid === rootPid);
  if (!root) return null;
  const childrenOf = new Map<number, RawProcess[]>();
  for (const entry of all) {
    if (entry.pid === entry.ppid) continue; // Windows pid 0 lists itself as parent
    const siblings = childrenOf.get(entry.ppid);
    if (siblings) siblings.push(entry);
    else childrenOf.set(entry.ppid, [entry]);
  }
  // ponytail: visited + depth cap absorb ppid loops from Windows pid reuse;
  // add a CreationDate ordering filter if a stray child is actually observed.
  const visited = new Set<number>();
  const build = (entry: RawProcess, depth: number): ProcessNode => {
    visited.add(entry.pid);
    const children: ProcessNode[] = [];
    if (depth < MAX_DEPTH) {
      const candidates = [...(childrenOf.get(entry.pid) ?? [])].sort((a, b) => a.pid - b.pid);
      for (const child of candidates) {
        if (visited.has(child.pid)) continue;
        children.push(build(child, depth + 1));
      }
    }
    return { pid: entry.pid, name: entry.name, command: entry.command, memoryBytes: entry.memoryBytes, children };
  };
  return build(root, 0);
}

export function listProcesses(): Promise<ProcessDump> {
  if (cache && Date.now() - cache.startedAt < CACHE_TTL_MS) return cache.promise;
  const startedAt = Date.now();
  const promise = (process.platform === 'win32'
    ? run('powershell', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT]).then(parseWindowsJson)
    // -A (not -e: on macOS -e prints the environment), -ww keeps args untruncated.
    : run('ps', ['-A', '-ww', '-o', 'pid=,ppid=,rss=,args=']).then(parsePosixPs)
  ).then((processes) => ({ at: new Date(startedAt).toISOString(), processes }));
  const entry = { startedAt, promise };
  cache = entry;
  // A failed dump must not be served from cache — let the next click retry.
  promise.catch(() => { if (cache === entry) cache = null; });
  return promise;
}

export async function getProcessTrees(roots: Record<string, number>): Promise<ProcessTreeResult> {
  const entries = Object.entries(roots);
  if (entries.length === 0) return { available: true, generatedAt: new Date().toISOString(), trees: {} };
  try {
    const { at, processes } = await listProcesses();
    const trees: Record<string, ProcessNode | null> = {};
    for (const [sessionId, pid] of entries) trees[sessionId] = buildProcessTree(processes, pid);
    return { available: true, generatedAt: at, trees };
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
