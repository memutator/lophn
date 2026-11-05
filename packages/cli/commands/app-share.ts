// `lophn app share`: 이 앱을 다른 agent(와 coding agent)에게 할당해 달라고 사람에게 청한다.
// 할당은 사람이 대기 목록에서 승인해야 생긴다. 이 명령은 요청만 연다: agent 정의를 바꾸지 않는다.
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import { shareRequestOpen } from "../../protocol/approvals/mod.ts";
import {
  agentList,
  agentNameKey,
  agentNameSchema,
} from "../../protocol/lophn-agent/mod.ts";
import { defineCommand } from "./types.ts";

const share = defineCommand({
  name: "app.share",
  summary: "Ask the person to share this app with other agents",
  description:
    "Ask the person to assign this app to other agents (--agent <name>, repeatable) and/or to coding agents in terminals (--coding-agents). " +
    "Only the app's own public skills and public commands are given. This opens a request in the waiting list; nothing changes until the person approves it, so tell them. " +
    "A new request for this app replaces the open one.",
  input: z.strictObject({
    agent: z.array(agentNameSchema).default([]),
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
    for (const name of input.agent) {
      const key = agentNameKey(name);
      const row = listed.value.agents.find(
        (entry) => agentNameKey(entry.name) === key,
      );
      if (row === undefined) {
        return err({ code: "not_found", message: `agent ${name} not found` });
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
        "opened a share request; the person approves it in the waiting list",
      content: opened.value,
    });
  },
});

export const APP_SHARE_COMMANDS = [share];
