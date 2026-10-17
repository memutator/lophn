// core가 보낸 call 요청 하나에 invocation 하나. 결과는 응답으로 돌려주고 기록은 core가 남긴다.
import { validateInput } from "../../../../protocol/apps/blueprint/mod.ts";
import { encodeChangeset, inputHashOf } from "./cap-host.ts";
import { CALL_BODY_MAX_BYTES, RESULT_MAX_BYTES } from "./limits.ts";
import { fitChangeset } from "./fit.ts";
import { parseProcessCall, type ProcessCall } from "./wire.ts";
import { isJson } from "./wire-check.ts";
import type { RuntimeState } from "./state.ts";
import { readRejection } from "../../invocations/context.ts";
import { ensureAppApiPort } from "./app-api-port.ts";

export type InvokeResult = { status: number; body: unknown };

export function fail(
  status: number,
  code: string,
  message: string,
): InvokeResult {
  return { status, body: { error: { code, message } } };
}

// handler까지 가지 못했거나 handler가 실패한 호출. 효과가 있었을 수 있으니 changeset을 싣는다.
function failed(
  code: string,
  message: string,
  changeset: string | null,
): InvokeResult {
  return {
    status: 200,
    body: { status: "error", error: { code, message }, changeset },
  };
}

export async function handleCall(
  state: RuntimeState,
  raw: Uint8Array,
): Promise<InvokeResult> {
  if (state.closed || !state.accepting) {
    return fail(503, "unavailable", "process is not accepting calls");
  }
  if (raw.byteLength > CALL_BODY_MAX_BYTES) {
    return fail(400, "invalid_input", "call body exceeds the size limit");
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return fail(400, "invalid_input", "call body is not JSON");
  }
  const call = parseProcessCall(json);
  if (!call) return fail(400, "invalid_input", "call request is invalid");
  const { context } = call;
  if (
    context.app !== state.identity.app ||
    context.mode !== state.identity.mode ||
    (state.identity.mode === "live" &&
      context.release !== state.identity.release)
  ) {
    return fail(409, "conflict", "call does not match this process");
  }
  state.running++;
  try {
    // write·external은 이 process 안에서도 한 번에 하나다. session이 연결 단위라 겹치면 changeset에
    // 두 호출의 변경이 섞인다.
    const done = context.effect === "read"
      ? await run(state, call, false)
      : await state.exclusive(() => run(state, call, true));
    return done.status === 200
      ? { status: 200, body: fitChangeset(done.body) }
      : done;
  } finally {
    state.running--;
  }
}

async function run(
  state: RuntimeState,
  call: ProcessCall,
  record: boolean,
): Promise<InvokeResult> {
  const declaration = state.blueprint.app_api.find((api) =>
    api.key === call.api
  );
  if (!declaration) return failed("not_found", "app-api is not declared", null);
  const port = ensureAppApiPort();
  const handler = port.handlers().find((item) => item.api === call.api);
  if (!handler) {
    return failed("not_found", "handler is not registered", null);
  }
  const input = validateInput(declaration.input, call.input);
  if (!input.ok) return failed("invalid_input", input.error.message, null);
  if (record) state.store.begin();
  let outcome: { ok: true; result: unknown } | { ok: false; error: unknown };
  try {
    outcome = {
      ok: true,
      result: await port.run(
        {
          app: state.identity.app,
          release: state.identity.release,
          mode: state.identity.mode,
          invocation: call.invocation,
          project: call.context.project,
          api: call.api,
          // 검증·default 적용한 실제 입력의 정규 hash다. 앱 코드의 capability 호출이 같은 호출에 묶였음을
          // broker가 확인하는 근거다.
          inputHash: inputHashOf(input.value),
          caller: call.context.caller,
        },
        () => handler.handle(input.value),
      ),
    };
  } catch (error) {
    outcome = { ok: false, error };
  }
  // 실패해도 DB가 일부 바뀌었을 수 있다.
  let changeset: string | null = null;
  if (record) {
    try {
      changeset = encodeChangeset(state.store.end());
    } catch {
      return failed("internal", "changeset could not be read", null);
    }
  }
  if (!outcome.ok) {
    const rejection = readRejection(outcome.error);
    if (rejection) return failed(rejection.code, rejection.message, changeset);
    if (outcome.error instanceof Error) {
      try {
        state.reportCaught?.(outcome.error, call.invocation);
      } catch {
        // 보고 실패가 호출 결과를 바꾸지 않는다.
      }
    }
    // 원문은 내보내지 않는다.
    return failed("internal", "handler failed", changeset);
  }
  const result = outcome.result ?? null;
  if (!isJson(result)) {
    return failed("internal", "result is not JSON", changeset);
  }
  if (
    new TextEncoder().encode(JSON.stringify(result)).byteLength >
      RESULT_MAX_BYTES
  ) {
    return failed("internal", "result exceeds the size limit", changeset);
  }
  return { status: 200, body: { status: "ok", result, changeset } };
}
