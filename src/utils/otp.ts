import bcrypt from 'bcrypt';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function hashOTP(otp: string): Promise<string> {
  return bcrypt.hash(otp, 10);
}

export function compareOTP(otp: string, hash: string): Promise<boolean> {
  return bcrypt.compare(otp, hash);
}

export interface NormalizedIdentifier {
  type: 'email' | 'phone';
  value: string;
}

/** Detects whether the given identifier is an email or a phone number, and normalizes it. */
export function normalizeIdentifier(raw: string): NormalizedIdentifier | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  if (trimmed.includes('@')) {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(trimmed)) return null;
    return { type: 'email', value: trimmed.toLowerCase() };
  }

  const parsed = parsePhoneNumberFromString(trimmed, 'IN');
  if (parsed && parsed.isValid()) {
    return { type: 'phone', value: parsed.number };
  }
  return null;
}
