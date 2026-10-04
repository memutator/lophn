// command 경계 하나에 invocation 하나. 응답은 ledger 전달을 기다리지 않는다.
import type { CommandDeclaration } from "../../blueprint/mod.ts";
import { COMMAND_BODY_MAX_BYTES } from "./limits.ts";
import { parseCommandReference, parseInvokeBody } from "./command-body.ts";
import { verifyCommandCall } from "./verify.ts";
import type { InvocationRecord, RuntimeState } from "./state.ts";
import type { AppConnection, InvocationCaller, Json } from "./wire.ts";
import { readSchedulePort } from "../../invocations/mod.ts";

export type InvokeResult = {
  status: number;
  body?: unknown;
  error?: { code: string; message: string; details?: Record<string, unknown> };
};

function fail(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): InvokeResult {
  return { status, error: { code, message, ...(details ? { details } : {}) } };
}

const STATUS: Record<string, number> = {
  invalid_input: 400,
  unauthorized: 401,
  forbidden: 403,
  conflict: 409,
  unavailable: 503,
};

export async function handleInvoke(
  state: RuntimeState,
  path: string,
  raw: Uint8Array | URLSearchParams,
  connection: AppConnection,
): Promise<InvokeResult> {
  if (state.closed) return fail(503, "unavailable", "process is closed");
  if (path.endsWith("/status")) {
    return reference(state, path, queryObject(raw));
  }
  if (!(raw instanceof Uint8Array)) {
    return fail(400, "invalid_input", "command body is missing");
  }
  if (raw.byteLength > COMMAND_BODY_MAX_BYTES) {
    return fail(400, "invalid_input", "command body exceeds 1MiB", {
      hint: "pass a blob or version reference instead of the body",
    });
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return fail(400, "invalid_input", "command body is not JSON");
  }
  if (path.endsWith("/cancel") || path.endsWith("/status")) {
    return reference(state, path, json);
  }
  if (!path.endsWith("/invoke")) {
    return fail(404, "not_found", "unknown command path");
  }
  const parsed = parseInvokeBody(json);
  if (!parsed.ok) return fail(400, "invalid_input", parsed.error.message);
  if (
    state.identity.mode === "live" &&
    parsed.value.release !== state.identity.release
  ) {
    return fail(409, "conflict", "invoke release mismatch");
  }
  const verified = await verifyCommandCall({
    blueprint: state.blueprint,
    connection,
    identity: state.identity,
    command: parsed.value.command,
    input: parsed.value.input,
    proof: parsed.value.proof,
    key: state.key,
    clock: state.clock,
    accepting: state.accepting,
  });
  if (!verified.ok) {
    return fail(
      STATUS[verified.error.code] ?? 400,
      verified.error.code,
      verified.error.message,
    );
  }
  const existing = state.byRequest.get(parsed.value.request_key);
  if (existing) return known(state, existing);
  if (verified.value.proof) {
    if (state.markers.has(verified.value.proof.invocation)) {
      return known(state, verified.value.proof.invocation);
    }
    if (state.markers.size >= 4096) {
      return fail(409, "conflict", "confirm markers are full");
    }
    state.markers.add(verified.value.proof.invocation);
  }
  return await runHandler(state, parsed.value.request_key, verified.value);
}

function queryObject(raw: Uint8Array | URLSearchParams): unknown {
  if (raw instanceof URLSearchParams) {
    return {
      request_key: raw.get("request_key"),
      invocation: raw.get("invocation"),
    };
  }
  try {
    return JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return undefined;
  }
}

function reference(
  state: RuntimeState,
  path: string,
  json: unknown,
): InvokeResult {
  const parsed = parseCommandReference(json);
  if (!parsed) {
    return fail(400, "invalid_input", "command reference is invalid");
  }
  const found = state.invocations.get(parsed.invocation);
  if (!found || found.requestKey !== parsed.request_key) {
    return {
      status: 200,
      body: path.endsWith("/status")
        ? { progress: "unknown" }
        : { accepted: false },
    };
  }
  if (path.endsWith("/status")) {
    return {
      status: 200,
      body: {
        progress: found.progress,
        ...(found.result ? { result: { result: found.result } } : {}),
      },
    };
  }
  found.progress = found.progress === "running" ? "unknown" : found.progress;
  return { status: 200, body: { accepted: true } };
}

function known(state: RuntimeState, invocation: string): InvokeResult {
  const found = state.invocations.get(invocation);
  if (!found) return fail(404, "not_found", "invocation is unknown");
  return {
    status: 200,
    body: {
      result: { result: found.result ?? null },
      ...(recordedInvocation(found) ? { invocation: found.id } : {}),
      mode: state.identity.mode,
    },
  };
}

function recordedInvocation(
  found: { effect: string; progress: string },
): boolean {
  return found.effect !== "read" || found.progress === "failed";
}

async function runHandler(
  state: RuntimeState,
  requestKey: string,
  call: {
    command: CommandDeclaration;
    input: unknown;
    caller: InvocationCaller;
    proof?: { invocation: string };
  },
): Promise<InvokeResult> {
  const port = readSchedulePort();
  const handler = port?.handlers().find((item) =>
    item.command === call.command.key
  );
  if (!handler) return fail(409, "conflict", "handler is not registered");
  const id = call.proof?.invocation ?? state.ids.newId("inv");
  const record: InvocationRecord = {
    id,
    requestKey,
    command: call.command.key,
    effect: call.command.effect,
    caller: call.caller,
    progress: "running",
    recorded: false,
  };
  state.invocations.set(id, record);
  state.byRequest.set(requestKey, id);
  void submit(state, id, "start", { command: call.command.key });
  let result: unknown;
  try {
    result = await port!.run(
      {
        app: state.identity.app,
        release: state.identity.release,
        mode: state.identity.mode,
        invocation: id,
      },
      () => handler.handle(call.input),
    );
  } catch (_error) {
    record.progress = "failed";
    void submit(state, id, "finish", { status: "failed" });
    return fail(500, "internal", "handler failed");
  }
  record.progress = "succeeded";
  record.result = result as Json;
  void submit(state, id, "finish", { status: "succeeded" });
  return {
    status: 200,
    body: {
      result: { result: result ?? null },
      ...(recordedInvocation(record) ? { invocation: id } : {}),
      mode: state.identity.mode,
    },
  };
}

function submit(
  state: RuntimeState,
  invocation: string,
  fact: "start" | "finish" | "deny",
  summary: unknown,
): Promise<void> {
  return state.broker.submitInvocation({ invocation, fact, summary }).then(
    () => {
      const found = state.invocations.get(invocation);
      if (found) found.recorded = true;
    },
    () => undefined,
  );
}
