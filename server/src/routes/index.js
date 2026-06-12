import toolsRouter from './tools.js';
import debugRouter from './debug.js';
import signedUrlRouter from './signedUrl.js';
import leadsRouter from './leads.js';
import callsRouter from './calls.js';
import vapiToolsRouter from './vapiTools.js';
import intakeRouter from './intake.js';
import promptsRouter from './prompts.js';
import vapiRouter from './vapi.js';
import crmToolsRouter from './crmTools.js';
import { verifyVapiSecret } from '../vapi/verifySecret.js';

export default function mountRoutes(app) {
  // ---- canonical Vapi CRM tools (snake_case, paste these into Vapi) ----
  app.use('/tools', verifyVapiSecret, crmToolsRouter);

  // ---- Vapi CRM API + earlier camelCase tools ----
  app.use('/api/leads', leadsRouter);
  app.use('/api/calls', callsRouter);
  app.use('/api/tools', verifyVapiSecret, vapiToolsRouter);
  app.use('/api/intake', intakeRouter);
  app.use('/api/prompts', promptsRouter);
  app.use('/api/vapi', vapiRouter);
  app.use('/api/debug', debugRouter); // POST /api/debug/reset, GET /api/debug/db

  // ---- legacy ElevenLabs flow (screening tools + signed-url) ----
  app.use('/tools', toolsRouter); // screen_eligibility, verify_conflict
  app.use('/debug', debugRouter);
  app.use('/api/get-signed-url', signedUrlRouter);
}
