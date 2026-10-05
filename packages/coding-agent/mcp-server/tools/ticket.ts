// lophn_ticket tool의 실행이다(T20, mcp#R26, R27). registry route로만 dispatch한
// 입력을 core RPC 하나로 보내고, 대응 contract 출력을 그대로 돌려준다. claim·
// renew·release는 실제 실행이며 응답에 connection·claim_seq·expires_at·반납
// 방법을 남긴다. 통로가 기한이나 자동 갱신을 덧붙이지 않는다(mcp#R27, cli#R41).
// start·resume·harness 설치·permission 응답 op는 소유 route가 없어 discovery와
// 직접 호출 모두에서 거절이다(mcp#R37). 문제 직접 claim op도 없다(tickets#R16).
import type { Result } from "../../../base/mod.ts";
import type { LophnError } from "../../../base/mod.ts";
import {
  MCP_APP_ROUTES,
  type McpAppToolName,
} from "../../../contracts/coding-agent/mod.ts";
import type { Route } from "../../../contracts/platform/mod.ts";
import { commandsResult } from "../../../contracts/platform/mod.ts";

// core client의 command 호출 모양이다. connection client leaf 내부 type이라
// leaf mod.ts를 거치지 않고 여기서 구별 없이 구조로만 좁혀 쓴다(check-deps
// leaf 규칙 — connection client leaf의 내부는 다른 leaf에서 import하지 않는다).
type ClientLike = {
  command(
    route: { resource: string; method: string; name?: string },
    body: { input: unknown; idempotency_key: string },
  ): Promise<
    Result<
      unknown,
      LophnError
    >
  >;
};

// tools/call의 실행 결과다. server가 mcpToolResult로 두 표현을 만든다(R5).
export type TicketToolResult = {
  summary: string;
  data: unknown;
  next: string[];
};

// core client가 command envelope에 채우는 idempotency key 발급이다.
export type IdempotencyKey = () => string;

export type TicketToolDeps = {
  client: ClientLike;
  now: () => string;
  idempotencyKey: IdempotencyKey;
};

type ClaimView = {
  ticket?: string;
  connection?: string;
  claim_seq?: string;
  expires_at?: string;
  state?: string;
};

// claim·renew의 응답은 connection·claim_seq·expires_at을 contract 출력 그대로
// 가진다. 반납 방법은 다음 동작 안내로 덧붙인다.
function claimNext(result: ClaimView): string[] {
  const seq = typeof result.claim_seq === "string" ? result.claim_seq : "";
  return [
    `ticket show ${result.ticket ?? "(ticket)"}`,
    `ticket release ${result.ticket ?? "(ticket)"} ${
      seq ? `claim_seq=${seq}` : ""
    }`.trim(),
  ];
}

function claimSummary(result: ClaimView, kind: string): string {
  return `${kind} ${result.ticket ?? "ticket"} claim_seq ${
    result.claim_seq ?? "?"
  } expires_at ${result.expires_at ?? "?"} connection ${
    result.connection ?? "?"
  }`;
}

function failure(error: LophnError): TicketToolResult {
  return {
    summary: error.message,
    data: { code: error.code, details: error.details ?? {} },
    next: ["ticket show로 현재 상태를 다시 읽는다"],
  };
}

// list·show·checks·claim·renew·release·report를 소유 route 하나로 core에 보낸다.
// 입력 검사는 registry(route input)가 실행 전에 했다(R6).
export function createTicketTool(
  deps: TicketToolDeps,
): (
  toolName: string,
  route: Route,
  input: unknown,
) => Promise<TicketToolResult> {
  const routes = MCP_APP_ROUTES.lophn_ticket as Record<string, Route>;
  return async function runTicketTool(_toolName, route, rawInput) {
    const input = (rawInput ?? {}) as Record<string, unknown>;
    const op = typeof input.op === "string" ? input.op : undefined;
    void _toolName;
    const known = op !== undefined && Object.hasOwn(routes, op)
      ? routes[op]
      : undefined;
    if (!known) {
      // op·route가 표에 없으면 실행하지 않는다(mcp#R37 — start·resume·permission
      // 응답류는 이 unkown op 경로로 거절이다).
      return {
        summary: "ticket tool 표에 없는 op다",
        data: { op: op ?? null },
        next: ["MCP discovery의 lophn_ticket ops를 본다"],
      };
    }
    if (route.kind !== "command") {
      // read(list·show·checks)도 POST 지만 kind는 read다. 각각 route의 method로
      // 보낸다.
      const looked = await deps.client.command(
        route as unknown as Parameters<ClientLike["command"]>[0],
        { input, idempotency_key: deps.idempotencyKey() },
      );
      if (!looked.ok) return failure(looked.error);
      return {
        summary: `${op} ticket ${op === "list" ? "목록" : "본문"}`,
        data: looked.value,
        next: op === "list"
          ? ["ticket show <ticket>로 전체 본문을 읽는다"]
          : ["lophn_ticket list로 목록을 돌아본다"],
      };
    }
    const sent = await deps.client.command(
      route as unknown as Parameters<ClientLike["command"]>[0],
      { input, idempotency_key: deps.idempotencyKey() },
    );
    if (!sent.ok) return failure(sent.error);
    const value = sent.value as ClaimView & Record<string, unknown>;
    if (op === "claim" || op === "renew") {
      return {
        summary: claimSummary(value, op === "claim" ? "claim했다" : "갠했다"),
        data: value,
        // 반납 방법을 응답에 남긴다. 통로가 갱신 주기를 대신하지 않는다(mcp#R27).
        next: claimNext(value),
      };
    }
    if (op === "release") {
      return {
        summary: `release ${value.ticket ?? "ticket"} → ${
          value.state ?? "open"
        }`,
        data: value,
        next: ["ticket show로 반납 뒤 state를 읽는다"],
      };
    }
    if (op === "report") {
      return {
        summary: `report ${value.ticket ?? "ticket"} → ${
          value.state ?? "reported"
        }`,
        data: value,
        next: ["ticket checks로 조건별 검사 결과를 읽는다"],
      };
    }
    // list·show·checks 외 command가 더 생기지 않는다(7개 op).
    return {
      summary: `${op}`,
      data: value,
      next: [],
    };
  };
}

// ticket tool의 소유 route 표다. registry와 같은 값을 쓴다(op마다 route 하나).
export function ticketToolRoute(
  op: string,
): Route | undefined {
  const routes = MCP_APP_ROUTES.lophn_ticket as Record<
    string,
    Route | undefined
  >;
  return routes[op];
}

// 이 tool의 이름이다. registry의 MCP_APP_TOOLS와 같은 값이다.
export const TICKET_TOOL_NAME: McpAppToolName = "lophn_ticket";

// 유실 대비 commands/result read다. 쓰기 응답을 잃으면 같은 key로 다시 읽는다.
export const TICKET_RESULT_ROUTE = commandsResult;

export type { Result };
