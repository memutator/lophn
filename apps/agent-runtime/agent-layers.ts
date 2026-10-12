import { err, ok, type Result } from "../../packages/base/mod.ts";
import { contextListRoute } from "../../packages/contracts/documents/mod.ts";
import {
  type AgentIssue,
  type AgentPlace,
  type AgentSettings,
  agentsRead,
  type McpTool,
  modelDefaultsRead,
  placeAgentSettingsRead,
  type ResolvedAgent,
  resolvedAgentSchema,
  runBody,
  runRead,
  sessionRead,
  type SessionRecord,
} from "../../packages/contracts/lophn-agent/mod.ts";
import {
  productEnvironment,
  resolveAgent,
} from "../../packages/lophn-agent/agents/mod.ts";
import { workspaceModels } from "../../packages/lophn-agent/harness/model/mod.ts";
import { type CoreCall, readOf } from "./core-call.ts";

// run을 준비할 때 resolved agent를 만드는 길이다(lophn-agent/agents R25~R27). 층은 core의 읽기 route로
// 모은다: Workspace(역할별 기본 model), 자리 설정, 정의 파일, 자리의 active context. 정의 파일은 core가
// 읽어 검사한 값이고 runtime은 파일을 직접 열지 않는다. 합치는 규칙은 agents의 resolveAgent다.

type RunRecord = {
  id: string;
  session: string | null;
  source: { kind: string; sender_run?: string };
};

type AssignmentRecord = {
  id: string;
  role: ResolvedAgent["role"];
  scope: { kind: string; id: string | null };
};

// 시작할 수 없는 이유. 영구히 없는 필수 설정·대상이라 run을 이유와 함께 끝낸다(run-loop R5).
export type CannotStart = {
  reason: "configuration_unavailable" | "target_unavailable";
  why: "model_required" | "agent_invalid" | "agent_missing" | "no_place";
};

export type RunAgent =
  | { kind: "resolved"; agent: ResolvedAgent }
  | ({ kind: "cannot_start" } & CannotStart);

const MAX_HANDOFF_DEPTH = 8;
const MAX_CONTEXT_PAGES = 50;

function cannot(reason: CannotStart["reason"], why: CannotStart["why"]) {
  return ok<RunAgent>({ kind: "cannot_start", reason, why });
}

function placeOfScope(
  scope: AssignmentRecord["scope"],
): AgentPlace | null {
  return (scope.kind === "project" || scope.kind === "app") &&
      scope.id !== null
    ? { kind: scope.kind, id: scope.id } as AgentPlace
    : null;
}

// built-in agent의 자리는 session의 작업 자리다(R27). session 없는 run(handoff로 받은 일)은 보낸 run의
// 자리를 따른다. Operator는 assignment의 scope다.
// session은 run이 속한 session의 기록이다(run.session이 null이면 null).
export async function placeOfRun(
  machine: CoreCall,
  run: RunRecord,
  assignment: AssignmentRecord,
  session: SessionRecord | null,
  depth = 0,
): Promise<Result<AgentPlace | null>> {
  if (assignment.role === "operator") {
    return ok(placeOfScope(assignment.scope));
  }
  if (session !== null) return ok(session.work_place);
  if (
    run.source.kind === "handoff" && run.source.sender_run !== undefined &&
    depth < MAX_HANDOFF_DEPTH
  ) {
    const sender = await readOf(machine, runRead, {
      run: run.source.sender_run,
    });
    if (!sender.ok) return sender;
    // 보낸 run의 session은 자리만 알려 주고 model 선택은 받는 run의 것이 아니다.
    const sentFrom = sender.value.run.session === null
      ? null
      : await readOf(machine, sessionRead, {
        session: sender.value.run.session,
      });
    if (sentFrom !== null && !sentFrom.ok) return sentFrom;
    return await placeOfRun(
      machine,
      sender.value.run,
      assignment,
      sentFrom === null ? null : sentFrom.value.session,
      depth + 1,
    );
  }
  return ok(placeOfScope(assignment.scope));
}

// 이 자리의 agent가 읽을 active context다. project 자리는 그 project의 context 전부이고, App Engineer가 앱
// 자리에서 열리면 그 앱을 app-data source로 읽는 context 전부다(`context.list`의 app 거르기). 그 밖의 앱
// 자리는 context 자료가 없다.
async function activeContexts(
  machine: CoreCall,
  place: AgentPlace,
  role: ResolvedAgent["role"],
): Promise<Result<string[]>> {
  const filter = place.kind === "project"
    ? { project: place.id }
    : role === "app_engineer"
    ? { app: place.id }
    : null;
  if (filter === null) return ok([]);
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_CONTEXT_PAGES; page += 1) {
    const listed = await readOf(machine, contextListRoute, {
      ...filter,
      status: "active",
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!listed.ok) return listed;
    for (const context of listed.value.contexts) {
      if (context.status === "active") ids.push(context.id);
    }
    if (listed.value.next_cursor === null) return ok(ids);
    cursor = listed.value.next_cursor;
  }
  return err({ code: "unavailable", message: "the context list is too long" });
}

function issueFields(error: { details?: unknown }): string[] {
  const issues = (error.details as { issues?: AgentIssue[] } | undefined)
    ?.issues;
  return (issues ?? []).map((issue) => issue.field);
}

// 새 run의 resolved agent를 만든다. 읽지 못한 것(core 연결 실패)은 오류이고, 정의가 틀렸거나 model이 어느
// 층에도 없는 것은 시작할 수 없는 run이다.
export async function resolveRunAgent(
  machine: CoreCall,
  input: {
    run: RunRecord;
    assignment: AssignmentRecord;
    skills: readonly string[];
    // 연결할 수 있는 MCP tool이다. 정의가 서버를 통째로 끈 이름을 먼저 알려 그 서버는 연결하지 않게 한다
    // (extensions R18, R31). 어느 tool을 켜는지는 resolve가 정한다.
    mcp(
      off: ReadonlySet<string>,
      place: AgentPlace,
    ): Promise<readonly McpTool[]>;
  },
): Promise<Result<RunAgent>> {
  const { run, assignment } = input;
  // 이 run의 session이 고른 model은 가장 높은 층이다(R27). run을 준비하는 지금 읽은 값이 이 run에 고정되고,
  // 그 뒤에 바뀐 선택은 다음 run부터 쓴다.
  const sessionRecord = run.session === null
    ? null
    : await readOf(machine, sessionRead, { session: run.session });
  if (sessionRecord !== null && !sessionRecord.ok) return sessionRecord;
  const session = sessionRecord === null ? null : sessionRecord.value.session;
  const found = await placeOfRun(machine, run, assignment, session);
  if (!found.ok) return found;
  const place = found.value;
  if (place === null) return cannot("target_unavailable", "no_place");

  const read = await readOf(machine, agentsRead, {
    place,
    assignment: assignment.id,
  });
  if (!read.ok) {
    return read.error.code === "not_found"
      ? cannot("target_unavailable", "agent_missing")
      : read;
  }
  if (read.value.issues.length > 0) {
    return cannot("configuration_unavailable", "agent_invalid");
  }

  const placed = await readOf(machine, placeAgentSettingsRead, { place });
  if (!placed.ok) {
    return placed.error.code === "invalid_input"
      ? cannot("configuration_unavailable", "agent_invalid")
      : placed.error.code === "not_found"
      ? cannot("target_unavailable", "agent_missing")
      : placed;
  }

  const defaults = await readOf(machine, modelDefaultsRead, {});
  if (!defaults.ok) return defaults;
  const workspace: AgentSettings = {
    models: workspaceModels(defaults.value.defaults),
  };

  const contexts = await activeContexts(machine, place, assignment.role);
  if (!contexts.ok) return contexts;

  const serversOff = new Set(
    (read.value.definition?.mcp_off ?? [])
      .filter((entry) => entry.original_tool === undefined)
      .map((entry) => entry.server_name),
  );
  const mcp = await input.mcp(serversOff, place);

  const resolved = await resolveAgent({
    assignment: assignment.id,
    role: assignment.role,
    place,
    definition: read.value.definition,
    workspace,
    place_settings: placed.value.settings,
    session_model: session?.model_selection ?? null,
    environment: productEnvironment(assignment.role, {
      skills: input.skills,
      mcp,
      active_contexts: contexts.value,
    }),
  });
  if (resolved.ok) {
    return ok({ kind: "resolved", agent: resolved.value });
  }
  if (resolved.error.code === "not_found") {
    return cannot("target_unavailable", "agent_missing");
  }
  if (resolved.error.code === "invalid_input") {
    return issueFields(resolved.error).includes("model")
      ? cannot("configuration_unavailable", "model_required")
      : cannot("configuration_unavailable", "agent_invalid");
  }
  return resolved;
}

// 이어 하기는 run 기준이 고정한 resolved agent를 그대로 쓴다(R26). 정의·설정·Workspace는 다시 읽지 않는다.
// `contexts`는 같은 run 기준이 싣은 선언 검색 정의의 판들(`tools.contexts`)이다. 모양은 쓰는 쪽이 검사한다.
export async function pinnedRun(
  machine: CoreCall,
  run: string,
  assignment: string,
): Promise<Result<{ agent: ResolvedAgent; contexts: unknown }>> {
  const unreadable = () =>
    err({
      code: "unavailable" as const,
      message: "the fixed agent of the run is unreadable",
    });
  const basis = await readOf(machine, runBody, { kind: "run_basis", id: run });
  if (!basis.ok) return basis;
  const fixed = basis.value.value as
    | { agent?: { hash?: string }; tools?: { contexts?: unknown } }
    | null;
  if (fixed?.agent?.hash === undefined) return unreadable();
  const body = await readOf(machine, runBody, { kind: "run_agent", id: run });
  if (!body.ok) return body;
  const parsed = resolvedAgentSchema.safeParse(body.value.value);
  if (
    !parsed.success || parsed.data.hash !== fixed.agent.hash ||
    parsed.data.assignment !== assignment
  ) return unreadable();
  return ok({ agent: parsed.data, contexts: fixed.tools?.contexts });
}

export async function pinnedRunAgent(
  machine: CoreCall,
  run: string,
  assignment: string,
): Promise<Result<ResolvedAgent>> {
  const pinned = await pinnedRun(machine, run, assignment);
  return pinned.ok ? ok(pinned.value.agent) : pinned;
}
