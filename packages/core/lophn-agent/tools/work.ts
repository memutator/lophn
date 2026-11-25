import type { Result } from "../../../base/mod.ts";
import type { ErrorCode } from "../../../base/mod.ts";
import type { AskedCall } from "../../../protocol/approvals/mod.ts";
import type {
  ToolOutcome,
  ToolResult,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  missingSecretSentence,
  secretSlotSchema,
} from "../../../protocol/lophn-agent/input-request.ts";
import { checkInput, unchanged } from "./schema.ts";
import { spillLarge } from "./spill.ts";
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
// not_found는 같은 문장이라 범위 밖 대상의 이름·존재가 새지 않는다. invalid_input만 handler 문장을 그대로 싣는다:
// 입력의 어느 부분이 왜 틀렸는지 알아야 model이 고치고, 그 문장은 model이 보낸 입력에 대한 것이다.
const FAILURE_SUMMARIES: Readonly<Record<string, string>> = {
  invalid_input: "tool input is not valid",
  unauthorized: "tool call is not authorized",
  forbidden: "tool target is not available",
  not_found: "tool target is not available",
  conflict: "tool call conflicted",
  unavailable: "tool is unavailable",
  internal: "tool call failed",
};

// browser·tab 호출의 unavailable·conflict 문장은 lophn이 쓴 고정 문장(원인과 다음 할 일)이라 그대로 싣는다.
// model이 이유를 못 받으면 우회로 바깥 browser를 띄운다. 이 tool들의 문장에는 page나 Chromium의 글이 들어가지 않는다.
// browser 호출의 not_found도 싣는다: 없는 탭과 남의 탭이 같은 고정 문장이라 존재가 새지 않고, 탭이 닫혔으면 다시 열라고 알려야 한다.
// `tab close`의 forbidden도 싣는다: 넘겨받거나 받은 탭은 닫지 못한다는 고정 문장(다음 할 일)이고, 자기 밑 session의 탭이라는 문장도
// 고정 문장이다. forbidden은 볼 수 있는 탭에만 나서(볼 수 없는 탭은 없는 탭과 같은 not_found) 존재가 새지 않는다. 이유를 못 받은
// agent는 되풀이해 닫으려 한다.
// `tab give`의 not_found·forbidden·invalid_input도 lophn이 쓴 고정 문장이다(누구에게 줄 수 있고 어떻게 되찾는지).
// `team spawn`(`--on` 포함)의 conflict·forbidden도 이 컴퓨터의 core가 쓴 고정 문장이다(팀이 가득 참·깊음은 "do the work yourself or
// ask your parent"로 끝난다, 팀원은 잎이다, call 정책·팀 규칙·private). 다른 컴퓨터의 글은 spawn의 답에 오지 않는다(그 컴퓨터의
// 실패는 늦게 call의 실패로 온다). 이유를 못 받은 agent는 spawn을 되풀이한다.
// `call send`(`--on` 포함)의 forbidden도 core가 쓴 고정 문장이다(call 정책, 팀 규칙, private, 받은 mail로 열린 session은 다른 컴퓨터로
// 보내지 못함). 다른 컴퓨터로 보낸 call의 그 컴퓨터 쪽 실패는 늦게 call의 실패로 오고 이 답에 오지 않는다.
// `app.take_in`은 home workspace 전용이고 conflict(`sdk_missing`·`dependency_missing`·`slug_in_use`)·not_found(동기화 폴더에
// 없음·활성 release 없음·폴더 미설정)·unavailable(의존성 설치·staging 일시 실패) 문장은 core가 원인과 다음 할 일을 적어 돌려준다.
// 이유를 못 받은 agent는 원인을 모른 채 take_in을 되풀이한다.
// 그 밖의 code(forbidden 등)는 대상 이름·존재를 가리려 공통 문장으로 둔다.
function carriesReason(name: string, code: string): boolean {
  return (
    ((name.startsWith("browser.") || name.startsWith("tab.")) &&
      (code === "unavailable" || code === "conflict")) ||
    (name.startsWith("browser.") && code === "not_found") ||
    (name === "tab.close" && code === "forbidden") ||
    (name === "team.spawn" && (code === "conflict" || code === "forbidden")) ||
    (name === "call.send" && code === "forbidden") ||
    (name === "tab.give" &&
      (code === "not_found" ||
        code === "forbidden" ||
        code === "invalid_input")) ||
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
  const produced = await definition.handler(checked.value, ctx);
  if (!produced.ok) {
    const code = FAILURE_CODES.get(produced.error.code) ?? "internal";
    // handler 문장은 대상 이름·존재를 담을 수 있어 공통 코드 문장만 돌려준다. 입력이 틀렸다는 문장은 그대로 싣는다.
    // 입력 밖 대상을 다루지 않는 tool(input-scoped)도 그대로 싣는다: 가릴 것이 없고, 가리면 같은 입력으로 되풀이한다.
    const base =
      code === "invalid_input" ||
      INPUT_SCOPED_FAILURES[name] === true ||
      carriesReason(name, code)
        ? `${FAILURE_SUMMARIES[code] ?? "tool call failed"}: ${produced.error.message}`
        : (FAILURE_SUMMARIES[code] ?? "tool call failed");
    // handler가 값이나 sign-in이 빈 자리를 알렸으면(details.missing, 설정에서 만든 자리) 청하는 명령을 고정 문장으로 붙인다.
    const missing = secretSlotSchema.safeParse(
      produced.error.details?.["missing"],
    );
    const summary = missing.success
      ? `${base}. ${missingSecretSentence(missing.data)}`
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
        `tool call was denied (${result.reason})`,
        effect,
      );
    case "rejected":
      return stopped(
        tool,
        "not_executed",
        "rejected",
        result.reason === null || result.reason === ""
          ? `the ${result.by} rejected this tool call`
          : `the ${result.by} rejected this tool call: ${result.reason}`,
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
