export interface TaskIntentValidation {
  valid: boolean;
  reason?: string;
}

const ACTION_KEYWORDS = [
  'add', 'build', 'change', 'create', 'debug', 'document', 'edit', 'explain',
  'fix', 'implement', 'improve', 'investigate', 'make', 'refactor', 'remove',
  'rename', 'repair', 'replace', 'test', 'update', 'write',
  '개선', '구현', '고쳐', '고치', '디버그', '만들', '문서', '변경', '분석', '삭제',
  '설명', '수정', '업데이트', '작성', '조사', '추가', '테스트', '리팩터링',
];

const NON_ACTIONABLE_PATTERNS = [
  /^[ㅎ하호헤힣ㅇ]+[!?~. ]*$/i,
  /^[a-z]{1,4}[!?~. ]*$/i,
  /^(hi|hey|hello|yo|sup|ping|test)[!?~. ]*$/i,
  /^(안녕|하이|헬로|핑|테스트)[!?~. ]*$/i,
];

export function validateTaskIntent(content: string): TaskIntentValidation {
  const normalized = content.trim().replace(/\s+/g, ' ');

  if (!normalized) {
    return {
      valid: false,
      reason: 'Task description is empty. Provide a concrete coding task.',
    };
  }

  if (normalized.length < 5) {
    return {
      valid: false,
      reason: 'Task description is too short. Provide a concrete coding task.',
    };
  }

  if (NON_ACTIONABLE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      valid: false,
      reason: 'Task description looks like a greeting or connectivity check, not an actionable coding task.',
    };
  }

  const hasKeyword = ACTION_KEYWORDS.some((keyword) => normalized.toLowerCase().includes(keyword.toLowerCase()));
  const hasStructure = /[`/\\.<>{}()=:_-]|\b(file|bug|code|ui|api|route|test|component|function|branch|commit)\b/i.test(normalized);

  if (!hasKeyword && !hasStructure && normalized.length < 12) {
    return {
      valid: false,
      reason: 'Task description is not specific enough to execute. Describe the change you want made.',
    };
  }

  return { valid: true };
}
