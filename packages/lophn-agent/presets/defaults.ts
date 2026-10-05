import type { PresetDefinition } from "../../contracts/lophn-agent/mod.ts";
import { ROLE_CAPS } from "./role-caps.ts";

// 내장 assignment(lophn·Context Engineer)가 쓰는 제품 기본 preset의 구성이다
// (presets#R9, domain model 기본 preset 표). 읽을 자료는 전체, capability는 그
// 역할 상한 안의 전부(상한 표 role-caps.ts), MCP·skill·지침은 비어 있고 model은
// 사람이 provider를 고르기 전까지 null(미준비)이다. prompt는 역할 prompt 자산의
// blob hash다. 더 좁은 기본 선택과 묶음은 사람이 새 user 판으로 정한다.
export type BuiltinRole = "lophn" | "context_engineer";

export const BUILTIN_ROLES: readonly BuiltinRole[] = [
  "lophn",
  "context_engineer",
];

const NAMES: Record<BuiltinRole, string> = {
  lophn: "lophn",
  context_engineer: "Context Engineer",
};

export function productPresetDefinition(
  role: BuiltinRole,
  promptHash: string,
): PresetDefinition {
  const cap = ROLE_CAPS.get(role);
  if (cap === undefined) throw new Error(`no role cap for ${role}`);
  return {
    kind: role,
    name: NAMES[role],
    origin: "product",
    prompt: promptHash,
    capability: {
      bundles: [],
      tools: cap.tools.map((tool) => ({ tool, app_command: null })),
    },
    context: [{ kind: "all", target: null, section: null }],
    mcp: { servers: [], tools: [] },
    safe_tools: [],
    skills: [],
    model: null,
    organizing_model: null,
    instructions: [],
  };
}
