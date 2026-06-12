// Email service for MedVoice. Sends via SendGrid REST API (no SDK dependency) when
// configured; otherwise dry-runs (logs the email and records an EmailLog). Never
// logs sensitive intake values — only subject + recipient + link.
import { insert } from '../db/mockDb.js';
import { newEmailLog } from './models.js';
import {
  getCase,
  getClient,
  generateIntakeToken,
  getMissingFields,
} from './intakeService.js';

function isDryRun() {
  // Dry-run when explicitly enabled OR when no key is present (safe default).
  return process.env.DRY_RUN_EMAILS !== 'false' || !process.env.SENDGRID_API_KEY;
}

function formUrl(token) {
  const base = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/intake/${token}`;
}

// Low-level send: dry-run logs; real send hits SendGrid v3. Always writes EmailLog.
async function deliver({ caseId, toEmail, subject, body }) {
  if (!toEmail) {
    const log = insert('emailLogs', newEmailLog({ caseId, toEmail, subject, body, status: 'failed', reason: 'no recipient email' }));
    console.warn(`[email] skipped (no recipient) case=${caseId}`);
    return log;
  }

  if (isDryRun()) {
    console.log(`[email:dry-run] to=${toEmail} subject="${subject}"`);
    return insert('emailLogs', newEmailLog({ caseId, toEmail, subject, body, status: 'dry_run', reason: 'DRY_RUN_EMAILS or missing SENDGRID_API_KEY' }));
  }

  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: toEmail }] }],
        from: { email: process.env.FROM_EMAIL || 'intake@example.com' },
        subject,
        content: [{ type: 'text/plain', value: body }],
      }),
    });
    if (!res.ok) {
      const reason = `SendGrid ${res.status}: ${(await res.text()).slice(0, 200)}`;
      console.error(`[email] send failed case=${caseId}: ${reason}`);
      return insert('emailLogs', newEmailLog({ caseId, toEmail, subject, body, status: 'failed', reason }));
    }
    console.log(`[email] sent to=${toEmail} subject="${subject}"`);
    return insert('emailLogs', newEmailLog({ caseId, toEmail, subject, body, status: 'sent' }));
  } catch (err) {
    console.error(`[email] send error case=${caseId}: ${err.message}`);
    return insert('emailLogs', newEmailLog({ caseId, toEmail, subject, body, status: 'failed', reason: err.message }));
  }
}

// Email the secure intake form link after a call.
export async function sendIntakeFormEmail(caseId) {
  const theCase = getCase(caseId);
  if (!theCase) throw new Error(`case not found: ${caseId}`);
  const client = theCase.clientId ? getClient(theCase.clientId) : null;
  const token = generateIntakeToken(caseId);
  const link = formUrl(token);
  const name = client?.firstName ? ` ${client.firstName}` : '';
  const subject = 'Complete your MedVoice intake form';
  const body =
    `Hi${name},\n\n` +
    `Thank you for speaking with our intake assistant. Please complete your secure ` +
    `intake form here:\n\n${link}\n\n` +
    `A few details are already filled in from our call — you just need to complete ` +
    `what's missing. You can save partial progress and finish later.\n\n` +
    `Thank you,\nThe MedVoice Intake Team`;
  return deliver({ caseId, toEmail: client?.email, subject, body });
}

// Basic reminder when required fields remain (no scheduling logic in this MVP).
export async function sendSimpleReminderEmail(caseId) {
  const theCase = getCase(caseId);
  if (!theCase) throw new Error(`case not found: ${caseId}`);
  const client = theCase.clientId ? getClient(theCase.clientId) : null;
  const missing = getMissingFields(caseId);
  if (!client?.email) return { skipped: true, reason: 'no client email' };
  if (missing.length === 0) return { skipped: true, reason: 'nothing missing' };

  const token = generateIntakeToken(caseId);
  const link = formUrl(token);
  const subject = 'Reminder: finish your MedVoice intake form';
  const body =
    `Hi${client.firstName ? ` ${client.firstName}` : ''},\n\n` +
    `Just a quick reminder to finish your intake form — there are still ${missing.length} ` +
    `item(s) to complete:\n\n${link}\n\nThank you,\nThe MedVoice Intake Team`;
  const log = await deliver({ caseId, toEmail: client.email, subject, body });
  return { skipped: false, missingCount: missing.length, log };
}
