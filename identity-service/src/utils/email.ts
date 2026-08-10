/**
 * Email delivery via Gmail - ported from the monolith's src/utils/email.ts. Only sendOTPEmail is
 * ported (the function auth.routes.ts actually calls for OTP delivery); sendPasswordResetEmail
 * exists in the monolith's file but is dead code there too (no route calls it - the real
 * password-reset flow is OTP-based, not token-link-based) - not ported, since porting unused code
 * would violate this service's own "no placeholder/unused code" discipline.
 */
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

function isGmailConfigured(): boolean {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  return Boolean(user && pass && user !== 'your-email@gmail.com');
}

export async function sendOTPEmail(email: string, otp: string, name: string): Promise<void> {
  if (!isGmailConfigured()) {
    console.warn(`[Email not configured] OTP for ${email}: ${otp}`);
    return;
  }
  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: email,
      subject: 'Tejoma - Email Verification OTP',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">Welcome to Tejoma, ${name}!</h2>
          <p>Your email verification code is:</p>
          <div style="background: #f0f0f0; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <h1 style="color: #2563eb; letter-spacing: 5px; margin: 0;">${otp}</h1>
          </div>
          <p style="color: #666; font-size: 14px;">This code expires in 10 minutes.</p>
          <p style="color: #999; font-size: 12px;">If you didn't request this, please ignore this email.</p>
        </div>
      `,
    });
    console.log(`OTP sent to ${email}`);
  } catch (error) {
    console.error('Error sending OTP email:', error);
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[Email send failed - dev fallback] OTP for ${email}: ${otp}`);
      return;
    }
    throw error;
  }
}
