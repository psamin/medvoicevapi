-- MedVoice MVP Postgres schema.
-- Records are stored as JSONB (matching the app's record shape) plus a few
-- indexed columns for the lookups the app performs. Run via: npm run migrate

CREATE TABLE IF NOT EXISTS clients (
  id          TEXT PRIMARY KEY,
  phone_norm  TEXT,
  email       TEXT,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clients_phone_norm_idx ON clients (phone_norm);
CREATE INDEX IF NOT EXISTS clients_email_idx ON clients (lower(email));

CREATE TABLE IF NOT EXISTS cases (
  id          TEXT PRIMARY KEY,
  client_id   TEXT,
  form_token  TEXT,
  status      TEXT,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cases_client_id_idx ON cases (client_id);
CREATE INDEX IF NOT EXISTS cases_form_token_idx ON cases (form_token);

CREATE TABLE IF NOT EXISTS intake_fields (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL,
  field_key   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id, field_key)
);
CREATE INDEX IF NOT EXISTS intake_fields_case_idx ON intake_fields (case_id);

CREATE TABLE IF NOT EXISTS required_documents (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL,
  doc_type    TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id, doc_type)
);
CREATE INDEX IF NOT EXISTS required_documents_case_idx ON required_documents (case_id);

CREATE TABLE IF NOT EXISTS intake_calls (
  id          TEXT PRIMARY KEY,
  case_id     TEXT,
  doc         JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intake_calls_case_idx ON intake_calls (case_id);

CREATE TABLE IF NOT EXISTS email_logs (
  id          TEXT PRIMARY KEY,
  case_id     TEXT,
  doc         JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_logs_case_idx ON email_logs (case_id);

-- ── CRM tables (case manager workflow) ──
CREATE TABLE IF NOT EXISTS follow_up_attempts (
  id          TEXT PRIMARY KEY,
  case_id     TEXT,
  doc         JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS follow_up_attempts_case_idx ON follow_up_attempts (case_id);

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  case_id     TEXT,
  doc         JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_case_idx ON tasks (case_id);

CREATE TABLE IF NOT EXISTS notes (
  id          TEXT PRIMARY KEY,
  case_id     TEXT,
  doc         JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_case_idx ON notes (case_id);

CREATE TABLE IF NOT EXISTS communications (
  id          TEXT PRIMARY KEY,
  case_id     TEXT,
  doc         JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS communications_case_idx ON communications (case_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  case_id     TEXT,
  doc         JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_case_idx ON audit_logs (case_id);
