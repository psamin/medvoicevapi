import toolsRouter from './tools.js';
import debugRouter from './debug.js';
import signedUrlRouter from './signedUrl.js';
import leadsRouter from './leads.js';
import callsRouter from './calls.js';
import vapiToolsRouter from './vapiTools.js';

export default function mountRoutes(app) {
  // ---- new Vapi CRM API ----
  app.use('/api/leads', leadsRouter);
  app.use('/api/calls', callsRouter);
  app.use('/api/tools', vapiToolsRouter);
  app.use('/api/debug', debugRouter); // POST /api/debug/reset, GET /api/debug/db

  // ---- legacy ElevenLabs flow ----
  app.use('/tools', toolsRouter);
  app.use('/debug', debugRouter);
  app.use('/api/get-signed-url', signedUrlRouter);
}
