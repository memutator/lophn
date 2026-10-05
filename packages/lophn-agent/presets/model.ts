import { err, ok, type Result } from "../../base/mod.ts";
import type {
  McpServerConfig,
  PresetDefinition,
} from "../../contracts/lophn-agent/mod.ts";
import { presetDefinitionOutputSchema } from "../../contracts/lophn-agent/mod.ts";

// Preset 판의 선택 검사 규칙. 저장은 commands.ts의 몫이다. wildcard·병합은
// 없고(presets#R11), 이름은 바꿔 맞추지 않고 거절한다(presets#R11 확인).
// 실제 담당 대상·주기·세션·run 상태는 assignment의 몫이다(presets#R1).

// 항목별 설명이 붙은 거절이다(presets#R11). wire의 오류 body는 code·message·
// details만 남기므로 어느 항목이 잘못되었는지 details.item으로 실어 보낸다.
export type PresetItemError = {
  code: "invalid_input" | "forbidden" | "not_found" | "conflict";
  message: string;
  details: { item: string };
};

// 어느 항목이 잘못되었는지 남기는 거절이다(presets#R11). details.item은
// 명확하다. 하나라도 잘못되면 전체 저장을 거절한다.
export function errItem(
  code: PresetItemError["code"],
  item: string,
  message: string,
): Result<never, PresetItemError> {
  return err({ code, message, details: { item } });
}

function okValue(): Result<void, PresetItemError> {
  return ok(undefined);
}

// 정의에 assignment 상태 필드가 있으면 거절이다. preset은 담당 대상·진행 일·
// 세션·run 상태를 넣지 않는다(presets#R1).
const ASSIGNMENT_FIELDS = [
  "scope",
  "schedule",
  "interval",
  "session",
  "run_state",
  "outputs",
  "approved_outputs",
] as const;

export function rejectAssignmentFields(
  definition: Record<string, unknown>,
): Result<void, PresetItemError> {
  const found = ASSIGNMENT_FIELDS.find((field) => field in definition);
  if (found !== undefined) {
    return errItem(
      "invalid_input",
      found,
      "assignment 범위·주기·세션은 preset 구성에 없다",
    );
  }
  return okValue();
}

// 이름은 사람 preset 사이에서 대소문자·공백을 무시해 중복을 거절한다(R3).
// product 표시 이름과 같은 user 이름은 별도 이름을 받는다(R3).
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

// tool 묶음 판을 저장 시점 개별 동작으로 펼친다(R7). 묶음에 새 동작이 생겨도
// 고정 판의 tools는 늘지 않는다(R7). bundle 조판으로 wildcard를 만들지 않는다.
export function expandBundles(
  selected: readonly { name: string; revision: number }[],
  bundles: ReadonlyMap<string, readonly string[]>,
): Result<readonly string[], PresetItemError> {
  const known = new Set<string>(bundles.keys());
  const missing = selected.find((bundle) => !known.has(bundle.name));
  if (missing !== undefined) {
    return errItem(
      "not_found",
      `capability.bundle:${missing.name}`,
      "저장 시점에 그 이름의 tool 묶음이 없다",
    );
  }
  const expanded: string[] = [];
  for (const bundle of selected) {
    for (const tool of bundles.get(bundle.name) ?? []) {
      if (!expanded.includes(tool)) expanded.push(tool);
    }
  }
  return ok(expanded);
}

// 역할 상한 밖 내장 tool은 하나라도 있으면 저장 전체를 거절한다(R11). 상한은
// roles/common이 고정한다(T8). 규칙 목록을 이어 붙여 병합하지 않는다(R11).
export type RoleCap = {
  tools: readonly string[];
};

export function rejectOutsideRoleCap(
  kind: string,
  tools: readonly string[],
  cap: RoleCap,
): Result<void, PresetItemError> {
  const known = new Set<string>(cap.tools);
  const outside = tools.find((tool) => !known.has(tool));
  if (outside !== undefined) {
    return errItem(
      "forbidden",
      `capability.tool:${outside}`,
      `${kind} 역할 상한 밖 tool이다. 나머지 항목도 저장하지 않는다`,
    );
  }
  return okValue();
}

// MCP 선택은 등록된 서버와 현재 유효한 정확한 tool 쌍만 남긴다(R11).
export function rejectUnknownMcp(
  servers: readonly string[],
  tools: readonly { server_name: string; original_tool: string }[],
  registered: ReadonlyMap<string, McpServerConfig>,
): Result<void, PresetItemError> {
  const missing = servers.find((server) => !registered.has(server));
  if (missing !== undefined) {
    return errItem(
      "not_found",
      `mcp.server:${missing}`,
      "등록되지 않은 MCP server다",
    );
  }
  for (const tool of tools) {
    const server = registered.get(tool.server_name);
    if (
      server === undefined ||
      server.classifications[tool.original_tool] === undefined
    ) {
      return errItem(
        "not_found",
        `mcp.tool:${tool.server_name}.${tool.original_tool}`,
        "그 서버의 현재 tool이 아니다",
      );
    }
  }
  return okValue();
}

// safe 표시는 그 MCP tool 쌍 하나에만 적용한다(R16). 제품이 고정한 역할 금지·
// 상한·confirm=true는 표시로 넓히지 못한다. 되돌림을 모르는 write·external
// tool은 물어야 하므로 안전 표시를 거절한다(R16).
export function rejectUnsafeSafeTools(
  safe: readonly { server_name: string; original_tool: string }[],
  registered: ReadonlyMap<string, McpServerConfig>,
): Result<void, PresetItemError> {
  for (const pair of safe) {
    const classification = registered.get(pair.server_name)?.classifications[
      pair.original_tool
    ];
    if (classification === undefined) {
      return errItem(
        "not_found",
        `mcp.tool:${pair.server_name}.${pair.original_tool}`,
        "분류가 등록되지 않은 MCP tool이다",
      );
    }
    if (classification.effect !== "read" && !classification.reversible) {
      return errItem(
        "forbidden",
        `mcp.tool:${pair.server_name}.${pair.original_tool}`,
        "되돌림을 모르는 write·external tool은 안전 표시할 수 없다",
      );
    }
  }
  return okValue();
}

// 판 values는 output schema로 다시 검사한다. 저장 전에 정확한 모양인지 본다.
export function parseDefinition(
  definition: unknown,
): Result<PresetDefinition, PresetItemError> {
  const parsed = presetDefinitionOutputSchema.safeParse(definition);
  if (!parsed.success) {
    return errItem(
      "invalid_input",
      parsed.error.issues[0]?.path.join(".") ?? "definition",
      "preset 구성이 수요 모양이 아니다",
    );
  }
  return ok(parsed.data);
}
