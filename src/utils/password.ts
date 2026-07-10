import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as zxcvbnCommonPackage from '@zxcvbn-ts/language-common';
import * as zxcvbnEnPackage from '@zxcvbn-ts/language-en';

const zxcvbnInstance = new ZxcvbnFactory({
  dictionary: {
    ...zxcvbnCommonPackage.dictionary,
    ...zxcvbnEnPackage.dictionary,
  },
  graphs: zxcvbnCommonPackage.adjacencyGraphs,
  translations: zxcvbnEnPackage.translations,
});

export const PASSWORD_MIN_LENGTH = 8;
// zxcvbn scores 0-4 (worst-best). 2 ("fair") is the standard minimum bar used by most
// production strength meters - 0/1 catches "password123", "qwerty", name/email-based, etc.
const MIN_ZXCVBN_SCORE = 2;

const SCORE_LABELS = ['very weak', 'weak', 'fair', 'good', 'strong'] as const;

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
  score: number;
  label: (typeof SCORE_LABELS)[number];
}

/**
 * `userInputs` should be the account's own name/email/phone/company - zxcvbn penalizes
 * passwords built from a user's own identity (e.g. "JohnSmith123" for a user named John Smith).
 */
export function validatePassword(password: string, userInputs: string[] = []): PasswordValidationResult {
  const errors: string[] = [];

  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (!/[a-z]/.test(password)) errors.push('Password must contain at least one lowercase letter');
  if (!/[A-Z]/.test(password)) errors.push('Password must contain at least one uppercase letter');
  if (!/[0-9]/.test(password)) errors.push('Password must contain at least one number');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('Password must contain at least one special character');

  const result = zxcvbnInstance.check(password, userInputs.filter(Boolean));
  const label = SCORE_LABELS[result.score];

  if (result.score < MIN_ZXCVBN_SCORE) {
    const reason = result.feedback.warning || 'This password is too common or easy to guess';
    const suggestion = result.feedback.suggestions[0] ? ` ${result.feedback.suggestions[0]}` : '';
    errors.push(`${reason}.${suggestion}`);
  }

  return { valid: errors.length === 0, errors, score: result.score, label };
}
