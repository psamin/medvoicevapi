import 'dotenv/config';
import app from './app.js';
import { STORAGE_BACKEND } from './mvp/repo.js';

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Voice agent test server running on http://localhost:${PORT}`);
  console.log(`  Storage:    ${STORAGE_BACKEND}${STORAGE_BACKEND === 'json' ? ' (set DATABASE_URL + npm run migrate for Postgres)' : ''}`);
  console.log(`  Health:     GET  /health`);
  console.log(`  Debug DB:   GET  /debug/db`);
  console.log(`  Reset DB:   POST /debug/reset`);
  console.log(`  Signed URL: GET  /api/get-signed-url`);
  console.log(`  Tools:      POST /tools/{log_consent,screen_eligibility,...}`);
});
