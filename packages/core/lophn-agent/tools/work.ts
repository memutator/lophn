import type { Result } from "../../../base/mod.ts";
import { fingerprint } from "../../../base/mod.ts";
import type { ErrorCode } from "../../../base/mod.ts";
import type {
  ToolOutcome,
  ToolResult,
} from "../../../protocol/lophn-agent/mod.ts";
import { checkInput, unchanged } from "./schema.ts";
import { findTool, type ToolDefinition } from "./registry.ts";

// 실행기. command 밖의 일이다. 결과는 command로 남긴다.
// 자격과 범위는 호출 run의 것만 쓴다. 실행기가 권한을 넓히지 않는다.

export type RunCredential = {
  run: string;
  // 현재 run의 scope가 허용하는 대상. 실행기는 이 집합 밖을 더하지 않는다.
  targets: ReadonlySet<string>;
  // 현재 run의 scope가 허용하는 동작.
  operations: ReadonlySet<string>;
  // 이 호출의 최초 ToolCall ID. 소유 contract의 idempotency key로 쓴다(같은 요청의 재전송이 새
  // 판·새 문서를 만들지 않는다). 모르면 handler가 호출 내용에서 정한다.
  call?: string;
};

export type ToolHandler = (
  input: unknown,
  credential: RunCredential,
) => Promise<Result<ToolResult>>;

export type ExecutionDeps = {
  listed: readonly ToolDefinition[];
  handlers: ReadonlyMap<string, ToolHandler>;
  credential: RunCredential;
};

export type ExecutionOutcome = {
  tool: string;
  definitionRevision: string;
  effect: ToolDefinition["effect"];
  confirm: boolean;
  // 원래 입력의 fingerprint. ledger에 쓰지 않는다. run-loop가 RecordToolRequest.input에 redaction 뒤 hash를 넣는다.
  inputHash: string;
  result: ToolResult;
  outcome: ToolOutcome;
  // 실제 소유 contract를 호출했는지. 거절은 false다.
  executed: boolean;
};

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

function failure(code: string, summary: string): ExecutionOutcome {
  return {
    tool: "",
    definitionRevision: "",
    effect: "read",
    confirm: false,
    inputHash: "",
    executed: false,
    outcome: { kind: "failure", code },
    result: {
      status: "failure",
      summary,
      content: null,
      complete: true,
      source: null,
      continuation: null,
      pending: [],
    },
  };
}

// 등록된 tool만 실행한다. 미등록 이름과 잘못된 입력은 소유 contract를 호출하기
// 전에 거절한다. 범위 밖 대상은 없는 대상과 같은 not_found로 답한다.
export async function executeTool(
  deps: ExecutionDeps,
  name: string,
  input: unknown,
): Promise<ExecutionOutcome> {
  const definition = findTool(deps.listed, name);
  if (definition === undefined) {
    return { ...failure("not_found", "tool is not available"), tool: name };
  }
  const checked = checkInput(definition.input, input);
  if (!checked.ok) {
    return {
      ...failure("invalid_input", checked.error.message),
      tool: definition.name,
      definitionRevision: definition.revision,
      effect: definition.effect,
      confirm: definition.confirm,
    };
  }
  if (!unchanged(input, checked.value)) {
    return {
      ...failure("invalid_input", "tool input was rewritten"),
      tool: definition.name,
      definitionRevision: definition.revision,
      effect: definition.effect,
      confirm: definition.confirm,
    };
  }
  if (!deps.credential.operations.has(definition.contract)) {
    return {
      ...failure("not_found", "tool is not available"),
      tool: definition.name,
      definitionRevision: definition.revision,
      effect: definition.effect,
      confirm: definition.confirm,
    };
  }
  const handler = deps.handlers.get(definition.name);
  if (handler === undefined) {
    return {
      ...failure("unavailable", "tool has no handler"),
      tool: definition.name,
      definitionRevision: definition.revision,
      effect: definition.effect,
      confirm: definition.confirm,
    };
  }
  const inputHash = await fingerprint(checked.value);
  const produced = await handler(checked.value, deps.credential);
  if (!produced.ok) {
    const code = FAILURE_CODES.get(produced.error.code) ?? "internal";
    // 범위 밖과 없는 대상은 같은 문장이다. handler 문장은 대상 이름·존재를
    // 담을 수 있으므로 공통 코드 문장만 돌려준다.
    const summary = FAILURE_SUMMARIES[code] ?? "tool call failed";
    return {
      ...failure(code, summary),
      tool: definition.name,
      definitionRevision: definition.revision,
      effect: definition.effect,
      confirm: definition.confirm,
      inputHash,
    };
  }
  const kind = produced.value.status === "success"
    ? "success"
    : produced.value.status === "uncertain"
    ? "uncertain"
    : produced.value.status === "not_executed"
    ? "not_executed"
    : "failure";
  return {
    tool: definition.name,
    definitionRevision: definition.revision,
    effect: definition.effect,
    confirm: definition.confirm,
    inputHash,
    executed: kind === "success" || kind === "uncertain" || kind === "failure",
    outcome: { kind, code: kind === "success" ? "ok" : kind },
    result: produced.value,
  };
}
