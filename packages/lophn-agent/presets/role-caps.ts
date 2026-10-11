import type { RoleCap } from "./model.ts";

// T8이 고정하는 역할별 상한 표(정본 자리). core는 platform/responsiveness#R1의
// core import 검사가 packages/lophn-agent/roles/를 막으므로, core가 부르는 검증
// deps(presets#R11)는 이 leaf의 표를 읽는다(presets#R9). roles/common/mod.ts가
// 같은 표를 runtime에 재노출한다. 상한은 이름 목록이고 wildcard·병합은 없다
// (presets#R11). 목록 밖 내장 tool은 저장 전체 거절이다. 확장 선택(MCP·skill)은
// 상한 항목이 아니라 preset의 선택 항목이다(R5).

// 공통 기본 tool 묶음의 개별 동작이다(domain model presets의 common 목록). 각
// 역할의 기본 preset은 이 목록에서 자기 범위만 고른다(R4).
export const DOCUMENT_READ_TOOLS: readonly string[] = Object.freeze([
  "document.list",
  "document.outline",
  "document.search",
  "document.read_version",
  "document.read_section",
  "document.read_range",
  "document.history",
  "document.diff",
]);

const FORMAT_TOOLS: readonly string[] = Object.freeze([
  "format.list",
  "format.rules",
  "format.examples",
  "format.validate",
]);

// context 개체 읽기다. 선언 검색 tool은 이름이 동적이라 이 표에 없고 preset의 context 선택이 정한다
// (harness/tools#R21). 개체 읽기는 선택한 context 안에서만 읽힌다.
const CONTEXT_READ_TOOLS: readonly string[] = Object.freeze([
  "context.read_entity",
]);

const ASK_TOOLS: readonly string[] = Object.freeze([
  "question.submit",
  "question.read_decision",
  "approval.read_decision",
]);

// 네 역할의 공통 읽기·format·묻기 동작이다(R4). 역할 상한은 이 목록에 역할별
// 추가 동작을 더한 교집합이다.
const COMMON_READ_TOOLS: readonly string[] = Object.freeze([
  ...DOCUMENT_READ_TOOLS,
  ...CONTEXT_READ_TOOLS,
  ...FORMAT_TOOLS,
  ...ASK_TOOLS,
]);

function cap(tools: readonly string[]): RoleCap {
  return Object.freeze({ tools: Object.freeze([...tools]) });
}

// 역할 상한 표다(presets#R9). lophn은 전체 범위 조회·coding 요청·제품 안내·run
// 결과 저장을, App Engineer는 담당 앱 하나의 설계 참조·해석 연결·ticket 생성을,
// Context Engineer는 앱 metadata 조회·승인 초안을,
// Operator는 승인된 앱 read command와 승인한 남길 문서만 상한에 둔다(R11).
export const ROLE_CAPS: ReadonlyMap<string, RoleCap> = new Map<string, RoleCap>(
  [
    [
      "lophn",
      cap([
        ...COMMON_READ_TOOLS,
        "project.list",
        "project.read",
        "app.list",
        "app.read",
        "app.blueprint",
        "app.commands",
        "app.releases",
        "app.health",
        "app.invocations",
        "sdk.list",
        "sdk.contract",
        "sdk.examples",
        "problem.list",
        "problem.read",
        "report.read",
        "snapshot.read",
        "verification.read",
        "repair.read",
        "ticket.list",
        "ticket.read",
        "ticket.create",
        "lophn.guide",
        "setting.read",
        "document.create",
        "document.save_version",
        "preset.list",
        "preset.read",
        "assignment.list",
        "assignment.read",
        "run.read_result",
        "handoff.submit",
        "handoff.read_status",
        "handoff.read_result",
        "visual.show",
        "visual.read",
        "visual.prepare_document",
      ]),
    ],
    [
      "app_engineer",
      cap([
        ...COMMON_READ_TOOLS,
        "project.read",
        "app.read",
        "app.blueprint",
        "app.commands",
        "app.releases",
        "app.health",
        "app.invocations",
        "sdk.contract",
        "sdk.examples",
        "problem.list",
        "problem.read",
        "report.read",
        "snapshot.read",
        "verification.read",
        "repair.read",
        "ticket.list",
        "ticket.read",
        "ticket.create",
        "ticket.make_ready",
        "problem.set_interpretation",
        "document.create",
        "document.save_version",
        "preset.read",
        "assignment.read",
        "run.read_result",
        "handoff.submit",
        "handoff.read_status",
        "handoff.read_result",
        "visual.show",
        "visual.read",
        "visual.prepare_document",
      ]),
    ],
    [
      "context_engineer",
      cap([
        ...COMMON_READ_TOOLS,
        "project.list",
        "project.read",
        "app.list",
        "app.read_purpose",
        "app.commands",
        "document.create",
        "document.save_version",
        "preset.list",
        "preset.read",
        "assignment.list",
        "assignment.read",
        "run.read_result",
        "approval.submit_assignment",
        "handoff.submit",
        "handoff.read_status",
        "handoff.read_result",
        "visual.show",
        "visual.read",
        "visual.prepare_document",
      ]),
    ],
    [
      "operator",
      cap([
        "document.list",
        "document.outline",
        "document.search",
        "document.read_version",
        "document.read_section",
        "document.read_range",
        "document.history",
        "document.diff",
        ...CONTEXT_READ_TOOLS,
        "format.list",
        "format.rules",
        "format.examples",
        "format.validate",
        "document.save_version",
        "app.command_metadata",
        "app.call_read_command",
        "question.submit",
        "question.read_decision",
        "approval.read_decision",
      ]),
    ],
  ],
);

// 앱 command 노출 규칙 표다(roles/common#R11). 노출 상한은 역할이고 실제 호출은
// 그때의 현재 허락·assignment 승인·harness/tool-judgment 효과 판정의 교집합이다.
// ask는 노출된 command 중 되돌릴 수 없거나 심각한 효과만 묻는 표시다(R11).
export type AppCommandExposure = Readonly<{
  // 노출할 효과 상한이다. 이 값 밖 효과는 노출하지 않는다.
  effects: readonly ("read" | "write" | "external")[];
  // 되돌리기를 지원하는 write만 노출한다(app_engineer).
  undo_write_only: boolean;
  // 호출 전 한정 자리다. permitted_apps는 사람이 agent 사용을 허락한 앱,
  // assigned_app은 담당 앱 하나, approved_reads는 assignment에 승인된 read,
  // none은 실행 없음이다.
  execution: "permitted_apps" | "assigned_app" | "approved_reads" | "none";
  // 노출된 command 중 되돌릴 수 없거나 심각한 효과만 묻는지다(R11).
  ask: boolean;
}>;

export const APP_COMMAND_EXPOSURE: ReadonlyMap<string, AppCommandExposure> =
  new Map<string, AppCommandExposure>([
    [
      "lophn",
      Object.freeze({
        effects: ["read", "write", "external"] as const,
        undo_write_only: false,
        execution: "permitted_apps",
        ask: true,
      }),
    ],
    [
      "app_engineer",
      Object.freeze({
        effects: ["read", "write"] as const,
        undo_write_only: true,
        execution: "assigned_app",
        ask: true,
      }),
    ],
    [
      "context_engineer",
      Object.freeze({
        effects: [] as const,
        undo_write_only: false,
        execution: "none",
        ask: false,
      }),
    ],
    [
      "operator",
      Object.freeze({
        effects: ["read"] as const,
        undo_write_only: false,
        execution: "approved_reads",
        ask: false,
      }),
    ],
  ]);
