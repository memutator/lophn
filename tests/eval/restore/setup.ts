// 시나리오 `setup`이 `SetupContext`를 받아 부르는 helper다.
import { agentGrantsSet } from "../../../packages/protocol/approvals/mod.ts";
import { settingsUpdate } from "../../../packages/protocol/config/mod.ts";
import { ticketList } from "../../../packages/protocol/coding-agent/ticket/mod.ts";
import {
  observeViewError,
  problemList,
} from "../../../packages/protocol/problems/mod.ts";
import { openSession, say, waitTurnEnd } from "../../support/core/human.ts";
import { lastToolResult } from "../../support/fake-server/probe.ts";
import type { Participant, SetupContext } from "../types.ts";
import { agentRefOf } from "./mod.ts";

// `to`로 부르는 길을 닫는다.
export async function excludeCall(
  ctx: SetupContext,
  from: Participant,
  to: Participant,
): Promise<void> {
  await ctx.core.call(agentGrantsSet, {
    agent: agentRefOf(ctx.world, from),
    entries: [{
      kind: "agent",
      agent: agentRefOf(ctx.world, to),
      setting: "excluded",
    }],
  });
}

function appOf(ctx: SetupContext, app: string) {
  const id = ctx.world.apps[app];
  if (id === undefined) throw new Error(`app ${app} is not restored`);
  return id;
}

// 앱 process 없이 shell main이 하는 접수를 대신 불러 problem을 연다.
export async function openProblem(
  ctx: SetupContext,
  app: string,
): Promise<{ problem: string }> {
  const { core } = ctx;
  const id = appOf(ctx, app);
  // 기본(open)이면 Project Manager session이 열려 fake 대본을 쓴다.
  await core.call(settingsUpdate, {
    changes: [{
      key: "reactions.problem_opened",
      action: "set",
      value: "off",
    }],
  });
  const reportId = core.ids.newId("rpt");
  const accepted = await core.call(observeViewError, {
    view: {
      view_session: "eval-view",
      generation: 0,
      app: id,
      release: null,
      mode: "live",
      bundle_hash: "0".repeat(64),
    },
    observation: {
      report_id: reportId,
      observed_at: new Date().toISOString(),
      observation: "render_error",
      error: {
        name: "EvalViewError",
        message: `boom ${reportId}`,
        message_missing_reason: null,
        stack: null,
        stack_missing_reason: { reason: "view" },
      },
      error_missing_reason: null,
      invocation: null,
    },
  });
  if (accepted.problem === null) throw new Error("no problem was opened");
  const listed = await core.call(problemList, { app: id });
  if (!listed.problems.some((p) => p.id === accepted.problem)) {
    throw new Error("the opened problem is not listed");
  }
  return { problem: accepted.problem };
}

// ticket은 앱의 App Engineer만 만든다. fake 대본으로 그가 `ticket_create`를 부르게 한다.
export async function openTicket(
  ctx: SetupContext,
  app: string,
  goal: string,
): Promise<{ ticket: string }> {
  const { core, fake } = ctx;
  const id = appOf(ctx, app);
  fake.reset();
  fake.script([
    {
      reply: {
        kind: "tool",
        calls: [{
          id: "t_ticket",
          name: "ticket_create",
          arguments: JSON.stringify({
            app: id,
            goal,
            check: { kind: "text", text: "the goal is met" },
          }),
        }],
      },
    },
    { reply: { kind: "text", text: "done" } },
  ]);
  const session = await openSession(core, { role: "app_engineer", app: id });
  await say(core, session, `App ${id}: open a ticket`);
  await waitTurnEnd(core, session);
  const listed = await core.call(ticketList, { app: id, state: "open" });
  const ticket = listed.tickets.find((t) => t.title === goal.split("\n")[0]);
  if (ticket === undefined) {
    throw new Error(
      `ticket was not opened: ${
        fake.journal().map((entry) => lastToolResult(entry)).at(-1)
      }`,
    );
  }
  return { ticket: ticket.id };
}
