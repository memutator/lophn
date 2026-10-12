// lophn_session tool의 실행이다(coding-agent#T35, guides#R21, R22). summary op는 소유 읽기 route 하나로만
// 보내고 읽기 실패를 빈 목록으로 바꾸지 않는다. 이 tool은 claim·갱신·수리 착수를 하지 않는다. summary를
// 읽거나 목록에서 ticket을 발견한 것은 착수 지시가 아니다.
import { MCP_SESSION_ROUTES } from "../../../protocol/coding-agent/mod.ts";
import type { Route } from "../../../protocol/server/mod.ts";
import type { FlowClient } from "../../connection/mod.ts";
import {
  failureOutput,
  type ToolOutput,
  withContinuation,
  withoutOp,
} from "./output.ts";

export type SessionToolDeps = { client: Pick<FlowClient, "read"> };

type SummaryValue = {
  summary: {
    problems: unknown[];
    tickets: unknown[];
    claims: unknown[];
    remaining_checks: unknown[];
    claim_rule: string;
    next_cursor: string | null;
  };
};

export function createSessionTool(
  deps: SessionToolDeps,
): (toolName: string, route: Route, input: unknown) => Promise<ToolOutput> {
  const route = MCP_SESSION_ROUTES.lophn_session.summary;
  return async function runSessionTool(_toolName, _route, rawInput) {
    const op = (rawInput as { op?: unknown } | undefined)?.op;
    if (op !== "summary") {
      // 표에 없는 op는 실행하지 않는다.
      return failureOutput({
        code: "invalid_input",
        message: "session tool 표에 없는 op다",
        details: { op: typeof op === "string" ? op : null },
      }, ["lophn_session summary만 있다"]);
    }
    const read = await deps.client.read(route, withoutOp(rawInput));
    if (!read.ok) {
      // 읽지 못했다는 사실을 그대로 전한다. 범위 밖 앱은 없는 앱과 같은 오류다.
      return failureOutput(read.error, [
        "summary를 읽지 못했다. 빈 목록이 아니다. lophn doctor로 연결을 확인한다",
      ]);
    }
    const value = read.value as SummaryValue;
    const summary = value.summary;
    return {
      summary: withContinuation(
        `열린 문제 ${summary.problems.length}개, 열린 ticket ${summary.tickets.length}개, 내 claim ${summary.claims.length}개, 남은 검사 ${summary.remaining_checks.length}개`,
        summary,
      ),
      data: value,
      next: [
        summary.claim_rule,
        "lophn_ticket show로 지정된 ticket의 상세를 읽는다",
        ...(summary.next_cursor === null ? [] : [
          "next_cursor를 cursor로 넣어 lophn_session summary를 이어 읽는다",
        ]),
      ],
    };
  };
}
