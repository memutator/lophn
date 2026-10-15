import { ok } from "../../../base/mod.ts";
import { agentGrantsGet } from "../../../protocol/approvals/mod.ts";
import type { ReadDefinition } from "../../../protocol/server/mod.ts";
import { loadAgentGrant } from "./store.ts";

export const agentGrantsGetRead: ReadDefinition<typeof agentGrantsGet> = {
  route: agentGrantsGet,
  handle(snapshot, _ctx, input) {
    const grant = loadAgentGrant(snapshot.sql, input.agent);
    if (!grant.ok) return grant;
    return ok({
      grant: grant.value,
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    });
  },
};
