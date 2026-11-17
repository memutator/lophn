import { err, ok, type Result } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { assignmentPorts, type AssignmentState } from "../assignment/mod.ts";
import {
  type AssignmentEntry,
  shareRequestDecide,
  shareRequestOpen,
} from "../../../protocol/approvals/mod.ts";
import type { AgentId } from "../../../protocol/lophn-agent/workspaces.ts";
import type { CommandDefinition, Tx } from "../../../protocol/server/mod.ts";
import { afterCommit } from "../../storage/ledger/after-commit.ts";
import { loadShare, type ShareRow } from "./rows.ts";
import {
  SHARE_CODING_TOPIC,
  SHARE_REQUEST_TOPIC,
  type ShareCodingData,
  shareLookupPort,
} from "./ports.ts";

type Event =
  | { type: "ShareRequestOpened"; app: string; app_name: string }
  | { type: "ShareRequestClosed"; app: string; outcome: "approve" | "reject" };

// 남지 않는 event를 commit 뒤 Bus로 내는 topic이다. 데이터는 Bus event 모양 그대로다.
function push(tx: Pick<Tx, "port" | "now">, event: Event): void {
  const { type, ...payload } = event;
  tx.port(afterCommit).push(SHARE_REQUEST_TOPIC, {
    type,
    subject: event.app,
    at: tx.now(),
    payload,
  });
}

// 승인의 효과: 받을 agent마다 할당 쓰기 길로 앱을 더하고, coding agent 몫은 commit 뒤로 넘긴다.
// 이미 있는 줄과 그 줄의 뺀 command는 그대로다. decide와 activation 동의가 같이 쓴다.
// 할당은 agent 정의 파일이라 ledger tx가 되돌리지 못한다. 한 agent에서 실패하면 앞서 쓴 agent의 할당을 이전 줄로
// 되돌린다: 요청은 열린 채인데 첫 agent만 그 앱의 tool을 쓰게 되면 사람이 본 결과와 권한이 어긋난다.
function applyApproval(
  tx: Pick<Tx, "port" | "now">,
  appId: string,
  waiting: ShareRow,
): Result<void> {
  const app = tx.port(shareLookupPort).app(appId);
  if (app === null) {
    return err({ code: "not_found", message: "app not found" });
  }
  const assignments = tx.port(assignmentPorts);
  // 쓰기 전에 모두 읽어 둔다. 못 읽는 agent가 있으면 아무것도 쓰지 않는다.
  const states: (AssignmentState & { agent: AgentId })[] = [];
  for (const agent of waiting.agents) {
    const state = assignments.get(agent);
    if (!state.ok) return state;
    states.push({ agent, ...state.value });
  }
  const written: {
    agent: AgentId;
    before: AssignmentEntry[];
    revision: number;
  }[] = [];
  for (const { agent, assignment, revision } of states) {
    const { entries } = assignment;
    if (entries.some((entry) => entry.app === appId)) continue;
    const set = assignments.set(
      agent,
      [...entries, { app: appId, removed_tools: [] }],
      revision,
    );
    if (!set.ok) {
      for (const done of written.reverse()) {
        assignments.set(done.agent, done.before, done.revision);
      }
      return set;
    }
    written.push({ agent, before: entries, revision: set.value.revision });
  }
  if (waiting.coding_agents) {
    const data: ShareCodingData = { slug: app.slug };
    tx.port(afterCommit).push(SHARE_CODING_TOPIC, data);
  }
  return ok(undefined);
}

// activation 동의가 같이 승인하는 길. 사람이 동의 화면에서 본 요청(requested_at)과 지금 열린 요청이 같을 때만 승인한다:
// 그 사이 새 요청이 대신했으면 사람이 보지 못한 내용이라 conflict다.
export function approveShareWithConsent(
  tx: Pick<Tx, "sql" | "port" | "now">,
  app: string,
  requestedAt: string,
): Result<void> {
  const waiting = loadShare(tx.sql, app);
  if (waiting === null || waiting.requested_at !== requestedAt) {
    return err({
      code: "conflict",
      message: "the share request is already decided or replaced",
    });
  }
  const applied = applyApproval(tx, app, waiting);
  if (!applied.ok) return applied;
  tx.sql.run("delete from share_requests where app = ?", [app]);
  push(tx, { type: "ShareRequestClosed", app, outcome: "approve" });
  return ok(undefined);
}

// 앱을 지우면 그 앱의 열린 공유 요청도 닫는다(거절과 같은 알림이라 열린 대기 목록에서 빠진다).
export function eraseShareRequest(
  tx: Pick<Tx, "sql" | "port" | "now">,
  app: string,
): void {
  if (loadShare(tx.sql, app) === null) return;
  tx.sql.run("delete from share_requests where app = ?", [app]);
  push(tx, { type: "ShareRequestClosed", app, outcome: "reject" });
}

export function createShareRequestCommands(): {
  open: CommandDefinition<typeof shareRequestOpen>;
  decide: CommandDefinition<typeof shareRequestDecide>;
} {
  return {
    // 앱 workspace의 agent만 연다. 앱은 credential이 고정한 앱이다. 같은 앱의 열린 요청이 있으면 새 요청이 대신한다.
    // 여기서는 어느 agent 정의도 바꾸지 않는다: 바꾸는 것은 사람의 승인(decide)뿐이다.
    open: {
      route: shareRequestOpen,
      handle(tx, ctx, input) {
        const actor = parseActor(ctx.actor);
        if (actor?.kind !== "agent") {
          return err({
            code: "forbidden",
            message: "only an agent opens a share request",
          });
        }
        const app = ctx.conditions.app;
        if (app === undefined) {
          return err({
            code: "forbidden",
            message: "only a session in an app's workspace shares that app",
          });
        }
        const lookup = tx.port(shareLookupPort);
        const found = lookup.app(app);
        if (found === null) {
          return err({ code: "not_found", message: "app not found" });
        }
        const agents = [...new Set(input.agents)];
        for (const agent of agents) {
          if (lookup.agent(agent) === null) {
            return err({
              code: "invalid_input",
              message: `agent ${agent} not found`,
            });
          }
        }
        const session = actor.id;
        const at = tx.now();
        tx.sql.run(
          `insert into share_requests (app, agents, coding_agents, reason, session, requested_at)
           values (?, ?, ?, ?, ?, ?)
           on conflict (app) do update set agents = excluded.agents,
             coding_agents = excluded.coding_agents, reason = excluded.reason,
             session = excluded.session, requested_at = excluded.requested_at`,
          [
            app,
            JSON.stringify(agents),
            input.coding_agents ? 1 : 0,
            input.reason,
            session,
            at,
          ],
        );
        push(tx, { type: "ShareRequestOpened", app, app_name: found.name });
        return ok({ app, requested_at: at });
      },
    },
    // 사람만 정한다. route의 actors가 같은 경계를 먼저 막고, 여기서 한 번 더 본다.
    // 승인하면 agent마다 할당 쓰기 길(assignmentPorts)로 앱을 더한다. 이미 있는 줄과 그 줄의 뺀 command는 그대로다.
    decide: {
      route: shareRequestDecide,
      handle(tx, ctx, input, compare) {
        if (parseActor(ctx.actor)?.kind !== "user") {
          return err({
            code: "forbidden",
            message: "only the user decides a share request",
          });
        }
        const waiting = loadShare(tx.sql, input.app);
        if (waiting === null || waiting.requested_at !== compare.requested_at) {
          return err({
            code: "conflict",
            message: "the share request is already decided or replaced",
          });
        }
        if (input.choice === "approve") {
          const applied = applyApproval(tx, input.app, waiting);
          if (!applied.ok) return applied;
        }
        tx.sql.run("delete from share_requests where app = ?", [input.app]);
        push(tx, {
          type: "ShareRequestClosed",
          app: input.app,
          outcome: input.choice,
        });
        return ok({ app: input.app, outcome: input.choice });
      },
    },
  };
}
