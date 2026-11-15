// `app_views/call`. 화면은 operation만 부른다: view에 묶인 release(preview는 preview bundle)의 선언에 있는 operation만
// 호출 경로(`apps/call_tool`)로 보낸다. 앱·release·nonce와 caller는 표의 binding에서만 온다. operation의 입력은 앱 code가
// 확인하고, 허락과 기록은 호출 경로가 정한다.
import { err, ok, type Result } from "../../../base/mod.ts";
import { CALL_RESULT_MAX_BYTES } from "../../../protocol/apps/calls/limits.ts";
import type { JsonValue } from "../../../protocol/base/json-values.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { AppViewOutcome } from "../../../protocol/apps/views.ts";
import type { AppViewsPorts } from "./ports.ts";
import type { ViewEntry } from "./table.ts";

type Effect = "read" | "write" | "external";

// 입력 상한. 앱 화면 IPC 상한(64 KiB)과 같다.
const CALL_INPUT_MAX_BYTES = 64 * 1024;

function fail(code: string, message: string): AppViewOutcome {
  return { ok: false, error: { code, message } };
}

/** 빈 operation·앞뒤 공백·제어 문자·wildcard, JSON 왕복이 다른 입력, 상한을 넘는 입력은 거절한다. */
export function checkCall(
  operation: string,
  input: unknown,
): { operation: string; input: JsonValue } | undefined {
  if (
    operation.trim().length === 0 ||
    operation.trim() !== operation ||
    /\p{Cc}/u.test(operation) ||
    operation.includes("*")
  ) {
    return undefined;
  }
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(input);
  } catch {
    return undefined;
  }
  if (
    encoded === undefined ||
    new TextEncoder().encode(encoded).byteLength > CALL_INPUT_MAX_BYTES
  ) {
    return undefined;
  }
  const parsed = JSON.parse(encoded) as JsonValue;
  if (JSON.stringify(parsed) !== encoded) return undefined;
  return { operation, input: parsed };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// 선언되지 않은 operation(command 이름, 구독 handler 이름 포함)과 이 앱 밖 operation은 같은 답이다(있는지 새지 않는다).
export const NOT_AVAILABLE = fail("forbidden", "operation is not available");

// handler까지 가지 못한 이유(denial.code)를 화면의 code로 옮긴다.
const DENIAL_CODES: Readonly<Record<string, string>> = {
  gate_blocked: "forbidden",
  not_declared: "forbidden",
  call_loop: "conflict",
  call_too_deep: "conflict",
  app_archived: "unavailable",
  app_unavailable: "unavailable",
};

// 호출 경로 자체가 실패했을 때. message는 고정 문구다.
function coreFailure(code: string, effect: Effect): AppViewOutcome {
  switch (code) {
    case "invalid_input":
      return fail("invalid_input", "call is invalid");
    case "forbidden":
    case "unauthorized":
      return NOT_AVAILABLE;
    case "conflict":
      return fail("conflict", "the app view changed");
    default:
      // 보낸 뒤 끊기면 쓰기 결과를 모른다. 자동으로 다시 부르지 않는다.
      return fail(
        "unavailable",
        effect === "read" ? "app is not available" : "result unknown",
      );
  }
}

/** 호출 경로의 outcome을 화면에 보일 결과로 바꾼다. 앱이 낸 오류는 앱의 code와 message를 그대로 싣는다. */
function outcomeOf(outcome: unknown): AppViewOutcome {
  const body = record(outcome);
  switch (body?.status) {
    case "succeeded": {
      let size = Infinity;
      try {
        size = new TextEncoder().encode(
          JSON.stringify(body.result) ?? "",
        ).byteLength;
      } catch {
        // 직렬화할 수 없는 값은 아래에서 거절한다.
      }
      return size > CALL_RESULT_MAX_BYTES
        ? fail("unavailable", "result is too large")
        : { ok: true, value: body.result as JsonValue };
    }
    case "failed": {
      const error = record(body.error);
      return typeof error?.code === "string" &&
        typeof error.message === "string"
        ? fail(error.code, error.message)
        : fail("unavailable", "app response did not match");
    }
    case "denied": {
      const denial = record(body.denial);
      return fail(
        DENIAL_CODES[String(denial?.code)] ?? "forbidden",
        typeof denial?.message === "string" ? denial.message : "not available",
      );
    }
    case "unknown":
      return fail("unavailable", "result unknown");
    default:
      return fail("unavailable", "app response did not match");
  }
}

// 묶인 대상의 선언에서 operation의 effect를 찾는다. 없으면 null(구독 handler도 화면이 부를 이름이 아니다).
async function declaredEffect(
  ports: AppViewsPorts,
  entry: ViewEntry,
  name: string,
): Promise<Result<Effect | null>> {
  if (entry.args.mode === "preview") {
    const found = await ports.lookup.findPreview(
      entry.args.app as Id<"app">,
      entry.binding.process_nonce,
      "operation",
      name,
    );
    return found.ok ? ok(found.value?.effect ?? null) : found;
  }
  const found = ports.lookup.find(
    entry.args.app as Id<"app">,
    entry.binding.release as Id<"rel"> | null,
    "operation",
    name,
  );
  if (!found.ok) return found;
  return ok(
    found.value === null || found.value.subscription === true
      ? null
      : found.value.effect,
  );
}

export async function callView(
  ports: AppViewsPorts,
  entry: ViewEntry,
  operation: string,
  input: unknown,
): Promise<Result<{ outcome: AppViewOutcome }>> {
  const call = checkCall(operation, input);
  if (call === undefined) {
    return err({ code: "invalid_input", message: "call is invalid" });
  }
  if (entry.lost !== null) {
    return ok({ outcome: fail("unavailable", "app is not available") });
  }
  const effect = await declaredEffect(ports, entry, call.operation);
  if (!effect.ok) {
    return ok({ outcome: fail("unavailable", "app is not available") });
  }
  if (effect.value === null) return ok({ outcome: NOT_AVAILABLE });
  const reply = await ports.path
    .call(
      {
        target:
          entry.args.mode === "live"
            ? {
                mode: "live",
                app: entry.args.app,
                release: entry.binding.release,
              }
            : {
                mode: "preview",
                app: entry.args.app,
                process_nonce: entry.binding.process_nonce,
              },
        kind: "operation",
        name: call.operation,
        input: call.input,
        caller: { kind: "person", view_session: entry.view },
      },
      { actor: "user" },
    )
    .catch(() =>
      err({ code: "unavailable" as const, message: "core call failed" }),
    );
  if (!reply.ok) {
    return ok({ outcome: coreFailure(reply.error.code, effect.value) });
  }
  return ok({ outcome: outcomeOf(reply.value.outcome) });
}
