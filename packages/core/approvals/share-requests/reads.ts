import { ok } from "../../../base/mod.ts";
import {
  type ShareRequest,
  shareRequestList,
} from "../../../protocol/approvals/mod.ts";
import type { ReadDefinition } from "../../../protocol/server/mod.ts";
import { allShares } from "./rows.ts";
import { shareLookupPort } from "./ports.ts";

export const shareRequestListRead: ReadDefinition<typeof shareRequestList> = {
  route: shareRequestList,
  handle(snapshot) {
    const lookup = snapshot.port(shareLookupPort);
    const requests: ShareRequest[] = [];
    for (const row of allShares(snapshot.sql)) {
      const app = lookup.app(row.app);
      if (app === null) continue;
      requests.push({
        app: row.app as ShareRequest["app"],
        app_name: app.name,
        // 지워진 agent는 id가 이름이다.
        agents: row.agents.map((id) => ({
          id,
          name: lookup.agent(id) ?? id,
        })),
        coding_agents: row.coding_agents,
        reason: row.reason,
        session: row.session as ShareRequest["session"],
        public_skills: app.public_skills,
        public_commands: app.public_commands,
        requested_at: row.requested_at,
      });
    }
    return ok({
      requests,
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    });
  },
};
