// `app:call-operation`의 main service. 앱 preload가 보낸 `{operation, input}`만 꺼내 core `app_views/call`로
// 보낸다. 신원은 IPC를 보낸 실제 view의 id 하나다(페이지는 자기가 어느 앱인지 모른다). 그 view가 어느
// 앱·release에 묶였는지, 어떤 operation을 부를 수 있는지는 core의 view 표가 정한다.
import type { CoreCaller } from "./app-connection.ts";
import type { BoundView } from "./registry.ts";

/** 페이지에 보일 결과. 앱이 낸 오류는 앱의 code와 message를 그대로 싣는다. */
export type CallOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };

function fail(code: string, message: string): CallOutcome<never> {
  return { ok: false, error: { code, message } };
}

interface AppCallDeps {
  call: CoreCaller;
  /** core가 그 view를 모른다(core 재시작, 표에서 내보냄). 같은 요청으로 다시 연다. */
  resume(view_session: string): void;
}

/**
 * 페이지 값에서는 operation과 input만 받는다. view·app·release 같은 다른 칸이 있으면 거절한다(신원은 sender view다).
 * input은 폰 bridge와 같은 규칙으로 JSON 값으로 만든다(없으면 null, JSON 왕복). IPC는 structured clone이라 값이
 * undefined인 칸이 그대로 오는데, core 통로의 입력 검사는 그런 값을 JSON이 아니라고 거절한다.
 */
function checkCall(
  value: unknown,
): { operation: unknown; input: unknown } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const call = value as Record<string, unknown>;
  if (Object.keys(call).some((key) => key !== "operation" && key !== "input")) {
    return undefined;
  }
  try {
    const encoded = JSON.stringify(call.input ?? null);
    return { operation: call.operation, input: JSON.parse(encoded) };
  } catch {
    return undefined;
  }
}

export function createAppCall(deps: AppCallDeps) {
  return {
    /** `app:call-operation` 하나. view는 IPC sender에서 registry가 정한 값이다. */
    async call(view: BoundView, value: unknown): Promise<CallOutcome<unknown>> {
      const call = checkCall(value);
      if (call === undefined) return fail("invalid_input", "call is invalid");
      const reply = await deps
        .call("memory", "app_views", "call", {
          view: view.view_session,
          operation: call.operation,
          input: call.input,
        })
        .catch(() => ({
          ok: false as const,
          error: { code: "unavailable", message: "core call failed" },
        }));
      if (reply.ok) {
        return (reply.value as { outcome: CallOutcome<unknown> }).outcome;
      }
      if (reply.error.code === "invalid_input") {
        return fail("invalid_input", "call is invalid");
      }
      if (reply.error.code === "not_found") deps.resume(view.view_session);
      return fail("unavailable", "app is not available");
    },
  };
}
