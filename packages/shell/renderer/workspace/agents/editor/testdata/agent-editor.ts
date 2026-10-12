// Operator editor test의 입력. contract type(AgentDefinition·ValueSource·AgentIssue)을 따르는 순수 data와 builder이고
// 시각·id는 고정한다. 기본은 project phroner의 Operator "Release notes"(context 둘, skill 하나 끔, model은 상속)다.
import type {
  AgentDefinition,
  ValueSource,
} from "../../../../../../protocol/lophn-agent/agent-values.ts";
import {
  pickerProps,
  SONNET,
} from "../../../../conversation/testdata/model-picker.ts";
import type {
  AgentEditorProps,
  AgentEffective,
  AvatarIconOption,
  ContextOption,
  PermissionChoice,
} from "../agent-editor.tsx";
import {
  FROM_WORKSPACE,
  imageSrc,
  LOPHN_ID,
  LOPHN_MD,
  modelLabel,
  PROJECT_NAME,
  PROJECT_PLACE,
  RELEASE_ID,
  SONNET_MEDIUM,
} from "../../testdata/common.ts";

export const FROM_DEFINITION: ValueSource = {
  layer: "definition",
  place: PROJECT_PLACE,
};
export const FROM_DEFAULT: ValueSource = { layer: "default", place: null };

export const EVAL_LOOP = "ctx_01arz3ndektsv4rrffq69g5fa1";
export const RELEASE_PLAN = "ctx_01arz3ndektsv4rrffq69g5fa2";
export const GLOSSARY = "ctx_01arz3ndektsv4rrffq69g5fa3";

export const CONTEXTS: readonly ContextOption[] = [
  { id: EVAL_LOOP, name: "Eval loop" },
  { id: RELEASE_PLAN, name: "Release plan" },
  { id: GLOSSARY, name: "Glossary" },
];

/** design avatar-icons 집합의 앞 다섯 개. 실제 집합은 design이 정하고 editor는 받은 순서대로 그린다. */
export const AVATAR_ICONS: readonly AvatarIconOption[] = [
  { id: "dock", label: "Chat" },
  { id: "roles", label: "People" },
  { id: "contexts", label: "Library" },
  { id: "edit", label: "Pencil" },
  { id: "terminal", label: "Terminal" },
];

export const SKILLS = ["summarize-notes", "release-checklist", "weekly-report"];
export const MCP_SERVERS = ["github", "linear"];

/** project가 허락하는 동작은 읽기와 문서 편집이고 앱 command 실행은 허락하지 않는다. */
export const PERMISSION_CHOICES: readonly PermissionChoice[] = [
  { tool: "documents.read", label: "Read documents", projectAllows: true },
  { tool: "documents.edit", label: "Edit documents", projectAllows: true },
  { tool: "apps.run_command", label: "Run app commands", projectAllows: false },
];

export const BODY = "Write release notes from merged changes.";

/** 정의가 있는 Operator: model 칸은 없어서 상속한다. */
export const OPERATOR_DEFINITION: AgentDefinition = {
  name: "Release notes",
  profile: { kind: "icon", icon: "edit" },
  contexts: [EVAL_LOOP, RELEASE_PLAN],
  skills_off: ["release-checklist"],
  permissions: { tools: ["documents.read"] },
  body: BODY,
};

export const OPERATOR_EFFECTIVE: AgentEffective = {
  name: { value: "Release notes", source: FROM_DEFINITION },
  profile: {
    value: { kind: "icon", icon: "edit" },
    source: FROM_DEFINITION,
  },
  model: { value: SONNET_MEDIUM, source: FROM_WORKSPACE },
  permissions: {
    value: { tools: ["documents.read"] },
    source: FROM_DEFINITION,
  },
};

/** 첫 저장 전의 새 Operator: 아무것도 정하지 않았고 이름도 없다. */
export const NEW_OPERATOR_EFFECTIVE: AgentEffective = {
  name: { value: "", source: FROM_DEFINITION },
  profile: { value: { kind: "icon", icon: "roles" }, source: FROM_DEFAULT },
  model: { value: SONNET_MEDIUM, source: FROM_WORKSPACE },
  permissions: {
    value: { tools: ["documents.read", "documents.edit"] },
    source: FROM_WORKSPACE,
  },
};

export const BUILT_IN_TEXT =
  "You talk with the person about this project and answer from its documents.";

export const LOPHN_DEFINITION: AgentDefinition = {
  body: "Always name the document you answer from.",
};
export const LOPHN_EFFECTIVE: AgentEffective = {
  name: { value: "lophn", source: FROM_DEFAULT },
  profile: { value: { kind: "icon", icon: "dock" }, source: FROM_DEFAULT },
  model: { value: SONNET_MEDIUM, source: FROM_WORKSPACE },
  permissions: {
    value: { tools: ["documents.read", "documents.edit"] },
    source: FROM_WORKSPACE,
  },
};

export interface EditorCalls {
  readonly names: string[];
  readonly icons: string[];
  readonly uploads: File[];
  readonly instructions: string[];
  readonly addedContexts: string[];
  readonly removedContexts: string[];
  readonly skills: [name: string, on: boolean][];
  readonly mcp: [name: string, on: boolean][];
  readonly permissions: [tool: string, on: boolean][];
  editProject: number;
  resetModel: number;
  saved: number;
  cancelled: number;
  deleted: number;
}

export function editorCalls(): EditorCalls {
  return {
    names: [],
    icons: [],
    uploads: [],
    instructions: [],
    addedContexts: [],
    removedContexts: [],
    skills: [],
    mcp: [],
    permissions: [],
    editProject: 0,
    resetModel: 0,
    saved: 0,
    cancelled: 0,
    deleted: 0,
  };
}

/** 기본값: 저장된 Operator "Release notes", model 상속(picker 닫힘, Sonnet 5.5 · Medium), 거절된 항목 없음. */
export function editorProps(
  over: Partial<AgentEditorProps> = {},
  calls: EditorCalls = editorCalls(),
): AgentEditorProps {
  return {
    agent: { assignment: RELEASE_ID, role: "operator", kind: "operator" },
    projectName: PROJECT_NAME,
    definition: OPERATOR_DEFINITION,
    effective: OPERATOR_EFFECTIVE,
    issues: [],
    imageSrc: (image) => imageSrc(RELEASE_ID, image),
    avatarIcons: AVATAR_ICONS,
    projectInstructions: { text: LOPHN_MD },
    builtInInstructions: null,
    modelLabel,
    picker: pickerProps({ open: false, scenario: SONNET }),
    projectContexts: CONTEXTS,
    skills: SKILLS,
    mcpServers: MCP_SERVERS,
    permissionChoices: PERMISSION_CHOICES,
    onName: (name) => calls.names.push(name),
    onPickIcon: (icon) => calls.icons.push(icon),
    onUploadImage: (file) => calls.uploads.push(file),
    onInstructions: (body) => calls.instructions.push(body),
    onEditProjectInstructions: () => calls.editProject += 1,
    onResetModel: () => calls.resetModel += 1,
    onAddContext: (id) => calls.addedContexts.push(id),
    onRemoveContext: (id) => calls.removedContexts.push(id),
    onToggleSkill: (name, on) => calls.skills.push([name, on]),
    onToggleMcp: (name, on) => calls.mcp.push([name, on]),
    onTogglePermission: (tool, on) => calls.permissions.push([tool, on]),
    onSave: () => calls.saved += 1,
    onCancel: () => calls.cancelled += 1,
    onDelete: () => calls.deleted += 1,
    ...over,
  };
}

/** 첫 저장 전의 새 Operator. */
export function newOperatorProps(
  over: Partial<AgentEditorProps> = {},
  calls: EditorCalls = editorCalls(),
): AgentEditorProps {
  return editorProps({
    agent: { assignment: null, role: "operator", kind: "operator" },
    definition: { body: "" },
    effective: NEW_OPERATOR_EFFECTIVE,
    projectContexts: CONTEXTS,
    ...over,
  }, calls);
}

/** built-in lophn의 editor. */
export function lophnProps(
  over: Partial<AgentEditorProps> = {},
  calls: EditorCalls = editorCalls(),
): AgentEditorProps {
  return editorProps({
    agent: {
      assignment: LOPHN_ID,
      role: "lophn",
      kind: "built_in",
    },
    definition: LOPHN_DEFINITION,
    effective: LOPHN_EFFECTIVE,
    builtInInstructions: BUILT_IN_TEXT,
    ...over,
  }, calls);
}
