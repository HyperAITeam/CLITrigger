import { describe, it, expect } from 'vitest';
import { WorktreeManager } from '../worktree-manager.js';

describe('WorktreeManager', () => {
  const manager = new WorktreeManager();

  describe('sanitizeBranchName', () => {
    it('should convert simple English title to branch name', () => {
      const result = manager.sanitizeBranchName('Fix login bug');
      expect(result).toBe('feature/fix-login-bug');
    });

    it('should handle uppercase letters', () => {
      const result = manager.sanitizeBranchName('Add New Feature');
      expect(result).toBe('feature/add-new-feature');
    });

    it('should remove special characters', () => {
      const result = manager.sanitizeBranchName('Fix bug #123 (urgent!)');
      expect(result).toBe('feature/fix-bug-123-urgent');
    });

    it('should collapse multiple hyphens', () => {
      const result = manager.sanitizeBranchName('Fix   multiple   spaces');
      expect(result).toBe('feature/fix-multiple-spaces');
    });

    it('should trim leading and trailing hyphens', () => {
      const result = manager.sanitizeBranchName('  leading and trailing  ');
      expect(result).toBe('feature/leading-and-trailing');
    });

    it('should handle Korean characters', () => {
      const result = manager.sanitizeBranchName('로그인 버그 수정');
      expect(result).toMatch(/^feature\//);
      expect(result.length).toBeGreaterThan('feature/'.length);
    });

    it('should truncate long titles to 50 chars', () => {
      const longTitle = 'a'.repeat(100);
      const result = manager.sanitizeBranchName(longTitle);
      const slug = result.replace('feature/', '');
      expect(slug.length).toBeLessThanOrEqual(50);
    });

    it('should fallback to task-timestamp for empty-resulting slugs', () => {
      const result = manager.sanitizeBranchName('!!!');
      expect(result).toMatch(/^feature\/task-[a-z0-9]+$/);
    });

    it('should handle mixed Korean and English', () => {
      const result = manager.sanitizeBranchName('Add 로그인 feature');
      expect(result).toMatch(/^feature\//);
      expect(result).toContain('add');
      expect(result).toContain('feature');
    });
  });
});
