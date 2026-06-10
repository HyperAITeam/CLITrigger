import { promises as fs } from 'fs';
import path from 'path';

export class HarnessPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarnessPathError';
  }
}

export function safeJoin(projectPath: string, ...segments: string[]): string {
  if (!projectPath) throw new HarnessPathError('projectPath is required');
  const root = path.resolve(projectPath);
  const target = path.resolve(root, ...segments);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new HarnessPathError(`Path "${target}" escapes project root "${root}"`);
  }
  return target;
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function listSubdirectories(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

export async function readTextOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return '';
    throw err;
  }
}

export async function readJsonOrEmpty<T extends object>(filePath: string): Promise<T> {
  const text = await readTextOrEmpty(filePath);
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

export async function atomicWriteText(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, filePath);
}

export async function atomicWriteJson(filePath: string, obj: unknown): Promise<void> {
  const text = JSON.stringify(obj, null, 2) + '\n';
  await atomicWriteText(filePath, text);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const existing = out[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      out[key] = deepMerge(existing, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

export function pruneUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (isPlainObject(value)) {
      const pruned = pruneUndefined(value as Record<string, unknown>);
      if (Object.keys(pruned).length > 0) out[key] = pruned;
    } else {
      out[key] = value;
    }
  }
  return out as T;
}
