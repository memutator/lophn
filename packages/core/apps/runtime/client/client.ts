// Deno runtime client. agent runtime·MCP·CLI가 앱을 부르는 한 길이다.
// core에서 `POST /v1/apps/connect`로 제한된 AppConnection을 받고, 그 뒤 업무 요청은
// 앱 direct socket으로 core를 지나지 않고 간다(apps/runtime#R10). 전송이 끊기면 결과 모름으로
// 돌려주고 자동으로 다시 부르지 않는다(R12). 같은 request_key로 다시 부르면 앱이 같은 결과를
// 돌려준다(handler를 다시 실행하지 않는다).
import { err, ok, type Result } from "../../../../base/mod.ts";
import type { z } from "zod";
import {
  type AppConnectInput,
  type AppConnection,
  appConnectOutputSchema,
  type CommandCancelOutput,
  commandCancelOutputSchema,
  type CommandInvokeInput,
  type CommandInvokeOutput,
  commandInvokeOutputSchema,
  type CommandStatusOutput,
  commandStatusOutputSchema,
  DIRECT_SOCKET_PATHS,
} from "../../../../protocol/apps/mod.ts";
import {
  errorBodySchema,
  errorCodeForStatus,
} from "../../../../protocol/platform/mod.ts";
import {
  type DirectTransport,
  NotSent,
  unixDirectTransport,
} from "./unix-http.ts";

export type CoreCall = (
  path: string,
  body: unknown,
) => Promise<{ status: number; body: unknown }>;

export type RuntimeClientOptions = {
  // core loopback API와 호출자의 token. fetch는 기본 전역 fetch다.
  core:
    | { baseUrl: string; token: string; fetch?: typeof fetch }
    | { call: CoreCall };
  direct?: DirectTransport;
};

// 호출 결과. 결과 모름은 오류가 아니다: 앱이 처리했는지 모른다는 사실이고 같은
// request_key로 다시 부르면 같은 결과를 조회한다.
export type InvokeOutcome =
  | { kind: "result"; output: CommandInvokeOutput }
  | { kind: "unknown"; request_key: string };

export type InvokeRequest = {
  command: string;
  input?: CommandInvokeInput["input"];
  // 같은 호출의 식별이다. 없으면 새로 정한다. 다시 부를 때는 같은 값을 쓴다.
  request_key?: string;
  proof?: CommandInvokeInput["proof"];
};

export type AppSession = {
  readonly endpoint: string;
  readonly connection: AppConnection;
  // 앱 direct 요청의 Authorization 값이다. 서명된 connection envelope의 JSON이다.
  readonly authorization: string;
  invoke(request: InvokeRequest): Promise<Result<InvokeOutcome>>;
  status(
    requestKey: string,
    invocation: string,
  ): Promise<Result<CommandStatusOutput>>;
  cancel(
    requestKey: string,
    invocation: string,
  ): Promise<Result<CommandCancelOutput>>;
};

export type RuntimeClient = {
  connect(input: AppConnectInput): Promise<Result<AppSession>>;
};

function failure(status: number, body: unknown): Result<never> {
  const parsed = errorBodySchema.safeParse(body);
  if (parsed.success) return err(parsed.data.error);
  return err({
    code: errorCodeForStatus(status) ?? "unavailable",
    message: "request failed",
  });
}

function coreCall(core: RuntimeClientOptions["core"]): CoreCall {
  if ("call" in core) return core.call;
  const send = core.fetch ?? fetch;
  const base = core.baseUrl.replace(/\/$/, "");
  return async (path, body) => {
    const response = await send(`${base}/v1/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${core.token}`,
      },
      body: JSON.stringify(body),
    });
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch { /* 본문이 없다 */ }
    return { status: response.status, body: parsed };
  };
}

export function createRuntimeClient(
  options: RuntimeClientOptions,
): RuntimeClient {
  const direct = options.direct ?? unixDirectTransport;
  const core = coreCall(options.core);

  function session(
    endpoint: string,
    connection: AppConnection,
    signature: string,
  ): AppSession {
    const authorization = JSON.stringify({ payload: connection, signature });

    async function call<S extends z.ZodType>(
      request: { method: "GET" | "POST"; path: string; body?: unknown },
      schema: S,
    ): Promise<Result<z.output<S>>> {
      let response;
      try {
        response = await direct(endpoint, { ...request, authorization });
      } catch (error) {
        return err({
          code: "unavailable",
          message: error instanceof NotSent
            ? "app is not reachable"
            : "the response was lost",
        });
      }
      if (response.status !== 200) {
        return failure(response.status, response.body);
      }
      const parsed = schema.safeParse(response.body);
      if (!parsed.success) {
        return err({ code: "unavailable", message: "response did not match" });
      }
      return ok(parsed.data);
    }

    return {
      endpoint,
      connection,
      authorization,
      async invoke(request) {
        const requestKey = request.request_key ?? crypto.randomUUID();
        const body: CommandInvokeInput = {
          request_key: requestKey,
          // live는 release가 필수다. connection이 고정한 release를 그대로 쓴다.
          ...(connection.release === null
            ? {}
            : { release: connection.release }),
          command: request.command,
          ...(request.input === undefined ? {} : { input: request.input }),
          ...(request.proof === undefined ? {} : { proof: request.proof }),
        };
        let response;
        try {
          response = await direct(endpoint, {
            method: "POST",
            path: DIRECT_SOCKET_PATHS.invoke,
            authorization,
            body,
          });
        } catch (error) {
          // 요청이 나가지 않았으면 안전하게 다시 시도할 수 있다.
          if (error instanceof NotSent) {
            return err({
              code: "unavailable",
              message: "app is not reachable",
            });
          }
          // 보낸 뒤 끊겼다. 앱이 이미 처리했을 수 있어 자동으로 다시 부르지 않는다.
          return ok({ kind: "unknown", request_key: requestKey });
        }
        if (response.status !== 200) {
          return failure(response.status, response.body);
        }
        const parsed = commandInvokeOutputSchema.safeParse(response.body);
        if (!parsed.success) {
          // 응답은 왔지만 읽을 수 없다. 처리 여부를 모른다.
          return ok({ kind: "unknown", request_key: requestKey });
        }
        return ok({ kind: "result", output: parsed.data });
      },
      status(requestKey, invocation) {
        const query = new URLSearchParams({
          request_key: requestKey,
          invocation,
        });
        return call({
          method: "GET",
          path: `${DIRECT_SOCKET_PATHS.status}?${query}`,
        }, commandStatusOutputSchema);
      },
      cancel(requestKey, invocation) {
        return call({
          method: "POST",
          path: DIRECT_SOCKET_PATHS.cancel,
          body: { request_key: requestKey, invocation },
        }, commandCancelOutputSchema);
      },
    };
  }

  return {
    async connect(input) {
      let response;
      try {
        response = await core("apps/connect", input);
      } catch {
        return err({ code: "unavailable", message: "core is unreachable" });
      }
      if (response.status !== 200) {
        return failure(response.status, response.body);
      }
      const parsed = appConnectOutputSchema.safeParse(response.body);
      if (!parsed.success) {
        return err({ code: "unavailable", message: "response did not match" });
      }
      return ok(
        session(
          parsed.data.endpoint,
          parsed.data.connection,
          parsed.data.signature,
        ),
      );
    },
  };
}
