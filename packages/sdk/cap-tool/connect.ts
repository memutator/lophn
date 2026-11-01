import { currentContext } from "./handlers.ts";

// 다른 앱의 command는 core를 거쳐 부른다. core가 부른 쪽(이 앱과 release, 부모 invocation)을 정하고
// Gate로 판정한다. broker 경로는 protocol/apps/calls/broker.ts의 APP_BROKER_PATHS.call과 같다
// (SDK는 zod를 import하지 않는다).
const APP_CALL_PATH = "/_lophn/broker/apps/call";
const CAP_HOST = Symbol.for("lophn.cap-host");

type PortResponse = { status: number; body: unknown };

type HostPort = {
  post(path: string, body: Record<string, unknown>): Promise<PortResponse>;
};

export type AppErrorCode =
  | "invalid_input"
  | "not_found"
  | "forbidden"
  | "unauthorized"
  | "conflict"
  | "unavailable"
  | "internal";

export type AppError = {
  code: AppErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export type AppResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppError };

// core가 돌려준 호출 결과다(protocol/apps/calls/call.ts의 toolCallOutputSchema와 같다).
// 호출이 막혔거나(denied) 결과를 모르는(unknown) 것은 오류가 아니라 결과의 한 갈래다. unknown은
// 대상 앱이 처리했는지 모른다는 사실이라 자동으로 다시 부르지 않는다.
type UnknownReason =
  | "unavailable"
  | "connection_lost"
  | "core_restarted"
  | "timeout";

export type CallOutcome =
  | { status: "succeeded"; result: unknown }
  | { status: "failed"; error: { code: string; message: string } }
  | { status: "denied"; denial: { code: string; message: string } }
  | { status: "unknown"; reason: UnknownReason };

export type CallOutput = {
  // 기록을 남기지 않은 성공한 읽기에서만 null이다.
  invocation: string | null;
  outcome: CallOutcome;
};

export type CommandClient = {
  readonly app: string;
  // 이 client가 부르겠다고 연 command 이름 목록이다. 허락은 호출마다 core가 판정한다.
  readonly commands: readonly string[];
  call(name: string, input?: unknown): Promise<AppResult<CallOutput>>;
};

const CODES: readonly string[] = [
  "invalid_input",
  "not_found",
  "forbidden",
  "unauthorized",
  "conflict",
  "unavailable",
  "internal",
];

const UNKNOWN_REASONS: readonly string[] = [
  "unavailable",
  "connection_lost",
  "core_restarted",
  "timeout",
];

function failure(message: string, code: AppErrorCode = "unavailable") {
  return { ok: false, error: { code, message } } as const;
}

function plain(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function failed(response: PortResponse): AppResult<never> {
  const error = plain(plain(response.body)?.["error"]);
  if (
    error !== undefined &&
    typeof error["code"] === "string" &&
    CODES.includes(error["code"]) &&
    typeof error["message"] === "string"
  ) {
    const details = plain(error["details"]);
    return {
      ok: false,
      error: {
        code: error["code"] as AppErrorCode,
        message: error["message"],
        ...(details === undefined ? {} : { details }),
      },
    };
  }
  return failure("request failed");
}

function pair(value: unknown): { code: string; message: string } | undefined {
  const item = plain(value);
  if (typeof item?.["code"] !== "string") return;
  if (typeof item["message"] !== "string") return;
  return { code: item["code"], message: item["message"] };
}

function outcomeOf(value: unknown): CallOutcome | undefined {
  const outcome = plain(value);
  switch (outcome?.["status"]) {
    case "succeeded":
      return "result" in outcome
        ? { status: "succeeded", result: outcome["result"] }
        : undefined;
    case "failed": {
      const error = pair(outcome["error"]);
      return error && { status: "failed", error };
    }
    case "denied": {
      const denial = pair(outcome["denial"]);
      return denial && { status: "denied", denial };
    }
    case "unknown":
      return typeof outcome["reason"] === "string" &&
        UNKNOWN_REASONS.includes(outcome["reason"])
        ? {
            status: "unknown",
            reason: outcome["reason"] as UnknownReason,
          }
        : undefined;
    default:
      return;
  }
}

function host(): HostPort | undefined {
  const found = (globalThis as Record<symbol, unknown>)[CAP_HOST];
  return found !== null &&
    typeof found === "object" &&
    typeof (found as Partial<HostPort>).post === "function"
    ? (found as HostPort)
    : undefined;
}

// 다른 앱의 command를 부르는 client를 준비한다. import만으로는 아무것도 열리지 않는다. 호출하는
// invocation(현재 호출 문맥)이 부모로 자동으로 붙고 부른 쪽의 신원은 core가 정한다.
export function connectCommands(
  app: string,
  commands: readonly string[],
): CommandClient {
  return {
    app,
    commands,
    async call(name, input) {
      if (!commands.includes(name)) {
        return failure("command is outside the connection", "forbidden");
      }
      const port = host();
      if (port === undefined) return failure("app calls are not available");
      let response: PortResponse;
      try {
        response = await port.post(APP_CALL_PATH, {
          target_app: app,
          command: name,
          ...(input === undefined ? {} : { input }),
          parent_invocation: currentContext()?.invocation ?? null,
        });
      } catch {
        // 보낸 뒤 끊겼을 수 있다. 처리됐는지 모르므로 자동으로 다시 부르지 않는다.
        return {
          ok: true,
          value: {
            invocation: null,
            outcome: { status: "unknown", reason: "connection_lost" },
          },
        };
      }
      if (response.status !== 200) return failed(response);
      const body = plain(response.body);
      const outcome = outcomeOf(body?.["outcome"]);
      const invocation = body?.["invocation"];
      if (
        outcome === undefined ||
        (invocation !== null && typeof invocation !== "string")
      ) {
        return failure("response did not match");
      }
      return { ok: true, value: { invocation, outcome } };
    },
  };
}
