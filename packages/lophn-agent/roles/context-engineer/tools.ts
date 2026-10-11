// Context Engineer만의 tool(lophn-agent/harness/tools#R23, roles/context-engineer#R8, R11, R14, R15)의
// spec stub이다. 구현은 ctx-I57이 한다. 목록에 넣는 곳은 harness/tools의 `BUILTIN_TOOLS`이고 역할 상한
// 이름 표(`presets/role-caps.ts`)가 이 이름을 Context Engineer에게만 연다. 옛 context 쓰기 17개
// (`harness/tools/bundles/context.ts`)는 ctx-R6이 지울 때까지 그대로 둔다.
import type { CheckFinding, StoredViolation } from "@lophn/contracts/documents";
import type { ContractCall } from "../../harness/tools/bundles/common.ts";
import type { ToolDefinition } from "../../harness/tools/registry.ts";
import type { ToolHandler } from "../../harness/tools/work.ts";

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

// 미리보기 route는 `context-api.ts`에 아직 없다. 입력은 `{context, bundle, cursor?}`(만드는 중인 판),
// 읽기 effect이고 결과는 아래 모양으로 가정했다. route를 더하는 task가 이 모양에 맞추거나 시험을 고친다.
export const CONTEXT_PREVIEW_CONTRACT = "context.preview";

export type ContextPreviewRead = {
  context: string;
  bundle: string;
  // 지금 파일에서 뽑은 type별 개체 수(계약의 type 순서)
  types: { type: string; count: number }[];
  violation_count: number;
  // 위반 한 page. 문구가 붙은 저장 모양에서 context·판 hash만 뺀 것이다.
  violations: Omit<StoredViolation, "context" | "bundle_hash">[];
  // 제출 검사의 판 단계 결과 가운데 파일 없이 알 수 있는 것(계약 모양·cross project 경로·예시 불일치 등)
  findings: CheckFinding[];
  complete: boolean;
  next_cursor: string | null;
};

// I57이 채운다. harness/tools의 `BUILTIN_TOOLS`가 이 목록을 더한다.
export const CONTEXT_ENGINEER_TOOLS: readonly ToolDefinition[] = [];

export function createContextEngineerToolHandlers(
  _ports: ContractCall,
): ReadonlyMap<string, ToolHandler> {
  throw new Error("not implemented");
}
