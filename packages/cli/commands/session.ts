// `lophn session list`: call을 보낼 수 있는 열린 session을 읽는다. 자기 session과 새 입력을 받지 않는 session은 Router가 이미 뺐다.
// `--on <컴퓨터>`는 그 컴퓨터에서 부를 수 있는 session이다(이 컴퓨터의 mail이 거기서 연 session). route의 actor가 agent뿐이라
// binary(사람)에서는 forbidden이다.
import { z } from "zod";
import { ok } from "../../base/mod.ts";
import { agentCallSendable } from "../../protocol/lophn-agent/calls.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { machinesSessions } from "../../protocol/lophn-agent/a2a.ts";
import { defineCommand } from "./types.ts";

const list = defineCommand({
  name: "session.list",
  summary: "List the open sessions you can send a call to",
  description:
    "List the open sessions you can send a call to (session ID, agent handle and name, title, workspace, state: running, waiting for a human, or idle, last activity time). " +
    "--on <computer> lists the sessions you can call on another computer of the person: the ones calls from this computer opened there.",
  input: z.strictObject({ on: z.string().min(1).optional() }),
  effect: "read",
  routes: [agentCallSendable, machinesSessions],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    if (input.on !== undefined) {
      const read = await ctx.core.read(machinesSessions, {
        machine: input.on,
      });
      if (!read.ok) return read;
      const { machine, sessions } = read.value;
      return ok({
        summary: `${sessions.length} sessions can be called on ${machine.name}`,
        content: { machine, sessions },
        arrayKeys: ["sessions"],
      });
    }
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
