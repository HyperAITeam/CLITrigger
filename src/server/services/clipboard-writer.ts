// Writes raw image bytes into the host OS clipboard so a CLI subprocess
// (Claude / Codex / Antigravity) can pick it up via its native Alt+V handler —
// no disk file ever touches the user's project tree.
//
// Concurrent calls are serialized via a process-wide promise chain so two
// sessions pasting at once don't clobber each other's bytes before the CLI
// has read them.

import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';

let mutex: Promise<void> = Promise.resolve();

const SPAWN_TIMEOUT_MS = 10_000;

export async function writeImageToClipboard(buffer: Buffer): Promise<void> {
  const prev = mutex;
  let releaseNext!: () => void;
  mutex = new Promise<void>(r => { releaseNext = r; });
  try {
    await prev;
    await writeForPlatform(buffer);
  } finally {
    releaseNext();
  }
}

function writeForPlatform(buffer: Buffer): Promise<void> {
  if (process.platform === 'win32') return writeWin32(buffer);
  if (process.platform === 'darwin') return writeMac(buffer);
  return writeLinux(buffer);
}

function writeWin32(buffer: Buffer): Promise<void> {
  // PowerShell reads base64 from stdin → MemoryStream → Image → SetImage.
  // Stays in memory; no temp file touches disk.
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "$base64 = [Console]::In.ReadToEnd()",
    "$bytes = [Convert]::FromBase64String($base64)",
    "$stream = New-Object System.IO.MemoryStream(,$bytes)",
    "$img = [System.Drawing.Image]::FromStream($stream)",
    "[System.Windows.Forms.Clipboard]::SetImage($img)",
  ].join('; ');

  return runChild('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], buffer.toString('base64'), { windowsHide: true });
}

function writeMac(buffer: Buffer): Promise<void> {
  // osascript wants a file path. Write a brief tmp file in os.tmpdir() (NOT
  // in the user's project tree), unlink it as soon as osascript returns.
  const tmpFile = path.join(os.tmpdir(), `clitrigger-clip-${Date.now()}-${process.pid}.png`);
  fs.writeFileSync(tmpFile, buffer);
  const script = `set the clipboard to (read (POSIX file "${tmpFile}") as «class PNGf»)`;
  return runChild('osascript', ['-e', script], null).finally(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  });
}

async function writeLinux(buffer: Buffer): Promise<void> {
  // Try wl-copy (Wayland) first if WAYLAND_DISPLAY is set, else xclip (X11),
  // and fall back the other way if the preferred tool isn't installed.
  const wayland = !!process.env.WAYLAND_DISPLAY;
  const tools: Array<{ cmd: string; args: string[] }> = wayland
    ? [
        { cmd: 'wl-copy', args: ['--type', 'image/png'] },
        { cmd: 'xclip', args: ['-selection', 'clipboard', '-t', 'image/png', '-i'] },
      ]
    : [
        { cmd: 'xclip', args: ['-selection', 'clipboard', '-t', 'image/png', '-i'] },
        { cmd: 'wl-copy', args: ['--type', 'image/png'] },
      ];

  let lastErr: unknown = new Error('No clipboard tool available');
  for (const { cmd, args } of tools) {
    try {
      await runChild(cmd, args, buffer);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('clipboard write failed');
}

function runChild(cmd: string, args: string[], stdin: string | Buffer | null, opts: { windowsHide?: boolean } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: opts.windowsHide ?? false });
    let stderr = '';
    proc.stderr?.on('data', d => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${SPAWN_TIMEOUT_MS}ms`));
    }, SPAWN_TIMEOUT_MS);
    proc.on('error', err => { clearTimeout(timer); reject(err); });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
    });
    if (stdin !== null) {
      proc.stdin.write(stdin);
    }
    proc.stdin.end();
  });
}
