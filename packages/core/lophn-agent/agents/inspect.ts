import { ok, type Result } from "../../../base/mod.ts";
import {
  type AgentDefinitionIssue,
  type AgentId,
  type AgentValueLayer,
  LOPHN_AGENT_HANDLE,
  isLophn,
  lophnIdOf,
  workspaceOfLophn,
  LOPHN_AGENT_NAME,
  type ModelChoice,
  type Workspace,
} from "../../../protocol/lophn-agent/mod.ts";
import { type AgentFileDefinition, parseAgentFile } from "./definition-file.ts";
import type { AgentDeps, AgentLookups, ReadSql } from "./ports.ts";
import { AGENT_DEFAULT_PROFILE, LOPHN_PROFILE } from "./resolve.ts";
import {
  type AgentFile,
  agentSlotOf,
  type AgentSlot,
  type AgentStore,
  createAgentStore,
  dataRootOf,
} from "./store.ts";

// 읽기와 쓰기가 함께 쓰는 것: agent 하나의 정의 파일을 찾아 읽고 검사한다.

export type AgentContext = {
  lookups: AgentLookups;
  store: AgentStore;
};

export function openAgentContext(
  deps: AgentDeps,
  sql: ReadSql,
): Result<AgentContext> {
  const root = dataRootOf(sql, deps.dataRoot);
  if (!root.ok) return root;
  return ok({
    lookups: deps.lookups(sql),
    store: createAgentStore(deps.files, root.value),
  });
}

export function issuesOfError(error: unknown): AgentDefinitionIssue[] {
  const details = (error as { details?: { issues?: AgentDefinitionIssue[] } })
    .details;
  return details?.issues ?? [];
}

// 읽은 agent 하나. lophn은 file이 없어도 agent이고 definition은 null이다.
export type Loaded = {
  agent: AgentId;
  slot: AgentSlot;
  file: AgentFile | null;
  definition: AgentFileDefinition | null;
  issues: AgentDefinitionIssue[];
};

export function loadAgent(
  context: AgentContext,
  agent: AgentId,
): Result<Loaded | null> {
  const slot = agentSlotOf(context.store.root, agent);
  const read = context.store.read(slot);
  if (!read.ok) return read;
  if (read.value === null && !isLophn(agent)) return ok(null);
  // 없는 workspace의 lophn은 없다(파일이 남아 있어도).
  if (isLophn(agent)) {
    const workspace = workspaceOfLophn(agent);
    if (workspace !== null && !context.lookups.workspaceExists(workspace)) {
      return ok(null);
    }
  }
  return ok(parsedAgent(agent, slot, read.value));
}

function parsedAgent(
  agent: AgentId,
  slot: AgentSlot,
  file: AgentFile | null,
): Loaded {
  let definition: AgentFileDefinition | null = null;
  const issues: AgentDefinitionIssue[] = [];
  // lophn은 file이 없어도 기본 정의(handle·name)를 갖는다.
  const text = file?.text ?? (isLophn(agent) ? "" : null);
  if (text !== null) {
    const parsed = parseAgentFile(text, { agent });
    if (parsed.ok) definition = parsed.value;
    else issues.push(...issuesOfError(parsed.error));
  }
  return { agent, slot, file, definition, issues };
}

// 틀린 file은 handle을 알 수 없어 id가 handle이다(주소로는 쓸 수 없고 목록에만 보인다).
export function handleOf(loaded: Loaded): string {
  if (isLophn(loaded.agent)) return LOPHN_AGENT_HANDLE;
  return loaded.definition?.handle ?? loaded.agent;
}

// 보이는 이름이다. 주소가 아니다.
export function nameOf(loaded: Loaded): string {
  if (loaded.definition !== null) return loaded.definition.name;
  return isLophn(loaded.agent) ? LOPHN_AGENT_NAME : loaded.agent;
}

// 범위 없는 agent는 전역이다. lophn의 범위는 id에서 나오고 Home lophn은 null이다.
export function workspaceOfAgent(loaded: Loaded): Workspace | null {
  if (isLophn(loaded.agent)) return workspaceOfLophn(loaded.agent);
  return loaded.definition?.workspace ?? null;
}

function sameWorkspace(a: Workspace | null, b: Workspace | null): boolean {
  return a === null || b === null
    ? a === b
    : a.kind === b.kind && a.id === b.id;
}

// 범위 agent는 그 workspace에서만 보인다. workspace가 null이면 home(전역만)이다. lophn은 자기 workspace에서만 보이고
// Home lophn도 Home에서만 보인다.
export function visibleIn(
  loaded: Loaded,
  workspace: Workspace | null,
): boolean {
  const scope = workspaceOfAgent(loaded);
  if (isLophn(loaded.agent)) return sameWorkspace(scope, workspace);
  return (
    scope === null ||
    (workspace !== null &&
      workspace.kind === scope.kind &&
      workspace.id === scope.id)
  );
}

export function profileOf(loaded: Loaded) {
  if (isLophn(loaded.agent)) return LOPHN_PROFILE;
  return loaded.definition?.profile ?? AGENT_DEFAULT_PROFILE;
}

// workspace마다의 lophn이 앞이고(Home, project, 앱 순) 그 뒤는 `agents/`의 사람이 만든 agent id 순서다.
// 틀린 file도 목록에 남아 issues를 보인다.
export function listAgents(context: AgentContext): Result<Loaded[]> {
  const loaded: Loaded[] = [];
  const ids = [lophnIdOf(null), ...context.lookups.workspaces().map(lophnIdOf)];
  for (const id of ids) {
    const lophn = loadAgent(context, id);
    if (!lophn.ok) return lophn;
    if (lophn.value !== null) loaded.push(lophn.value);
  }
  const stored = context.store.agentIds();
  if (!stored.ok) return stored;
  for (const id of stored.value) {
    const agent = loadAgent(context, id as AgentId);
    if (!agent.ok) return agent;
    if (agent.value !== null) loaded.push(agent.value);
  }
  return ok(loaded);
}

export function effectiveModel(
  context: AgentContext,
  loaded: Loaded,
  workspace: Workspace | null,
): { value: ModelChoice; source: AgentValueLayer } | null {
  const own = loaded.definition?.model;
  if (own !== undefined) return { value: own, source: "agent" };
  const project = context.lookups.projectModel(workspace);
  if (project !== null) return { value: project, source: "project" };
  const global = context.lookups.modelDefault();
  return global === null ? null : { value: global, source: "global" };
}
