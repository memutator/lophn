// editor의 순수 부분: 편집 중인 값(Ready), 칸 이름과 탭의 대응, 저장하지 않은 변경 판정.
// 탭 컴포넌트들이 같이 쓰는 모양이라 한 곳에 둔다.
import type { AgentDefinitionIssue } from "../../../../../protocol/lophn-agent/agent-definitions.ts";
import {
  type AgentRuntime,
  isHarnessRuntime,
} from "../../../../../protocol/lophn-agent/agent-values.ts";
import {
  isCodingBuiltin,
  isLophn,
} from "../../../../../protocol/lophn-agent/workspaces.ts";
import type { AgentDetail, AgentDraft } from "../source.ts";

/**
 * editor의 탭. 첫 탭(overview)은 정의를 네 묶음으로 한 장에 보이고, 나머지 넷이 그 묶음의 칸을 고친다:
 * who(누구), runs(무엇으로 도나), sees(무엇을 보나), works(어떻게 일하나).
 */
export type EditorTab = "overview" | "who" | "runs" | "sees" | "works";

/** 고치는 탭 넷. overview의 절도 이 순서다. */
export const GROUPS = ["who", "runs", "sees", "works"] as const;
export type Group = (typeof GROUPS)[number];

export type FieldName =
  | "avatar"
  | "handle"
  | "workspace"
  | "name"
  | "description"
  | "runtime"
  | "modality"
  | "tools"
  | "instructions"
  | "memory"
  | "model"
  | "skills"
  | "mcp"
  | "extensions"
  | "skip"
  | "browser_profile"
  | "card";

// 거절된 항목의 점 경로 첫 구간이 어느 칸에 속하는지. 칸에 없는 경로(frontmatter 등)는 맨 위 머리에 보인다.
const FIELD_OF: Readonly<Record<string, FieldName>> = {
  handle: "handle",
  workspace: "workspace",
  name: "name",
  avatar: "avatar",
  description: "description",
  runtime: "runtime",
  modality: "modality",
  tools: "tools",
  skills: "skills",
  body: "instructions",
  model: "model",
  skills_off: "skills",
  mcp_off: "mcp",
  mcp_servers: "mcp",
  extensions: "extensions",
  skip: "skip",
  browser_profile: "browser_profile",
};

export const fieldOf = (issue: AgentDefinitionIssue): FieldName | null =>
  FIELD_OF[issue.field.split(".")[0]] ?? null;

/** 칸이 어느 탭에 있는가. issue가 숨은 탭에 있으면 그 탭에 표시를 단다. */
const TAB_OF_FIELD: Readonly<Record<FieldName, Group>> = {
  avatar: "who",
  handle: "who",
  name: "who",
  description: "who",
  card: "who",
  runtime: "runs",
  model: "runs",
  modality: "runs",
  workspace: "sees",
  browser_profile: "sees",
  tools: "sees",
  mcp: "sees",
  extensions: "sees",
  skip: "sees",
  instructions: "works",
  skills: "works",
  memory: "works",
};

export const tabOfIssue = (issue: AgentDefinitionIssue): Group => {
  const field = fieldOf(issue);
  return field === null ? "who" : TAB_OF_FIELD[field];
};

/** 어느 칸에도 속하지 않은 항목(frontmatter 등). 어느 탭에서나 보이도록 머리에 둔다. */
export const looseIssues = (issues: readonly AgentDefinitionIssue[]) =>
  issues.filter((issue) => fieldOf(issue) === null);

export const issuesOf = (
  issues: readonly AgentDefinitionIssue[],
  name: FieldName,
) => issues.filter((issue) => fieldOf(issue) === name);

/** editor가 쥔 값. base는 마지막으로 읽거나 저장한 정의이고 definition은 편집 중인 값이다. */
export interface Ready {
  readonly kind: "ready";
  readonly detail: AgentDetail;
  readonly base: AgentDraft;
  readonly definition: AgentDraft;
  readonly issues: readonly AgentDefinitionIssue[];
  /** 복제로 연 새 agent면 원래 agent. 올린 이미지는 옮기지 못해 imageDropped가 참이다. */
  readonly copyOf?: { readonly name: string; readonly imageDropped: boolean };
}

// 키 순서와 상관없이 같은 값이면 같은 글이다(칸을 지웠다 다시 넣으면 순서가 바뀐다).
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/** 할당 칸. Sees의 앱 할당이 바로 저장해 파일에 맞춘다. 이 칸의 차이는 편집이 아니다. */
export const GRANT_FIELDS = ["apps", "remote_apps", "permissions"] as const;

const withoutGrants = (definition: AgentDraft): string => {
  const rest: Record<string, unknown> = { ...definition };
  for (const field of GRANT_FIELDS) delete rest[field];
  return canonical(rest);
};

/** 읽거나 저장한 값에서 사람이 바꾼 것이 있는가. */
export const isDirty = (ready: Ready): boolean =>
  withoutGrants(ready.definition) !== withoutGrants(ready.base);

/** 정의와 detail이 가르는 agent의 종류와 runtime. 탭마다 무엇을 보일지 정한다. */
export interface AgentFacts {
  readonly fresh: boolean;
  readonly lophn: boolean;
  /** 내장 coding agent는 handle·runtime·범위가 고정이다. */
  readonly coding: boolean;
  readonly runtime: AgentRuntime;
  readonly custom: boolean;
  /** harness(third-party CLI)는 자기 model·skill·MCP를 쓴다. */
  readonly harness: boolean;
}

export function factsOf(
  detail: AgentDetail,
  definition: AgentDraft,
): AgentFacts {
  const runtime = definition.runtime ?? "lophn";
  return {
    fresh: detail.assignment === null,
    lophn: detail.assignment !== null && isLophn(detail.assignment),
    coding: detail.assignment !== null && isCodingBuiltin(detail.assignment),
    runtime,
    custom: runtime === "custom",
    harness: isHarnessRuntime(runtime),
  };
}

// 비어 가는 칸은 정의에서 뺀다: 파일에는 사람이 바꾼 칸만 둔다.
export function withField(
  definition: AgentDraft,
  key: Exclude<keyof AgentDraft, "body">,
  value: unknown,
): AgentDraft {
  const next: Record<string, unknown> = { ...definition };
  if (value === undefined || (Array.isArray(value) && value.length === 0)) {
    delete next[key];
  } else next[key] = value;
  return next as unknown as AgentDraft;
}

/** 탭 컴포넌트가 모두 받는 것. */
export interface FormProps {
  readonly detail: AgentDetail;
  readonly definition: AgentDraft;
  readonly issues: readonly AgentDefinitionIssue[];
  /** agent가 놓인 곳의 이름(Agents 탭이 열린 project나 앱). */
  readonly workspaceName: string;
  readonly onChange: (definition: AgentDraft) => void;
}
