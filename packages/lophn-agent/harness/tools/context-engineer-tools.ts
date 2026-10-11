// Context Engineer만의 tool(lophn-agent/harness/tools#R23, roles/context-engineer#R8, R11, R14, R15)의
// spec stub이다. 구현은 ctx-I57이 한다. 정의는 harness/tools에 있고(harness는 roles를 import하지 않는다)
// `BUILTIN_TOOLS`가 더한다. 역할 쪽은 이름만 고른다: 역할 상한 이름 표(`presets/role-caps.ts`)가 이 이름을
// Context Engineer에게만 연다. 옛 context 쓰기 17개
// (`harness/tools/bundles/context.ts`)는 ctx-R6이 지울 때까지 그대로 둔다.
import type { ContractCall } from "./bundles/common.ts";
import {
  CONTEXT_PREVIEW_CONTRACT,
  type ContextPreviewRead,
} from "./context-route-shapes.ts";
import type { ToolDefinition } from "./registry.ts";
import type { ToolHandler } from "./work.ts";

// 읽기 tool 다섯, 쓰기 tool 넷. 이름은 `<영역>.<동작>`이다.
export const CONTEXT_ENGINEER_TOOL_NAMES = {
  // 적용된 판의 계약·검색·saved view 정의·예시 (`context.contract`)
  readContract: "context.read_contract",
  // 만드는 중인 판(draft, 검사 중, 마지막 failed)과 그 검사 보고 (`context.draft`)
  readDraft: "context.read_draft",
  // 초안을 지금 project 파일로 추출해 보기만 한다 (`context.preview`, 적용 없음)
  preview: "context.preview",
  // 현재 위반 (`context.violations`)
  readViolations: "context.violations",
  // 용어집 읽기 (`glossary.list`)
  readGlossary: "glossary.read",
  // 초안 쓰기 (`bundle.save_draft`, write)
  saveDraft: "context.save_draft",
  // 판 제출 (`bundle.submit`, write)
  submit: "context.submit_bundle",
  // 용어집 항목 쓰기·지우기 (`glossary.set`, `glossary.remove`, write)
  setGlossary: "glossary.set",
  removeGlossary: "glossary.remove",
} as const;

// 미리보기 route(`context.preview`)와 결과 모양은 `context-route-shapes.ts`에 있다.
export { CONTEXT_PREVIEW_CONTRACT, type ContextPreviewRead };

// I57이 채운다. harness/tools의 `BUILTIN_TOOLS`가 이 목록을 더한다.
export const CONTEXT_ENGINEER_TOOLS: readonly ToolDefinition[] = [];

export function createContextEngineerToolHandlers(
  _ports: ContractCall,
): ReadonlyMap<string, ToolHandler> {
  throw new Error("not implemented");
}
