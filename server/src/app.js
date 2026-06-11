import express from 'express';
import cors from 'cors';
import mountRoutes from './routes/index.js';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'voice-agent-test-backend' });
});

mountRoutes(app);

// Global error handler — catches async throws from Express 5 routes.
// Returns JSON so the frontend and curl always get a readable error.
app.use((err, _req, res, _next) => {
  console.error('[error]', err.message);
  res.status(err.status ?? 500).json({ ok: false, error: err.message });
});

export default app;
