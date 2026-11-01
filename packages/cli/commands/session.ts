// `lophn session list`: call을 보낼 수 있는 열린 session을 읽는다. 자기 session과 새 입력을 받지 않는 session은 Router가 이미 뺐다.
// route의 actor가 agent뿐이라 binary(사람)에서는 forbidden이다.
import { z } from "zod";
import { ok } from "../../base/mod.ts";
import { agentCallSendable } from "../../protocol/lophn-agent/calls.ts";
import { PLACE_KINDS } from "../../protocol/lophn-agent/places.ts";
import { defineCommand } from "./types.ts";

const list = defineCommand({
  name: "session.list",
  summary: "List the open sessions you can send a call to",
  description:
    "List the open sessions you can send a call to (ID, agent, name, place, state).",
  input: z.strictObject({}),
  effect: "read",
  routes: [agentCallSendable],
  places: PLACE_KINDS,
  run: async (_input, ctx) => {
    const read = await ctx.core.read(agentCallSendable, {});
    if (!read.ok) return read;
    const { sessions } = read.value;
    return ok({
      summary: `${sessions.length} sessions can be called`,
      content: { sessions },
      arrayKeys: ["sessions"],
    });
  },
});

export const SESSION_COMMANDS = [list];
