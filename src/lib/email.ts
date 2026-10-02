/* Email delivery via Resend API (fetch-based, zero deps) */

import { EMAIL_FROM, RESEND_API_KEY, SITE_URL } from "./config";
import { db } from "./db";

export interface SendResult {
  sent: boolean;
  devUrl?: string;
  error?: string;
}

function verificationEmailHtml(verifyUrl: string, name: string): string {
  const safeName = name ? name.replace(/[<>&"]/g, "") : "there";
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#060809;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#060809;padding:40px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#0b0f11;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 8px 32px;" align="center">
              <div style="display:inline-block;width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#34d399,#0d9488);line-height:48px;font-size:24px;font-weight:800;color:#060809;">U</div>
              <h1 style="margin:16px 0 0 0;color:#f4f4f5;font-size:22px;font-weight:700;">unblurr.site</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <p style="margin:0;color:#d4d4d8;font-size:15px;line-height:1.6;">
                Hi ${safeName},<br/><br/>
                Welcome to <strong style="color:#34d399;">unblurr.site</strong>! Confirm your email address to activate your account and start keeping your videos crystal clear.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px;" align="center">
              <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(90deg,#10b981,#14b8a6);color:#060809;font-weight:700;font-size:15px;text-decoration:none;padding:14px 34px;border-radius:10px;">Verify my email</a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px 32px;">
              <p style="margin:0;color:#a1a1aa;font-size:12px;line-height:1.7;">
                This link expires in 24 hours. If the button doesn't work, copy and paste this URL into your browser:<br/>
                <span style="color:#71717a;word-break:break-all;">${verifyUrl}</span><br/><br/>
                If you didn't create an account on unblurr.site, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;border-top:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);">
              <p style="margin:0;color:#52525b;font-size:11px;text-align:center;">© unblurr.site — keep your video quality.</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export async function sendVerificationEmail(to: string, token: string, name: string): Promise<SendResult> {
  const verifyUrl = `${SITE_URL}/verify?token=${token}`;
  const subject = "Verify your email — unblurr.site";

  if (!RESEND_API_KEY) {
    /* Dev/demo mode: no email provider configured — surface the link instead */
    await db.logEmail({ to, subject, kind: "verification", status: "skipped", error: "RESEND_API_KEY not configured" });
    return { sent: false, devUrl: verifyUrl };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to,
        subject,
        html: verificationEmailHtml(verifyUrl, name),
      }),
    });
    if (res.ok) {
      await db.logEmail({ to, subject, kind: "verification", status: "sent" });
      return { sent: true };
    }
    const errorText = (await res.text()).slice(0, 500);
    await db.logEmail({ to, subject, kind: "verification", status: "failed", error: errorText });
    return { sent: false, error: `Resend API error (${res.status})` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "network error";
    await db.logEmail({ to, subject, kind: "verification", status: "failed", error: message });
    return { sent: false, error: message };
  }
}
