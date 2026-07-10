/**
 * Email Service using Gmail
 */

import nodemailer from 'nodemailer';
import { config } from 'dotenv';

config({ path: '.env.local' });

// Configure Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER, // your-email@gmail.com
    pass: process.env.GMAIL_APP_PASSWORD // Gmail App Password
  }
});

// ==================== GENERATE OTP ====================
export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function isGmailConfigured(): boolean {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  return Boolean(user && pass && user !== 'your-email@gmail.com');
}

// ==================== SEND OTP EMAIL ====================
export async function sendOTPEmail(email: string, otp: string, name: string): Promise<void> {
  if (!isGmailConfigured()) {
    console.warn(`[Email not configured] OTP for ${email}: ${otp}`);
    return;
  }
  try {
    const mailOptions = {
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
      `
    };

    await transporter.sendMail(mailOptions);
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

// ==================== SEND PASSWORD RESET EMAIL ====================
export async function sendPasswordResetEmail(
  email: string,
  resetToken: string,
  name: string
): Promise<void> {
  try {
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: email,
      subject: 'Tejoma - Reset Your Password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">Reset Your Password</h2>
          <p>Hi ${name},</p>
          <p>We received a request to reset your password. Click the button below to set a new password:</p>
          <div style="text-align: center; margin: 20px 0;">
            <a href="${resetLink}" style="background: #10b981; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold;">
              Reset Password
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">Or copy this link: ${resetLink}</p>
          <p style="color: #999; font-size: 12px;">This link expires in 1 hour.</p>
          <p style="color: #999; font-size: 12px;">If you didn't request this, please ignore this email.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`Password reset link sent to ${email}`);
  } catch (error) {
    console.error('Error sending reset email:', error);
    throw error;
  }
}