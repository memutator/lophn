import { ok, type Result } from "../../../base/mod.ts";
import {
  type AgentDefinitionIssue,
  type AgentId,
  LOPHN_AGENT_ID,
  LOPHN_AGENT_NAME,
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
  if (read.value === null && agent !== LOPHN_AGENT_ID) return ok(null);
  return ok(parsedAgent(agent, slot, read.value));
}

function parsedAgent(
  agent: AgentId,
  slot: AgentSlot,
  file: AgentFile | null,
): Loaded {
  let definition: AgentFileDefinition | null = null;
  const issues: AgentDefinitionIssue[] = [];
  if (file !== null) {
    const parsed = parseAgentFile(file.text, { agent });
    if (parsed.ok) definition = parsed.value;
    else issues.push(...issuesOfError(parsed.error));
  }
  return { agent, slot, file, definition, issues };
}

export function nameOf(loaded: Loaded): string {
  if (loaded.agent === LOPHN_AGENT_ID) return LOPHN_AGENT_NAME;
  return loaded.definition?.name ?? loaded.agent;
}

export function profileOf(loaded: Loaded) {
  if (loaded.agent === LOPHN_AGENT_ID) return LOPHN_PROFILE;
  return loaded.definition?.profile ?? AGENT_DEFAULT_PROFILE;
}

// lophn이 첫 줄이고 그 뒤는 `agents/`의 id 순서다. 틀린 file도 목록에 남아 issues를 보인다.
export function listAgents(context: AgentContext): Result<Loaded[]> {
  const loaded: Loaded[] = [];
  const lophn = loadAgent(context, LOPHN_AGENT_ID);
  if (!lophn.ok) return lophn;
  if (lophn.value !== null) loaded.push(lophn.value);
  const ids = context.store.agentIds();
  if (!ids.ok) return ids;
  for (const id of ids.value) {
    const agent = loadAgent(context, id as AgentId);
    if (!agent.ok) return agent;
    if (agent.value !== null) loaded.push(agent.value);
  }
  return ok(loaded);
}
