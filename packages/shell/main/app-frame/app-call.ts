// `app:call`의 main service. 앱 preload가 보낸 `{api, input}`만 받고, 앱·release·mode는
// IPC를 보낸 실제 view에서 main이 정한다(페이지는 자기가 어느 앱인지 모른다). api는 그 view의 고정 blueprint가
// 선언한 것만 core의 `app.call_tool`로 보낸다. 입력 검사와 default는 앱 process가 하고, 허락과
// 사람 결정은 core가 정한다. 결과는 core가 호출을 마치고 돌려준 outcome이다.
import type { ConnectTarget, CoreCaller, Outcome } from "./app-connection.ts";
import type { BoundView } from "./registry.ts";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** blueprint의 app-api 선언 중 main이 쓰는 것. */
interface AppApiDeclaration {
  key: string;
  label: string;
  effect: "read" | "write" | "external";
  /** 입력을 받는다. 입력이 없는 app-api는 false다. */
  hasInput: boolean;
}

export interface Blueprint {
  appApi: readonly AppApiDeclaration[];
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
// 앱 응답을 페이지로 넘기는 상한. 넘으면 결과를 넘기지 않는다.
const CALL_RESULT_MAX_BYTES = 8 * 1024 * 1024;

/** 고정 bundle의 blueprint를 읽는다. 같은 bundle은 같은 blueprint다. */
export type BlueprintSource = (view: {
  app: string;
  release: string | null;
  mode: ConnectTarget["mode"];
  bundleHash: string;
}) => Promise<Outcome<Blueprint>>;

interface AppCallDeps {
  blueprint: BlueprintSource;
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

/** 모르는 field·빈 api·wildcard는 거절한다. */
function checkCall(
  value: unknown,
): { api: string; input: JsonValue } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const call = value as Record<string, unknown>;
  if (Object.keys(call).sort().join(",") !== "api,input") return undefined;
  const api = call.api;
  if (
    typeof api !== "string" || api.trim().length === 0 || api.trim() !== api ||
    /\p{Cc}/u.test(api) || api.includes("*")
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
  return { api, input };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

// 선언되지 않은 app-api와 이 앱 밖 app-api는 같은 답이다(있는지 새지 않는다).
const NOT_AVAILABLE = fail("forbidden", "app-api is not available");

// handler까지 가지 못한 이유(denial.code)를 페이지의 code로 옮긴다.
const DENIAL_CODES: Readonly<Record<string, string>> = {
  gate_blocked: "forbidden",
  rejected: "forbidden",
  cancelled: "forbidden",
  not_declared: "forbidden",
  call_loop: "conflict",
  call_too_deep: "conflict",
  app_archived: "unavailable",
  app_unavailable: "unavailable",
};

// core 호출 자체가 실패했을 때. message는 고정 문구다.
function coreFailure(
  code: string,
  effect: AppApiDeclaration["effect"],
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

/** core의 app-api outcome을 페이지에 보일 결과로 바꾼다. */
function outcomeOf(outcome: unknown): CallOutcome<unknown> {
  const body = record(outcome);
  switch (body?.status) {
    case "succeeded": {
      let size = Infinity;
      try {
        size = new TextEncoder().encode(JSON.stringify(body.result) ?? "")
          .byteLength;
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
  const blueprints = new Map<string, Blueprint>();
  async function blueprintOf(view: BoundView): Promise<Outcome<Blueprint>> {
    const key = view.binding.bundleHash;
    const known = blueprints.get(key);
    if (known !== undefined) return { ok: true, value: known };
    const read = await deps.blueprint({
      app: view.target.app,
      release: view.binding.release,
      mode: view.target.mode,
      bundleHash: key,
    });
    if (read.ok) remember(blueprints, key, read.value);
    return read;
  }

  return {
    /** `app:call` 하나. view는 IPC sender에서 registry가 정한 값이다. */
    async call(view: BoundView, value: unknown): Promise<CallOutcome<unknown>> {
      const call = checkCall(value);
      if (call === undefined) {
        return fail("invalid_input", "call is invalid");
      }
      const blueprint = await blueprintOf(view);
      if (!blueprint.ok) return fail("unavailable", "app is not available");
      const declared = blueprint.value.appApi.find((api) =>
        api.key === call.api
      );
      if (declared === undefined) return NOT_AVAILABLE;
      // 입력이 없는 app-api는 페이지가 null로 부른다. 앱에는 입력 없이 보낸다.
      const input = !declared.hasInput && call.input === null
        ? undefined
        : call.input;

      const reply = await deps.call("memory", "apps", "call_tool", {
        target: view.target.mode === "live"
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
        tool: declared.key,
        ...(input === undefined ? {} : { input }),
        caller: { kind: "person", view_session: view.view_session },
      }).catch(() => ({
        ok: false as const,
        error: { code: "unavailable", message: "core call failed" },
      }));
      if (!reply.ok) return coreFailure(reply.error.code, declared.effect);
      return outcomeOf(record(reply.value)?.outcome);
    },
  };
}
