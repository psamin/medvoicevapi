// Email service for MedVoice. Sends via SendGrid REST API (no SDK dependency) when
// configured; otherwise dry-runs (logs the email and records an EmailLog). Never
// logs sensitive intake values — only subject + recipient + link.
import repo from './repo.js';
import { newEmailLog } from './models.js';
import {
  getCase,
  getClient,
  generateIntakeToken,
  getMissingFields,
} from './intakeService.js';
import { logCommunication } from '../crm/communications.js';

const logEmail = (rec) => repo.emailLogs.insert(newEmailLog(rec));

function isDryRun() {
  // Dry-run when explicitly enabled OR when no key is present (safe default).
  return process.env.DRY_RUN_EMAILS !== 'false' || !process.env.SENDGRID_API_KEY;
}

function formUrl(token) {
  const base = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/intake/${token}`;
}

// Mirror an email into the communications timeline (every email is tracked).
async function logEmailComm({ caseId, clientId, type, subject, status }) {
  await logCommunication({
    caseId, clientId, channel: 'email', direction: 'outbound',
    type: type ?? 'email', status: status === 'failed' ? 'failed' : 'sent',
    subject, externalProvider: 'sendgrid',
  });
}

// Low-level send: dry-run logs; real send hits SendGrid v3. Always writes EmailLog
// AND a communications-timeline row (type identifies which email it was).
async function deliver({ caseId, clientId, type, toEmail, subject, body }) {
  if (!toEmail) {
    console.warn(`[email] skipped (no recipient) case=${caseId}`);
    const log = await logEmail({ caseId, toEmail, subject, body, status: 'failed', reason: 'no recipient email' });
    await logEmailComm({ caseId, clientId, type, subject, status: 'failed' });
    return log;
  }

  if (isDryRun()) {
    console.log(`[email:dry-run] to=${toEmail} subject="${subject}"`);
    const log = await logEmail({ caseId, toEmail, subject, body, status: 'dry_run', reason: 'DRY_RUN_EMAILS or missing SENDGRID_API_KEY' });
    await logEmailComm({ caseId, clientId, type, subject, status: 'sent' });
    return log;
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
      const log = await logEmail({ caseId, toEmail, subject, body, status: 'failed', reason });
      await logEmailComm({ caseId, clientId, type, subject, status: 'failed' });
      return log;
    }
    console.log(`[email] sent to=${toEmail} subject="${subject}"`);
    const log = await logEmail({ caseId, toEmail, subject, body, status: 'sent' });
    await logEmailComm({ caseId, clientId, type, subject, status: 'sent' });
    return log;
  } catch (err) {
    console.error(`[email] send error case=${caseId}: ${err.message}`);
    const log = await logEmail({ caseId, toEmail, subject, body, status: 'failed', reason: err.message });
    await logEmailComm({ caseId, clientId, type, subject, status: 'failed' });
    return log;
  }
}

// Email the secure intake form link after a call.
export async function sendIntakeFormEmail(caseId) {
  const theCase = await getCase(caseId);
  if (!theCase) throw new Error(`case not found: ${caseId}`);
  const client = theCase.clientId ? await getClient(theCase.clientId) : null;
  const token = await generateIntakeToken(caseId);
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
  return deliver({ caseId, clientId: theCase.clientId, type: 'intake_form_sent', toEmail: client?.email, subject, body });
}

// Confirmation email — sent only once all required fields + documents are complete.
export async function sendConfirmationEmail(caseId) {
  const theCase = await getCase(caseId);
  if (!theCase) throw new Error(`case not found: ${caseId}`);
  const client = theCase.clientId ? await getClient(theCase.clientId) : null;
  const subject = 'Your MedVoice intake is complete';
  const body =
    `Hi${client?.firstName ? ` ${client.firstName}` : ''},\n\n` +
    `Thank you — we've received your completed intake. A case manager will review it ` +
    `and follow up with you about next steps.\n\nThank you,\nThe MedVoice Intake Team`;
  return deliver({ caseId, clientId: theCase.clientId, type: 'confirmation_email', toEmail: client?.email, subject, body });
}

// Basic reminder when required fields remain (no scheduling logic in this MVP).
export async function sendSimpleReminderEmail(caseId) {
  const theCase = await getCase(caseId);
  if (!theCase) throw new Error(`case not found: ${caseId}`);
  const client = theCase.clientId ? await getClient(theCase.clientId) : null;
  const missing = await getMissingFields(caseId);
  if (!client?.email) return { skipped: true, reason: 'no client email' };
  if (missing.length === 0) return { skipped: true, reason: 'nothing missing' };

  const token = await generateIntakeToken(caseId);
  const link = formUrl(token);
  const subject = 'Reminder: finish your MedVoice intake form';
  const body =
    `Hi${client.firstName ? ` ${client.firstName}` : ''},\n\n` +
    `Just a quick reminder to finish your intake form — there are still ${missing.length} ` +
    `item(s) to complete:\n\n${link}\n\nThank you,\nThe MedVoice Intake Team`;
  const log = await deliver({ caseId, clientId: theCase.clientId, type: 'follow_up_email', toEmail: client.email, subject, body });
  return { skipped: false, missingCount: missing.length, log };
}
