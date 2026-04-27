import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = "Clubhouse IQ <noreply@clubhouseiq.app>";
const APP_URL = process.env.APP_URL || "https://clubhouse-iq.up.railway.app";

export async function sendPINResetEmail(toEmail: string, resetToken: string): Promise<void> {
  const resetUrl = `${APP_URL}/#/reset-pin?token=${resetToken}`;

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
      </div>
    `,
  });
}
