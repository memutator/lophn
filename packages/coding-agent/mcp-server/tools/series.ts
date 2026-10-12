// lophn_series tool의 실행이다(T14, mcp#R16). list·show·next는 읽기 route 하나로만
// 보내고 다음 key·title 제안만 돌려준다. 이 tool은 command route를 부르지 않는다:
// 문서를 저장하지 않고 series를 만들지도 않으며 둘 다 사람의 몫이다(cli#R20).
import { MCP_CORE_ROUTES } from "../../../protocol/coding-agent/mod.ts";
import type { Route } from "../../../protocol/server/mod.ts";
import type { FlowClient } from "../../connection/mod.ts";
import { failureOutput, type ToolOutput, withoutOp } from "./output.ts";

export type SeriesToolDeps = { client: Pick<FlowClient, "read"> };

type Suggestion = {
  series_revision: string;
  key: string;
  title: string;
  from: string | null;
  taken: boolean;
  document_name: string | null;
};

// 제안이 비었거나 막힌 이유를 모델이 그대로 읽게 한다.
function suggestionReason(suggestion: Suggestion): {
  reason: "first_key_manual" | "rule_mismatch" | "taken" | "available";
  text: string;
} {
  if (suggestion.key === "") {
    return suggestion.from === null
      ? {
        reason: "first_key_manual",
        text: "가족에 key가 아직 없다. 첫 key는 직접 정한다",
      }
      : {
        reason: "rule_mismatch",
        text:
          `마지막 key(${suggestion.from})가 다음 규칙에 맞지 않아 제안이 없다. key를 직접 정한다`,
      };
  }
  return suggestion.taken
    ? {
      reason: "taken",
      text:
        `제안 key(${suggestion.key})는 이미 쓰고 있다. 다른 key를 직접 정한다`,
    }
    : { reason: "available", text: `다음 key는 ${suggestion.key}` };
}

export function createSeriesTool(
  deps: SeriesToolDeps,
): (toolName: string, route: Route, input: unknown) => Promise<ToolOutput> {
  const routes = MCP_CORE_ROUTES.lophn_series as Record<string, Route>;
  return async function runSeriesTool(_toolName, _route, rawInput) {
    const op = (rawInput as { op?: unknown } | undefined)?.op;
    const owned = typeof op === "string" && Object.hasOwn(routes, op)
      ? routes[op]
      : undefined;
    if (owned === undefined) {
      // 표에 없는 op는 실행하지 않는다. 생성·수정 op는 이 tool에 없다.
      return failureOutput({
        code: "invalid_input",
        message: "series tool 표에 없는 op다",
        details: { op: typeof op === "string" ? op : null },
      }, ["lophn_series list, show, next만 있다"]);
    }
    const read = await deps.client.read(owned, withoutOp(rawInput));
    if (!read.ok) {
      return failureOutput(read.error, ["lophn_series list로 다시 읽는다"]);
    }
    const value = read.value as Record<string, unknown>;
    if (op === "list") {
      const rows = (value.series as unknown[] | undefined) ?? [];
      return {
        summary: `series ${rows.length}개`,
        data: value,
        next: ["lophn_series show로 규칙과 인스턴스를 읽는다"],
      };
    }
    if (op === "show") {
      const family = value.series as { title?: string } | undefined;
      const entries = (value.entries as unknown[] | undefined) ?? [];
      return {
        summary: `${family?.title ?? "series"}: 인스턴스 ${entries.length}개`,
        data: value,
        next: [
          "lophn_series next로 다음 key·title 제안을 읽는다",
          "lophn_read로 인스턴스 본문을 읽는다",
        ],
      };
    }
    const suggestion = value.suggestion as Suggestion;
    const reason = suggestionReason(suggestion);
    return {
      summary: reason.text,
      // 제안은 읽기뿐이다. 문서·series는 만들어지지 않았다.
      data: { ...value, reason: reason.reason },
      next: reason.reason === "available"
        ? ["lophn_save에 series와 이 key를 넣어 문서를 저장한다"]
        : ["lophn_save에 series와 직접 정한 key를 넣어 문서를 저장한다"],
    };
  };
}
