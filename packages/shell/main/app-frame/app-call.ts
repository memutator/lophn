// `app:call-operation`의 main service. 앱 preload가 보낸 `{operation, input}`만 받고, 앱·release·mode는
// IPC를 보낸 실제 view에서 main이 정한다(페이지는 자기가 어느 앱인지 모른다). 화면은 operation만 부른다:
// 그 view의 고정 선언의 operations에 있는 것만 core의 `apps.call_tool`로 보낸다. operation의 입력은 앱 code가
// 확인하고, 허락과 기록은 core가 정한다. 결과는 core가 호출을 마치고 돌려준 outcome이다.
import { CALL_RESULT_MAX_BYTES } from "../../../protocol/apps/calls/limits.ts";
import type { ConnectTarget, CoreCaller, Outcome } from "./app-connection.ts";
import type { BoundView } from "./registry.ts";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** 앱 선언의 operation 중 main이 쓰는 것. */
interface OperationDeclaration {
  name: string;
  title: string;
  effect: "read" | "write" | "external";
}

export interface AppDeclaration {
  operations: readonly OperationDeclaration[];
}

/** 페이지에 보일 실패. 앱이 낸 오류는 앱의 code와 message를 그대로 싣는다. */
export type CallOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };

function fail(code: string, message: string): CallOutcome<never> {
  return { ok: false, error: { code, message } };
}

// IPC 입력 상한. protocol의 IPC 상한(64 KiB)과 같다.
const CALL_INPUT_MAX_BYTES = 64 * 1024;
/** 고정 bundle의 선언을 읽는다. 같은 bundle은 같은 선언이다. */
export type DeclarationSource = (view: {
  app: string;
  release: string | null;
  mode: ConnectTarget["mode"];
  bundleHash: string;
}) => Promise<Outcome<AppDeclaration>>;

interface AppCallDeps {
  declaration: DeclarationSource;
  call: CoreCaller;
}

// 오래 남는 view가 많아도 cache가 끝없이 자라지 않게 한다.
const CACHE_LIMIT = 64;

function remember<K, V>(cache: Map<K, V>, key: K, value: V): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
}

/** 모르는 field·빈 operation·wildcard는 거절한다. */
function checkCall(
  value: unknown,
): { operation: string; input: JsonValue } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const call = value as Record<string, unknown>;
  if (Object.keys(call).sort().join(",") !== "input,operation") {
    return undefined;
  }
  const operation = call.operation;
  if (
    typeof operation !== "string" ||
    operation.trim().length === 0 ||
    operation.trim() !== operation ||
    /\p{Cc}/u.test(operation) ||
    operation.includes("*")
  ) {
    return undefined;
  }
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(call.input);
  } catch {
    return undefined;
  }
  if (
    encoded === undefined ||
    new TextEncoder().encode(encoded).byteLength > CALL_INPUT_MAX_BYTES
  ) {
    return undefined;
  }
  // JSON 왕복과 같은 값만 받는다(undefined·함수·NaN 같은 비 JSON 값은 빠지거나 바뀐다).
  const input = JSON.parse(encoded) as JsonValue;
  if (JSON.stringify(input) !== encoded) return undefined;
  return { operation, input };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// 선언되지 않은 operation(command 이름 포함)과 이 앱 밖 operation은 같은 답이다(있는지 새지 않는다).
const NOT_AVAILABLE = fail("forbidden", "operation is not available");

// handler까지 가지 못한 이유(denial.code)를 페이지의 code로 옮긴다.
const DENIAL_CODES: Readonly<Record<string, string>> = {
  gate_blocked: "forbidden",
  not_declared: "forbidden",
  call_loop: "conflict",
  call_too_deep: "conflict",
  app_archived: "unavailable",
  app_unavailable: "unavailable",
};

// core 호출 자체가 실패했을 때. message는 고정 문구다.
function coreFailure(
  code: string,
  effect: OperationDeclaration["effect"],
): CallOutcome<never> {
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

/** core의 호출 outcome을 페이지에 보일 결과로 바꾼다. */
function outcomeOf(outcome: unknown): CallOutcome<unknown> {
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
        : { ok: true, value: body.result };
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

export function createAppCall(deps: AppCallDeps) {
  const declarations = new Map<string, AppDeclaration>();
  async function declarationOf(
    view: BoundView,
  ): Promise<Outcome<AppDeclaration>> {
    const key = view.binding.bundleHash;
    const known = declarations.get(key);
    if (known !== undefined) return { ok: true, value: known };
    const read = await deps.declaration({
      app: view.target.app,
      release: view.binding.release,
      mode: view.target.mode,
      bundleHash: key,
    });
    if (read.ok) remember(declarations, key, read.value);
    return read;
  }

  return {
    /** `app:call-operation` 하나. view는 IPC sender에서 registry가 정한 값이다. */
    async call(view: BoundView, value: unknown): Promise<CallOutcome<unknown>> {
      const call = checkCall(value);
      if (call === undefined) {
        return fail("invalid_input", "call is invalid");
      }
      const declaration = await declarationOf(view);
      if (!declaration.ok) return fail("unavailable", "app is not available");
      const declared = declaration.value.operations.find(
        (operation) => operation.name === call.operation,
      );
      if (declared === undefined) return NOT_AVAILABLE;

      const reply = await deps
        .call("memory", "apps", "call_tool", {
          target:
            view.target.mode === "live"
              ? {
                  mode: "live",
                  app: view.target.app,
                  release: view.binding.release,
                }
              : {
                  mode: "preview",
                  app: view.target.app,
                  process_nonce: view.binding.processNonce,
                },
          kind: "operation",
          name: declared.name,
          input: call.input,
          caller: { kind: "person", view_session: view.view_session },
        })
        .catch(() => ({
          ok: false as const,
          error: { code: "unavailable", message: "core call failed" },
        }));
      if (!reply.ok) return coreFailure(reply.error.code, declared.effect);
      return outcomeOf(record(reply.value)?.outcome);
    },
  };
}
