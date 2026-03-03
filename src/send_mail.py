import smtplib
import os
import sys
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def send_authenticated_email(recipient, passcode, template_type='jira'):
    """
    Final non-mocked implementation for OpenPetition 2026.
    Uses SMTP credentials from environment variables.
    """
    smtp_server = os.getenv("MPC_SMTP_SERVER", "mail.stare.network")
    smtp_port = int(os.getenv("MPC_SMTP_PORT", "587"))
    user = os.getenv("MPC_SMTP_USER")
    pw = os.getenv("MPC_SMTP_PASS")

    if not user or not pw:
        print("❌ CRITICAL: SMTP credentials missing in environment.")
        return False

    msg = MIMEMultipart()
    
    if template_type == 'jira':
        msg['Subject'] = f"OpenPetition ZK-Verification Code: {passcode}"
        body = f"""
        Hello,

        You requested a zero-knowledge verification code for OpenPetition.
        
        Reference: {passcode}

        If you did not request this, please ignore this email.

        Best,
        OpenPetition Node
        """
    else:
        msg['Subject'] = f"OpenPetition System Verification: {passcode}"
        body = f"""
        A zero-knowledge verification request was initiated.
        
        Code: {passcode}
        Result: PENDING
        
        Check your OpenPetition client to complete the process.
        """

    sender_email = f"{user}@stare.network"
    msg['From'] = f"OpenPetition Node <{sender_email}>"
    msg['To'] = recipient
    msg.attach(MIMEText(body, 'plain'))

    try:
        server = smtplib.SMTP(smtp_server, smtp_port, timeout=15)
        server.starttls()
        server.login(user, pw)
        server.send_message(msg)
        server.quit()
        print(f"✅ FINAL VERIFICATION: Email accepted for delivery to {recipient}")
        return True
    except Exception as e:
        print(f"❌ SMTP Transmission Failed: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python send_mail.py <recipient_email> <passcode>")
    else:
        send_authenticated_email(sys.argv[1], sys.argv[2])
