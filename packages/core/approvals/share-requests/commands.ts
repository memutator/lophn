import { err, ok } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { assignmentPorts } from "../assignment/mod.ts";
import {
  shareRequestDecide,
  shareRequestOpen,
} from "../../../protocol/approvals/mod.ts";
import type { CommandDefinition, Tx } from "../../../protocol/server/mod.ts";
import { afterCommit } from "../../storage/ledger/after-commit.ts";
import { loadShare } from "./rows.ts";
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

export function createShareRequestCommands(): {
  open: CommandDefinition<typeof shareRequestOpen>;
  decide: CommandDefinition<typeof shareRequestDecide>;
} {
  return {
    // 앱 place의 agent만 연다. 앱은 credential이 고정한 앱이다. 같은 앱의 열린 요청이 있으면 새 요청이 대신한다.
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
            message: "only a session in an app's place shares that app",
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
          const app = tx.port(shareLookupPort).app(input.app);
          if (app === null) {
            return err({ code: "not_found", message: "app not found" });
          }
          const assignments = tx.port(assignmentPorts);
          for (const agent of waiting.agents) {
            const state = assignments.get(agent);
            if (!state.ok) return state;
            const { entries } = state.value.assignment;
            if (entries.some((entry) => entry.app === input.app)) continue;
            const written = assignments.set(
              agent,
              [...entries, { app: input.app, removed_tools: [] }],
              state.value.revision,
            );
            if (!written.ok) return written;
          }
          if (waiting.coding_agents) {
            const data: ShareCodingData = { slug: app.slug };
            tx.port(afterCommit).push(SHARE_CODING_TOPIC, data);
          }
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
