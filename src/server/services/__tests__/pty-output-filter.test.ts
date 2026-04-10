import { describe, it, expect } from 'vitest';
import { isNoiseLine, filterInteractivePtyOutput, createPtyFilterState } from '../pty-output-filter.js';

describe('pty-output-filter', () => {
  describe('isNoiseLine', () => {
    // ── Noise lines (should return true) ──
    it('filters box drawing separators', () => {
      expect(isNoiseLine('────────────────────────────')).toBe(true);
      expect(isNoiseLine('━━━━━━━━━━━━━━━━━━━━━━━━━━')).toBe(true);
      expect(isNoiseLine('  ─────────  ')).toBe(true);
    });

    it('filters Claude banner frame', () => {
      expect(isNoiseLine('╭───ClaudeCodev2.1.98────────╮')).toBe(true);
      expect(isNoiseLine('╰────────────────────────────╯')).toBe(true);
    });

    it('filters vertical pipe lines', () => {
      expect(isNoiseLine('│')).toBe(true);
      expect(isNoiseLine('  │  ')).toBe(true);
    });

    it('filters status bar with model info', () => {
      expect(isNoiseLine('[Haiku 4.5 | Team] │ feature-task git:(feature/task*)')).toBe(true);
      expect(isNoiseLine('[Sonnet 4.6 | Personal] │ main git:(main)')).toBe(true);
      expect(isNoiseLine('[Opus 4.6 | Team] │ branch')).toBe(true);
    });

    it('filters context/usage bars', () => {
      expect(isNoiseLine('Context ██░░░░░░░░ 15% │ Usage ████░░░░░░ 38%')).toBe(true);
      expect(isNoiseLine('Context ░░░░░░░░░░ 0%')).toBe(true);
    });

    it('filters hook count', () => {
      expect(isNoiseLine('2 hooks')).toBe(true);
      expect(isNoiseLine('1 hook')).toBe(true);
    });

    it('filters prompt mode indicator', () => {
      expect(isNoiseLine('⏵⏵ don\'t ask on (shift+tab to cycle)')).toBe(true);
    });

    it('filters TUI hints', () => {
      expect(isNoiseLine('ctrl+g to edit in Notepad.exe')).toBe(true);
      expect(isNoiseLine('shift+tab to cycle')).toBe(true);
    });

    it('filters tip lines', () => {
      expect(isNoiseLine('⎿ Tip: Create skills by adding .md files')).toBe(true);
      expect(isNoiseLine('⎿ Tip: Running multiple Claude sessions?')).toBe(true);
    });

    it('filters spinner lines', () => {
      expect(isNoiseLine('✶ Germinating…')).toBe(true);
      expect(isNoiseLine('✻ Fiddle-faddling…')).toBe(true);
      expect(isNoiseLine('✢ Prestidigitating…')).toBe(true);
      expect(isNoiseLine('· Pollinating…')).toBe(true);
      expect(isNoiseLine('* Pollinating…')).toBe(true);
    });

    it('filters thinking indicators', () => {
      expect(isNoiseLine('(thinking)')).toBe(true);
      expect(isNoiseLine('(thinking)(thinking)')).toBe(true);
      expect(isNoiseLine('(thought for 1s)')).toBe(true);
      expect(isNoiseLine('(thought for 12s)')).toBe(true);
    });

    it('filters welcome screen elements', () => {
      expect(isNoiseLine('Welcome back 이창진(Com2us)!')).toBe(true);
      expect(isNoiseLine('Tips for getting started')).toBe(true);
      expect(isNoiseLine('No recent activity')).toBe(true);
      expect(isNoiseLine('Recent activity')).toBe(true);
      expect(isNoiseLine('Run /init to create a CLAUDE.md file')).toBe(true);
    });

    it('filters Claude logo chars', () => {
      expect(isNoiseLine('▐▛███▜▌')).toBe(true);
      expect(isNoiseLine('▝▜█████▛▘')).toBe(true);
      expect(isNoiseLine('▘▘ ▝▝')).toBe(true);
    });

    it('filters user input echo', () => {
      expect(isNoiseLine('> ㅎㅇ?')).toBe(true);
      expect(isNoiseLine('> some user input')).toBe(true);
    });

    it('filters short partial redraws', () => {
      expect(isNoiseLine('*F')).toBe(true);
      expect(isNoiseLine('✢id')).toBe(true);
      expect(isNoiseLine('·F')).toBe(true);
    });

    it('filters empty/whitespace lines', () => {
      expect(isNoiseLine('')).toBe(true);
      expect(isNoiseLine('   ')).toBe(true);
    });

    it('filters cost display', () => {
      expect(isNoiseLine('$0.0234')).toBe(true);
    });

    // ── Keep lines (should return false) ──
    it('keeps AI response lines (● prefix)', () => {
      expect(isNoiseLine('● 안녕! 👋')).toBe(false);
      expect(isNoiseLine('● I see you\'ve provided what appears to be random characters.')).toBe(false);
    });

    it('keeps tool call notifications', () => {
      expect(isNoiseLine('[Tool: Read] file.ts')).toBe(false);
      expect(isNoiseLine('[Tool: Bash] git status')).toBe(false);
    });

    it('keeps error messages', () => {
      expect(isNoiseLine('Error: file not found')).toBe(false);
      expect(isNoiseLine('fatal: not a git repository')).toBe(false);
      expect(isNoiseLine('Permission denied')).toBe(false);
    });

    it('keeps substantive text lines', () => {
      expect(isNoiseLine('뭘 도와드릴까요? 코드 작업이나 프로젝트와 관련해서 뭐든 물어봐도 괜찮습니다!')).toBe(false);
      expect(isNoiseLine('Please provide a clear description of the task.')).toBe(false);
      expect(isNoiseLine('- Create or modify a specific file?')).toBe(false);
    });
  });

  describe('filterInteractivePtyOutput', () => {
    it('filters noise lines from multi-line chunk', () => {
      const state = createPtyFilterState();
      const chunk = '────────────────\n● Hello!\nsome text\n⏵⏵ don\'t ask\n';
      const result = filterInteractivePtyOutput(chunk, state);
      expect(result).toContain('● Hello!');
      expect(result).toContain('some text');
      expect(result).not.toContain('────');
      expect(result).not.toContain('⏵⏵');
    });

    it('buffers partial lines until newline', () => {
      const state = createPtyFilterState();
      const result1 = filterInteractivePtyOutput('● Hel', state);
      expect(result1).toBe(''); // still in buffer
      const result2 = filterInteractivePtyOutput('lo!\n', state);
      expect(result2).toContain('● Hello!');
    });

    it('deduplicates repeated lines', () => {
      const state = createPtyFilterState();
      filterInteractivePtyOutput('some content\n', state);
      const result = filterInteractivePtyOutput('some content\n', state);
      expect(result).toBe('');
    });

    it('does not deduplicate AI response lines', () => {
      const state = createPtyFilterState();
      filterInteractivePtyOutput('● Hello!\n', state);
      const result = filterInteractivePtyOutput('● Hello!\n', state);
      expect(result).toContain('● Hello!');
    });

    it('returns empty string when all lines are noise', () => {
      const state = createPtyFilterState();
      const chunk = '────────────\n⏵⏵ hint\n(thinking)\n';
      const result = filterInteractivePtyOutput(chunk, state);
      expect(result).toBe('');
    });

    it('tracks response blocks for continuation lines', () => {
      const state = createPtyFilterState();
      const chunk = '● Here is my response:\n- First point\n- Second point\n';
      const result = filterInteractivePtyOutput(chunk, state);
      expect(result).toContain('● Here is my response:');
      expect(result).toContain('- First point');
      expect(result).toContain('- Second point');
    });

    it('handles mixed noise and content', () => {
      const state = createPtyFilterState();
      const chunk = [
        '────────────────',
        '[Haiku 4.5 | Team] │ branch git:(branch*)',
        '● 네, 들립니다!',
        '뭘 도와드릴까요?',
        '✶ Germinating…',
        'Context ██░░░░░░░░ 15%',
        '',
      ].join('\n');
      const result = filterInteractivePtyOutput(chunk, state);
      expect(result).toContain('● 네, 들립니다!');
      expect(result).toContain('뭘 도와드릴까요?');
      expect(result).not.toContain('Haiku');
      expect(result).not.toContain('Germinating');
      expect(result).not.toContain('Context');
    });
  });
});
