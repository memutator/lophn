// agent 하나의 editor(shell/workspace#R38~R44). Agents 탭 안에서 [Open]이나 [+ New Operator]로 열리고, 위에서부터
// Profile · Name · Instructions · Model · Contexts · Skills · MCP servers · Permissions와 [Save]·[Cancel], Operator는
// 맨 아래에 [Delete Operator]가 있다. What it does·Schedule·Last run·남길 문서 칸은 없다. built-in(lophn·Context
// Engineer)의 [Open]도 이 editor다: Name은 고정 글자, Contexts 칸은 없고, Instructions에 "Built-in instructions
// (read only)" 접힌 줄이 더해지며, 지우는 길이 없다.
//
// 이 component는 form의 값(definition)을 props로 받아 그리고 바뀔 때마다 callback으로 알린다. 정의 파일은 사람이 바꾼 칸만
// 가지므로 definition에 없는 칸은 "상속"이고, effective가 그 칸의 실제 값과 출처를 준다(ReadAgent).
//
// 약속하는 DOM(test가 단언): 칸은 `[data-field=profile|name|instructions|model|contexts|skills|mcp|permissions]`가
// 위의 순서대로 나온다(built-in은 contexts 없이). 저장 때 거절된 항목(issues)은 그 칸 안에 `[data-issue=<code>]`로 보인다
// (`contexts.1`은 contexts 칸). Profile은 design `Avatar`(크기 lg) 미리보기, `[data-icon-option=<id>]` 단추(눌린 것은
// aria-pressed), `input[type=file]`(png·jpeg·webp)과 "Upload image" 단추를 둔다. Name은 input 하나이고 built-in은
// input 없이 글자 `[data-fixed-name]`다. Instructions는 `[data-project-instructions]` 읽기 전용 블록(머리 글,
// `[data-project-instructions-body]` 첫 4줄, "Edit LOPHN.md" 단추)이 textarea보다 위에 있다. Model은 상속일 때
// `[data-model-inherit]`("Use project default — <model> (from <출처>)")를, 고른 값이 있을 때 `[data-model-changed]`
// ("Changed")와 "Reset" 단추를 보이고 picker 단추 `[data-model-button]`는 항상 있다. Contexts의 chip은
// `[data-context=<id>]` 안에 ✕ 단추 하나를 가진다. Skills·MCP servers는 design `Switch`, Permissions는 design `Checkbox`
// (project가 허락하지 않은 동작은 disabled)다. 맨 아래 Delete 단추는 design `Dialog`로 확인을 한 번 받는다.
import type { ReactElement } from "react";

import type {
  AgentDefinition,
  AgentIssue,
  AgentPermissions,
  Profile,
  ValueSource,
} from "../../../../../../packages/contracts/lophn-agent/agent-values.ts";
import type { ModelChoice } from "../../../../../../packages/contracts/lophn-agent/models.ts";
import type { AgentRole } from "../../../../../../packages/contracts/lophn-agent/scope.ts";
import type { ModelPickerProps } from "../../../conversation/model-picker/model-picker.tsx";
import type { ModelLabel, ProjectInstructionsView } from "../views.ts";

/** 값과 그 값이 어느 층에서 왔는지(ReadAgent.effective의 칸). */
export interface Sourced<T> {
  readonly value: T;
  readonly source: ValueSource;
}

/** ReadAgent의 effective 중 editor가 쓰는 칸. 정의에 칸이 없을 때 보일 상속 값이다. */
export interface AgentEffective {
  readonly name: Sourced<string>;
  readonly profile: Sourced<Profile>;
  /** 어느 층에도 model이 없으면 null이다. */
  readonly model: Sourced<ModelChoice> | null;
  readonly permissions: Sourced<AgentPermissions>;
}

/** icon grid의 한 칸. id는 design의 avatar-icons 집합이고 label은 접근 이름이다. */
export interface AvatarIconOption {
  readonly id: string;
  readonly label: string;
}

/** 붙일 수 있는 context 한 개(이 project의 context 목록). */
export interface ContextOption {
  readonly id: string;
  readonly name: string;
}

/** Permissions 칸의 한 줄. projectAllows가 false인 동작은 project보다 넓어서 고를 수 없다. */
export interface PermissionChoice {
  readonly tool: string;
  readonly label: string;
  readonly projectAllows: boolean;
}

export interface AgentEditorProps {
  agent: {
    /** 첫 저장 전의 새 Operator는 null이다(이미지는 첫 저장 뒤에 올린다). */
    readonly assignment: string | null;
    readonly role: AgentRole;
    readonly kind: "built_in" | "operator";
  };
  projectName: string;
  /** form의 현재 값. 새 Operator는 `{ body: "" }`다. */
  definition: AgentDefinition;
  effective: AgentEffective;
  /** 저장이 거절된 항목별 이유(field는 점 경로). 없으면 빈 배열이다. */
  issues: readonly AgentIssue[];
  /** 올린 이미지 파일 이름(`avatar.png`)을 화면이 읽을 수 있는 주소로 푼다. */
  imageSrc: (image: string) => string;
  /** design의 avatar-icons 집합. 순서가 grid 순서다. */
  avatarIcons: readonly AvatarIconOption[];
  /** project의 LOPHN.md. editor는 첫 4줄을 읽기 전용으로 보인다. */
  projectInstructions: ProjectInstructionsView;
  /** built-in의 제품 지침 글. Operator는 null이다. */
  builtInInstructions: string | null;
  modelLabel: ModelLabel;
  /** model 단추와 picker. 고른 model이 가진 option 축만 picker가 보인다. */
  picker: ModelPickerProps;
  /** 이 project의 context 목록. built-in editor는 쓰지 않는다. */
  projectContexts: readonly ContextOption[];
  /** 이 project에서 쓸 수 있는 skill 이름. 정의의 skills_off에 든 것만 꺼져 보인다. */
  skills: readonly string[];
  /** 이 project에서 쓸 수 있는 MCP server 이름. 정의의 mcp_off에 서버 전체로 든 것만 꺼져 보인다. */
  mcpServers: readonly string[];
  /** 고를 수 있는 동작 전부. 켜짐은 definition.permissions, 없으면 effective.permissions다. */
  permissionChoices: readonly PermissionChoice[];
  onName: (name: string) => void;
  onPickIcon: (icon: string) => void;
  onUploadImage: (file: File) => void;
  /** 이 agent의 instructions 본문. */
  onInstructions: (body: string) => void;
  /** project instructions 블록의 [Edit LOPHN.md]. */
  onEditProjectInstructions: () => void;
  /** model 칸의 [Reset]. 정의에서 model을 빼고 상속으로 돌아간다. */
  onResetModel: () => void;
  onAddContext: (id: string) => void;
  onRemoveContext: (id: string) => void;
  onToggleSkill: (name: string, on: boolean) => void;
  onToggleMcp: (name: string, on: boolean) => void;
  onTogglePermission: (tool: string, on: boolean) => void;
  onSave: () => void;
  onCancel: () => void;
  /** 확인을 한 번 받은 뒤에만 부른다. */
  onDelete: () => void;
}

export function AgentEditor(_props: AgentEditorProps): ReactElement {
  throw new Error("not implemented: agent-I29");
}
