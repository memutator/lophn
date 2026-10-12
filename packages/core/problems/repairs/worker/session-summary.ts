// coding-agent worker kind의 세션 시작 summary 조립이다(coding-agent#T35; guides#R21, R22). 요청마다 요청자
// connection credential로 core loopback의 정본 읽기를 불러 summary를 만든다. worker는 자기 credential이 없어
// 범위 밖 자료를 대신 읽지 못하고, 읽기를 바꾸는 호출도 없다. core의 `/v1/coding_agent_sessions/summary`
// route가 요청을 이 worker로 넘긴다.
import { type Result } from "../../../../base/mod.ts";
import { CodingAgentSessionSummaryInputSchema } from "../../../../protocol/coding-agent/mod.ts";
import {
  createRpcClient,
  type RpcFetch,
} from "../../../../protocol/client/mod.ts";
import type { Route } from "../../../../protocol/base/mod.ts";
import type { WorkerRequest } from "../../../../protocol/supervision/mod.ts";
import { assembleSessionSummary } from "../../../../coding-agent/guides/mod.ts";
import { RepairContextRejection } from "./context.ts";

export const SESSION_SUMMARY_OP = "coding_agent_sessions.summary";

export type SessionSummaryPayload = {
  credential: string;
  principal: string;
  input: unknown;
};

export type SessionSummaryDeps = {
  baseUrl: string;
  now?(): string;
  fetch?: RpcFetch;
};

function rpcFetch(): RpcFetch {
  return (input, init) => {
    // EXTERNAL_FETCH tripwire: property access로만 부른다.
    const globalFetch = globalThis.fetch;
    return globalFetch(input, init).then(async (response) => ({
      status: response.status,
      headers: response.headers,
      bytes: new Uint8Array(await response.arrayBuffer()),
    }));
  };
}

export async function acceptSessionSummary(
  request: WorkerRequest,
  deps: SessionSummaryDeps,
): Promise<unknown> {
  const payload = request.payload as Partial<SessionSummaryPayload> | undefined;
  if (
    typeof payload !== "object" || payload === null ||
    typeof payload.credential !== "string" ||
    typeof payload.principal !== "string"
  ) {
    throw new RepairContextRejection("invalid_input", "invalid request body");
  }
  const input = CodingAgentSessionSummaryInputSchema.safeParse(payload.input);
  if (!input.success) {
    throw new RepairContextRejection("invalid_input", "invalid input");
  }
  const client = createRpcClient({
    baseUrl: deps.baseUrl,
    token: payload.credential,
    fetch: deps.fetch ?? rpcFetch(),
  });
  const assembled = await assembleSessionSummary(
    {
      read: (route: Route, body: unknown) =>
        client.call(route, body as never) as Promise<Result<unknown>>,
    },
    {
      principal: payload.principal,
      input: input.data,
      now: deps.now ?? (() => new Date().toISOString()),
    },
  );
  if (!assembled.ok) {
    throw new RepairContextRejection(
      assembled.error.code,
      assembled.error.message,
    );
  }
  return {
    summary: assembled.value.summary,
    as_of_seq: assembled.value.as_of_seq,
    next_cursor: assembled.value.summary.next_cursor,
  };
}
