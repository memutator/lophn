// command 경계 하나에 invocation 하나. 응답은 ledger 전달을 기다리지 않는다.
import type { CommandDeclaration } from "../../blueprint/mod.ts";
import { inputHashOf } from "./cap-host.ts";
import { COMMAND_BODY_MAX_BYTES } from "./limits.ts";
import { parseCommandReference, parseInvokeBody } from "./command-body.ts";
import { projectCaller, verifyCommandCall } from "./verify.ts";
import type { InvocationRecord, RuntimeState } from "./state.ts";
import type { AppConnection, InvocationCaller, Json } from "./wire.ts";
import {
  type DenyFact,
  type FinishFact,
  readRejection,
  readSchedulePort,
  type RecordedJson,
  type RecordedTrigger,
  recordingMode,
  type RegisteredHandler,
  type SchedulePort,
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
      verified.error.details,
    );
  }
  const existing = state.byRequest.get(parsed.value.request_key);
  if (existing) return known(state, existing);
  if (verified.value.proof) {
    // 같은 접수는 알고 있는 진행·결과만 돌려주고 handler를 다시 부르지 않는다.
    // 가득 차면 기존 marker를 버리지 않고 새 접수를 거절한다.
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

// SDK `withRevert`가 만든 값의 심볼이다(packages/sdk/cap-schedule/revert.ts와 같다).
const COMMAND_REVERT = Symbol.for("lophn.command-revert");

// handler 값을 command 결과로 만든다. 되돌림 근거를 가진 write는 `{result, revert}`로 올리고 그 밖의 값은
// result 그대로다.
function commandResult(value: unknown): { result: unknown; revert?: unknown } {
  if (
    value !== null && typeof value === "object" &&
    (value as Record<symbol, unknown>)[COMMAND_REVERT] === true
  ) {
    const { result, revert } = value as { result?: unknown; revert?: unknown };
    return {
      result: result ?? null,
      ...(revert === undefined ? {} : { revert }),
    };
  }
  return { result: value ?? null };
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
        ...(found.result ? { result: commandResult(found.result) } : {}),
      },
    };
  }
  // 취소 요청은 받았다는 사실만 남긴다. 진행 중이던 호출은 결과를 모르는 상태로 보이고 취소 완료로
  // 보이지 않는다.
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
    if (found.rejection) {
      return fail(
        STATUS[found.rejection.code] ?? 400,
        found.rejection.code,
        found.rejection.message,
        { invocation: found.id },
      );
    }
    return fail(500, "internal", "handler failed", { invocation: found.id });
  }
  return {
    status: 200,
    body: {
      result: commandResult(found.result),
      ...(recordedInvocation(found, state.identity.release)
        ? { invocation: found.id }
        : {}),
      mode: state.identity.mode,
    },
  };
}

// 호출 ID는 ledger에 남는 호출만 가리킨다. release가 없는 프로세스(준비 전 bundle의 preview·test)는
// 기록 대상이 없으므로 invocation을 꾸며 돌려주지 않는다.
function recordedInvocation(
  found: { effect: string; progress: string },
  release: string | null,
): boolean {
  return release !== null &&
    (found.effect !== "read" || found.progress === "failed");
}

type Origin = { trigger: RecordedTrigger; actor: string };

type Launched = {
  record: InvocationRecord;
  // handler가 실제로 끝났을 때 정해진다. reject하지 않는다.
  outcome: Promise<{ ok: true; result: unknown } | { ok: false }>;
};

// command 경계 하나를 시작한다. 직접 호출과 automation 회차가 같은 handler 경로를 쓴다. 호출 방식
// (trigger·actor)만 다르고 입력 검사는 부르는 쪽이 이미 마쳤다.
function launch(
  state: RuntimeState,
  id: string,
  requestKey: string | null,
  call: {
    command: CommandDeclaration;
    input: unknown;
    caller: InvocationCaller;
    origin: Origin;
    handler: RegisteredHandler;
    port: SchedulePort;
  },
): Launched {
  const { command, origin } = call;
  const record: InvocationRecord = {
    id,
    // 요청 key가 없는 호출(automation)은 어떤 client도 같은 key로 찾지 못하는 값을 쓴다.
    requestKey: requestKey ?? `automation:${id}`,
    command: command.key,
    effect: command.effect,
    caller: call.caller,
    progress: "running",
    recorded: false,
  };
  state.invocations.set(id, record);
  if (requestKey !== null) state.byRequest.set(requestKey, id);
  // 일반 성공 읽기는 남기지 않고, 그 밖에는 실제 시작을 관측한 뒤 후행으로 알린다.
  // automation 회차는 읽기도 항상 남긴다.
  const mode = recordingMode({
    operation: "command",
    effect: command.effect,
    confirm: command.confirm,
    trigger: origin.trigger.kind,
  });
  const startedAt = state.clock.now();
  record.startedAt = startedAt;
  const start: StartFact = {
    operation: { kind: "command", command: command.key },
    trigger: origin.trigger,
    caller: call.caller,
    actor: origin.actor,
    started_at: startedAt,
  };
  if (mode === "always") void submit(state, id, { fact: "start", body: start });
  openStages(id);
  const outcome = (async () => {
    let result: unknown;
    try {
      result = await call.port.run(
        {
          app: state.identity.app,
          release: state.identity.release,
          mode: state.identity.mode,
          invocation: id,
          command: command.key,
          // 검증·default 적용한 실제 입력의 정규 hash다. 앱 코드의 capability 호출이 같은 호출에
          // 묶였음을 broker가 확인하는 근거다(cap-host의 호출 문맥). handler 시작을 미루지 않도록
          // 동기로 계산한다.
          inputHash: inputHashOf(call.input),
          // 다른 앱에게서 받은 호출이면 그 출처의 식별이다.
          caller: call.caller.kind === "app"
            ? {
              app: call.caller.app,
              release: call.caller.release,
              parent_invocation: call.caller.parent_invocation,
            }
            : null,
        },
        () => call.handler.handle(call.input),
      );
    } catch (error) {
      // 거절이 아닌 예외는 발생으로 남긴다. command 결과와 프로세스 종료는 그대로다.
      if (readRejection(error) === undefined && error instanceof Error) {
        try {
          state.reportCaught?.(error, id);
        } catch {
          // 보고 실패가 command 결과를 바꾸지 않는다.
        }
      }
      // timeout으로 이미 결과 모름을 남겼으면 늦은 종료가 그 사실을 바꾸지 않는다.
      if (record.settled) {
        takeStages(id);
        return { ok: false as const };
      }
      record.progress = "failed";
      // 효과 전의 거절은 코드를 남기고 같은 접수의 재전송도 같은 거절로 답한다.
      const rejection = readRejection(error);
      if (rejection) record.rejection = rejection;
      const finish = finishFact(
        record,
        command.confirm,
        "failed",
        startedAt,
        state,
      );
      if (mode === "on_failure") {
        void submit(state, id, { fact: "start", body: start });
      }
      void submit(state, id, { fact: "finish", body: finish });
      return { ok: false as const };
    }
    if (record.settled) {
      takeStages(id);
      return { ok: true as const, result };
    }
    record.progress = "succeeded";
    if (origin.trigger.kind === "direct") record.result = result as Json;
    if (mode === "always") {
      void submit(state, id, {
        fact: "finish",
        body: finishFact(
          record,
          command.confirm,
          "succeeded",
          startedAt,
          state,
        ),
      });
    } else {
      takeStages(id);
    }
    return { ok: true as const, result };
  })();
  return { record, outcome };
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
  if (!port || !handler) {
    return fail(409, "conflict", "handler is not registered");
  }
  const id = call.proof?.invocation ?? state.ids.newId("inv");
  const run = launch(state, id, requestKey, {
    command: call.command,
    input: call.input,
    caller: call.caller,
    origin: { trigger: { kind: "direct" }, actor: call.connection.actor },
    handler,
    port,
  });
  const done = await run.outcome;
  if (!done.ok) {
    // handler가 효과 전에 받지 않겠다고 알린 호출만 그 코드로 답한다. 그 밖의 예외는 원문 없이 500이다.
    const rejection = run.record.rejection;
    if (rejection) {
      return fail(
        STATUS[rejection.code] ?? 400,
        rejection.code,
        rejection.message,
      );
    }
    return fail(500, "internal", "handler failed");
  }
  return {
    status: 200,
    body: {
      result: commandResult(done.result),
      ...(recordedInvocation(run.record, state.identity.release)
        ? { invocation: id }
        : {}),
      mode: state.identity.mode,
    },
  };
}

export type AutomationLaunch = {
  invocation: string;
  done: Promise<void>;
};

// automation 회차의 handler 호출. 입력은 부르는 쪽이 선언 schema로 검사한 정규 입력이다. actor는
// machine, trigger와 caller는 automation key다(apps/automations domain).
export function launchAutomation(
  state: RuntimeState,
  automation: { key: string; command: CommandDeclaration; input: unknown },
): AutomationLaunch | undefined {
  const port = readSchedulePort();
  const handler = port?.handlers().find((item) =>
    item.command === automation.command.key
  );
  if (!port || !handler) return undefined;
  const id = state.ids.newId("inv");
  const run = launch(state, id, null, {
    command: automation.command,
    input: automation.input,
    caller: { kind: "automation", key: automation.key },
    origin: {
      trigger: { kind: "automation", key: automation.key },
      actor: "machine",
    },
    handler,
    port,
  });
  // 회차는 requestKey로 다시 찾는 호출이 아니므로 끝난 기록을 메모리에 쌓지 않는다. 기록은 이미
  // 후행 전달로 나갔다.
  return {
    invocation: id,
    done: run.outcome.then(() => {
      state.invocations.delete(id);
    }),
  };
}

// timeout은 종료 요청과 timeout 사실일 뿐 handler 종료나 효과 취소가 아니다. 결과를 모르는 호출로 남기고
// 늦은 종료가 그 사실을 바꾸지 않는다.
export function timeoutAutomation(state: RuntimeState, id: string): void {
  const record = state.invocations.get(id);
  if (!record || record.settled || record.progress !== "running") return;
  record.settled = true;
  record.cancelRequested = true;
  record.progress = "unknown";
  const summary: { [key: string]: RecordedJson } = {
    command: record.command,
    effect: record.effect,
    timeout: true,
    cancel_requested: true,
  };
  if (record.effect !== "read") summary.effects = "unconfirmed";
  void submit(state, id, {
    fact: "finish",
    body: {
      status: "unknown",
      started_at: record.startedAt ?? null,
      finished_at: state.clock.now(),
      summary,
      detail_hash: null,
    },
  });
}

// 선언을 어긴 회차(confirm=true, 잘못된 고정 입력)는 handler 없이 거절 사실로 남긴다.
export function denyAutomation(
  state: RuntimeState,
  automation: { key: string; command: CommandDeclaration },
  code: string,
): void {
  const deny: DenyFact = {
    operation: { kind: "command", command: automation.command.key },
    trigger: { kind: "automation", key: automation.key },
    caller: { kind: "automation", key: automation.key },
    actor: "machine",
    finished_at: state.clock.now(),
    summary: {
      command: automation.command.key,
      effect: automation.command.effect,
      automation: automation.key,
      code,
    },
  };
  void submit(state, state.ids.newId("inv"), { fact: "deny", body: deny });
}

// 종료 사실의 요약. 입출력 본문이나 오류 원문은 담지 않는다. 실패·중단한 write·external은
// 부분 저장이나 외부 전송이 없었다고 말하지 않고, 취소 요청은 효과 취소로 쓰지 않는다.
function finishFact(
  record: InvocationRecord,
  confirm: boolean,
  status: "succeeded" | "failed",
  startedAt: string,
  state: RuntimeState,
): FinishFact {
  const stages = takeStages(record.id);
  const summary: { [key: string]: RecordedJson } = {
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
    summary.error = record.rejection?.code ?? "handler_failed";
    if (record.effect !== "read" && !record.rejection) {
      summary.effects = "unconfirmed";
    }
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
