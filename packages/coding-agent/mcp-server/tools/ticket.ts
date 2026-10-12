// lophn_ticket tool의 실행이다. registry route로만 dispatch한
// 입력을 core RPC 하나로 보내고, 대응 contract 출력을 그대로 돌려준다. claim·
// renew·release는 실제 실행이며 응답에 connection·claim_seq·expires_at·반납
// 방법을 남긴다. 통로가 기한이나 자동 갱신을 덧붙이지 않는다.
// start·resume·harness 설치·permission 응답 op는 소유 route가 없어 discovery와
// 직접 호출 모두에서 거절이다. 문제 직접 claim op도 없다.
import type { Result } from "../../../base/mod.ts";
import type { LophnError } from "../../../base/mod.ts";
import {
  reportInputOf,
  reportTicket,
  ticketCompare,
  type TicketOpClient,
} from "../../connection/mod.ts";
import {
  MCP_APP_ROUTES,
  type McpAppToolName,
} from "../../../protocol/coding-agent/mod.ts";
import type { Route } from "../../../protocol/base/mod.ts";
import { commandsResult } from "../../../protocol/server/mod.ts";

// tools/call의 실행 결과다. server가 mcpToolResult로 두 표현을 만든다.
export type TicketToolResult = {
  summary: string;
  data: unknown;
  next: string[];
  isError?: true;
};

// core client가 command envelope에 채우는 idempotency key 발급이다.
export type IdempotencyKey = () => string;

export type TicketToolDeps = {
  client: TicketOpClient;
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
    isError: true,
  };
}

// list·show·checks·claim·renew·release·report를 소유 route로 core에 보낸다(report는 upload_summary로
// summary를 먼저 올린 뒤 준비 참조로 보낸다).
// 입력 검사는 registry(route input)가 실행 전에 했다.
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
      // read(list·show·checks)는 소유 read route에 입력만 보낸다. `op`는 tool의
      // 선택자라 route 입력에는 없다.
      const { op: _op, ...readInput } = input;
      const looked = await deps.client.read(route, readInput);
      if (!looked.ok) return failure(looked.error);
      return {
        summary: `${op} ticket ${op === "list" ? "목록" : "본문"}`,
        data: looked.value,
        next: op === "list"
          ? ["ticket show <ticket>로 전체 본문을 읽는다"]
          : ["lophn_ticket list로 목록을 돌아본다"],
      };
    }
    // `op`는 tool의 선택자라 소유 route 입력에는 없다. 쓰기는 소유 route가 요구하는 CAS 비교를
    // 싣는다(만료·취소 뒤 쓰기의 거절은 core가 한다. 통로가 기한을 정하거나 갱신하지 않는다).
    const { op: _op, ...body } = input;
    if (op === "report") {
      // summary를 올린 준비 참조로 보고한다. completion seq는 입력이 아니다.
      return await reportTicket(reportInputOf(body), deps);
    }
    const sent = await deps.client.command(
      route as unknown as Parameters<TicketOpClient["command"]>[0],
      {
        input: body,
        idempotency_key: deps.idempotencyKey(),
        compare: ticketCompare(body),
      },
    );
    if (!sent.ok) return failure(sent.error);
    const value = sent.value as ClaimView & Record<string, unknown>;
    if (op === "claim" || op === "renew") {
      return {
        summary: claimSummary(value, op === "claim" ? "claim했다" : "갱신했다"),
        data: value,
        // 반납 방법을 응답에 남긴다. 통로가 갱신 주기를 대신하지 않는다.
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
    // claim·renew·release·report 외 command op가 없다.
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
