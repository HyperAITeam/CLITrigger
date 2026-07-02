import { describe, it, expect, vi, afterEach } from 'vitest';
import { ClaudeManager } from '../claude-manager.js';
import * as cliStatus from '../cli-status.js';

describe('ClaudeManager', () => {
  describe('isRunning', () => {
    it('should return false for unknown PID', () => {
      const manager = new ClaudeManager();
      expect(manager.isRunning(99999)).toBe(false);
    });
  });

  describe('stopClaude', () => {
    it('should resolve immediately for unknown PID', async () => {
      const manager = new ClaudeManager();
      await expect(manager.stopClaude(99999)).resolves.toBeUndefined();
    });
  });

  describe('killAll', () => {
    it('should resolve when no processes exist', async () => {
      const manager = new ClaudeManager();
      await expect(manager.killAll()).resolves.toBeUndefined();
    });
  });

  describe('startClaude pre-flight (Windows)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('rejects with an actionable message when the CLI is not installed', async () => {
      if (process.platform !== 'win32') return; // pre-flight is win32-only
      vi.spyOn(cliStatus, 'getToolStatus').mockResolvedValue({ tool: 'antigravity', installed: false, version: null });
      const manager = new ClaudeManager();
      await expect(
        manager.startClaude(process.cwd(), 'hi', undefined, undefined, 'headless', 'antigravity')
      ).rejects.toThrow(/not found on PATH/);
    });
  });
});
