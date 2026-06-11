const db = {
  toolCalls: [],
  consents: [],
  eligibilityChecks: [],
  conflicts: [],
  transfers: [],
  callbacks: [],
  intakes: [],
};

function makeRecord(payload) {
  return {
    id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    payload,
  };
}

export function logToolCall(toolName, payload) {
  const record = makeRecord({ toolName, ...payload });
  db.toolCalls.push(record);
  return record;
}

export function save(collection, payload) {
  const record = makeRecord(payload);
  db[collection].push(record);
  return record;
}

export function getAll() {
  return db;
}

export function reset() {
  for (const key of Object.keys(db)) {
    db[key] = [];
  }
}
