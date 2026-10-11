// project의 Agents 탭 본문(shell/workspace#R36·R37). 위에서부터 agent 카드(lophn · Context Engineer · Operator들),
// [+ New Operator], 그리고 Instructions · Models for this project · Skills · MCP servers · Permissions 구역과
// 맨 아래 "Agent definitions are stored in lophn, not in your project folder." 한 줄이다. 카드에는 일정·마지막
// 실행 줄이 없다. [Open]이 여는 editor는 editor/agent-editor.tsx가 맡고, 탭 안에서 본문을 바꾸는 일은 탭 쪽 몫이다.
//
// 약속하는 DOM(test가 단언): 카드는 `[data-agent-card]`(`data-assignment`, `data-role`, `data-kind`)가 위의 순서대로
// 나오고 안에 design `Avatar`, `[data-agent-name]`, `[data-agent-kind]`("Built in" | "Operator"), `[data-agent-model]`
// (model 이름), `[data-agent-counts]`("n contexts · n skills · n MCP", built-in은 contexts 없이), "Open" 단추가 있다.
// "New Operator" 단추가 마지막 카드 뒤에 있다. 구역은 `section[data-section=instructions|models|skills|mcp|permissions]`
// 이고 각자 h2 제목을 가진다. Instructions는 `[data-instructions-preview]`(LOPHN.md 첫 줄)와 "Edit" 단추, Models는 role마다
// `[data-role-model]`(`data-role`) 안에 `[data-role-label]`·`[data-role-model-line]`·`[data-model-button]`을 두며 고른
// 값이 있는 줄에만 "Use Workspace default" 단추가 있다. Skills·MCP servers·Permissions의 켬·끔은 design `Switch`다.
// 맨 아래 `[data-stored-note]`가 마지막 요소다.
import type { ReactElement } from "react";

import type {
  AgentListRow,
  ValueSource,
} from "../../../../../packages/contracts/lophn-agent/agent-values.ts";
import type { ModelChoice } from "../../../../../packages/contracts/lophn-agent/models.ts";
import type { AgentRole } from "../../../../../packages/contracts/lophn-agent/scope.ts";
import type { ModelPickerProps } from "../../conversation/model-picker/model-picker.tsx";
import type {
  ImageSrc,
  ModelLabel,
  PermissionRow,
  ProjectInstructionsView,
  ToggleRow,
} from "./views.ts";

/**
 * "Models for this project"의 줄 하나. role 넷(lophn · Context Engineer · App Engineer · Operators)이 이 순서로
 * 온다. 줄 이름은 role에서 화면이 만든다.
 */
export interface RoleModelRow {
  readonly role: AgentRole;
  /** 이 project가 고른 값(place settings의 models[role]). 비워 두었으면 null이다. */
  readonly chosen: ModelChoice | null;
  /**
   * 실제로 쓰는 값과 출처(ReadPlaceAgentSettings의 effective_models[role]). chosen이 있으면 출처 층은 place이고
   * 없으면 Workspace나 기본값이다. 아무 층에도 값이 없으면 null이다.
   */
  readonly effective: {
    readonly value: ModelChoice;
    readonly source: ValueSource;
  } | null;
  /** 이 줄에서 model과 option을 고르는 picker. */
  readonly picker: ModelPickerProps;
}

export interface AgentsTabProps {
  /** project 이름. "Shared by every agent in <project>"에 쓴다. */
  projectName: string;
  /**
   * ListAgents의 행을 보여 줄 순서대로: lophn, Context Engineer, Operator들. App Engineer는 앱 자리 agent라 이
   * 탭에 오지 않는다. 카드 개수(counts)는 행이 가진 값이다: built-in은 contexts가 null이라 그 수를 보이지 않는다.
   */
  agents: readonly AgentListRow[];
  imageSrc: ImageSrc;
  /** LOPHN.md. 이 탭은 첫 줄만 미리 보인다. */
  instructions: ProjectInstructionsView;
  modelRoles: readonly RoleModelRow[];
  modelLabel: ModelLabel;
  /** 이 project에 등록한 skill과 MCP server의 켬·끔. */
  skills: readonly ToggleRow[];
  mcpServers: readonly ToggleRow[];
  /** 이 project의 권한 규칙. 오래 가는 허락은 여기서만 정한다(platform/approvals). */
  permissions: readonly PermissionRow[];
  /** 카드의 [Open]. 같은 탭 안에서 그 agent의 editor를 연다. */
  onOpenAgent: (assignment: string, role: AgentRole) => void;
  /** [+ New Operator]. */
  onNewOperator: () => void;
  /** Instructions의 [Edit]. LOPHN.md의 문서 탭을 연다. */
  onEditInstructions: () => void;
  /** 고른 model 줄을 비워 Workspace 기본값을 따르게 한다. */
  onResetRoleModel: (role: AgentRole) => void;
  onToggleSkill: (name: string, on: boolean) => void;
  onAddSkill: () => void;
  onToggleMcp: (name: string, on: boolean) => void;
  onAddServer: () => void;
  onChangePermission: (tool: string, on: boolean) => void;
}

export function AgentsTab(_props: AgentsTabProps): ReactElement {
  throw new Error("not implemented: agent-I28");
}
