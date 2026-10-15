import { err, ok } from "../../../base/mod.ts";
import { agentGrantsSet } from "../../../protocol/approvals/mod.ts";
import type { CommandDefinition } from "../../../protocol/server/mod.ts";
import { saveAgentGrant } from "./store.ts";

// agent와 앱은 자기 grant를 넓히지 못한다. route의 actors가 같은 경계를 먼저 막고, 여기서 한 번 더 본다.
export const agentGrantsSetCommand: CommandDefinition<typeof agentGrantsSet> = {
  route: agentGrantsSet,
  handle(tx, ctx, input) {
    if (ctx.actor !== "user") {
      return err({
        code: "forbidden",
        message: "only the user changes an agent grant",
      });
    }
    saveAgentGrant(tx, input.agent, input.entries);
    return ok({ grant: { agent: input.agent, entries: input.entries } });
  },
};
