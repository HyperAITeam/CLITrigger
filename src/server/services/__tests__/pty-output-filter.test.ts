import { describe, it, expect } from 'vitest';
import { isNoiseLine, filterInteractivePtyOutput, createPtyFilterState, isPlainTextNoise } from '../pty-output-filter.js';

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
      // Spinner with thinking suffix
      expect(isNoiseLine('✢ Beaming… (thinking)')).toBe(true);
      expect(isNoiseLine('✶Simmering…')).toBe(true);
      expect(isNoiseLine('✽Simmering… (thought for 2s)')).toBe(true);
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

    it('filters separator with trailing prompt char', () => {
      expect(isNoiseLine('────────────────────────────────>')).toBe(true);
    });

    it('filters prompt template echo', () => {
      expect(isNoiseLine('You are working in a git worktree. Complete the task...')).toBe(true);
      expect(isNoiseLine('After completing the task, commit all changes with a descriptive commit message.')).toBe(true);
      expect(isNoiseLine('IMPORTANT: Your working directory is C:\\Osgood\\...')).toBe(true);
      expect(isNoiseLine('<user_task>')).toBe(true);
      expect(isNoiseLine('</user_task>')).toBe(true);
    });

    it('filters short partial redraws', () => {
      expect(isNoiseLine('*F')).toBe(true);
      expect(isNoiseLine('✢id')).toBe(true);
      expect(isNoiseLine('·F')).toBe(true);
    });

    it('filters concatenated animation frames (multiple (thinking))', () => {
      expect(isNoiseLine('✢ (thinking) * (thinking) ✶ (thinking) ✻ (thinking)')).toBe(true);
      expect(isNoiseLine('(thinking) ✻ (thinking) (thinking) ✶ (thinking)')).toBe(true);
    });

    it('filters fragmented animation characters', () => {
      expect(isNoiseLine('✢ * ✶ ✻ Smo ✽ S o m s oo hi s n ✻ h g i … ✶ ng…')).toBe(true);
      expect(isNoiseLine('✢ h i es zi · i n z g i … ng ✢ … * ✶ ✻ ✽ ✻ ✶ P * ho Pho')).toBe(true);
    });

    it('filters single-spinner-prefixed fragmented redraws', () => {
      // Spinner frames where cursor repositioning became spaces — no trailing …
      expect(isNoiseLine('✶ r P ec')).toBe(true);
      expect(isNoiseLine('✻ r i e p')).toBe(true);
      expect(isNoiseLine('✻ t i at ng')).toBe(true);
      expect(isNoiseLine('✽ Pre Pr ci e p')).toBe(true);
      expect(isNoiseLine('✻ c i i t')).toBe(true);
      expect(isNoiseLine('✶ pi at')).toBe(true);
      expect(isNoiseLine('* t i a n')).toBe(true);
    });

    it('keeps real markdown bullets with substantive words', () => {
      expect(isNoiseLine('* First item')).toBe(false);
      expect(isNoiseLine('* Install dependencies')).toBe(false);
    });

    it('filters single-token spinner redraws (word mid-animation)', () => {
      // "Learning" being redrawn: "* Lea", "* Le", etc.
      expect(isNoiseLine('* Lea')).toBe(true);
      expect(isNoiseLine('* Le')).toBe(true);
      expect(isNoiseLine('✶ Pre')).toBe(true);
      expect(isNoiseLine('✻ ing')).toBe(true);
    });

    it('filters plus-prefix spinner fragments with (thinking)', () => {
      // "+" is also a spinner variant in some CLI animations
      expect(isNoiseLine('+ c s (thinking)')).toBe(true);
      expect(isNoiseLine('+ (thinking)')).toBe(true);
      expect(isNoiseLine('+ Processing…')).toBe(true);
    });

    it('filters numbered prompt echo with spaced angle bracket', () => {
      // TUI sometimes renders "3 > text" with space between number and >
      expect(isNoiseLine('3 > 아테스트중이야')).toBe(true);
      expect(isNoiseLine('10 > hello')).toBe(true);
      // Existing no-space form still filtered
      expect(isNoiseLine('3> 뭐해?')).toBe(true);
    });

    it('filters Ink status sub-lines (Hmm…, Loading…)', () => {
      expect(isNoiseLine('⎿  Hmm…')).toBe(true);
      expect(isNoiseLine('Hmm…')).toBe(true);
      expect(isNoiseLine('⎿ Loading…')).toBe(true);
    });

    it('keeps real ⎿ sub-lines (tool result continuation)', () => {
      expect(isNoiseLine('⎿  Wrote 3 lines to 헬로지토.md')).toBe(false);
      expect(isNoiseLine('⎿ .gitignore')).toBe(false);
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

    it('splits on bare \\r (TUI animation frame separator)', () => {
      const state = createPtyFilterState();
      // Three spinner frames rewritten with \r, then a real response after \n
      const chunk = '✶ Photosynthesizing…\r✻ Photosynthesizing…\r✽ Photosynthesizing…\n● 파일 생성 완료\n';
      const result = filterInteractivePtyOutput(chunk, state);
      expect(result).toContain('● 파일 생성 완료');
      expect(result).not.toContain('Photosynthesizing');
    });

    it('filters accumulated animation frames even without \\n', () => {
      const state = createPtyFilterState();
      // Many bare-\r frames followed by a real line
      let chunk = '';
      for (let i = 0; i < 10; i++) chunk += `✻ Thinking…\r`;
      chunk += '● Real response\n';
      const result = filterInteractivePtyOutput(chunk, state);
      expect(result).toContain('● Real response');
      expect(result).not.toContain('Thinking');
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

  describe('multi-line noise blocks (Windows node-pty / xterm.js)', () => {
    it('drops the entire xterm.js Parsing error dump including nested params and Int32Array rows', () => {
      const state = createPtyFilterState();
      const chunk = [
        'I will list the files in the directory.',
        'xterm.js: Parsing error: {',
        'position: 31,',
        'code: 20197,',
        'currentState: 7,',
        'collect: 0,',
        'params: s3 {',
        '  maxLength: 32,',
        '  maxSubParamsLength: 32,',
        '  params: Int32Array(32) [',
        '    0, 5, 9, 0, 0, 0, 0, 0, 0,',
        '    0, 0, 0, 0, 0, 0, 0, 0, 0,',
        '    0, 0, 0, 0, 0, 0, 0, 0, 0,',
        '    0, 0, 0, 0, 0',
        '  ],',
        '  length: 1,',
        '  _subParams: Int32Array(32) [',
        '    0, 0, 0, 0, 0, 0, 0, 0, 0,',
        '    0, 0, 0, 0, 0, 0, 0, 0, 0,',
        '    0, 0, 0, 0, 0, 0, 0, 0, 0,',
        '    0, 0, 0, 0, 0',
        '  ],',
        '  _subParamsLength: 0,',
        '  _subParamsIdx: Uint16Array(32) [',
        '    0, 0, 0, 0, 0, 0, 0, 0, 0,',
        '    0, 0, 0, 0, 0, 0, 0, 0, 0,',
        '    0, 0, 0, 0, 0, 0, 0, 0, 0,',
        '    0, 0, 0, 0, 0',
        '  ],',
        '  _rejectDigits: false,',
        '  _rejectSubDigits: false,',
        '  _digitIsSub: false',
        '},',
        'abort: false',
        '}',
        '● Done!',
        '',
      ].join('\n');
      const result = filterInteractivePtyOutput(chunk, state);
      expect(result).toContain('I will list the files');
      expect(result).toContain('● Done!');
      expect(result).not.toContain('xterm.js');
      expect(result).not.toContain('Int32Array');
      expect(result).not.toContain('position');
      expect(result).not.toContain('Uint16Array');
      expect(result).not.toContain('_digitIsSub');
    });

    it('drops a node-pty conpty stack trace from path leader through Node.js version', () => {
      const state = createPtyFilterState();
      const chunk = [
        'I will check the git status.',
        'C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules\\@google\\gemini-cli\\node_modules\\@lydell\\node-pty\\conpty_console_list_agent.js:11',
        '    var consoleProcessList = getConsoleProcessList(shellPid);',
        '    ^',
        'Error: AttachConsole failed',
        '    at Object.<anonymous> (C:\\Users\\user\\...conpty_console_list_agent.js:11:26)',
        '    at Module._compile (node:internal/modules/cjs/loader:1730:14)',
        '    at Object..js (node:internal/modules/cjs/loader:1895:10)',
        '    at Module.load (node:internal/modules/cjs/loader:1465:32)',
        '    at Function._load (node:internal/modules/cjs/loader:1282:12)',
        '    at TracingChannel.traceSync (node:diagnostics_channel:322:14)',
        '    at wrapModuleLoad (node:internal/modules/cjs/loader:235:24)',
        '    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:171:5)',
        '    at node:internal/main/run_main_module:36:49',
        'Node.js v22.17.0',
        '● Continuing.',
        '',
      ].join('\n');
      const result = filterInteractivePtyOutput(chunk, state);
      expect(result).toContain('I will check the git status');
      expect(result).toContain('● Continuing.');
      expect(result).not.toContain('AttachConsole');
      expect(result).not.toContain('conpty_console_list_agent');
      expect(result).not.toContain('Node.js v22');
      expect(result).not.toContain('TracingChannel');
    });

    it('preserves real ENOENT / Error: messages outside the conpty block', () => {
      const state = createPtyFilterState();
      const chunk = [
        'Error: ENOENT: no such file or directory, open \'config.json\'',
        'fatal: not a git repository',
        'Permission denied: /etc/passwd',
        '',
      ].join('\n');
      const result = filterInteractivePtyOutput(chunk, state);
      expect(result).toContain('ENOENT');
      expect(result).toContain('not a git repository');
      expect(result).toContain('Permission denied');
    });

    it('isNoiseLine drops AttachConsole and conpty agent lines individually', () => {
      expect(isNoiseLine('Error: AttachConsole failed')).toBe(true);
      expect(isNoiseLine('    at Object.<anonymous> (.../conpty_console_list_agent.js:11:26)')).toBe(true);
      expect(isNoiseLine('xterm.js: Parsing error: {')).toBe(true);
      expect(isNoiseLine('Node.js v22.17.0')).toBe(true);
      // Real errors must still pass through
      expect(isNoiseLine('Error: ENOENT')).toBe(false);
      expect(isNoiseLine('fatal: not a git repository')).toBe(false);
    });

    it('runaway block is force-released after the safety cap', () => {
      const state = createPtyFilterState();
      // Open an xterm.js block but never emit the closing '}' alone on a line.
      const lines = ['xterm.js: Parsing error: {'];
      for (let i = 0; i < 250; i++) lines.push(`  field${i}: ${i},`);
      // After 200 lines the block guard force-exits; subsequent meaningful
      // lines should pass through.
      lines.push('● Survived the dump.');
      lines.push('');
      const result = filterInteractivePtyOutput(lines.join('\n'), state);
      expect(result).toContain('● Survived');
      expect(state.activeBlock).toBeNull();
    });

    it('isPlainTextNoise tracks block state across separate calls (per-line)', () => {
      const state = createPtyFilterState();
      // Simulate log-streamer invoking the filter line-by-line (no buffering).
      expect(isPlainTextNoise('xterm.js: Parsing error: {', state)).toBe(true);
      expect(isPlainTextNoise('  position: 31,', state)).toBe(true);
      expect(isPlainTextNoise('  params: s3 {', state)).toBe(true);
      expect(isPlainTextNoise('    maxLength: 32,', state)).toBe(true);
      expect(isPlainTextNoise('  },', state)).toBe(true); // inner close — stays in block
      expect(state.activeBlock).toBe('xterm-parse');
      expect(isPlainTextNoise('  abort: false', state)).toBe(true);
      expect(isPlainTextNoise('}', state)).toBe(true); // outer close — ends block
      expect(state.activeBlock).toBeNull();
      // Subsequent normal output passes through.
      expect(isPlainTextNoise('I will create a new markdown file.', state)).toBe(false);
    });

    it('isPlainTextNoise drops conpty stack lines split across stdout/stderr', () => {
      const state = createPtyFilterState();
      // stdout side
      expect(isPlainTextNoise('C:\\path\\node-pty\\conpty_console_list_agent.js:11', state)).toBe(true);
      expect(isPlainTextNoise('  var consoleProcessList = getConsoleProcessList(shellPid);', state)).toBe(true);
      // stderr side (different stream, same shared state)
      expect(isPlainTextNoise('Error: AttachConsole failed', state)).toBe(true);
      expect(isPlainTextNoise('    at Object.<anonymous> (...conpty_console_list_agent.js:11:26)', state)).toBe(true);
      expect(isPlainTextNoise('Node.js v22.17.0', state)).toBe(true);
      expect(state.activeBlock).toBeNull();
      // Real output after the block.
      expect(isPlainTextNoise('Successfully completed.', state)).toBe(false);
    });

    it('drops Int32Array element rows on their own (single-line fallback)', () => {
      // These can leak when the block end fires early but the surrounding
      // structure is still being printed.
      expect(isNoiseLine('  Int32Array(32) [')).toBe(true);
      expect(isNoiseLine('  Uint16Array(32) [')).toBe(true);
      expect(isNoiseLine('  ],')).toBe(true);
      expect(isNoiseLine('  s3 {')).toBe(true);
      expect(isNoiseLine('  position: 31,')).toBe(true);
      expect(isNoiseLine('  abort: false')).toBe(true);
    });
  });
});
