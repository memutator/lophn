import { err, ok } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { agentGrantsGet, agentKey } from "../../../protocol/approvals/mod.ts";
import { agentRefOfColumns } from "../../../protocol/lophn-agent/places.ts";
import type { ReadDefinition } from "../../../protocol/server/mod.ts";
import { loadAgentGrant } from "./store.ts";

export const agentGrantsGetRead: ReadDefinition<typeof agentGrantsGet> = {
  route: agentGrantsGet,
  handle(snapshot, ctx, input) {
    const actor = parseActor(ctx.actor);
    // agent는 자기 grant만 읽는다. session이 정체성을 쥐고 있어 session 행에서 자기 ref를 만든다.
    if (actor?.kind === "agent") {
      const row = snapshot.sql.get(
        "select role, project, operator from sessions where id = ?",
        [actor.id],
      );
      const own = row === undefined ? undefined : agentRefOfColumns({
        role: String(row["role"]) as never,
        project: row["project"] === null ? null : String(row["project"]),
        // Role 합집합에 app_engineer가 남아 있는 동안 ref 변환이 요구하는 열 자리다.
        app: null,
        operator: row["operator"] === null ? null : String(row["operator"]),
      });
      if (own === undefined || agentKey(own) !== agentKey(input.agent)) {
        return err({
          code: "forbidden",
          message: "an agent reads only its own grant",
        });
      }
    }
    const grant = loadAgentGrant(snapshot.sql, input.agent);
    if (!grant.ok) return grant;
    return ok({
      grant: grant.value,
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    });
  },
};
