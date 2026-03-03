import smtplib
import os
import sys
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart


def send_verification_email(recipient, passcode):
    """
    Sends a verification code email styled identically to Resend's default template.
    No project branding, no ZK/MPC references — clean transactional email only.
    """
    smtp_server = os.getenv("MPC_SMTP_SERVER", "mail.stare.network")
    smtp_port = int(os.getenv("MPC_SMTP_PORT", "587"))
    user = os.getenv("MPC_SMTP_USER")
    pw = os.getenv("MPC_SMTP_PASS")
    sender_name = os.getenv("SMTP_SENDER_NAME", "Verification")
    sender_domain = os.getenv("SMTP_SENDER_DOMAIN", "stare.network")

    if not user or not pw:
        print("SMTP credentials missing in environment.")
        return False

    sender_email = f"{user}@{sender_domain}"
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Your verification code: {passcode}"
    msg["From"] = f"{sender_name} <{sender_email}>"
    msg["To"] = recipient

    # Plain text fallback
    text_body = f"""Your verification code

Enter this code to verify your identity:

{passcode}

This code expires in 10 minutes. If you didn't request this code, you can safely ignore this email.
"""

    # HTML body — matches Resend's default transactional template exactly
    html_body = f"""\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Verification Code</title>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Ubuntu,sans-serif;">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:#ffffff;">
  <tr>
    <td align="center" style="padding:40px 0;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;padding:0 20px;">
        <!-- Body -->
        <tr>
          <td style="padding:0 0 24px;">
            <h1 style="margin:0 0 12px;font-size:24px;font-weight:700;line-height:32px;color:#09090b;">
              Your verification code
            </h1>
            <p style="margin:0;font-size:15px;line-height:24px;color:#71717a;">
              Enter the following code to verify your identity.
            </p>
          </td>
        </tr>
        <!-- Code -->
        <tr>
          <td style="padding:0 0 24px;">
            <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background-color:#f4f4f5;border-radius:8px;padding:24px;text-align:center;">
                  <span style="font-size:32px;font-weight:700;letter-spacing:6px;color:#09090b;font-family:'Courier New',Courier,monospace;">
                    {passcode}
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Expiry notice -->
        <tr>
          <td style="padding:0 0 32px;">
            <p style="margin:0;font-size:14px;line-height:22px;color:#71717a;">
              This code expires in 10 minutes. If you didn't request this code, you can safely ignore this email.
            </p>
          </td>
        </tr>
        <!-- Divider -->
        <tr>
          <td style="padding:0 0 24px;">
            <hr style="border:none;border-top:1px solid #e4e4e7;margin:0;">
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td>
            <p style="margin:0;font-size:12px;line-height:20px;color:#a1a1aa;">
              This is an automated message. Please do not reply to this email.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
"""

    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    try:
        server = smtplib.SMTP(smtp_server, smtp_port, timeout=15)
        server.starttls()
        server.login(user, pw)
        server.send_message(msg)
        server.quit()
        return True
    except Exception as e:
        print(f"SMTP error: {e}")
        return False


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python send_mail.py <recipient_email> <passcode>")
    else:
        ok = send_verification_email(sys.argv[1], sys.argv[2])
        sys.exit(0 if ok else 1)
