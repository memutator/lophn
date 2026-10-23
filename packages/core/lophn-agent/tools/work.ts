import type { Result } from "../../../base/mod.ts";
import type { ErrorCode } from "../../../base/mod.ts";
import type { GateCall } from "../../../protocol/approvals/mod.ts";
import type {
  ToolOutcome,
  ToolResult,
} from "../../../protocol/lophn-agent/mod.ts";
import { checkInput, unchanged } from "./schema.ts";
import type { ToolDefinition } from "./registry.ts";
import type { ToolContext } from "./tool-context.ts";
import { toolForWireName } from "./wire.ts";

// 실행기. command 밖의 일이다. 결과는 command로 남긴다.
// 자격과 범위는 호출 turn의 것만 쓴다. 실행기가 권한을 넓히지 않는다.

export type TurnCredential = {
  turn: string;
  // 현재 turn의 scope가 허용하는 대상. 실행기는 이 집합 밖을 더하지 않는다.
  targets: ReadonlySet<string>;
  // 현재 turn의 scope가 허용하는 동작.
  operations: ReadonlySet<string>;
  // 이 호출의 최초 ToolCall ID. 소유 contract의 idempotency key로 쓴다(같은 요청의 재전송이 새
  // 판·새 문서를 만들지 않는다). 모르면 handler가 호출 내용에서 정한다.
  call?: string;
};

export type ToolHandler = (
  input: unknown,
  credential: TurnCredential,
) => Promise<Result<ToolResult>>;

// 기계가 구별하는 코드는 유지하고, 문장만 안전하게 고정한다. forbidden과
// not_found는 같은 문장이라 범위 밖 대상의 이름·존재가 새지 않는다.
const FAILURE_SUMMARIES: Readonly<Record<string, string>> = {
  invalid_input: "tool input is not valid",
  unauthorized: "tool call is not authorized",
  forbidden: "tool target is not available",
  not_found: "tool target is not available",
  conflict: "tool call conflicted",
  unavailable: "tool is unavailable",
  internal: "tool call failed",
};

const FAILURE_CODES: ReadonlyMap<ErrorCode, string> = new Map([
  ["invalid_input", "invalid_input"],
  ["unauthorized", "unauthorized"],
  ["forbidden", "forbidden"],
  ["not_found", "not_found"],
  ["conflict", "conflict"],
  ["unavailable", "unavailable"],
  ["internal", "internal"],
]);

// ---- 새 실행기 ----

type ToolCallOutcome = {
  // 정본 이름. 없는 tool이면 model이 부른 이름이다.
  tool: string;
  effect: ToolDefinition["effect"];
  outcome: ToolOutcome;
  result: ToolResult;
  // handler를 불렀는지.
  executed: boolean;
};

function stopped(
  tool: string,
  kind: "failure" | "not_executed",
  code: string,
  summary: string,
  effect: ToolDefinition["effect"] = "read",
): ToolCallOutcome {
  return {
    tool,
    effect,
    outcome: { kind, code },
    executed: false,
    result: {
      status: kind,
      summary,
      content: null,
      complete: true,
      source: null,
      continuation: null,
      pending: [],
    },
  };
}

// model이 부른 wire 이름의 tool을 ctx.listed에서 찾아 실행한다. 목록 밖의 tool은 실행하지 않는다.
// Gate가 걸리는 tool(`gate`가 있는 정의)은 실행 전에 core에 묻고, 막히면 이유를 결과로 돌려준다.
// file, web, pdf, image tool은 `gate`가 없어 거치지 않는다. `shell.run`은 shell 규칙으로 Gate를 거친다.
export async function executeToolCall(
  ctx: ToolContext,
  wireName: string,
  input: unknown,
): Promise<ToolCallOutcome> {
  const definition = toolForWireName(ctx.listed, wireName);
  if (definition === undefined) {
    return stopped(
      wireName,
      "failure",
      "not_found",
      "tool is not available",
    );
  }
  const name = definition.name;
  const effect = definition.effect;
  const checked = checkInput(definition.input, input);
  if (!checked.ok) {
    return stopped(
      name,
      "failure",
      "invalid_input",
      checked.error.message,
      effect,
    );
  }
  if (!unchanged(input, checked.value)) {
    return stopped(
      name,
      "failure",
      "invalid_input",
      "tool input was rewritten",
      effect,
    );
  }
  if (definition.handler === undefined) {
    return stopped(
      name,
      "failure",
      "unavailable",
      "tool has no handler",
      effect,
    );
  }
  const call = (await definition.gate?.(checked.value, ctx)) ?? null;
  if (call !== null) {
    const blocked = await askGate(ctx, name, effect, call);
    if (blocked !== null) return blocked;
  }
  const produced = await definition.handler(checked.value, ctx);
  if (!produced.ok) {
    const code = FAILURE_CODES.get(produced.error.code) ?? "internal";
    // handler 문장은 대상 이름·존재를 담을 수 있어 공통 코드 문장만 돌려준다.
    const summary = FAILURE_SUMMARIES[code] ?? "tool call failed";
    return {
      ...stopped(name, "failure", code, summary, effect),
      executed: true,
    };
  }
  const status = produced.value.status;
  return {
    tool: name,
    effect,
    executed: true,
    outcome: { kind: status, code: status === "success" ? "ok" : status },
    result: produced.value,
  };
}

// 허락되면 null, 아니면 실행하지 않은 결과다. 판정, 사람에게 묻기, 기다리기는 core가 한다.
async function askGate(
  ctx: ToolContext,
  tool: string,
  effect: ToolDefinition["effect"],
  call: GateCall,
): Promise<ToolCallOutcome | null> {
  const checked = await ctx.gate.check({
    session: ctx.session,
    turn: ctx.turn,
    tool_call: ctx.tool_call,
    tool,
    call,
  });
  if (!checked.ok) {
    return stopped(
      tool,
      "failure",
      "unavailable",
      "tool is unavailable",
      effect,
    );
  }
  const result = checked.value;
  switch (result.kind) {
    case "run":
      return null;
    case "denied":
      return stopped(
        tool,
        "not_executed",
        "denied",
        `tool call was denied (${result.reason})`,
        effect,
      );
    case "rejected":
      return stopped(
        tool,
        "not_executed",
        "rejected",
        result.reason === null || result.reason === ""
          ? "the person rejected this tool call"
          : `the person rejected this tool call: ${result.reason}`,
        effect,
      );
    case "cancelled":
      return stopped(
        tool,
        "not_executed",
        "cancelled",
        `the request was cancelled (${result.cause})`,
        effect,
      );
  }
}
