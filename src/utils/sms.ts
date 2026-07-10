/**
 * SMS OTP delivery via Twilio.
 * Falls back to logging the code to the server console when Twilio isn't configured,
 * so phone signup/login works end-to-end in dev before real SMS credentials exist.
 */

import twilio from 'twilio';

let client: ReturnType<typeof twilio> | null = null;

function isTwilioConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

function getClient(): ReturnType<typeof twilio> | null {
  if (!isTwilioConfigured()) return null;
  if (!client) {
    client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
  }
  return client;
}

export async function sendOTPSms(phone: string, otp: string): Promise<void> {
  const c = getClient();
  if (!c) {
    console.warn(`[SMS not configured - set TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER] OTP for ${phone}: ${otp}`);
    return;
  }
  try {
    await c.messages.create({
      body: `Your Tejoma verification code is ${otp}. It expires in 10 minutes.`,
      from: process.env.TWILIO_FROM_NUMBER,
      to: phone,
    });
    console.log(`OTP SMS sent to ${phone}`);
  } catch (error) {
    console.error('Error sending OTP SMS:', error);
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[SMS send failed - dev fallback] OTP for ${phone}: ${otp}`);
      return;
    }
    throw error;
  }
}
