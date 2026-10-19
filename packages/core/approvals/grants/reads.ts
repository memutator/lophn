import { err, ok } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { agentGrantsGet, agentKey } from "../../../protocol/approvals/mod.ts";
import type { ReadDefinition } from "../../../protocol/server/mod.ts";
import { AgentOfSession } from "./ports.ts";
import { loadAgentGrant } from "./store.ts";

export const agentGrantsGetRead: ReadDefinition<typeof agentGrantsGet> = {
  route: agentGrantsGet,
  handle(snapshot, ctx, input) {
    const actor = parseActor(ctx.actor);
    // agent는 자기 grant만 읽는다. 자기 ref는 session을 가진 lophn-agent가 port로 푼다.
    if (actor?.kind === "agent") {
      const own = snapshot.port(AgentOfSession).agentOf(actor.id);
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
