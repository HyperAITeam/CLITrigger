import { describe, expect, it } from 'vitest';
import { validateTaskIntent } from '../task-intent.js';

describe('task-intent', () => {
  it('rejects greeting-only tasks', () => {
    expect(validateTaskIntent('ㅎㅇ')).toEqual({
      valid: false,
      reason: 'Task description is too short. Provide a concrete coding task.',
    });
    expect(validateTaskIntent('hello')).toEqual({
      valid: false,
      reason: 'Task description looks like a greeting or connectivity check, not an actionable coding task.',
    });
  });

  it('accepts actionable coding work', () => {
    expect(validateTaskIntent('로그인 버튼 클릭 버그를 수정해줘')).toEqual({ valid: true });
    expect(validateTaskIntent('Fix the failing login test in auth.spec.ts')).toEqual({ valid: true });
  });
});
