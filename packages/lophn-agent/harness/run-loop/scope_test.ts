import { assert, assertEquals } from "@std/assert";
import {
  type AgentAppScope,
  agentAppScopeSchema,
  type AgentRole,
} from "../../../contracts/lophn-agent/mod.ts";
import {
  type AppOffer,
  computeAgentAppScope,
  type OfferedCommand,
  type ScopeInput,
} from "./scope.ts";
import { runId } from "./testing/runs.ts";

// StartRun이 싣는 AgentAppScope 계산 테스트(lophn-agent/roles/common#R11,
// lophn-agent/roles/app-engineer#R21). 선언 ∩ 사람 허락 안에서 역할이 받을 범위만
// 나오고 상한을 넓히지 않는다.

const ASG = runId("asg", 1);
const APP_A = runId("app", 1);
const APP_B = runId("app", 2);
const APP_C = runId("app", 3);

const COMMANDS: OfferedCommand[] = [
  { key: "list", effect: "read", confirm: false, revert_supported: false },
  { key: "ask", effect: "read", confirm: true, revert_supported: false },
  { key: "save", effect: "write", confirm: false, revert_supported: true },
  { key: "wipe", effect: "write", confirm: true, revert_supported: false },
  { key: "send", effect: "external", confirm: true, revert_supported: false },
];

const OFFERS: AppOffer[] = [
  {
    app: APP_B,
    commands: [COMMANDS[0]!],
    granted: ["list"],
  },
  {
    app: APP_A,
    commands: COMMANDS,
    // ghost는 앱이 선언하지 않은 command다.
    granted: ["send", "list", "wipe", "save", "ask", "ghost"],
  },
  // 사람이 agent 사용을 허락하지 않은 앱.
  { app: APP_C, commands: COMMANDS, granted: [] },
];

function scope(
  role: AgentRole,
  overrides: Partial<ScopeInput> = {},
): AgentAppScope {
  const computed = computeAgentAppScope({
    role,
    assignment: ASG,
    work: { kind: "all", id: null },
    read_apps: [],
    read_commands: [],
    offers: OFFERS,
    ...overrides,
  });
  assert(computed.ok, computed.ok ? undefined : computed.error.message);
  // 계산 결과는 contract의 상한 모양을 그대로 통과한다.
  assert(agentAppScopeSchema.safeParse(computed.value).success);
  return computed.value;
}

Deno.test("lophn-agent/roles/common#R11: lophn은 사람이 agent 사용을 허락한 앱의 선언된 command만 받고 허락 없는 앱은 없다", () => {
  const result = scope("lophn");
  assertEquals(result.role, "lophn");
  assertEquals(result.assignment, ASG);
  assertEquals(result.apps, [
    {
      app: APP_A,
      commands: ["ask", "list", "save", "send", "wipe"],
      effects: ["read", "write", "external"],
      revert_required: false,
      confirm_allowed: true,
    },
    {
      app: APP_B,
      commands: ["list"],
      effects: ["read"],
      revert_required: false,
      confirm_allowed: true,
    },
  ]);
  // 허락이 하나도 없으면 앱이 없다. 회수한 grant를 선언이 되살리지 않는다.
  assertEquals(
    scope("lophn", {
      offers: OFFERS.map((offer) => ({ ...offer, granted: [] })),
    }).apps,
    [],
  );
  // 같은 입력은 순서와 관계없이 같은 범위다.
  assertEquals(
    scope("lophn", { offers: [...OFFERS].reverse() }),
    scope("lophn"),
  );
});

Deno.test("lophn-agent/roles/app-engineer#R21: App Engineer는 담당 앱의 read와 되돌릴 수 있는 write만 받고 external·복원 불가 write와 다른 앱은 받지 않는다", () => {
  const own = scope("app_engineer", { work: { kind: "app", id: APP_A } });
  assertEquals(own.apps, [{
    app: APP_A,
    commands: ["ask", "list", "save"],
    effects: ["read", "write"],
    revert_required: true,
    confirm_allowed: true,
  }]);
  // 다른 앱의 AE는 자기 앱만 본다.
  assertEquals(
    scope("app_engineer", { work: { kind: "app", id: APP_B } }).apps.map((
      entry,
    ) => entry.app),
    [APP_B],
  );
  // read만 있으면 되돌리기 조건이 붙지 않는다.
  assertEquals(
    scope("app_engineer", { work: { kind: "app", id: APP_B } }).apps[0]
      ?.revert_required,
    false,
  );
  // 담당 앱이 없는 자리(전역·project)는 앱 command가 없다.
  assertEquals(
    scope("app_engineer", { work: { kind: "project", id: runId("prj", 1) } })
      .apps,
    [],
  );
  // 허락한 write가 되돌릴 수 없는 것뿐이면 write는 한 줄도 없다.
  assertEquals(
    scope("app_engineer", {
      work: { kind: "app", id: APP_A },
      offers: [{ app: APP_A, commands: COMMANDS, granted: ["wipe", "send"] }],
    }).apps,
    [],
  );
});

Deno.test("lophn-agent/roles/common#R11: Operator는 assignment에 승인된 read만 받고 confirm·write·external은 받지 않으며 Context Engineer는 앱 command가 없다", () => {
  const operator = scope("operator", {
    read_apps: [APP_A, APP_C],
    read_commands: [
      { app: APP_A, command: "list" },
      // 승인 목록에 있어도 confirm 선언이나 write는 사람 없이 못 부른다.
      { app: APP_A, command: "ask" },
      { app: APP_A, command: "save" },
      { app: APP_C, command: "list" },
      { app: APP_B, command: "list" },
    ],
  });
  assertEquals(operator.apps, [{
    app: APP_A,
    commands: ["list"],
    effects: ["read"],
    revert_required: false,
    confirm_allowed: false,
  }]);
  // 승인한 앱이 아니면(B는 read_apps 밖) 허락이 있어도 없다. 허락 없는 C도 없다.
  assertEquals(operator.apps.map((entry) => entry.app), [APP_A]);
  // 승인한 command가 없으면 앱이 없다.
  assertEquals(scope("operator", { read_apps: [APP_A] }).apps, []);
  // Context Engineer는 허락·선언과 관계없이 실행 범위가 비어 있다.
  assertEquals(scope("context_engineer").apps, []);
  assertEquals(
    scope("context_engineer", { work: { kind: "app", id: APP_A } }).apps,
    [],
  );
});
