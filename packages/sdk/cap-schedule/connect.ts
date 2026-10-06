import { currentContext } from "./handlers.ts";

// 앱 runtime이 설치하는 host port의 모양이다(packages/apps/connections/client.ts와 같은 심볼·
// 필드). SDK는 packages/apps를 import하지 않는다.
export const PAIR_PORT = Symbol.for("lophn.cap-apps");

type PortResponse = { status: number; body: unknown };

type DirectRequest = {
  method: "GET" | "POST";
  path: string;
  authorization: string;
  body?: unknown;
};

export type PairPort = {
  connect(request: {
    app: string;
    commands: readonly string[];
    parent_invocation: string | null;
    incoming?: {
      app: string;
      release: string;
      parent_invocation: string | null;
    };
  }): Promise<PortResponse>;
  confirmRequest(body: Record<string, unknown>): Promise<PortResponse>;
  confirmPoll(body: Record<string, unknown>): Promise<PortResponse>;
  direct(endpoint: string, request: DirectRequest): Promise<PortResponse>;
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

// 호출 결과. 결과 모름은 오류가 아니다. 앱이 처리했는지 모른다는 사실이고 같은 requestKey로
// 다시 부르면 대상 앱이 같은 결과를 돌려준다(handler를 다시 실행하지 않는다).
export type AppCommandOutcome =
  | {
    kind: "result";
    result: unknown;
    invocation?: string;
    revert?: unknown;
    source?: unknown;
  }
  | { kind: "unknown"; requestKey: string };

export type AppCallOptions = {
  // 같은 호출의 식별이다. 없으면 새로 정한다. 다시 부를 때는 같은 값을 쓴다.
  requestKey?: string;
  // 이미 가진 proof를 붙인다. 없으면 confirm=true command는 아래 흐름으로 proof를 받는다.
  proof?: unknown;
  // true면 처음부터 사람 확인 흐름으로 간다. 지정하지 않으면 대상 앱이 confirm을 요구했을 때만
  // 간다. false면 자동으로 하지 않는다.
  confirm?: boolean;
  // 사람의 결정을 기다리는 한도(ms). 기본 5분이다. 넘으면 unavailable이고 details에 approval이 있다.
  confirmTimeoutMs?: number;
};

export type AppCommandsClient = {
  readonly app: string;
  // lophn이 허락 범위로 줄여 서명한 command 목록이다. 요청보다 적을 수 있다.
  readonly commands: readonly string[];
  call(
    command: string,
    input?: unknown,
    options?: AppCallOptions,
  ): Promise<AppResult<AppCommandOutcome>>;
  status(
    requestKey: string,
    invocation: string,
  ): Promise<AppResult<{ progress: string; result?: unknown }>>;
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

function failure(message: string, code: AppErrorCode = "unavailable") {
  return { ok: false, error: { code, message } } as const;
}

function plain(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function failed(response: PortResponse): AppResult<never> {
  const error = plain(plain(response.body)?.["error"]);
  if (
    error !== undefined && typeof error["code"] === "string" &&
    CODES.includes(error["code"]) && typeof error["message"] === "string"
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

function port(): PairPort | undefined {
  const found = (globalThis as Record<symbol, unknown>)[PAIR_PORT];
  return found !== null && typeof found === "object"
    ? found as PairPort
    : undefined;
}

const INVOKE_PATH = "/_lophn/commands/invoke";
const STATUS_PATH = "/_lophn/commands/status";

// 다른 앱의 command를 쓰는 client를 준비한다. 쓸 수 있는 command는 blueprint 선언·사람이 허락한
// 앱 쌍·대상 앱의 현재 command의 교집합이다. import만으로는 아무것도 열리지 않고, 허락 없는
// 앱·command는 없는 것처럼 거절된다. 호출하는 invocation 문맥(현재 invocation)이 부모로 전달된다.
export async function connectAppCommands(
  app: string,
  commands: readonly string[],
): Promise<AppResult<AppCommandsClient>> {
  const host = port();
  if (host === undefined) return failure("app connections are not available");
  let response: PortResponse;
  try {
    const context = currentContext();
    response = await host.connect({
      app,
      commands: [...commands],
      parent_invocation: context?.invocation ?? null,
      // 다른 앱에게서 받은 호출이면 그 출처의 식별만 보낸다. path는 서비스가 정한다.
      ...(context?.caller ? { incoming: context.caller } : {}),
    });
  } catch {
    return failure("connection could not be prepared");
  }
  if (response.status !== 200) return failed(response);
  const body = plain(response.body);
  const connection = plain(body?.["connection"]);
  if (
    typeof body?.["endpoint"] !== "string" ||
    typeof body["signature"] !== "string" || connection === undefined ||
    !Array.isArray(connection["commands"])
  ) {
    return failure("response did not match");
  }
  const endpoint = body["endpoint"];
  const granted = connection["commands"] as string[];
  const release = typeof connection["release"] === "string"
    ? connection["release"]
    : undefined;
  const authorization = JSON.stringify({
    payload: connection,
    signature: body["signature"],
  });
  const targetNonce = connection["process_nonce"];
  const origin = plain(connection["caller"]);
  const connectionParent = typeof origin?.["parent_invocation"] === "string"
    ? origin["parent_invocation"]
    : null;

  // confirm=true command의 approval을 요청하고 사람의 결정을 짧은 poll로 기다려 proof를 받는다.
  // 소켓을 오래 잡지 않고, 기다림은 호출한 쪽의 한도까지다.
  async function proofFor(
    command: string,
    input: unknown,
    timeoutMs: number,
  ): Promise<AppResult<unknown>> {
    if (release === undefined || typeof targetNonce !== "string") {
      return failure("response did not match");
    }
    let requested: PortResponse;
    try {
      requested = await host!.confirmRequest({
        app,
        command,
        ...(input === undefined ? {} : { input }),
        target_release: release,
        target_process_nonce: targetNonce,
        parent_invocation: connectionParent,
      });
    } catch {
      return failure("confirmation could not be requested");
    }
    if (requested.status !== 200) return failed(requested);
    const approval = plain(requested.body)?.["approval"];
    if (typeof approval !== "string") return failure("response did not match");
    const deadline = Date.now() + timeoutMs;
    while (true) {
      let polled: PortResponse;
      try {
        polled = await host!.confirmPoll({ approval, wait_ms: 3000 });
      } catch {
        return failure("confirmation could not be read");
      }
      if (polled.status !== 200) return failed(polled);
      const state = plain(polled.body)?.["state"];
      if (state === "granted") {
        const proof = plain(polled.body)?.["proof"];
        return proof === undefined
          ? failure("response did not match")
          : { ok: true, value: proof };
      }
      if (state === "rejected") {
        return failure("confirmation was rejected", "forbidden");
      }
      if (state === "expired") return failure("confirmation expired");
      if (state !== "pending") return failure("response did not match");
      if (Date.now() >= deadline) {
        return {
          ok: false,
          error: {
            code: "unavailable",
            message: "confirmation is still pending",
            details: { approval },
          },
        };
      }
    }
  }

  async function direct(
    request: DirectRequest,
  ): Promise<PortResponse | "not_sent" | "lost"> {
    try {
      return await host!.direct(endpoint, request);
    } catch (error) {
      return (error as Error)?.name === "NotSent" ? "not_sent" : "lost";
    }
  }

  return {
    ok: true,
    value: {
      app,
      commands: granted,
      async call(command, input, options = {}) {
        if (!granted.includes(command)) {
          return failure("command is outside the connection", "forbidden");
        }
        const requestKey = options.requestKey ?? crypto.randomUUID();
        const timeoutMs = options.confirmTimeoutMs ?? 300_000;
        let proof = options.proof;
        if (proof === undefined && options.confirm === true) {
          const obtained = await proofFor(command, input, timeoutMs);
          if (!obtained.ok) return obtained;
          proof = obtained.value;
        }
        const invoke = (attached: unknown) =>
          direct({
            method: "POST",
            path: INVOKE_PATH,
            authorization,
            body: {
              request_key: requestKey,
              ...(release === undefined ? {} : { release }),
              command,
              ...(input === undefined ? {} : { input }),
              ...(attached === undefined ? {} : { proof: attached }),
            },
          });
        let sent = await invoke(proof);
        // 대상 앱이 사람 확인을 요구하면(보낸 요청은 handler 전에 거절됐다) 확인 흐름으로 가서
        // 같은 입력·같은 request_key로 한 번만 다시 보낸다.
        if (
          proof === undefined && options.confirm !== false &&
          typeof sent === "object" && sent.status === 403 &&
          plain(plain(plain(sent.body)?.["error"])?.["details"])?.[
              "confirm_required"
            ] === true
        ) {
          const obtained = await proofFor(command, input, timeoutMs);
          if (!obtained.ok) return obtained;
          sent = await invoke(obtained.value);
        }
        // 요청이 나가지 않았으면 안전하게 다시 부를 수 있다. 보낸 뒤 끊겼으면 결과 모름이고
        // 자동으로 다시 부르지 않는다.
        if (sent === "not_sent") return failure("app is not reachable");
        if (sent === "lost") {
          return { ok: true, value: { kind: "unknown", requestKey } };
        }
        if (sent.status !== 200) return failed(sent);
        const output = plain(plain(sent.body)?.["result"]);
        if (output === undefined || !("result" in output)) {
          return { ok: true, value: { kind: "unknown", requestKey } };
        }
        const record = plain(sent.body)!;
        return {
          ok: true,
          value: {
            kind: "result",
            result: output["result"],
            ...(typeof record["invocation"] === "string"
              ? { invocation: record["invocation"] }
              : {}),
            ...("revert" in output ? { revert: output["revert"] } : {}),
            ...("source" in output ? { source: output["source"] } : {}),
          },
        };
      },
      async status(requestKey, invocation) {
        const query = new URLSearchParams({
          request_key: requestKey,
          invocation,
        });
        const sent = await direct({
          method: "GET",
          path: `${STATUS_PATH}?${query}`,
          authorization,
        });
        if (sent === "not_sent") return failure("app is not reachable");
        if (sent === "lost") return failure("the response was lost");
        if (sent.status !== 200) return failed(sent);
        const record = plain(sent.body);
        if (typeof record?.["progress"] !== "string") {
          return failure("response did not match");
        }
        return {
          ok: true,
          value: {
            progress: record["progress"],
            ...("result" in record ? { result: record["result"] } : {}),
          },
        };
      },
    },
  };
}
