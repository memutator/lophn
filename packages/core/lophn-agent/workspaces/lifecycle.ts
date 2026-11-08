import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  type AgentId,
  isHarnessRuntime,
  isLophn,
  type Workspace,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import {
  type AgentSessionRow,
  loadSession,
  nextSessionSeq,
  workspaceOf,
} from "../session/model.ts";
import { harnessEnabledIn } from "../session/harness.ts";
import type { EndDeps, OpenDeps, WorkspaceDeps } from "./ports.ts";
import type { TeamLimits } from "../../../protocol/lophn-agent/team.ts";

// session을 열고 끝내는 규칙. command(`OpenSession`, `ArchiveSession`, `DeleteSession`)와 Router의
// SessionDirectory가 같이 쓴다.

function fail<T = never>(
  code: "not_found" | "conflict" | "invalid_input",
  message: string,
): Result<T> {
  return err({ code, message });
}

// workspace(project나 앱)가 지금 session을 열 수 있는 곳인지. 없거나 보관됐으면 conflict다.
function workspaceUsable(
  deps: WorkspaceDeps,
  workspace: Workspace,
): Result<void> {
  const info =
    workspace.kind === "project"
      ? deps.projects.project(workspace.id as Id<"prj">)
      : deps.apps.app(workspace.id as Id<"app">);
  if (info === null) return fail("conflict", "the workspace does not exist");
  if (info.archived) return fail("conflict", "the workspace is archived");
  return ok(undefined);
}

// parent가 새 자식을 열어도 팀이 상한 안인지. core는 desk를 모르므로 root(조상 중 spawned_by가 없는 session) 아래 열린 자손 수로 센다.
// 부모가 지워져 끊긴 사슬은 남은 가장 위가 root다.
export function checkSpawnSlot(
  tx: Tx,
  parent: Id<"ses">,
  limits: TeamLimits,
): Result<void> {
  const top = tx.sql.get(
    `with recursive up(id, parent, depth) as (
       select id, spawned_by, 0 from sessions where id = ?
       union all
       select s.id, s.spawned_by, up.depth + 1 from sessions s join up on s.id = up.parent
     ) select id, depth from up order by depth desc limit 1`,
    [parent],
  );
  if (top === undefined) return fail("not_found", "session not found");
  // root가 0이고 새 자식은 부모보다 한 칸 아래다.
  if (Number(top["depth"]) + 1 > limits.max_depth) {
    return fail(
      "conflict",
      "the team is too deep for another member; do the work yourself or ask your parent",
    );
  }
  const members = tx.sql.get(
    `with recursive down(id) as (
       select id from sessions where spawned_by = ?
       union all
       select s.id from sessions s join down on s.spawned_by = down.id
     ) select count(*) as n from sessions where id in (select id from down) and lifecycle = 'open'`,
    [top["id"]],
  );
  if (Number(members?.["n"]) >= limits.max_members) {
    return fail(
      "conflict",
      "the team is full; do the work yourself or ask your parent",
    );
  }
  return ok(undefined);
}

export function startSession(
  tx: Tx,
  deps: OpenDeps,
  input: {
    id: string;
    agent: AgentId;
    workspace: Workspace | null;
    // 다른 workspace의 session이 불러 열었으면 그 workspace.
    calledFrom?: Workspace | null;
    // `team spawn`이 열었으면 연 session.
    spawnedBy?: Id<"ses"> | null;
    // fork는 출처의 제목, model 선택, 출처 표시를 이어받는다. skip은 가져가지 않는다:
    // 새 session은 정의의 기본값으로 시작한다(workspace-session의 fork가 허락을 가져가지 않는 것과 같은 이유).
    inherit?: {
      title: string | null;
      model_selection: string | null;
      forked_from: { session: string; through_seq: bigint } | null;
    };
  },
): Result<AgentSessionRow> {
  const definition = deps.agents.agent(input.agent);
  if (definition === null) return fail("not_found", "agent not found");
  // 범위 agent는 그 workspace에서만 열린다. 밖에서는 없는 agent다. lophn은 Home lophn도 Home에서만 열린다.
  const scope = definition.workspace;
  const inScope =
    scope === null || input.workspace === null
      ? scope === input.workspace
      : input.workspace.kind === scope.kind && input.workspace.id === scope.id;
  if ((scope !== null || isLophn(input.agent)) && !inScope) {
    return fail("not_found", "agent not found");
  }
  // harness runtime의 session은 열 때 그 harness로 정해 바뀌지 않는다. 설정이 꺼져 있으면 열지 않는다.
  const harness = isHarnessRuntime(definition.runtime)
    ? definition.runtime
    : null;
  if (harness !== null && !harnessEnabledIn(tx.sql)) {
    return err({ code: "unavailable", message: "harness is turned off" });
  }
  const workspace = input.workspace;
  if (workspace !== null) {
    const usable = workspaceUsable(deps, workspace);
    if (!usable.ok) return usable;
  }
  const seq = nextSessionSeq(tx);
  const kind = workspace?.kind ?? null;
  const id = workspace?.id ?? null;
  const inherit = input.inherit;
  tx.sql.run(
    `insert into sessions (id, agent, project, app, workspace_kind,
       workspace_id, title, lifecycle, forked_from_session, forked_from_through_seq,
       model_selection, skip, harness, called_from_kind, called_from_id, spawned_by, created_seq, state_seq)
     values (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.agent,
      kind === "project" ? id : null,
      kind === "app" ? id : null,
      kind,
      id,
      inherit?.title ?? null,
      inherit?.forked_from?.session ?? null,
      inherit?.forked_from?.through_seq ?? null,
      inherit?.model_selection ?? null,
      definition.skip ? 1 : 0,
      harness,
      input.calledFrom?.kind ?? null,
      input.calledFrom?.id ?? null,
      input.spawnedBy ?? null,
      seq,
      seq,
    ],
  );
  const row = loadSession(tx, input.id)!;
  deps.publish({
    session: row.id as Id<"ses">,
    type: "SessionStarted",
    at: tx.now(),
    payload: {
      agent: row.agent,
      workspace: workspaceOf(row),
      revived: false,
    },
  });
  return ok(row);
}

// archive와 지움이 묶는 영향이다. 모두 같은 tx 안이다. 보낸 call의 답은 받은 session에만 남으므로 하지 않는다.
export function endSession(
  tx: Tx,
  deps: EndDeps,
  session: AgentSessionRow,
  reason: "archived" | "deleted",
): Result<void> {
  const id = session.id as Id<"ses">;
  const interrupted = deps.interruptRunningTurns(tx, id);
  if (!interrupted.ok) return interrupted;
  const failed = deps.effects.failReceivedCalls(tx, id);
  if (!failed.ok) return failed;
  const cancelled = deps.effects.cancelPendingRequests(tx, id);
  if (!cancelled.ok) return cancelled;
  deps.clearQueue(tx, id);
  deps.publish(tx, {
    session: id,
    type: "SessionEnded",
    at: tx.now(),
    payload: { reason },
  });
  return ok(undefined);
}
