// Adapts Vapi's tool-call webhook format <-> plain JSON, so every tool endpoint
// works both when called by Vapi AND when poked directly with curl / our tests.
//
// Vapi sends:  { message: { toolCallList: [{ id, function: { name, arguments } }] } }
//   (older/variant payloads use `toolCalls`, and arguments may be a JSON string)
// Vapi expects: { results: [{ toolCallId, result: <string> }] }

export function extractToolCall(body = {}) {
  const msg = body.message ?? body;
  const list = msg.toolCallList ?? msg.toolCalls ?? null;

  if (Array.isArray(list) && list.length > 0) {
    const tc = list[0];
    const fn = tc.function ?? tc;
    let args = fn.arguments ?? tc.arguments ?? {};
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        args = {};
      }
    }
    return { name: fn.name ?? tc.name ?? null, args: args ?? {}, toolCallId: tc.id ?? null, isVapi: true };
  }

  // Plain call (curl / tests): the body itself is the arguments object.
  return { name: null, args: body ?? {}, toolCallId: null, isVapi: false };
}

// Send a response that satisfies Vapi when wrapped, or returns flat JSON otherwise.
export function sendToolResult(res, call, payload, status = 200) {
  if (call.isVapi) {
    const result = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return res.status(status).json({ results: [{ toolCallId: call.toolCallId, result }] });
  }
  return res.status(status).json(payload);
}

// Wraps a tool handler: parses the call, logs it, runs the handler, formats the
// reply, and never lets a thrown error crash the process — always replies JSON.
export function toolHandler(name, fn) {
  return async (req, res) => {
    const call = extractToolCall(req.body);
    console.log(`[vapi-tool] ${name}`, JSON.stringify(call.args));
    try {
      const { payload, status = 200 } = (await fn(call.args, call)) ?? { payload: {} };
      sendToolResult(res, call, { ok: true, tool: name, ...payload }, status);
    } catch (err) {
      console.error(`[vapi-tool] ${name} error:`, err.message);
      sendToolResult(res, call, { ok: false, tool: name, error: err.message }, 200);
    }
  };
}
