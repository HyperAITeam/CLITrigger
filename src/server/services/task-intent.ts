export interface TaskIntentValidation {
  valid: boolean;
  reason?: string;
}

export function validateTaskIntent(_content: string): TaskIntentValidation {
  return { valid: true };
}
