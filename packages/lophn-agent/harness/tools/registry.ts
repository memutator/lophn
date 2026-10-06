import type { z } from "zod";
import type { ToolEffect } from "../../../contracts/lophn-agent/mod.ts";
import { AGENT_TOOLS } from "./bundles/agent.ts";
import {
  DOCUMENT_READ_TOOL_NAMES,
  DOCUMENT_TOOLS,
  DOCUMENT_WRITE_TOOL_NAMES,
} from "./bundles/document.ts";
import { FORMAT_TOOL_NAMES, FORMAT_TOOLS } from "./bundles/format.ts";
import { GUIDE_TOOL_NAMES, GUIDE_TOOLS } from "./bundles/guide.ts";
import { VISUAL_TOOL_NAMES, VISUAL_TOOLS } from "./bundles/visual.ts";

// tool 하나는 정의 하나다. 목록과 실행이 같은 schema·효과·실패 종류를 쓴다(R2).
// 내장 이름은 `<영역>.<동작>` 점 표기다(domain model ToolDefinition).

export type ToolOrigin = "builtin" | "app" | "external";

export type ToolDefinition = {
  name: string;
  description: string;
  revision: string;
  input: z.ZodType;
  // 효과 선언이 없으면 제공도 호출도 없다(R4). 그래서 타입에서 필수로 둔다.
  effect: ToolEffect;
  confirm: boolean;
  // 소유 contract 이름 하나. 여러 영역의 숨은 절차는 없다.
  contract: string;
  scopeCheck: string;
  reversible: boolean;
  idempotent: boolean;
  errors: readonly string[];
  origin: ToolOrigin;
};

export type ToolCatalog = {
  definitions: readonly ToolDefinition[];
};

// 내장 tool은 문서·앱·context와 agent 일만 다룬다(R1). shell·임의 파일·임의 URL·
// 웹 검색·브라우저·코드 run·subagent·coding agent 시작은 정의 자체가 없다.
export const BUILTIN_TOOLS: readonly ToolDefinition[] = [
  ...DOCUMENT_TOOLS,
  ...FORMAT_TOOLS,
  ...VISUAL_TOOLS,
  ...GUIDE_TOOLS,
  ...AGENT_TOOLS,
];

// preset이 이름으로 고르는 tool 묶음이다(presets#R7). 저장 때 개별 동작으로 펼쳐 고정하므로 묶음에
// 새 동작이 생겨도 옛 판은 늘지 않는다. 묶음은 이름 목록일 뿐 권한이 아니다. 역할 상한과 현재
// scope, 판정이 그 뒤에 따로 적용된다. 쓰기 묶음은 읽기 묶음과 따로 골라야 한다.
export const TOOL_BUNDLES: ReadonlyMap<string, readonly string[]> = new Map([
  ["document-read", DOCUMENT_READ_TOOL_NAMES],
  ["document-write", DOCUMENT_WRITE_TOOL_NAMES],
  ["format", FORMAT_TOOL_NAMES],
  ["lophn-guide", GUIDE_TOOL_NAMES],
  ["visual", VISUAL_TOOL_NAMES],
]);

// 금지 통로 이름. 내장·앱·외부 어디에도 이 이름이 있으면 목록에서 뺀다(R1).
export const FORBIDDEN_TOOL_NAMES: readonly string[] = [
  "shell",
  "shell.exec",
  "file.read",
  "file.write",
  "http.request",
  "web.search",
  "web.read",
  "browser",
  "code.run",
  "subagent",
  "coding_agent.start",
];

const FORBIDDEN = new Set(FORBIDDEN_TOOL_NAMES);

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

// 목록은 preset capability와 역할 상한의 교집합이고 순서는 내장→앱→외부다(R5).
// 같은 판의 같은 bytes를 유지하려고 입력 순서를 그대로 두고 이름 중복은 먼저 온
// 정의를 남긴다. 금지 이름은 어느 출처든 빠진다.
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
    const definition of [...source.builtin, ...source.app, ...source.external]
  ) {
    if (FORBIDDEN.has(definition.name)) continue;
    if (!allowed.has(definition.name) || !role.has(definition.name)) continue;
    if (seen.has(definition.name)) continue;
    seen.add(definition.name);
    listed.push(definition);
  }
  return listed;
}

// 소유 contract 하나를 부르려고 core가 같은 agent 자격으로 더 부르는 operation이다. 본문을 글 값으로
// 받는 저장은 core가 같은 자격으로 `document.prepare`·`document.save`를 부른다(documents의
// 저장 범위와 기준 판 비교를 그대로 적용하려고 요청한 agent의 자격으로 부른다).
const SUPPORTING_OPERATIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ["SaveToolDocument", ["document.prepare", "document.save"]],
  // 제품 안내 읽기는 안내 목록과 설정 정의를 같은 읽기 자격으로 함께 읽는다.
  ["guide.read", ["guide.list"]],
  ["GetSettings", ["SettingsDefinitions"]],
  // 시각 출처 검증은 이 run이 실행해 끝낸 앱 command의 ToolCall을 읽는다.
  ["RecordMessage", ["ReadToolCall"]],
]);

// run의 agent 자격이 가져야 하는 operation 목록이다. 제공 목록의 소유 contract와 그 보조 operation의
// 합이고, 목록에 없는 tool의 contract는 더하지 않는다.
export function runOperations(
  listed: readonly ToolDefinition[],
): readonly string[] {
  const operations = new Set<string>();
  for (const definition of listed) {
    operations.add(definition.contract);
    for (const extra of SUPPORTING_OPERATIONS.get(definition.contract) ?? []) {
      operations.add(extra);
    }
  }
  return [...operations];
}

// 실행은 목록과 같은 정의를 찾는다(R2). 등록되지 않은 이름은 없다.
export function findTool(
  listed: readonly ToolDefinition[],
  name: string,
): ToolDefinition | undefined {
  return listed.find((definition) => definition.name === name);
}
