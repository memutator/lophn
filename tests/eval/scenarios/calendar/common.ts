// 캘린더 단위 시나리오가 같이 쓰는 참가자, setup, 공용 check 조각, fixture helper. 시나리오가 아니라 runner가 읽지 않는다.
import type { Id } from "../../../../packages/protocol/base/mod.ts";
import { operatorCreate } from "../../../../packages/protocol/lophn-agent/mod.ts";
import { agentAssignmentSet } from "../../../../packages/protocol/approvals/mod.ts";
import {
  appActive,
  appDesignInput,
  askedAgainInput,
  callApi,
  findApp,
  liveCheck,
  reuseChecks,
} from "../../checks/app/mod.ts";
import { fixtureSession, fixtureTrial } from "../../checks/mod.ts";
import {
  type Check,
  type Participant,
  type ProgramCheck,
  type Scenario,
  type SetupContext,
} from "../../types.ts";
import { nextWeekTuesdays } from "./dates.ts";
import { APP, OPERATOR, REUSE } from "./spec.ts";

export const LOPHN: Participant = { role: "lophn" };
// 앱의 일은 앱 그릇의 App Engineer가 한다.
export const AE: Participant = { role: "app_engineer", place: { app: APP } };
export const OP: Participant = {
  role: "operator",
  name: OPERATOR,
  place: { app: APP },
};

// calendar-app@2에는 Operator가 없으므로 setup에서 제품 route로 만든다. model은 runner가 붙인다.
// Operator가 앱 그릇에 놓여 그 앱의 domain을 맡으므로 비공개 tool도 받는다.
export async function createCalendarOperator(ctx: SetupContext): Promise<void> {
  const id = ctx.core.ids.newId("agt") as Id<"agt">;
  const app = ctx.world.apps[APP]!;
  await ctx.core.call(operatorCreate, {
    id,
    place: { kind: "app", id: app },
    definition: {
      name: OPERATOR,
      body: `${APP} 앱의 tool로 일정을 넣고 보여 준다.`,
    },
  });
  // 새 Operator는 할당 줄이 없어 revision이 0이다.
  await ctx.core.call(agentAssignmentSet, {
    agent: { role: "operator", agent: id },
    entries: [{ app, removed_tools: [] }],
  }, { revision: 0 });
  ctx.world.operators[OPERATOR] = id;
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

// 사람이 App Engineer에게 직접 말하는 새 앱 단위(calendar-user, calendar-dev)의 fixture. 인자는 부르는 곳의 글을 남기려고 둔다.
export function buildAppFixtures(_goal: string): Scenario["fixtures"] {
  return { right: [fixtureTrial([fixtureSession(AE, [])])], wrong: [] };
}

// 사람이 App Engineer에게 직접 말하는 새 앱 단위의 check. 고정된 tool 이름이나 입출력에 기대지 않는다.
// 판정은 화면과 카드를 본다. judge는 premise인 app-active 뒤다.
export function buildAppChecks(card: string, request: string): Check[] {
  return [
    appActive("app-active", { app: APP }),
    ...reuseChecks(REUSE),
    {
      kind: "judge",
      id: "asked-again",
      premise: ["app-active"],
      criterion: "asked-again@3",
      input: askedAgainInput(request),
    },
    {
      kind: "judge",
      id: "app-design",
      premise: ["app-active"],
      criterion: "app-design@1",
      input: appDesignInput(card, APP),
    },
  ];
}
