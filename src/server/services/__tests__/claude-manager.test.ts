import { describe, it, expect } from 'vitest';
import { ClaudeManager } from '../claude-manager.js';

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
});
