import type { Result } from "../../base/mod.ts";
import type {
  CatalogEntry,
  McpServerConfig,
  PresetDefinition,
  ResolvedModel,
} from "../../contracts/lophn-agent/mod.ts";
import { validateModelSelection } from "./capability.ts";
import {
  expandBundles,
  type PresetItemError,
  rejectAssignmentFields,
  rejectOutsideRoleCap,
  rejectUnknownMcp,
  rejectUnsafeSafeTools,
  type RoleCap,
} from "./model.ts";

// Preset 저장·적용 전 역할 종류·필수 값·이름 중복·자료와 지침 참조·tool·확장·
// provider 계정과 model·제품 상한을 전체 검사한다(R11). 하나라도 잘못되면
// 항목별 설명과 함께 전체를 거절하고 어느 일부도 남기지 않는다(R11).

export type ValidateDeps = {
  // 저장 시점에 존재하는 tool 묶음 판(R7). 이름 → 개별 동작 이름 목록.
  bundles: ReadonlyMap<string, readonly string[]>;
  // 등록된 MCP server 설정(extensions의 settings registry 값이다)(R11).
  mcpServers: ReadonlyMap<string, McpServerConfig>;
  // T8이 고정하는 역할별 상한 표. 역할의 cap이 없으면 tool 선택을 검사할 수
  // 없어 거절이다(T8 전까지).
  roleCaps: ReadonlyMap<string, RoleCap>;
  // provider 기록의 provider 정의 key다(providers 표 definition_key). 기록이
  // 없으면 undefined다(R6).
  definitionKey: (provider: string) => string | undefined;
  // preset의 model 선택을 T5 검사로 검증할 때 catalog의 현재 항목이다(R13).
  catalogEntry: (
    providerDefinition: string,
    modelName: string,
  ) => CatalogEntry | undefined;
  // provider 정의의 확인된 model 목록이다. 확인하지 못했으면 null이다(R10).
  modelListed: (
    providerDefinition: string,
    modelName: string,
  ) => boolean | null;
  // provider 안 존재하는 credential key 목록이다(R6).
  credentialKeys: (provider: string) => readonly string[];
};

export type ResolvedSelections = {
  model: ResolvedModel | null;
  organizing_model: ResolvedModel | null;
};

// 전체 검사 하나. 첫 잘못된 항목 설명으로 거절한다(R11). 성공하면 T5로 검증한
// model 선택을 돌려준다. 이 ResolvedModel은 사용했을 때의 입력·출력 한계와
// 가격표 근거다(R13).
export function validateDefinition(
  definition: PresetDefinition,
  deps: ValidateDeps,
): Result<ResolvedSelections, PresetItemError> {
  // assignment 범위·주기·세션은 preset 구성에 없다(R1).
  const shape = rejectAssignmentFields(
    definition as unknown as Record<string, unknown>,
  );
  if (!shape.ok) return shape;
  // capability 묶음을 저장 시점 개별 동작으로 펼친다(R7).
  const expanded = expandBundles(definition.capability.bundles, deps.bundles);
  if (!expanded.ok) return expanded;
  // 빈 선택은 0개다(R7). 묶음 펼침 + 직접 선택이 총 노출 목록이다.
  const directTools = definition.capability.tools.map((tool) => tool.tool);
  const tools = [...expanded.value, ...directTools];
  // 역할 상한 밖 내장 tool은 하나라도 있으면 저장 전체를 거절한다(R11).
  const cap = deps.roleCaps.get(definition.kind);
  if (cap === undefined) {
    return {
      ok: false,
      error: {
        code: "forbidden",
        message:
          `${definition.kind} 역할 상한이 준비되지 않았다. tool 선택을 검사할 수 없다`,
        details: { item: "capability" },
      },
    };
  }
  const inside = rejectOutsideRoleCap(definition.kind, tools, cap);
  if (!inside.ok) return inside;
  // MCP 선택은 등록된 서버와 현재 유효한 정확한 tool 쌍만 남긴다(R11).
  const mcp = rejectUnknownMcp(
    definition.mcp.servers,
    definition.mcp.tools,
    deps.mcpServers,
  );
  if (!mcp.ok) return mcp;
  // safe 표시는 그 MCP tool 쌍 하나에만 적용한다(R16).
  const safe = rejectUnsafeSafeTools(definition.safe_tools, deps.mcpServers);
  if (!safe.ok) return safe;
  // model·organizing_model 선택을 T5의 검사로 실제 검증한다(T5 사용).
  const model = validateModelSelection("model", definition.model, deps);
  if (!model.ok) return model;
  const organizing = validateModelSelection(
    "organizing_model",
    definition.organizing_model,
    deps,
  );
  if (!organizing.ok) return organizing;
  return {
    ok: true,
    value: { model: model.value, organizing_model: organizing.value },
  };
}
