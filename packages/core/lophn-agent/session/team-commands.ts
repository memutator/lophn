import { ok } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { teamEnd } from "../../../protocol/lophn-agent/team.ts";
import type { CommandDefinition } from "../../../protocol/server/mod.ts";
import { endSession } from "../workspaces/lifecycle.ts";
import type { EndDeps } from "../workspaces/ports.ts";
import { reject, sessionNotFound } from "./guards.ts";
import { loadSession, nextSessionSeq } from "./model.ts";

// 규칙 3. agent는 자기 엄격한 자손만 끝낸다. 대상과 그 밑의 열린 session을 잎부터 archive처럼 닫는다.
// 사람의 ArchiveSession은 그대로 두고 자식을 따라 닫지 않는다.
export function createTeamEnd(
  deps: EndDeps,
): CommandDefinition<typeof teamEnd> {
  return {
    route: teamEnd,
    handle(tx, ctx, input) {
      const actor = parseActor(ctx.actor);
      if (actor?.kind !== "agent") {
        return reject("forbidden", "only an agent session ends its members");
      }
      const target = loadSession(tx, input.session);
      if (target === undefined) return sessionNotFound();
      const above = tx.sql.get(
        `with recursive up(id, parent) as (
           select id, spawned_by from sessions where id = ?
           union all
           select s.id, s.spawned_by from sessions s join up on s.id = up.parent
         ) select 1 as found from up where id = ? and id != ?`,
        [target.id, actor.id, target.id],
      );
      if (above === undefined) {
        return reject("forbidden", "you can end only the members under you");
      }
      const open = tx.sql.all(
        `with recursive down(id, depth) as (
           select ?, 0
           union all
           select s.id, down.depth + 1 from sessions s join down on s.spawned_by = down.id
         ) select d.id as id from down d join sessions s on s.id = d.id
           where s.lifecycle = 'open' order by d.depth desc`,
        [target.id],
      );
      const ended: Id<"ses">[] = [];
      for (const { id } of open) {
        const row = loadSession(tx, String(id))!;
        tx.sql.run(
          "update sessions set lifecycle = 'archived', state_seq = ? where id = ?",
          [nextSessionSeq(tx), row.id],
        );
        const done = endSession(tx, deps, row, "archived");
        if (!done.ok) return done;
        ended.push(row.id as Id<"ses">);
      }
      return ok({ ended });
    },
  };
}
