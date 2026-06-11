import toolsRouter from './tools.js';
import debugRouter from './debug.js';
import signedUrlRouter from './signedUrl.js';

export default function mountRoutes(app) {
  app.use('/tools', toolsRouter);
  app.use('/debug', debugRouter);
  app.use('/api/get-signed-url', signedUrlRouter);
}
