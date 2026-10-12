import type { PresetDefinition } from "../../contracts/lophn-agent/mod.ts";
import {
  CONTEXT_ENGINEER_ONLY_TOOLS,
  CONTEXT_LOOKUP_ONLY_TOOLS,
  ROLE_CAPS,
} from "./role-caps.ts";

// 내장 assignment(lophn·Context Engineer)가 쓰는 제품 기본 preset의 구성이다
// (presets#R9, domain model 기본 preset 표). 읽을 자료는 전체, capability는 그
// 역할 상한 안의 전부(상한 표 role-caps.ts), MCP·skill·지침은 비어 있고 model은
// 사람이 provider를 고르기 전까지 null(미준비)이다. prompt는 역할 prompt 자산의
// blob hash다. 더 좁은 기본 선택과 묶음은 사람이 새 user 판으로 정한다.
export type BuiltinRole = "lophn" | "context_engineer";

// 제품 기본 preset이 있는 역할이다. App Engineer는 전역 assignment가 없어 BuiltinRole이 아니지만
// AppCreated 반응이 만드는 assignment가 쓰는 product preset은 준비해 둔다(assignments#R1).
export type ProductRole = BuiltinRole | "app_engineer";

export const BUILTIN_ROLES: readonly BuiltinRole[] = [
  "lophn",
  "context_engineer",
];

const NAMES: Record<ProductRole, string> = {
  lophn: "lophn",
  app_engineer: "App Engineer",
  context_engineer: "Context Engineer",
};

// Context Engineer 기본 preset이 고르는 tool 묶음 이름이다. 묶음의 동작은 harness/tools의
// `TOOL_BUNDLES`가 정하고 값은 `CONTEXT_ENGINEER_ONLY_TOOLS`와 같다(presets는 harness를 import하지 않는다).
export const CONTEXT_ENGINEER_BUNDLE = "context-engineer";

// lophn 기본 preset이 고르는 모든 project context 조회 묶음 이름이다. 값은 `CONTEXT_LOOKUP_ONLY_TOOLS`와 같다.
export const CONTEXT_LOOKUP_BUNDLE = "context-lookup";

// 역할 기본 preset이 묶음으로 고르는 상한 동작이다. 나머지 상한 동작은 하나씩 고른다.
function bundledTools(role: ProductRole): {
  name: string;
  tools: readonly string[];
} | null {
  if (role === "context_engineer") {
    return {
      name: CONTEXT_ENGINEER_BUNDLE,
      tools: CONTEXT_ENGINEER_ONLY_TOOLS,
    };
  }
  if (role === "lophn") {
    return { name: CONTEXT_LOOKUP_BUNDLE, tools: CONTEXT_LOOKUP_ONLY_TOOLS };
  }
  return null;
}

export function productPresetDefinition(
  role: ProductRole,
  promptHash: string,
): PresetDefinition {
  const cap = ROLE_CAPS.get(role);
  if (cap === undefined) throw new Error(`no role cap for ${role}`);
  // Context Engineer는 자기만의 여덟 동작을, lophn은 context 조회 셋을 묶음으로 고르고 나머지 상한 동작을
  // 하나씩 고른다.
  const bundle = bundledTools(role);
  const bundled = new Set(bundle?.tools ?? []);
  return {
    kind: role,
    name: NAMES[role],
    origin: "product",
    prompt: promptHash,
    capability: {
      bundles: bundle === null ? [] : [{ name: bundle.name, revision: 1 }],
      tools: cap.tools.filter((tool) => !bundled.has(tool)).map((tool) => ({
        tool,
        app_command: null,
      })),
    },
    // App Engineer는 담당 assignment 범위만 읽는다(domain model 기본 preset 표).
    context: [{
      kind: role === "app_engineer" ? "assignment_scope" : "all",
      target: null,
      section: null,
    }],
    mcp: { servers: [], tools: [] },
    safe_tools: [],
    skills: [],
    model: null,
    organizing_model: null,
    instructions: [],
  };
}
