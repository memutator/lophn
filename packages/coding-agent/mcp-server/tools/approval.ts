// lophn_approval tool의 실행이다(T16, mcp#R18). list·show는 소유 읽기 route 하나로만
// 보내고 exact 대상·입력·영향·기한과 상태를 그대로 돌려준다. 이 tool은 command route를
// 부르지 않는다: 허락·거절·사용은 사람 confirmation window와 소유 concern의 몫이고
// coding 통로는 결정하지도 소비하지도 않는다. 대기 중인 요청에는 결정 화면 링크만 붙는다.
import { MCP_DECISION_ROUTES } from "../../../contracts/coding-agent/mod.ts";
import type { Route } from "../../../contracts/platform/mod.ts";
import {
  type ApprovalRequest,
  approvalStateText,
  approvalView,
  type FlowClient,
} from "../../connection/mod.ts";
import { failureOutput, type ToolOutput, withoutOp } from "./output.ts";

export type ApprovalToolDeps = { client: Pick<FlowClient, "read"> };

export function createApprovalTool(
  deps: ApprovalToolDeps,
): (toolName: string, route: Route, input: unknown) => Promise<ToolOutput> {
  const routes = MCP_DECISION_ROUTES.lophn_approval as Record<string, Route>;
  return async function runApprovalTool(_toolName, _route, rawInput) {
    const op = (rawInput as { op?: unknown } | undefined)?.op;
    const owned = typeof op === "string" && Object.hasOwn(routes, op)
      ? routes[op]
      : undefined;
    if (owned === undefined) {
      // 표에 없는 op는 실행하지 않는다. 허락·거절·사용 op는 이 tool에 없다.
      return failureOutput({
        code: "invalid_input",
        message: "approval tool 표에 없는 op다",
        details: { op: typeof op === "string" ? op : null },
      }, ["lophn_approval list, show만 있다"]);
    }
    const read = await deps.client.read(owned, withoutOp(rawInput));
    if (!read.ok) {
      return failureOutput(read.error, ["lophn_approval list로 다시 읽는다"]);
    }
    const value = read.value as Record<string, unknown>;
    if (op === "list") {
      const rows = (value.requests as ApprovalRequest[] | undefined) ?? [];
      const waiting = rows.filter((row) => row.status === "pending").length;
      return {
        summary: `approval ${rows.length}개, 대기 ${waiting}개`,
        // list에는 사용 기록이 없다. 허락된 요청의 사용 여부는 show가 낸다.
        data: {
          ...value,
          requests: rows.map((row) => approvalView(row, undefined)),
        },
        next: [
          "lophn_approval show로 대상·입력·영향·기한과 사용 여부를 읽는다",
        ],
      };
    }
    const shown = approvalView(value.request as ApprovalRequest, value.use);
    return {
      summary: `approval ${shown.id}: ${approvalStateText(shown.state)}`,
      data: { ...value, request: shown },
      next: shown.waiting
        ? [
          `사람이 ${shown.decision_link}에서 결정한다. coding agent는 허락·거절·사용하지 않는다`,
        ]
        : ["lophn_approval list로 다른 요청을 읽는다"],
    };
  };
}
