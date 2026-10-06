// command 경계 하나에 invocation 하나. 응답은 ledger 전달을 기다리지 않는다.
import type { CommandDeclaration } from "../../blueprint/mod.ts";
import { COMMAND_BODY_MAX_BYTES } from "./limits.ts";
import { parseCommandReference, parseInvokeBody } from "./command-body.ts";
import { projectCaller, verifyCommandCall } from "./verify.ts";
import type { InvocationRecord, RuntimeState } from "./state.ts";
import type { AppConnection, InvocationCaller, Json } from "./wire.ts";
import {
  type DenyFact,
  type FinishFact,
  type JsonValue,
  readSchedulePort,
  recordingMode,
  type StartFact,
  type SubmittedFact,
} from "../../invocations/mod.ts";
import { openStages, takeStages } from "./stages.ts";

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
    denyCall(state, connection, parsed.value.command, verified.error.code);
    return fail(
      STATUS[verified.error.code] ?? 400,
      verified.error.code,
      verified.error.message,
    );
  }
  const existing = state.byRequest.get(parsed.value.request_key);
  if (existing) return known(state, existing);
  if (verified.value.proof) {
    // 같은 접수는 알고 있는 진행·결과만 돌려주고 handler를 다시 부르지 않는다(R8).
    // 가득 차면 기존 marker를 버리지 않고 새 접수를 거절한다(R19).
    const admitted = state.markers.admit(
      verified.value.proof.invocation,
      verified.value.proof.expires_at,
      state.clock.now(),
    );
    if (admitted === "known") {
      return known(state, verified.value.proof.invocation);
    }
    if (admitted === "full") {
      return fail(409, "conflict", "confirm markers are full");
    }
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
  // 취소 요청은 받았다는 사실만 남긴다. 진행 중이던 호출은 결과를 모르는 상태로 보이고 취소 완료로
  // 보이지 않는다(apps/invocations#R11).
  found.cancelRequested = true;
  found.progress = found.progress === "running" ? "unknown" : found.progress;
  return { status: 200, body: { accepted: true } };
}

function known(state: RuntimeState, invocation: string): InvokeResult {
  const found = state.invocations.get(invocation);
  if (!found) return fail(404, "not_found", "invocation is unknown");
  // 진행 중이거나 결과를 모르는 호출을 성공 응답처럼 돌려주지 않는다. 같은 호출을 다시 실행하지도 않는다.
  if (found.progress === "running" || found.progress === "unknown") {
    return fail(409, "conflict", `invocation is ${found.progress}`, {
      invocation: found.id,
      progress: found.progress,
    });
  }
  if (found.progress === "failed") {
    return fail(500, "internal", "handler failed", { invocation: found.id });
  }
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
    connection: AppConnection;
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
  // 일반 성공 읽기는 남기지 않고(R2), 그 밖에는 실제 시작을 관측한 뒤 후행으로 알린다(R9).
  const mode = recordingMode({
    operation: "command",
    effect: call.command.effect,
    confirm: call.command.confirm,
    trigger: "direct",
  });
  const startedAt = state.clock.now();
  const start: StartFact = {
    operation: { kind: "command", command: call.command.key },
    trigger: { kind: "direct" },
    caller: call.caller,
    actor: call.connection.actor,
    started_at: startedAt,
  };
  if (mode === "always") void submit(state, id, { fact: "start", body: start });
  openStages(id);
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
    const finish = finishFact(
      record,
      call.command.confirm,
      "failed",
      startedAt,
      state,
    );
    if (mode === "on_failure") {
      void submit(state, id, { fact: "start", body: start });
    }
    void submit(state, id, { fact: "finish", body: finish });
    return fail(500, "internal", "handler failed");
  }
  record.progress = "succeeded";
  record.result = result as Json;
  if (mode === "always") {
    void submit(state, id, {
      fact: "finish",
      body: finishFact(
        record,
        call.command.confirm,
        "succeeded",
        startedAt,
        state,
      ),
    });
  } else {
    takeStages(id);
  }
  return {
    status: 200,
    body: {
      result: { result: result ?? null },
      ...(recordedInvocation(record) ? { invocation: id } : {}),
      mode: state.identity.mode,
    },
  };
}

// 종료 사실의 요약. 입출력 본문이나 오류 원문은 담지 않는다. 실패·중단한 write·external은
// 부분 저장이나 외부 전송이 없었다고 말하지 않고, 취소 요청은 효과 취소로 쓰지 않는다(R11).
function finishFact(
  record: InvocationRecord,
  confirm: boolean,
  status: "succeeded" | "failed",
  startedAt: string,
  state: RuntimeState,
): FinishFact {
  const stages = takeStages(record.id);
  const summary: { [key: string]: JsonValue } = {
    command: record.command,
    effect: record.effect,
  };
  if (confirm) summary.confirm = true;
  if (stages.length > 0) {
    summary.stages = stages.map((stage) => ({
      name: stage.name,
      state: stage.state,
    }));
  }
  if (record.cancelRequested) summary.cancel_requested = true;
  if (status === "failed") {
    summary.error = "handler_failed";
    if (record.effect !== "read") summary.effects = "unconfirmed";
  }
  return {
    status,
    started_at: startedAt,
    finished_at: state.clock.now(),
    summary,
    detail_hash: null,
  };
}

// handler 전 거절도 알려진 호출이면 남긴다. 선언 없는 command는 어떤 호출인지 모르므로 만들지 않는다.
function denyCall(
  state: RuntimeState,
  connection: AppConnection,
  command: string,
  code: string,
): void {
  const declared = state.blueprint.commands.find((item) =>
    item.key === command
  );
  if (!declared) return;
  const deny: DenyFact = {
    operation: { kind: "command", command },
    trigger: { kind: "direct" },
    caller: connectionCaller(connection),
    actor: connection.actor,
    finished_at: state.clock.now(),
    summary: { command, effect: declared.effect, code },
  };
  void submit(state, state.ids.newId("inv"), { fact: "deny", body: deny });
}

function connectionCaller(connection: AppConnection): InvocationCaller {
  return projectCaller(connection);
}

function submit(
  state: RuntimeState,
  invocation: string,
  submitted: SubmittedFact,
): Promise<void> {
  return state.broker.submitInvocation({
    invocation,
    fact: submitted.fact,
    summary: submitted.body,
  }).then(
    (response) => {
      const found = state.invocations.get(invocation);
      if (found && response.status === 200) found.recorded = true;
    },
    () => undefined,
  );
}
