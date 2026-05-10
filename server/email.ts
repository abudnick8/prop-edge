import { Resend } from "resend";

// Lazy init — don't crash on startup if RESEND_API_KEY isn't set yet
function getResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY env var not set");
  return new Resend(key);
}
const FROM_EMAIL = "Clubhouse IQ <noreply@clubhouseiq.app>";
const APP_URL = process.env.APP_URL || "https://clubhouse-iq.up.railway.app";

// Admin notification emails
const ADMIN_EMAILS = ["clubhouseiqbets@gmail.com", "adam.budnick8@gmail.com"];
export const SUPPORT_EMAIL = "clubhouseiqbets@gmail.com";

export async function sendPINResetEmail(toEmail: string, resetToken: string): Promise<void> {
  const resetUrl = `${APP_URL}/#/reset-pin?token=${resetToken}`;

  const resend = getResend();
  await resend.emails.send({
    from: FROM_EMAIL,
    to: toEmail,
    subject: "Reset your Clubhouse IQ PIN",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #131A24; margin-bottom: 8px;">Reset your PIN</h2>
        <p style="color: #3D4B58; margin-bottom: 24px;">
          Someone requested a PIN reset for your Clubhouse IQ account. 
          If that was you, click the button below. This link expires in 1 hour.
        </p>
        <a href="${resetUrl}" 
           style="display: inline-block; background: #13233A; color: #F6F1E7; 
                  padding: 12px 24px; border-radius: 8px; text-decoration: none; 
                  font-weight: bold; font-size: 14px;">
          Reset PIN
        </a>
        <p style="color: #8A9BB0; font-size: 12px; margin-top: 24px;">
          If you didn't request this, you can safely ignore this email.
          <br/>Link: ${resetUrl}
        </p>
      </div>
    `,
  });
}

export async function sendWelcomeEmail(toEmail: string, tier: string): Promise<void> {
  const tierLabel = tier === "pro" ? "Pro ($15/mo)" : "Basic ($5/mo)";

  const resend = getResend();
  await resend.emails.send({
    from: FROM_EMAIL,
    to: toEmail,
    subject: "Welcome to Clubhouse IQ",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #131A24; margin-bottom: 8px;">Welcome to Clubhouse IQ</h2>
        <p style="color: #3D4B58; margin-bottom: 16px;">
          Your <strong>${tierLabel}</strong> subscription is now active.
        </p>
        <a href="${APP_URL}" 
           style="display: inline-block; background: #13233A; color: #F6F1E7; 
                  padding: 12px 24px; border-radius: 8px; text-decoration: none; 
                  font-weight: bold; font-size: 14px;">
          Open Clubhouse IQ
        </a>
        <p style="color: #8A9BB0; font-size: 12px; margin-top: 24px;">
          Questions? Reply to this email or contact us at ${SUPPORT_EMAIL}
        </p>
      </div>
    `,
  });
}

export async function sendNewSignupNotification(newUserEmail: string, tier: string): Promise<void> {
  const resend = getResend();
  const tierLabel = tier === "pro" ? "Pro" : tier === "basic" ? "Basic" : "Free";
  const tierColor = tier === "pro" ? "#A23B32" : tier === "basic" ? "#2563eb" : "#3D4B58";
  const now = new Date().toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" });

  await resend.emails.send({
    from: FROM_EMAIL,
    to: ADMIN_EMAILS,
    subject: `🏟️ New Clubhouse IQ Signup — ${newUserEmail}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #F6F1E7; border-radius: 12px;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
          <span style="font-size: 28px;">🏟️</span>
          <h2 style="color: #131A24; margin: 0;">New Signup</h2>
        </div>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 10px 0; color: #3D4B58; font-size: 13px; border-bottom: 1px solid rgba(19,35,58,0.1);"><strong>Email</strong></td>
            <td style="padding: 10px 0; color: #131A24; font-size: 13px; border-bottom: 1px solid rgba(19,35,58,0.1);">${newUserEmail}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; color: #3D4B58; font-size: 13px; border-bottom: 1px solid rgba(19,35,58,0.1);"><strong>Plan</strong></td>
            <td style="padding: 10px 0; border-bottom: 1px solid rgba(19,35,58,0.1);">
              <span style="background: ${tierColor}; color: #fff; padding: 2px 10px; border-radius: 20px; font-size: 12px; font-weight: bold;">${tierLabel}</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 0; color: #3D4B58; font-size: 13px;"><strong>Time</strong></td>
            <td style="padding: 10px 0; color: #131A24; font-size: 13px;">${now} CT</td>
          </tr>
        </table>
        <p style="color: #8A9BB0; font-size: 11px; margin-top: 24px;">Clubhouse IQ · Admin Notification</p>
      </div>
    `,
  });
}
