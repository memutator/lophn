// 켤 때 claim이 남은 coding session을 모두 정산하는 command. 살아 있는 session이 없는 기동 때 core 안
// machine만 쓴다. 보고 없이 끝난 session은 같은 tx에서 `CodingSessionEndedUnreported`가 남는다.
import { z } from "zod";
import { err, ok } from "../../../base/mod.ts";
import { defineCommand } from "../../../protocol/base/mod.ts";
import { TicketSessionEnd } from "../../../protocol/coding-agent/ticket/mod.ts";
import type { CommandDefinition } from "../../../protocol/server/mod.ts";

const ticketSettleAll = defineCommand({
  resource: "tickets",
  method: "settle_all",
  name: "SettleTicketSessions",
  input: z.strictObject({}),
  output: z.object({ settled: z.number().int() }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["forbidden", "unavailable", "internal"],
});

export const settleTicketSessionsCommand: CommandDefinition<
  typeof ticketSettleAll
> = {
  route: ticketSettleAll,
  handle(tx, ctx) {
    if (ctx.actor !== "machine") {
      return err({ code: "forbidden", message: "only core settles sessions" });
    }
    const settled = tx.port(TicketSessionEnd).settleAll();
    return settled.ok ? ok({ settled: settled.value }) : settled;
  },
};
