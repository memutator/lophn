// Agents 탭 test의 입력. contract type(AgentListRow·ValueSource·ModelChoice)을 따르는 순수 data와 builder이고
// 시각·id는 고정한다. 목록은 project phroner에 Operator 둘이 있는 상태가 기본이다.
import type {
  AgentListRow,
  ValueSource,
} from "../../../../../../packages/protocol/lophn-agent/agent-values.ts";
import type { ModelChoice } from "../../../../../../packages/protocol/lophn-agent/models.ts";
import type { AgentRole } from "../../../../../../packages/protocol/lophn-agent/scope.ts";
import {
  HAIKU,
  pickerProps,
  SONNET,
} from "../../../conversation/testdata/model-picker.ts";
import type { AgentsTabProps, RoleModelRow } from "../agents-tab.tsx";
import type { PermissionRow, ToggleRow } from "../views.ts";
import {
  DIGEST_ID,
  ENGINEER_ID,
  FROM_PROJECT,
  FROM_WORKSPACE,
  HAIKU_PLAIN,
  imageSrc,
  LOPHN_ID,
  LOPHN_MD,
  modelLabel,
  PROJECT_NAME,
  RELEASE_ID,
  SONNET_MEDIUM,
} from "./common.ts";

function summary(choice: ModelChoice, source: ValueSource) {
  return {
    provider: choice.provider,
    model_name: choice.model_name,
    source,
  };
}

/** 이슈 없는 행의 기본값: Operator 하나. 바꿀 칸만 over로 준다. */
export function agentRow(over: Partial<AgentListRow> = {}): AgentListRow {
  return {
    assignment: RELEASE_ID,
    role: "operator",
    kind: "operator",
    name: "Release notes",
    profile: { kind: "icon", icon: "edit" },
    model: summary(SONNET_MEDIUM, FROM_WORKSPACE),
    state: "enabled",
    issues: [],
    counts: { contexts: 2, skills: 3, mcp: 2 },
    ...over,
  };
}

export const LOPHN_ROW = agentRow({
  assignment: LOPHN_ID,
  role: "lophn",
  kind: "built_in",
  name: "lophn",
  profile: { kind: "icon", icon: "dock" },
  counts: { contexts: null, skills: 3, mcp: 2 },
});
export const ENGINEER_ROW = agentRow({
  assignment: ENGINEER_ID,
  role: "context_engineer",
  kind: "built_in",
  name: "Context Engineer",
  profile: { kind: "icon", icon: "contexts" },
  model: summary(HAIKU_PLAIN, FROM_PROJECT),
  counts: { contexts: null, skills: 3, mcp: 2 },
});
export const RELEASE_ROW = agentRow();
export const DIGEST_ROW = agentRow({
  assignment: DIGEST_ID,
  name: "Weekly digest",
  profile: { kind: "image", image: "avatar.png" },
  counts: { contexts: 4, skills: 2, mcp: 3 },
});

/** 카드 순서: lophn, Context Engineer, Operator들. */
export const TWO_OPERATORS = [LOPHN_ROW, ENGINEER_ROW, RELEASE_ROW, DIGEST_ROW];
export const NO_OPERATORS = [LOPHN_ROW, ENGINEER_ROW];

export const SKILLS: readonly ToggleRow[] = [
  { name: "summarize-notes", on: true },
  { name: "release-checklist", on: false },
  { name: "weekly-report", on: true },
];
export const MCP_SERVERS: readonly ToggleRow[] = [
  { name: "github", on: true },
  { name: "linear", on: false },
];
export const PERMISSIONS: readonly PermissionRow[] = [
  { tool: "documents.read", label: "Read documents", on: true },
  { tool: "documents.edit", label: "Edit documents", on: false },
  { tool: "apps.run_command", label: "Run app commands", on: false },
];

/**
 * role 넷의 기본값: Context Engineer만 이 project가 Haiku 5.5를 골랐고(출처 project), 나머지는 비워서 Workspace
 * 기본값 Sonnet 5.5 · Medium을 따른다.
 */
export const ROLE_MODELS: readonly RoleModelRow[] = [
  roleModel("lophn", null),
  roleModel("context_engineer", HAIKU_PLAIN),
  roleModel("app_engineer", null),
  roleModel("operator", null),
];

export function roleModel(
  role: AgentRole,
  chosen: ModelChoice | null,
): RoleModelRow {
  return {
    role,
    chosen,
    effective: chosen === null
      ? { value: SONNET_MEDIUM, source: FROM_WORKSPACE }
      : { value: chosen, source: FROM_PROJECT },
    picker: pickerProps({
      open: false,
      scenario: chosen === null ? SONNET : HAIKU,
    }),
  };
}

export interface TabCalls {
  readonly opened: [assignment: string, role: AgentRole][];
  readonly resetRoles: AgentRole[];
  readonly skills: [name: string, on: boolean][];
  readonly mcp: [name: string, on: boolean][];
  readonly permissions: [tool: string, on: boolean][];
  newOperator: number;
  editInstructions: number;
  addSkill: number;
  addServer: number;
}

export function tabCalls(): TabCalls {
  return {
    opened: [],
    resetRoles: [],
    skills: [],
    mcp: [],
    permissions: [],
    newOperator: 0,
    editInstructions: 0,
    addSkill: 0,
    addServer: 0,
  };
}

/** 기본값: Operator 둘, LOPHN.md 다섯 줄, role 넷, skill 셋, MCP server 둘, 권한 규칙 셋. */
export function tabProps(
  over: Partial<AgentsTabProps> = {},
  calls: TabCalls = tabCalls(),
): AgentsTabProps {
  return {
    projectName: PROJECT_NAME,
    agents: TWO_OPERATORS,
    imageSrc,
    instructions: { text: LOPHN_MD },
    modelRoles: ROLE_MODELS,
    modelLabel,
    skills: SKILLS,
    mcpServers: MCP_SERVERS,
    permissions: PERMISSIONS,
    onOpenAgent: (assignment, role) => calls.opened.push([assignment, role]),
    onNewOperator: () => calls.newOperator += 1,
    onEditInstructions: () => calls.editInstructions += 1,
    onResetRoleModel: (role) => calls.resetRoles.push(role),
    onToggleSkill: (name, on) => calls.skills.push([name, on]),
    onAddSkill: () => calls.addSkill += 1,
    onToggleMcp: (name, on) => calls.mcp.push([name, on]),
    onAddServer: () => calls.addServer += 1,
    onChangePermission: (tool, on) => calls.permissions.push([tool, on]),
    ...over,
  };
}
