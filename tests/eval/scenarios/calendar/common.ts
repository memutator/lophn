// 캘린더 단위 시나리오가 같이 쓰는 참가자, setup, 공용 check 조각, fixture helper. 시나리오가 아니라 runner가 읽지 않는다.
import type { Id } from "../../../../packages/protocol/base/mod.ts";
import { operatorCreate } from "../../../../packages/protocol/lophn-agent/mod.ts";
import { agentGrantsSet } from "../../../../packages/protocol/approvals/mod.ts";
import { callApi, liveCheck } from "../../checks/app/mod.ts";
import { findApp } from "../../checks/app/mod.ts";
import { toolCount } from "../../checks/mod.ts";
import type { FxStep } from "../../checks/mod.ts";
import {
  codingAgent,
  type Participant,
  type ProgramCheck,
  type SetupContext,
} from "../../types.ts";
import { nextWeekTuesdays } from "./dates.ts";
import { APP, OPERATOR } from "./spec.ts";

export const LOPHN: Participant = { role: "lophn" };
export const AE: Participant = { role: "app_engineer", place: { app: APP } };
export const CODING = codingAgent(APP);
export const OP: Participant = {
  role: "operator",
  name: OPERATOR,
  place: { app: APP },
};

// calendar-app@1에는 Operator가 없으므로 setup에서 제품 route로 만든다. model은 runner가 붙인다.
export async function createCalendarOperator(ctx: SetupContext): Promise<void> {
  const id = ctx.core.ids.newId("agt") as Id<"agt">;
  const app = ctx.world.apps[APP]!;
  await ctx.core.call(operatorCreate, {
    id,
    place: { kind: "app", id: app },
    definition: {
      name: OPERATOR,
      body: `${APP} 앱의 app-api로 일정을 넣고 보여 준다.`,
    },
  });
  await ctx.core.call(agentGrantsSet, {
    agent: { role: "operator", agent: id },
    entries: [{ kind: "app", app, apis: [] }],
  });
  ctx.world.operators[OPERATOR] = id;
}

// calendar-mvp와 calendar-maintain: App Engineer가 ticket을 만들고 verify했다.
export function aeTicketChecks(): ProgramCheck[] {
  return [
    toolCount("ae-ticket-created", {
      tool: "ticket.create",
      count: { min: 1 },
    }),
    toolCount("ae-ticket-verified", {
      tool: "ticket.verify",
      count: { min: 1 },
      success: true,
    }),
  ];
}

// calendar-api: 다음 주 화요일 15:00 치과 일정이 들어 있다. 날짜는 trial 시작 시각으로 계산한다.
export const eventInCalendar: ProgramCheck = liveCheck(
  "event-in-calendar",
  async (core, trial) => {
    const app = await findApp(core, APP);
    const outcome = await callApi(core, app.id, "event.list", { range: "all" });
    if (outcome.status !== "succeeded") {
      return { pass: false, reason: `event.list ${outcome.status}` };
    }
    const days = nextWeekTuesdays(new Date(trial.started_at));
    const want = days.map((d) => `${d}T15:00`);
    const rows =
      (outcome.result as { rows?: { title?: string; start?: string }[] })
        .rows ?? [];
    const hit = rows.some((r) =>
      r.title?.includes("치과") === true && want.includes(r.start ?? "")
    );
    return {
      pass: hit,
      reason: hit
        ? `치과 일정이 ${want.join(" 또는 ")}에 있음`
        : `치과 ${want.join(" 또는 ")} 일정이 없음 (일정 ${rows.length}건)`,
    };
  },
);

// ---- fixture helper ----

export const ticketCreate = (goal: string): FxStep => ({
  tool: "ticket.create",
  effect: "write",
  input: {
    app: `app_fx_${APP}`,
    goal,
    check: { kind: "text", text: "fixture check" },
  },
  output: { status: "success", content: { ticket: "tkt_fx" } },
});

export const ticketVerify = (): FxStep => ({
  tool: "ticket.verify",
  effect: "write",
  input: { ticket: "tkt_fx" },
  output: { status: "success", content: { ticket: "tkt_fx" } },
});

export const problemGet = (): FxStep => ({ tool: "problem.get" });
