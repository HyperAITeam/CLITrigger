import { Router, Request, Response } from 'express';
import nodePath from 'path';
import fs from 'fs';
import { execFileSync, exec } from 'child_process';
import os from 'os';
import { createProject, getAllProjects, getProjectById, updateProject, deleteProject, syncProjectCliDefaults } from '../db/queries.js';
import { worktreeManager } from '../services/worktree-manager.js';
import { isSvnRepository } from '../lib/svn.js';
import { cleanupProjectImages } from './images.js';

const router = Router();

/**
 * Validate project path: must be absolute, exist, be a directory,
 * and not contain path traversal sequences.
 */
function validateProjectPath(inputPath: string): { valid: boolean; error?: string; resolved?: string } {
  if (!inputPath || typeof inputPath !== 'string') {
    return { valid: false, error: 'Path is required' };
  }

  // Resolve to absolute path
  const resolved = nodePath.resolve(inputPath);

  // Check for path traversal attempts
  if (inputPath.includes('..')) {
    return { valid: false, error: 'Path traversal (..) is not allowed' };
  }

  // Must be an absolute path
  if (!nodePath.isAbsolute(inputPath)) {
    return { valid: false, error: 'Path must be absolute' };
  }

  // Must exist and be a directory
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return { valid: false, error: 'Path must be a directory' };
    }
  } catch {
    return { valid: false, error: 'Path does not exist or is not accessible' };
  }

  return { valid: true, resolved };
}

// POST /api/projects/browse - open native OS folder picker dialog
router.post('/browse', (req: Request, res: Response) => {
  const initialDir = req.body.initialPath || '';

  try {
    let selected = '';

    if (process.platform === 'win32') {
      const initialEscaped = initialDir.replace(/'/g, "''");
      const csharpSrc = `using System;
using System.Runtime.InteropServices;

namespace CLITriggerPicker {
    [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    internal class FileOpenDialogClass { }

    [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IFileDialog {
        [PreserveSig] uint Show(IntPtr parent);
        void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
        void SetFileTypeIndex(uint iFileType);
        void GetFileTypeIndex(out uint piFileType);
        void Advise(IntPtr pfde, out uint pdwCookie);
        void Unadvise(uint dwCookie);
        void SetOptions(uint fos);
        void GetOptions(out uint pfos);
        void SetDefaultFolder(IShellItem psi);
        void SetFolder(IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
        void AddPlace(IShellItem psi, uint fdap);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
        void Close(int hr);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr pFilter);
    }

    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellItem {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName(uint sigdnName, out IntPtr ppszName);
        void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        void Compare(IShellItem psi, uint hint, out int piOrder);
    }

    public static class Picker {
        const uint FOS_PICKFOLDERS = 0x20;
        const uint FOS_FORCEFILESYSTEM = 0x40;
        const uint FOS_NOCHANGEDIR = 0x8;
        const uint SIGDN_FILESYSPATH = 0x80058000;

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, PreserveSig = true)]
        static extern int SHCreateItemFromParsingName(
            [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
            IntPtr pbc,
            ref Guid riid,
            [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);

        public static string Pick(string initialDir, string title) {
            var dialog = (IFileDialog)new FileOpenDialogClass();
            dialog.SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR);
            if (!string.IsNullOrEmpty(title)) dialog.SetTitle(title);

            if (!string.IsNullOrEmpty(initialDir)) {
                try {
                    Guid iid = typeof(IShellItem).GUID;
                    IShellItem startItem;
                    int hr = SHCreateItemFromParsingName(initialDir, IntPtr.Zero, ref iid, out startItem);
                    if (hr == 0 && startItem != null) dialog.SetFolder(startItem);
                } catch { }
            }

            uint showRes = dialog.Show(IntPtr.Zero);
            if (showRes != 0) return "";

            IShellItem result;
            dialog.GetResult(out result);
            IntPtr pszPath;
            result.GetDisplayName(SIGDN_FILESYSPATH, out pszPath);
            string path = Marshal.PtrToStringUni(pszPath);
            Marshal.FreeCoTaskMem(pszPath);
            return path;
        }
    }
}`;

      const scriptLines = [
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
        "Add-Type -TypeDefinition @'",
        csharpSrc,
        "'@",
        `$picked = [CLITriggerPicker.Picker]::Pick('${initialEscaped}', '폴더 선택')`,
        'if ($picked) { Write-Output $picked }',
      ];

      const tmpScript = nodePath.join(os.tmpdir(), `clitrigger-browse-${Date.now()}.ps1`);
      // UTF-8 BOM so PowerShell 5.1 reads non-ASCII (e.g. Korean) chars correctly
      fs.writeFileSync(tmpScript, '﻿' + scriptLines.join('\r\n'), 'utf-8');

      try {
        selected = execFileSync('powershell', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', tmpScript], {
          encoding: 'utf-8',
          timeout: 120000,
          windowsHide: false,
        }).replace(/^﻿/, '').trim();
      } finally {
        try { fs.unlinkSync(tmpScript); } catch { /* ignore */ }
      }
    } else if (process.platform === 'darwin') {
      // Escape \ and " for safe interpolation into AppleScript string literal.
      // POSIX file coercion makes default location reliable across macOS versions.
      const escapeAS = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const prompt = 'with prompt "폴더 선택"';
      const script = initialDir
        ? `POSIX path of (choose folder ${prompt} default location (POSIX file "${escapeAS(initialDir)}"))`
        : `POSIX path of (choose folder ${prompt})`;
      selected = execFileSync('osascript', ['-e', script], {
        encoding: 'utf-8',
        timeout: 120000,
      }).trim();
    } else {
      // Linux: try zenity, then kdialog
      const args = ['--file-selection', '--directory'];
      if (initialDir) args.push(`--filename=${initialDir}/`);
      try {
        selected = execFileSync('zenity', args, { encoding: 'utf-8', timeout: 120000 }).trim();
      } catch {
        selected = execFileSync('kdialog', ['--getexistingdirectory', initialDir || '~'], {
          encoding: 'utf-8',
          timeout: 120000,
        }).trim();
      }
    }

    if (selected) {
      res.json({ path: selected.replace(/\\/g, '/') });
    } else {
      res.json({ path: null });
    }
  } catch {
    // User cancelled or dialog closed
    res.json({ path: null });
  }
});

// POST /api/projects/open-folder - open folder in OS file explorer
router.post('/open-folder', (req: Request, res: Response) => {
  const { path: folderPath } = req.body;
  if (!folderPath || typeof folderPath !== 'string') {
    res.status(400).json({ error: 'path is required' });
    return;
  }

  const resolved = nodePath.resolve(folderPath);
  if (!fs.existsSync(resolved)) {
    res.status(404).json({ error: 'path does not exist' });
    return;
  }

  try {
    if (process.platform === 'win32') {
      exec(`explorer.exe "${resolved}"`);
    } else if (process.platform === 'darwin') {
      exec(`open "${resolved}"`);
    } else {
      exec(`xdg-open "${resolved}"`);
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'failed to open folder' });
  }
});

// POST /api/projects - create project
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, path, default_branch } = req.body;
    if (!name || !path) {
      res.status(400).json({ error: 'name and path are required' });
      return;
    }

    const pathCheck = validateProjectPath(path);
    if (!pathCheck.valid) {
      res.status(400).json({ error: pathCheck.error });
      return;
    }

    const safePath = pathCheck.resolved!;
    const isGitRepo = await worktreeManager.isGitRepository(safePath);
    // SVN detection is opt-in per project; not run at create time.
    // Users enable it later via Settings → "Enable SVN" which triggers detection.
    const vcsType: string | null = isGitRepo ? 'git' : null;
    const project = createProject(name, safePath, default_branch, isGitRepo ? 1 : 0, vcsType);
    res.status(201).json(project);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'A project with this path already exists' });
      return;
    }
    res.status(500).json({ error: message });
  }
});

// GET /api/projects - list all projects
router.get('/', (_req: Request, res: Response) => {
  try {
    const projects = getAllProjects();
    const enriched = projects.map((p) => {
      let pathExists = false;
      try {
        pathExists = fs.statSync(p.path).isDirectory();
      } catch { /* path missing */ }
      return { ...p, path_exists: pathExists };
    });
    res.json(enriched);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id - get project by id
router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    let project = getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!project.is_git_repo || !project.vcs_type) {
      try {
        const isGitRepo = await worktreeManager.isGitRepository(project.path);
        if (isGitRepo) {
          const patch: { is_git_repo?: number; vcs_type?: string } = {};
          if (!project.is_git_repo) patch.is_git_repo = 1;
          if (project.vcs_type !== 'git') patch.vcs_type = 'git';
          if (Object.keys(patch).length > 0) {
            project = updateProject(req.params.id, patch) ?? project;
          }
        } else if (project.svn_enabled && !project.vcs_type && await isSvnRepository(project.path)) {
          project = updateProject(req.params.id, { vcs_type: 'svn' }) ?? project;
        }
      } catch { /* best-effort; ignore failures */ }
    }
    res.json(project);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// PUT /api/projects/:id - update project
router.put('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const existing = getProjectById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const { name, path, default_branch, max_concurrent, claude_model, claude_options, cli_tool, gstack_enabled, gstack_skills, jira_enabled, jira_base_url, jira_email, jira_api_token, jira_project_key, cli_fallback_chain, default_max_turns, sandbox_mode, debug_logging, notion_enabled, notion_api_key, notion_database_id, github_enabled, github_token, github_owner, github_repo, use_worktree, show_token_usage, npm_auto_install, memory_auto_ingest, svn_enabled, color } = req.body;

    // Handle SVN enable/disable transitions:
    //   off → on  : run detection now and set vcs_type='svn' if .svn/ found
    //   on  → off : clear vcs_type if it was 'svn' so the tab and routes go quiet
    let vcsTypePatch: string | null | undefined = undefined;
    if (svn_enabled !== undefined && Number(svn_enabled) !== existing.svn_enabled) {
      if (Number(svn_enabled) === 1) {
        try {
          if (await isSvnRepository(existing.path)) vcsTypePatch = 'svn';
        } catch { /* leave vcs_type unchanged on detection error */ }
      } else if (existing.vcs_type === 'svn') {
        vcsTypePatch = null;
      }
    }

    const project = updateProject(req.params.id, {
      name, path, default_branch, max_concurrent, claude_model, claude_options, cli_tool, gstack_enabled, gstack_skills, jira_enabled, jira_base_url, jira_email, jira_api_token, jira_project_key, cli_fallback_chain, default_max_turns, sandbox_mode, debug_logging, notion_enabled, notion_api_key, notion_database_id, github_enabled, github_token, github_owner, github_repo, use_worktree, show_token_usage, npm_auto_install, memory_auto_ingest, color,
      ...(svn_enabled !== undefined ? { svn_enabled: Number(svn_enabled) } : {}),
      ...(vcsTypePatch !== undefined ? { vcs_type: vcsTypePatch } : {}),
    });

    const cliChanged =
      (cli_tool !== undefined && cli_tool !== existing.cli_tool) ||
      (claude_model !== undefined && claude_model !== existing.claude_model);

    if (project && cliChanged) {
      syncProjectCliDefaults(
        req.params.id,
        existing.cli_tool ?? null,
        existing.claude_model ?? null,
        project.cli_tool ?? null,
        project.claude_model ?? null
      );
    }

    res.json(project);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/projects/:id - delete project
router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    // Clean up image files before CASCADE deletes DB rows
    cleanupProjectImages(req.params.id);
    const deleted = deleteProject(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.status(204).send();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/projects/:id/check-git - re-check if project path is a git repo
router.post('/:id/check-git', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const existing = getProjectById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const isGitRepo = await worktreeManager.isGitRepository(existing.path);
    const project = updateProject(req.params.id, { is_git_repo: isGitRepo ? 1 : 0 });
    res.json(project);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id/git-status - get git status tree
router.get('/:id/git-status', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!project.is_git_repo) {
      res.status(400).json({ error: 'Project is not a git repository' });
      return;
    }

    const worktreePath = req.query.worktreePath as string | undefined;
    let targetPath = project.path;

    if (worktreePath) {
      // Validate worktree path: must be under project's .worktrees directory
      const resolved = nodePath.resolve(worktreePath);
      const worktreeBase = nodePath.resolve(project.path, '.worktrees');
      if (!resolved.startsWith(worktreeBase + nodePath.sep) && resolved !== worktreeBase) {
        res.status(400).json({ error: 'Invalid worktree path' });
        return;
      }
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        res.status(400).json({ error: 'Worktree path does not exist' });
        return;
      }
      targetPath = resolved;
    }

    const status = await worktreeManager.getGitStatus(targetPath);
    res.json(status);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id/git-log - get commit history
router.get('/:id/git-log', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!project.is_git_repo) {
      res.status(400).json({ error: 'Project is not a git repository' });
      return;
    }

    const worktreePath = req.query.worktreePath as string | undefined;
    let targetPath = project.path;

    if (worktreePath) {
      const resolved = nodePath.resolve(worktreePath);
      const worktreeBase = nodePath.resolve(project.path, '.worktrees');
      if (!resolved.startsWith(worktreeBase + nodePath.sep) && resolved !== worktreeBase) {
        res.status(400).json({ error: 'Invalid worktree path' });
        return;
      }
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        res.status(400).json({ error: 'Worktree path does not exist' });
        return;
      }
      targetPath = resolved;
    }

    const skip = parseInt(req.query.skip as string) || 0;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const result = await worktreeManager.getGitLog(targetPath, { skip, limit });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id/git-refs - get branches, tags, stashes
router.get('/:id/git-refs', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!project.is_git_repo) {
      res.status(400).json({ error: 'Project is not a git repository' });
      return;
    }

    const worktreePath = req.query.worktreePath as string | undefined;
    let targetPath = project.path;

    if (worktreePath) {
      const resolved = nodePath.resolve(worktreePath);
      const worktreeBase = nodePath.resolve(project.path, '.worktrees');
      if (!resolved.startsWith(worktreeBase + nodePath.sep) && resolved !== worktreeBase) {
        res.status(400).json({ error: 'Invalid worktree path' });
        return;
      }
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        res.status(400).json({ error: 'Worktree path does not exist' });
        return;
      }
      targetPath = resolved;
    }

    const refs = await worktreeManager.getGitRefs(targetPath);
    res.json(refs);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id/worktrees - list git worktrees
router.get('/:id/worktrees', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = getProjectById(req.params.id);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    if (!project.is_git_repo) { res.status(400).json({ error: 'Not a git repository' }); return; }
    const worktrees = await worktreeManager.listWorktrees(project.path);
    // Exclude the main worktree (same as project path)
    const filtered = worktrees.filter(w => nodePath.resolve(w.path) !== nodePath.resolve(project.path));
    res.json({ worktrees: filtered });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/worktree-cleanup - remove a worktree and its branch
router.post('/:id/worktree-cleanup', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = getProjectById(req.params.id);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    if (!project.is_git_repo) { res.status(400).json({ error: 'Not a git repository' }); return; }

    const { worktreePath, branchName } = req.body as { worktreePath: string; branchName: string };
    if (!worktreePath && !branchName) {
      res.status(400).json({ error: 'worktreePath or branchName required' });
      return;
    }

    // Validate worktree path is under .worktrees
    if (worktreePath) {
      const resolved = nodePath.resolve(worktreePath);
      const worktreeBase = nodePath.resolve(project.path, '.worktrees');
      if (!resolved.startsWith(worktreeBase + nodePath.sep) && resolved !== worktreeBase) {
        res.status(400).json({ error: 'Invalid worktree path' });
        return;
      }
    }

    const result = await worktreeManager.cleanupWorktree(project.path, worktreePath || '', branchName || '');
    res.json({ success: true, ...result });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// --- Git action helpers ---

function getProjectGitPath(req: Request<{ id: string }>, res: Response): string | null {
  const project = getProjectById(req.params.id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return null; }
  if (!project.is_git_repo) { res.status(400).json({ error: 'Not a git repository' }); return null; }
  return project.path;
}

// POST /api/projects/:id/git-stage
router.post('/:id/git-stage', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { files } = req.body;
    if (!files || !Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: 'files array is required' }); return;
    }
    await worktreeManager.gitStage(dirPath, files);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-unstage
router.post('/:id/git-unstage', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { files } = req.body;
    if (!files || !Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: 'files array is required' }); return;
    }
    await worktreeManager.gitUnstage(dirPath, files);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-commit
router.post('/:id/git-commit', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { message } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required' }); return;
    }
    const commit = await worktreeManager.gitCommit(dirPath, message.trim());
    res.json({ ok: true, commit });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-pull
router.post('/:id/git-pull', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { remote, branch } = req.body;
    const summary = await worktreeManager.gitPull(dirPath, remote, branch);
    res.json({ ok: true, summary });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-push
router.post('/:id/git-push', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const body = (req.body || {}) as {
      remote?: string;
      branch?: string;
      setUpstream?: boolean;
      branches?: Array<{ local: string; remote?: string; setUpstream?: boolean }>;
      pushAllTags?: boolean;
      force?: boolean;
    };

    let branches = (body.branches || []).map((b) => ({
      local: String(b.local || '').trim(),
      remote: String(b.remote || '').trim(),
      setUpstream: !!b.setUpstream,
    })).filter((b) => b.local);

    // Backward compatibility: { branch, setUpstream } style
    if (branches.length === 0 && body.branch) {
      branches = [{ local: body.branch, remote: body.branch, setUpstream: !!body.setUpstream }];
    }

    await worktreeManager.gitPush(dirPath, {
      remote: body.remote,
      branches,
      pushAllTags: !!body.pushAllTags,
      force: !!body.force,
    });
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/projects/:id/git-remotes
router.get('/:id/git-remotes', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const remotes = await worktreeManager.getRemotes(dirPath);
    res.json({ remotes });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-fetch
router.post('/:id/git-fetch', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { remote, prune } = req.body;
    await worktreeManager.gitFetch(dirPath, remote, prune);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-branch
router.post('/:id/git-branch', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { name, startPoint } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' }); return;
    }
    await worktreeManager.gitCreateBranch(dirPath, name.trim(), startPoint);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-branch-delete
router.post('/:id/git-branch-delete', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { name, force } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' }); return;
    }
    await worktreeManager.gitDeleteBranch(dirPath, name.trim(), !!force);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-checkout
router.post('/:id/git-checkout', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { branch } = req.body;
    if (!branch || typeof branch !== 'string') {
      res.status(400).json({ error: 'branch is required' }); return;
    }
    await worktreeManager.gitCheckout(dirPath, branch.trim());
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-merge
router.post('/:id/git-merge', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { branch } = req.body;
    if (!branch || typeof branch !== 'string') {
      res.status(400).json({ error: 'branch is required' }); return;
    }
    const result = await worktreeManager.gitMerge(dirPath, branch.trim());
    res.json({ ok: true, result });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-branch-rename
router.post('/:id/git-branch-rename', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { oldName, newName } = req.body;
    if (!oldName || typeof oldName !== 'string' || !newName || typeof newName !== 'string') {
      res.status(400).json({ error: 'oldName and newName are required' }); return;
    }
    await worktreeManager.gitRenameBranch(dirPath, oldName.trim(), newName.trim());
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-rebase
router.post('/:id/git-rebase', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { onto } = req.body;
    if (!onto || typeof onto !== 'string') {
      res.status(400).json({ error: 'onto is required' }); return;
    }
    const result = await worktreeManager.gitRebase(dirPath, onto.trim());
    res.json({ ok: true, result });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-stash
router.post('/:id/git-stash', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { message } = req.body;
    await worktreeManager.gitStashPush(dirPath, message);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-stash-pop
router.post('/:id/git-stash-pop', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { index } = req.body;
    await worktreeManager.gitStashPop(dirPath, index ?? 0);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/projects/:id/git-stash-list
router.get('/:id/git-stash-list', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const stashes = await worktreeManager.gitStashList(dirPath);
    res.json(stashes);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-discard
router.post('/:id/git-discard', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { files, all } = req.body;
    if (all) {
      await worktreeManager.gitDiscardAll(dirPath);
    } else if (files && Array.isArray(files) && files.length > 0) {
      await worktreeManager.gitDiscard(dirPath, files);
    } else {
      res.status(400).json({ error: 'files array or all flag is required' }); return;
    }
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-tag
router.post('/:id/git-tag', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { name, message, commit } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' }); return;
    }
    await worktreeManager.gitCreateTag(dirPath, name.trim(), message, commit);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/git-tag-delete
router.post('/:id/git-tag-delete', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' }); return;
    }
    await worktreeManager.gitDeleteTag(dirPath, name.trim());
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/projects/:id/git-commit-files - get files changed in a specific commit
router.get('/:id/git-commit-files', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const hash = req.query.hash as string | undefined;
    if (!hash || !/^[0-9a-f]{4,40}$/i.test(hash)) {
      res.status(400).json({ error: 'Valid commit hash is required' }); return;
    }
    const files = await worktreeManager.getCommitFiles(dirPath, hash);
    res.json({ files });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/projects/:id/git-commit-diff - get diff for a specific commit
router.get('/:id/git-commit-diff', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const hash = req.query.hash as string | undefined;
    if (!hash || !/^[0-9a-f]{4,40}$/i.test(hash)) {
      res.status(400).json({ error: 'Valid commit hash is required' }); return;
    }
    const file = req.query.file as string | undefined;
    const diff = await worktreeManager.getCommitDiff(dirPath, hash, file);
    res.json({ diff });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/projects/:id/git-diff
router.get('/:id/git-diff', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const dirPath = getProjectGitPath(req, res); if (!dirPath) return;
    const file = req.query.file as string | undefined;
    const staged = req.query.staged === 'true';
    const diff = await worktreeManager.gitDiff(dirPath, file, staged);
    res.json({ diff });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
