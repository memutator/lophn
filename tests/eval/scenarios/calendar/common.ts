// 캘린더 단위 시나리오가 같이 쓰는 참가자, setup, 공용 check 조각, fixture helper. 시나리오가 아니라 runner가 읽지 않는다.
// 새 앱 단위(calendar-user, calendar-dev, calendar-maintain)는 App Engineer가 직접 설계하고 짓는다: DESIGN.md를 쓰고, test하고, release를 준비해 preview로 보고, 켠다.
import type { Id } from "../../../../packages/protocol/base/mod.ts";
import { operatorCreate } from "../../../../packages/protocol/lophn-agent/mod.ts";
import { agentAssignmentSet } from "../../../../packages/protocol/approvals/mod.ts";
import {
  appActive,
  appDesignInput,
  appEngineerCalls,
  askedAgainInput,
  callApi,
  cardCoveredInput,
  DESIGN_SECTIONS,
  designFirst,
  findApp,
  liveCheck,
  reuseChecks,
} from "../../checks/app/mod.ts";
import { fixtureSession, fixtureTrial, type FxStep } from "../../checks/mod.ts";
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

// ---- 기록 check ----

const indexOfTool = (calls: { call: { tool: string } }[], tool: string) =>
  calls.findIndex((c) => c.call.tool === tool);

// 성공한 tool call만 센다. 첫 release.prepare 앞에 deno test나 check를 돌렸나.
const aeTested: ProgramCheck = {
  kind: "program",
  id: "ae-tested",
  run({ trial }) {
    const calls = appEngineerCalls(trial, APP).filter((c) =>
      c.call.outcome?.kind === "success"
    );
    const prepare = indexOfTool(calls, "release.prepare");
    if (prepare === -1) {
      return { pass: false, reason: "release.prepare가 없음" };
    }
    const ran = calls.slice(0, prepare).some((c) =>
      c.call.tool === "shell.run" &&
      /\bdeno\s+(task\s+)?(test|check)\b/.test(
        String((c.input as { command?: unknown } | null)?.command ?? ""),
      )
    );
    return {
      pass: ran,
      reason: ran
        ? "release.prepare 앞에 deno test나 check를 돌림"
        : "release.prepare 앞에 deno test나 check를 돌리지 않음",
    };
  },
};

// 첫 release.activate 앞에 preview.start, preview.call, preview.stop이 이 순서로 있나.
const aePreviewed: ProgramCheck = {
  kind: "program",
  id: "ae-previewed",
  run({ trial }) {
    const calls = appEngineerCalls(trial, APP).filter((c) =>
      c.call.outcome?.kind === "success"
    );
    const activate = indexOfTool(calls, "release.activate");
    if (activate === -1) {
      return { pass: false, reason: "release.activate가 없음" };
    }
    const before = calls.slice(0, activate);
    const start = indexOfTool(before, "preview.start");
    const call = before.findIndex((c, i) =>
      i > start && c.call.tool === "preview.call"
    );
    const stop = before.findIndex((c, i) =>
      i > call && c.call.tool === "preview.stop"
    );
    const pass = start !== -1 && call !== -1 && stop !== -1;
    return {
      pass,
      reason: pass
        ? "release.activate 앞에 preview.start, call, stop 순서로 있음"
        : "release.activate 앞에 preview.start, preview.call, preview.stop 순서가 없음",
    };
  },
};

// Router가 coding_agent로 가는 call을 거절한다. App Engineer가 직접 짓는다. outcome과 상관없이 센다.
const noCodingCall: ProgramCheck = {
  kind: "program",
  id: "no-coding-call",
  run({ trial }) {
    const n =
      appEngineerCalls(trial, APP).filter((c) =>
        c.call.tool === "call" &&
        (c.input as { to?: { role?: unknown } } | null)?.to?.role ===
          "coding_agent"
      ).length;
    return {
      pass: n === 0,
      reason: n === 0
        ? "coding_agent로 call을 보내지 않음"
        : `coding_agent로 call ${n}번`,
    };
  },
};

export function aeFlowChecks(): ProgramCheck[] {
  return [
    designFirst("design-first", { app: APP }),
    aeTested,
    aePreviewed,
    noCodingCall,
  ];
}

// ---- fixture helper ----

// 일곱 절 DESIGN.md를 쓰는 step. sections를 줄여 빠진 절을 만든다.
export function fxDesign(
  purpose: string,
  sections: readonly string[] = DESIGN_SECTIONS,
): FxStep {
  const body = sections.map((name) =>
    `## ${name}\n${name === "Purpose" ? purpose : "fixture"}\n`
  ).join("\n");
  return {
    tool: "file.write",
    effect: "write",
    input: { path: "DESIGN.md", content: `# ${APP}\n\n${body}` },
  };
}

const TEST: FxStep = {
  tool: "shell.run",
  effect: "external",
  input: { command: "deno task test" },
};
const PREPARE: FxStep = { tool: "release.prepare", effect: "write" };
const PREVIEW: FxStep[] = [
  { tool: "preview.start", effect: "write" },
  { tool: "preview.call", effect: "write" },
  { tool: "preview.stop", effect: "write" },
];
const ACTIVATE: FxStep = { tool: "release.activate", effect: "write" };

// App Engineer가 설계하고, test하고, release를 준비해 preview로 보고, 켜는 흐름.
export function aeFlowSteps(purpose: string): FxStep[] {
  return [fxDesign(purpose), TEST, PREPARE, ...PREVIEW, ACTIVATE];
}

// 사람이 App Engineer에게 직접 말하는 새 앱 단위(calendar-user, calendar-dev)의 fixture. purpose는 시나리오의 글 그대로다.
export function buildAppFixtures(purpose: string): Scenario["fixtures"] {
  const flow = aeFlowSteps(purpose);
  const wrong = (steps: FxStep[], fails: string[]) => ({
    trial: fixtureTrial([fixtureSession(AE, steps)]),
    fails,
  });
  return {
    right: [fixtureTrial([fixtureSession(AE, flow)])],
    wrong: [
      wrong(
        [TEST, PREPARE, fxDesign(purpose), ...PREVIEW, ACTIVATE],
        ["design-first"],
      ),
      wrong(
        [
          fxDesign(
            purpose,
            DESIGN_SECTIONS.filter((s) => s !== "Screens"),
          ),
          ...flow.slice(1),
        ],
        ["design-first"],
      ),
      wrong([fxDesign(purpose), PREPARE, ACTIVATE], [
        "ae-tested",
        "ae-previewed",
      ]),
      wrong([
        ...flow,
        {
          tool: "call",
          effect: "read",
          outcome: "failure",
          code: "invalid_input",
          input: {
            to: { role: "coding_agent", place: { app: APP } },
            reply: "conversation",
            body: purpose,
          },
        },
      ], ["no-coding-call"]),
    ],
  };
}

// 사람이 App Engineer에게 직접 말하는 새 앱 단위의 check. 고정된 tool 이름이나 입출력에 기대지 않는다.
// 순서: 기록 check, 읽기만 하는 live check, judge. judge의 premise는 앞 check다.
export function buildAppChecks(card: string, request: string): Check[] {
  return [
    ...aeFlowChecks(),
    appActive("app-active", { app: APP }),
    ...reuseChecks(REUSE),
    {
      kind: "judge",
      id: "card-covered",
      premise: ["app-active"],
      criterion: "card-covered@4",
      input: cardCoveredInput(card, APP),
    },
    {
      kind: "judge",
      id: "asked-again",
      premise: ["design-first"],
      criterion: "asked-again@3",
      input: askedAgainInput(request),
    },
    {
      kind: "judge",
      id: "app-design",
      premise: ["app-active"],
      criterion: "app-design@2",
      input: appDesignInput(card, APP),
    },
  ];
}
