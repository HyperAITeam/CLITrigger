/**
 * Prompt injection defense utilities.
 * Validates and flags suspicious content before it becomes part of AI prompts.
 * Warning-only by design — does not block content to avoid false positives.
 */

export const MAX_TITLE_LENGTH = 500;
export const MAX_DESCRIPTION_LENGTH = 50_000;

const INJECTION_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /ignore\s+(all\s+)?previous\s+instructions/i, label: 'ignore-previous-instructions' },
  { pattern: /ignore\s+(all\s+)?above\s+instructions/i, label: 'ignore-above-instructions' },
  { pattern: /disregard\s+(all\s+)?previous/i, label: 'disregard-previous' },
  { pattern: /you\s+are\s+now\s+(a|an)\s+/i, label: 'role-override' },
  { pattern: /new\s+instructions?\s*:/i, label: 'new-instructions' },
  { pattern: /\bsystem\s*:\s*/i, label: 'system-prefix' },
  { pattern: /\[INST\]/i, label: 'inst-tag' },
  { pattern: /<<SYS>>/i, label: 'sys-tag' },
  { pattern: /<\|im_start\|>/i, label: 'im-start-tag' },
  { pattern: /<\|im_end\|>/i, label: 'im-end-tag' },
  { pattern: /```\s*system\b/i, label: 'system-code-block' },
];

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  sanitized: string;
}

/**
 * Validate content that will be included in AI prompts.
 * Returns warnings for logging — does NOT block content.
 * Truncates to max length if exceeded.
 */
export function validatePromptContent(
  content: string,
  maxLength: number = MAX_DESCRIPTION_LENGTH,
): ValidationResult {
  const warnings: string[] = [];

  if (content.length > maxLength) {
    warnings.push(`Content truncated from ${content.length} to ${maxLength} characters`);
    content = content.slice(0, maxLength);
  }

  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      warnings.push(`Suspicious pattern detected: ${label}`);
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
    sanitized: content,
  };
}
