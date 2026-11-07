// `lophn app share`: 이 앱을 다른 agent(와 coding agent)에게 할당해 달라고 사람에게 청한다.
// 할당은 사람이 대기 목록에서 승인해야 생긴다. 이 명령은 요청만 연다: agent 정의를 바꾸지 않는다.
// 그 앱의 activation 동의가 기다리는 중이면 사람이 동의를 허락할 때 같이 승인된다(요청은 따로 줄을 서지 않는다).
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import { shareRequestOpen } from "../../protocol/approvals/mod.ts";
import {
  agentList,
  agentHandleKey,
  agentHandleSchema,
} from "../../protocol/lophn-agent/mod.ts";
import { defineCommand } from "./types.ts";

const share = defineCommand({
  name: "app.share",
  summary: "Ask the person to share this app with other agents",
  description:
    "Ask the person to assign this app to other agents (--agent <handle>, repeatable) and/or to coding agents in terminals (--coding-agents). " +
    "Only the app's own public skills and public commands are given. This opens a request; nothing changes until the person approves it. If this app's activation is waiting for the person's consent (before or after this command), the request is shown on that consent and approved with it, so there is no second prompt; otherwise it is its own entry in the waiting list, so tell the person. " +
    "A new request for this app replaces the open one.",
  input: z.strictObject({
    agent: z.array(agentHandleSchema).default([]),
    coding_agents: z.boolean().optional(),
    reason: z.string().max(200).optional(),
  }),
  effect: "write",
  routes: [agentList, shareRequestOpen],
  workspaces: ["app"],
  run: async (input, ctx) => {
    const listed = await ctx.core.read(agentList, {});
    if (!listed.ok) return listed;
    const ids = [];
    for (const handle of input.agent) {
      const key = agentHandleKey(handle);
      const row = listed.value.agents.find(
        (entry) => agentHandleKey(entry.handle) === key,
      );
      if (row === undefined) {
        return err({
          code: "not_found",
          message: `agent ${handle} not found`,
        });
      }
      ids.push(row.agent);
    }
    const opened = await ctx.core.command(
      shareRequestOpen,
      {
        agents: ids,
        coding_agents: input.coding_agents === true,
        reason: input.reason ?? "",
      },
      { key: ctx.key },
    );
    if (!opened.ok) return opened;
    return ok({
      summary:
        "opened a share request; the person approves it with the activation consent if one is waiting, otherwise in the waiting list",
      content: opened.value,
    });
  },
});

export const APP_SHARE_COMMANDS = [share];
