import type { ErrorCode, Result } from "../../../base/mod.ts";
import type {
  AskedCall,
  PermissionDenial,
} from "../../../protocol/approvals/mod.ts";
import {
  missingSecretSentence,
  secretSlotSchema,
} from "../../../protocol/lophn-agent/input-request.ts";
import type {
  ToolOutcome,
  ToolResult,
} from "../../../protocol/lophn-agent/mod.ts";
import type { ToolDefinition } from "./registry.ts";
import { checkInput, unchanged } from "./schema.ts";
import { spillLarge } from "./spill.ts";
import type { ToolContext } from "./tool-context.ts";
import { toolForWireName } from "./wire.ts";

// 실행기. command 밖의 일이다. 결과는 command로 남긴다.
// 자격과 범위는 호출 turn의 것만 쓴다. 실행기가 권한을 넓히지 않는다.

export const ANTI_BYPASS_DIRECTIVE =
  "Do not try to bypass this restriction with another tool (such as shell.run). Explain the restriction to the person or use the guided recovery path.";

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

// 기계가 구별하는 코드는 유지한다. forbidden은 권한·범위·정책 거부를 숨기지 않도록 handler 문장을
// 그대로 싣고 우회 금지 지침을 붙인다. 존재를 감춰야 하는 대상은 handler가 not_found로 돌려주며,
// not_found는 공통 문장으로 유지한다. invalid_input도 입력의 어느 부분이 틀렸는지 알 수 있게 원문을 싣는다.
const FAILURE_SUMMARIES: Readonly<Record<string, string>> = {
  invalid_input: "tool input is not valid",
  unauthorized: "tool call is not authorized",
  forbidden: "tool call is not permitted",
  not_found: "tool target is not available",
  conflict: "tool call conflicted",
  unavailable: "tool is unavailable",
  internal: "tool call failed",
};

// browser·tab 호출의 unavailable·conflict·not_found와 team.spawn의 conflict, tab.give의 not_found·invalid_input,
// app.take_in의 conflict·not_found·unavailable은 lophn이 쓴 고정 문장(원인과 다음 할 일)이라 그대로 싣는다.
// forbidden은 모든 tool에서 그대로 싣는다.
function carriesReason(name: string, code: string): boolean {
  return (
    ((name.startsWith("browser.") || name.startsWith("tab.")) &&
      (code === "unavailable" || code === "conflict")) ||
    (name.startsWith("browser.") && code === "not_found") ||
    (name === "team.spawn" && code === "conflict") ||
    (name === "tab.give" &&
      (code === "not_found" || code === "invalid_input")) ||
    (name === "app.take_in" &&
      (code === "conflict" || code === "not_found" || code === "unavailable"))
  );
}

// 실패한 대상이 model이 보낸 입력뿐인 tool이다. skill.read의 이름은 prompt의 skill 목록에 이미 실려 있어
// 문장에서 가릴 것이 없고, 가리면 원인을 못 가려 같은 입력으로 되풀이한다. 여기 없는 tool은 공통 문장만 쓴다.
const INPUT_SCOPED_FAILURES: Readonly<Record<string, true>> = {
  "skill.read": true,
  // 모르는 handle이면 부를 수 있는 handle 목록을 message에 싣는다.
  "agent.card": true,
  // 모르는 provider면 내장 정의 key 목록, 청할 수 없는 자리면 어디서 청하는지를 message에 싣는다.
  "ask.secret": true,
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

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function formatPermissionDenial(denial: PermissionDenial): string {
  const header =
    denial.rule_pattern !== null
      ? `tool call was denied (${denial.reason_kind}, rule: ${denial.rule_pattern}): ${sentence(denial.message)}`
      : `tool call was denied (${denial.reason_kind}): ${sentence(denial.message)}`;
  const parts = [header];
  if (denial.recovery_hint !== null && denial.recovery_hint.trim() !== "") {
    parts.push(sentence(denial.recovery_hint));
  }
  parts.push(ANTI_BYPASS_DIRECTIVE);
  return parts.join(" ");
}

// ---- 새 실행기 ----

type ToolCallOutcome = {
  // 정본 이름. 없는 tool이면 model이 부른 이름이다.
  tool: string;
  effect: ToolDefinition["effect"];
  outcome: ToolOutcome;
  result: ToolResult;
  // handler를 불렀는지.
  executed: boolean;
  // 사람이 이유를 달아 거절했는지(true면 남은 batch 호출을 이어 간다).
  rejectedWithReason?: boolean;
};

function stopped(
  tool: string,
  kind: "failure" | "not_executed",
  code: string,
  summary: string,
  effect: ToolDefinition["effect"] = "read",
  extra?: { rejectedWithReason?: boolean },
): ToolCallOutcome {
  return {
    tool,
    effect,
    outcome: { kind, code },
    executed: false,
    ...(extra?.rejectedWithReason === undefined
      ? {}
      : { rejectedWithReason: extra.rejectedWithReason }),
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

// Gate가 바깥 경로의 file_read·file_write를 run으로 허락했을 때 이 호출 한 번의 scope에 그 대상을 연다.
// ctx.scope 자체는 바꾸지 않아 `once` 허락과 `/permissions` session grant 해제가 다음 호출에 바로 닿는다.
function scopeForApprovedFile(
  ctx: ToolContext,
  call: AskedCall | null,
): ToolContext {
  if (
    call === null ||
    (call.kind !== "file_read" && call.kind !== "file_write") ||
    !call.outside_workspace
  ) {
    return ctx;
  }
  const read = ctx.scope.read.includes(call.path)
    ? ctx.scope.read
    : [...ctx.scope.read, call.path];
  const write =
    call.kind === "file_write" && !ctx.scope.write.includes(call.path)
      ? [...ctx.scope.write, call.path]
      : ctx.scope.write;
  return {
    ...ctx,
    scope: {
      ...ctx.scope,
      read,
      write,
      onceTarget: {
        path: call.path,
        folder: call.folder,
        mode: call.kind === "file_write" ? "write" : "read",
      },
    },
  };
}

// model이 부른 wire 이름의 tool을 ctx.listed에서 찾아 실행한다. 목록 밖의 tool은 실행하지 않는다.
// Gate가 걸리는 tool(`gate`가 있는 정의)은 실행 전에 core에 묻고, 막히면 이유를 결과로 돌려준다.
export async function executeToolCall(
  ctx: ToolContext,
  wireName: string,
  input: unknown,
): Promise<ToolCallOutcome> {
  const definition = toolForWireName(ctx.listed, wireName);
  if (definition === undefined) {
    return stopped(wireName, "failure", "not_found", "tool is not available");
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
  const handlerCtx = scopeForApprovedFile(ctx, call);
  const produced = await definition.handler(checked.value, handlerCtx);
  if (!produced.ok) {
    const code = FAILURE_CODES.get(produced.error.code) ?? "internal";
    let base: string;
    if (code === "forbidden") {
      const msg = produced.error.message.trim();
      base =
        msg === ""
          ? `${sentence(FAILURE_SUMMARIES.forbidden!)} ${ANTI_BYPASS_DIRECTIVE}`
          : `${sentence(msg)} ${ANTI_BYPASS_DIRECTIVE}`;
    } else if (
      code === "invalid_input" ||
      INPUT_SCOPED_FAILURES[name] === true ||
      carriesReason(name, code)
    ) {
      base = `${FAILURE_SUMMARIES[code] ?? "tool call failed"}: ${produced.error.message}`;
    } else {
      base = FAILURE_SUMMARIES[code] ?? "tool call failed";
    }
    // handler가 값이나 sign-in이 빈 자리를 알렸으면(details.missing, 설정에서 만든 자리) 청하는 명령을 고정 문장으로 붙인다.
    const missing = secretSlotSchema.safeParse(
      produced.error.details?.["missing"],
    );
    const summary = missing.success
      ? `${sentence(base)} ${missingSecretSentence(missing.data)}`
      : base;
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
    // 기록과 model에 가는 결과는 늘 이 판이다. 상한을 넘은 전체는 파일에만 있다.
    result: await spillLarge(ctx, produced.value),
  };
}

// 허락되면 null, 아니면 실행하지 않은 결과다. 판정, 사람에게 묻기, 기다리기는 core가 한다.
async function askGate(
  ctx: ToolContext,
  tool: string,
  effect: ToolDefinition["effect"],
  call: AskedCall,
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
        formatPermissionDenial(result.denial),
        effect,
      );
    case "rejected": {
      const hasReason = result.reason !== null && result.reason.trim() !== "";
      return stopped(
        tool,
        "not_executed",
        "rejected",
        hasReason
          ? `the ${result.by} rejected this tool call: ${result.reason}`
          : `the ${result.by} rejected this tool call`,
        effect,
        { rejectedWithReason: hasReason },
      );
    }
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
