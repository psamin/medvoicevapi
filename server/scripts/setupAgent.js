/**
 * Pushes the system prompt and all tool webhook definitions to your ElevenLabs agent.
 * Run once after initial setup, and any time you change the prompt or tool URLs.
 *
 * Usage:
 *   npm run setup
 *
 * Requires in .env:
 *   ELEVENLABS_API_KEY
 *   ELEVENLABS_AGENT_ID
 *   NGROK_URL   (e.g. https://abc123.ngrok-free.app)
 */

import 'dotenv/config';
import { buildPrompt } from '../src/prompt.js';

const { ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, NGROK_URL } = process.env;

if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID || !NGROK_URL) {
  console.error('Missing required env vars: ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, NGROK_URL');
  process.exit(1);
}

const base = NGROK_URL.replace(/\/$/, '');

const tools = [
  {
    type: 'webhook',
    name: 'log_consent',
    description: 'Logs recording or TCPA consent from the caller. Call at Stage 1 (call_recording) and Stage 10 (tcpa_sms, tcpa_autodial).',
    api_schema: {
      url: `${base}/tools/log_consent`,
      method: 'POST',
      request_body_schema: {
        type: 'object',
        properties: {
          consent_type: {
            type: 'string',
            description: 'Type of consent: call_recording, tcpa_sms, or tcpa_autodial.',
          },
          granted: {
            type: 'boolean',
            description: 'Whether the caller granted consent.',
          },
          channel: {
            type: 'string',
            description: 'How consent was given. Use "verbal".',
          },
          caller_phone: {
            type: 'string',
            description: 'The caller\'s phone number.',
          },
          transcript_snippet: {
            type: 'string',
            description: 'The portion of the transcript where consent was given or denied.',
          },
        },
        required: ['consent_type', 'granted'],
      },
    },
  },
  {
    type: 'webhook',
    name: 'screen_eligibility',
    description: 'Checks statute of limitations status for routing. Call silently at Stage 9. Never state the result to the caller as a legal conclusion.',
    api_schema: {
      url: `${base}/tools/screen_eligibility`,
      method: 'POST',
      request_body_schema: {
        type: 'object',
        properties: {
          incident_date: {
            type: 'string',
            description: 'Date of the incident in YYYY-MM-DD format.',
          },
          state: {
            type: 'string',
            description: 'Two-letter US state code where the incident occurred.',
          },
          matter_type: {
            type: 'string',
            description: 'Type of matter, e.g. mva, slip_and_fall, dog_bite.',
          },
        },
        required: ['incident_date', 'state'],
      },
    },
  },
  {
    type: 'webhook',
    name: 'verify_conflict',
    description: 'Checks for a conflict of interest when the at-fault party is named. Call as soon as the at-fault name is known.',
    api_schema: {
      url: `${base}/tools/verify_conflict`,
      method: 'POST',
      request_body_schema: {
        type: 'object',
        properties: {
          at_fault_name: {
            type: 'string',
            description: 'Full name of the at-fault party.',
          },
          caller_name: {
            type: 'string',
            description: 'Full name of the caller.',
          },
        },
        required: ['at_fault_name'],
      },
    },
  },
  {
    type: 'webhook',
    name: 'transfer_to_human',
    description: 'Initiates a warm transfer to an on-call intake attorney or case manager. Call at Stage 11 when qualified and a live agent is available.',
    api_schema: {
      url: `${base}/tools/transfer_to_human`,
      method: 'POST',
      request_body_schema: {
        type: 'object',
        properties: {
          case_summary: {
            type: 'string',
            description: 'Brief summary of the incident and injuries for the receiving agent.',
          },
          urgency_flag: {
            type: 'string',
            description: 'Urgency level: none, near_sol, emergency, or conflict.',
          },
        },
        required: ['case_summary'],
      },
    },
  },
  {
    type: 'webhook',
    name: 'schedule_callback',
    description: 'Schedules a callback when no live agent is available or the caller prefers. Call at Stage 11.',
    api_schema: {
      url: `${base}/tools/schedule_callback`,
      method: 'POST',
      request_body_schema: {
        type: 'object',
        properties: {
          preferred_window: {
            type: 'string',
            description: 'Caller\'s preferred callback time, e.g. "tomorrow morning" or "weekday afternoons".',
          },
          phone: {
            type: 'string',
            description: 'Phone number to call back.',
          },
          consent_id: {
            type: 'string',
            description: 'The consent_id returned by log_consent for tcpa_autodial.',
          },
        },
        required: ['phone'],
      },
    },
  },
  {
    type: 'webhook',
    name: 'save_intake',
    description: 'Saves the complete structured intake record. Call at the end of every conversation, whether qualified or disqualified.',
    api_schema: {
      url: `${base}/tools/save_intake`,
      method: 'POST',
      request_body_schema: {
        type: 'object',
        description: 'Full structured intake object.',
        properties: {
          caller: { type: 'object' },
          incident: { type: 'object' },
          vehicle: { type: 'object' },
          at_fault: { type: 'object' },
          insurance: { type: 'object' },
          injuries: {
            type: 'array',
            description: 'List of injuries, each with body_region, description, severity, surgery, preexisting_same_area.',
            items: { type: 'object' },
          },
          treatment: { type: 'object' },
          damages: { type: 'object' },
          consents: { type: 'object' },
          routing: { type: 'object' },
        },
        required: ['caller', 'incident', 'routing'],
      },
    },
  },
];

const body = {
  conversation_config: {
    agent: {
      prompt: {
        prompt: buildPrompt(),
        llm: 'claude-sonnet-4-6',
        tools,
      },
      first_message:
        "Thanks for calling, this is Aria. Just so you know, this call may be recorded for quality and accuracy — is that alright? I'm here to help. Can you tell me a little about what happened?",
      language: 'en',
    },
  },
};

console.log(`Configuring agent ${ELEVENLABS_AGENT_ID}...`);

const res = await fetch(
  `https://api.elevenlabs.io/v1/convai/agents/${ELEVENLABS_AGENT_ID}`,
  {
    method: 'PATCH',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }
);

if (!res.ok) {
  const text = await res.text();
  console.error(`ElevenLabs API error ${res.status}:`, text);
  process.exit(1);
}

const data = await res.json();
console.log('Agent configured successfully.');
console.log('  Agent ID:   ', data.agent_id ?? ELEVENLABS_AGENT_ID);
console.log('  Tools wired:', tools.map(t => t.name).join(', '));
console.log('  Backend URL:', base);
