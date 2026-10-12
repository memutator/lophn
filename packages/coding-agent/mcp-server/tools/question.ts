// lophn_question tool의 실행이다. list·show는 소유 읽기 route 하나로만
// 보내고 이유·option·고정 action과 상태를 그대로 돌려준다. 이 tool은 command route를
// 부르지 않는다: 답·미루기·취소·적용은 사람 결정 화면과 lophn-agent의 몫이다. 대기
// 중인 질문에는 결정 화면 링크만 붙는다(CLI와 같은 링크).
import { MCP_DECISION_ROUTES } from "../../../protocol/coding-agent/mod.ts";
import type { Route } from "../../../protocol/base/mod.ts";
import {
  type FlowClient,
  type QuestionRecord,
  questionStateText,
  questionView,
} from "../../connection/mod.ts";
import { failureOutput, type ToolOutput, withoutOp } from "./output.ts";

export type QuestionToolDeps = { client: Pick<FlowClient, "read"> };

export function createQuestionTool(
  deps: QuestionToolDeps,
): (toolName: string, route: Route, input: unknown) => Promise<ToolOutput> {
  const routes = MCP_DECISION_ROUTES.lophn_question as Record<string, Route>;
  return async function runQuestionTool(_toolName, _route, rawInput) {
    const op = (rawInput as { op?: unknown } | undefined)?.op;
    const owned = typeof op === "string" && Object.hasOwn(routes, op)
      ? routes[op]
      : undefined;
    if (owned === undefined) {
      // 표에 없는 op는 실행하지 않는다. 답·허락·취소 op는 이 tool에 없다.
      return failureOutput({
        code: "invalid_input",
        message: "question tool 표에 없는 op다",
        details: { op: typeof op === "string" ? op : null },
      }, ["lophn_question list, show만 있다"]);
    }
    const read = await deps.client.read(owned, withoutOp(rawInput));
    if (!read.ok) {
      return failureOutput(read.error, ["lophn_question list로 다시 읽는다"]);
    }
    const value = read.value as Record<string, unknown>;
    if (op === "list") {
      const rows = (value.groups as QuestionRecord[] | undefined) ?? [];
      const waiting = rows.filter((row) => row.status === "pending").length;
      return {
        summary: `질문 묶음 ${rows.length}개, 대기 ${waiting}개`,
        data: { ...value, groups: rows.map(questionView) },
        next: [
          "lophn_question show로 이유·option·고정 action을 읽는다",
          ...(value.next_cursor === null || value.next_cursor === undefined
            ? []
            : [
              "lophn_question list에 next_cursor를 cursor로 넣어 이어 읽는다",
            ]),
        ],
      };
    }
    const shown = questionView(value.group as QuestionRecord);
    return {
      summary: `질문 묶음 ${shown.id}: ${questionStateText(shown.state)}`,
      data: { ...value, group: shown },
      next: shown.waiting
        ? [
          `사람이 ${shown.decision_link}에서 답한다. coding agent는 답하거나 적용하지 않는다`,
        ]
        : ["lophn_question list로 다른 질문을 읽는다"],
    };
  };
}
