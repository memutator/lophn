import type { z } from "zod";
import type { Result } from "../../../base/mod.ts";
import type { Intent } from "../../../protocol/approvals/mod.ts";
import type {
  ToolEffect,
  ToolResult,
} from "../../../protocol/lophn-agent/mod.ts";
import { builtinTools } from "./builtin.ts";
import type { ToolContext } from "./tool-context.ts";

// tool 하나는 정의 하나다. 목록과 실행이 같은 schema·효과를 쓴다.
// 내장 이름은 `<자원>.<동사>` 점 표기다. model에는 wire 이름으로 간다(wire.ts).

export type ToolOrigin = "builtin" | "app" | "external";

// Gate에 물을 intent의 재료다. 호출자(actor)와 출처(origin)는 executeToolCall이 ToolContext에서 채운다.
export type GateRequest = Pick<Intent, "kind" | "target" | "effect" | "input">;

export type ToolCallHandler = (
  input: unknown,
  ctx: ToolContext,
) => Promise<Result<ToolResult>>;

export type ToolDefinition = {
  // 정본 이름. wire 이름은 여기서 만든다.
  name: string;
  description: string;
  input: z.ZodType;
  // model에 보이는 입력 JSON Schema. 없으면 `input`에서 만든다. 앱 command처럼 선언이 이미 JSON Schema인 정의가
  // 자기 schema를 그대로 보이려고 쓴다. 실행 검사는 어느 쪽이든 `input`이 한다.
  inputSchema?: Record<string, unknown>;
  // registry와 Gate만 읽는다. model에 보이는 정의에는 없다.
  effect: ToolEffect;
  origin: ToolOrigin;
  // 실행. 옛 run-loop가 만든 정의(앱, MCP)는 없고 handlers 표로 실행한다.
  handler?: ToolCallHandler;
  // Gate가 걸리는 tool만 둔다. null이면 그 호출은 거치지 않는다.
  // 받는 agent처럼 core를 읽어야 정해지는 intent가 있어 Promise도 된다.
  gate?: (
    input: unknown,
    ctx: ToolContext,
  ) => GateRequest | null | Promise<GateRequest | null>;
  // 아래는 옛 tool-judgment와 run-loop가 아직 읽는 칸이다. `defineBuiltin`이 기본값을 채운다.
  // 그 둘이 새 설계로 바뀌면 지운다.
  revision: string;
  confirm: boolean;
  contract: string;
  reversible: boolean;
  idempotent: boolean;
  // 옛 정의가 채우지만 읽는 곳은 없다.
  scopeCheck?: string;
  errors?: readonly string[];
};

export type ToolCatalog = {
  definitions: readonly ToolDefinition[];
};

export const BUILTIN_TOOLS: readonly ToolDefinition[] = builtinTools();

export type ToolSource = {
  builtin: readonly ToolDefinition[];
  app: readonly ToolDefinition[];
  external: readonly ToolDefinition[];
};

export type CapabilityScope = {
  // preset capability가 고른 이름. null이면 선택을 아직 고정하지 않아 빈 목록이다.
  presetTools: readonly string[] | null;
  // 제품 역할 상한. null이면 상한이 없어 빈 목록이다(fail closed).
  roleTools: readonly string[] | null;
};

// 목록은 preset capability와 역할 상한의 교집합이고 순서는 내장→앱→외부다.
// 같은 판의 같은 bytes를 유지하려고 입력 순서를 그대로 두고 이름 중복은 먼저 온
// 정의를 남긴다. 옛 run-loop가 쓴다(새 목록은 builtin.ts의 listRoleTools).
export function listTools(
  source: ToolSource,
  scope: CapabilityScope,
): readonly ToolDefinition[] {
  if (scope.presetTools === null || scope.roleTools === null) return [];
  const allowed = new Set(scope.presetTools);
  for (const name of scope.roleTools) {
    if (!allowed.has(name)) allowed.delete(name);
  }
  const role = new Set(scope.roleTools);
  const seen = new Set<string>();
  const listed: ToolDefinition[] = [];
  for (
    const definition of [
      ...source.builtin,
      ...source.app,
      ...source.external,
    ]
  ) {
    // 앱 command 정의는 이름이 동적이라 preset·역할 이름 목록에 없다. 역할·현재 허락·assignment의
    // 교집합(AgentAppScope)이 이미 고른 것만 들어오므로 이름 검사를 건너뛴다.
    if (
      definition.origin !== "app" &&
      (!allowed.has(definition.name) || !role.has(definition.name))
    ) continue;
    if (seen.has(definition.name)) continue;
    seen.add(definition.name);
    listed.push(definition);
  }
  return listed;
}

// run의 agent 자격이 가져야 하는 operation 목록이다. 제공 목록의 소유 contract다. 목록에 없는 tool의
// contract는 더하지 않는다.
export function runOperations(
  listed: readonly ToolDefinition[],
): readonly string[] {
  return [...new Set(listed.map((definition) => definition.contract))];
}

// 실행은 목록과 같은 정의를 찾는다. 등록되지 않은 이름은 없다.
export function findTool(
  listed: readonly ToolDefinition[],
  name: string,
): ToolDefinition | undefined {
  return listed.find((definition) => definition.name === name);
}
