import { assert, assertEquals } from "@std/assert";
import type { TestObservationFrame } from "../../../protocol/problems/mod.ts";
import { acceptFrame, emptySides } from "../work/ipc.ts";
import { createEmitter } from "../harness/emit.ts";
import { observeFailurePath, runPlatformChecks } from "../harness/checks.ts";
import { fixtureDriver, type FixtureOmission } from "../testing/app-driver.ts";
import { HASH } from "../fixtures.ts";
import {
  type AppTestInput,
  type AppTestPlan,
  generateAppTestChecks,
  judgeAppTest,
  sdkDependenciesHash,
} from "./mod.ts";

const TEST_HASH = "c".repeat(64);
const BUNDLE = "d".repeat(64);
const SDK = [{ name: "@lophn/cap-problem", version: "1.0.0" }];

type Command = {
  key: string;
  effect: "read" | "write" | "external";
  confirm: boolean;
  revert: { supported: boolean; command?: string };
};

const NO_REVERT = { supported: false };
const COMMANDS: Command[] = [
  { key: "list", effect: "read", confirm: false, revert: NO_REVERT },
  {
    key: "add",
    effect: "write",
    confirm: false,
    revert: { supported: true, command: "undo" },
  },
  { key: "undo", effect: "write", confirm: false, revert: NO_REVERT },
  { key: "push", effect: "external", confirm: false, revert: NO_REVERT },
  { key: "wipe", effect: "write", confirm: true, revert: NO_REVERT },
];

type Shape = {
  commands?: Command[];
  automations?: { key: string; command: string }[];
  permissions?: { kind: string; scope: Record<string, unknown> }[];
  data?: AppTestInput["data"];
};

const FULL: Required<Shape> = {
  commands: COMMANDS,
  automations: [{ key: "daily_push", command: "push" }, {
    key: "refresh",
    command: "list",
  }],
  permissions: [
    { kind: "secret.use", scope: { name: "calendar_token" } },
    { kind: "net.fetch", scope: { host: "api.example.com", port: 443 } },
    { kind: "document.save", scope: { key: "notes" } },
  ],
  data: { schema: 3, previous_schema: 1 },
};

function inputFor(shape: Shape = {}): AppTestInput {
  const value = { ...FULL, ...shape };
  const blueprint = {
    problem_codes: [{
      code: "save_failed",
      message_key: "app-detail.issue.save_failed",
      message: "Saving failed.",
      fixer: "coding_agent",
    }],
    commands: value.commands,
    screens: [],
    sdk_dependencies: SDK,
    automatic_tasks: value.automations.map((task) => ({
      ...task,
      label: task.key,
      when: { kind: "interval", interval_ms: 60000 },
    })),
    permissions: value.permissions.map((item) => ({
      ...item,
      reason: "fixture",
    })),
    app_connections: [],
  } as unknown as AppTestInput["blueprint"];
  return {
    bundle_hash: BUNDLE,
    test_hash: TEST_HASH,
    blueprint,
    blueprint_hash: HASH,
    frozen: {
      blueprint: HASH,
      sdk_dependencies: sdkDependenciesHash(SDK),
      failure_paths: [{ code: "save_failed", test_hash: HASH }],
    },
    fixed_sdk: SDK,
    previous_declarations: null,
    data: value.data,
  };
}

const SOURCE = [{
  path: "app.ts",
  text:
    `import { reportProblem } from "@lophn/cap-problem";\nreportProblem("save_failed");`,
}];

async function run(
  shape: Shape = {},
  omit: readonly FixtureOmission[] = [],
) {
  const plan: AppTestPlan = generateAppTestChecks(inputFor(shape));
  const bytes: Uint8Array[] = [];
  const emitter = createEmitter({
    side: "single",
    test_hash: TEST_HASH,
    write: (frame) => bytes.push(frame),
  });
  const driver = fixtureDriver({
    bundle_hash: BUNDLE,
    commands: plan.harness.commands,
    declared_codes: plan.harness.declared_codes,
    failure_commands: { add: "save_failed" },
    has_view: false,
    omit,
    plan: plan.harness,
  });
  const ran = await runPlatformChecks({
    driver,
    plan: plan.harness,
    emitter,
    sources: SOURCE,
  });
  assert(ran.ok);
  await observeFailurePath({
    driver,
    plan: plan.harness,
    emitter,
    code: "save_failed",
    command: "add",
    command_input: {},
  });
  const sides = emptySides();
  for (const frame of bytes) assert(acceptFrame(sides, frame).ok);
  const frames: TestObservationFrame[] = sides.single.frames;
  return {
    plan,
    frames,
    judgment: judgeAppTest({ plan, test_hash: TEST_HASH, frames }),
  };
}

type Judgment = Awaited<ReturnType<typeof run>>["judgment"];

function check(judgment: Judgment, name: string) {
  const found = judgment.observations.checks.find((item) => item.name === name);
  assert(found, `check ${name}`);
  return found;
}

function failed(judgment: Judgment): string[] {
  return judgment.observations.checks.filter((item) => item.status === "fail")
    .map((item) => item.name);
}

Deno.test("problems/tests#R8: 빈 DB 전체 migration과 이전 schema migration을 각각 돌리고 모두 통과해야 pass다", async () => {
  const both = await run();
  assertEquals(both.judgment.result, "pass");
  assertEquals(check(both.judgment, "migration_empty").status, "pass");
  assertEquals(check(both.judgment, "migration_upgrade").status, "pass");
  assertEquals(
    check(both.judgment, "migration_upgrade").reason.includes("이전 release"),
    true,
  );
  // 한쪽이 실패하면 다른 쪽이 통과해도 test는 통과하지 않는다.
  for (
    const [omit, name, other] of [
      ["migration_empty_fails", "migration_empty", "migration_upgrade"],
      ["migration_upgrade_fails", "migration_upgrade", "migration_empty"],
    ] as const
  ) {
    const result = await run({}, [omit]);
    assertEquals(result.judgment.result, "fail");
    assertEquals(check(result.judgment, name).status, "fail");
    assertEquals(check(result.judgment, other).status, "pass");
    assertEquals(failed(result.judgment), [name]);
  }
});

Deno.test("problems/tests#R8: DB를 쓰지 않는 앱과 첫 release는 이유 있는 not_applicable이고 이를 이유로 필수 검사를 건너뛰지 못한다", async () => {
  const noData = await run({ data: { schema: 0, previous_schema: null } });
  assertEquals(noData.judgment.result, "pass");
  for (const name of ["migration_empty", "migration_upgrade"]) {
    assertEquals(check(noData.judgment, name).status, "not_applicable");
    assert(check(noData.judgment, name).reason.includes("schema 0"));
  }
  const first = await run({ data: { schema: 2, previous_schema: null } });
  assertEquals(check(first.judgment, "migration_empty").status, "pass");
  assertEquals(
    check(first.judgment, "migration_upgrade").status,
    "not_applicable",
  );
  // schema가 있는 앱의 migration 관측을 빼면 fail이다.
  const { plan, frames } = await run();
  const judged = judgeAppTest({
    plan,
    test_hash: TEST_HASH,
    frames: frames.filter((frame) => frame.name !== "migration_upgrade"),
  });
  assertEquals(judged.result, "fail");
  assertEquals(check(judged, "migration_upgrade").status, "fail");
});

Deno.test("problems/tests#R9: 잘못된 입력을 받거나 업무 데이터를 쓰는 read와 grant 없는 접근은 통과하지 못하고 외부 상태 불변은 인접 불변식으로 따로 관측한다", async () => {
  const wrongInput = await run({}, ["read_accepts_invalid_input"]);
  assertEquals(wrongInput.judgment.result, "fail");
  assertEquals(failed(wrongInput.judgment), ["read_contract"]);
  const writes = await run({}, ["read_writes_business_data"]);
  assertEquals(writes.judgment.result, "fail");
  assertEquals(failed(writes.judgment), ["read_contract"]);
  assert(
    check(writes.judgment, "read_contract").reason.includes("업무 데이터"),
  );
  const denied = await run({}, ["permission_denial"]);
  assertEquals(denied.judgment.result, "fail");
  assertEquals(failed(denied.judgment), ["permission_denial"]);
  const external = await run({}, ["read_changes_external_state"]);
  assertEquals(external.judgment.result, "fail");
  assertEquals(
    check(external.judgment, "read_contract").coverage.adjacent_invariants,
    [{ name: "external_state_unchanged", held: false }],
  );
  // read 선언이 없으면 read 검사는 이유 있는 not_applicable이다.
  const noRead = await run({
    commands: COMMANDS.filter((command) => command.effect !== "read"),
    automations: [{ key: "daily_push", command: "push" }],
  });
  assertEquals(
    check(noRead.judgment, "read_contract").status,
    "not_applicable",
  );
});

Deno.test("problems/tests#R9: confirm command를 automation으로 선언하거나 실행하면 통과하지 못한다", async () => {
  const declared = await run({
    automations: [...FULL.automations, { key: "wipe_daily", command: "wipe" }],
  });
  assertEquals(declared.judgment.result, "fail");
  assertEquals(failed(declared.judgment), ["automation_scope"]);
  assert(
    check(declared.judgment, "automation_scope").reason.includes("confirm"),
  );
  const executed = await run({}, ["confirm_automation_allowed"]);
  assertEquals(executed.judgment.result, "fail");
  assertEquals(failed(executed.judgment), ["automation_scope"]);
});

Deno.test("problems/tests#R9: grant된 secret 대역의 가져오기·쓰기·동기화와 한 번 승인한 external automation은 허용하고 승인 없이 돌거나 승인 뒤에도 막히면 통과하지 못한다", async () => {
  const allowed = await run();
  assertEquals(allowed.judgment.result, "pass");
  assertEquals(check(allowed.judgment, "secret_grant").status, "pass");
  assertEquals(check(allowed.judgment, "automation_scope").status, "pass");
  for (
    const [omit, name] of [
      ["secret_needs_approval", "secret_grant"],
      ["secret_blocked_for_automation", "secret_grant"],
      ["secret_not_granted", "secret_grant"],
      ["external_automation_without_approval", "automation_scope"],
      ["external_automation_blocked", "automation_scope"],
    ] as const
  ) {
    const result = await run({}, [omit]);
    assertEquals(result.judgment.result, "fail", omit);
    assertEquals(failed(result.judgment), [name], omit);
  }
  // 출력 schema는 필수 검사로 만들지 않는다.
  assertEquals(
    allowed.plan.checks.filter((item) => /output|schema/.test(item.name))
      .length,
    0,
  );
});

Deno.test("problems/tests#R15: net·secret·문서 쓰기는 고정 대역에만 닿고 실제 외부 host 접속이나 선언하지 않은 목적지는 통과하지 못한다", async () => {
  const fixed = await run();
  assertEquals(check(fixed.judgment, "adapter_isolation").status, "pass");
  const real = await run({}, ["real_host_contact"]);
  assertEquals(real.judgment.result, "fail");
  assertEquals(failed(real.judgment), ["adapter_isolation"]);
  assert(
    check(real.judgment, "adapter_isolation").reason.includes("실제 외부"),
  );
  const stray = await run({}, ["undeclared_double_target"]);
  assertEquals(failed(stray.judgment), ["adapter_isolation"]);
  assertEquals(
    check(stray.judgment, "adapter_isolation").coverage.adjacent_invariants,
    [{ name: "doubles_received_declared_targets_only", held: false }],
  );
  const none = await run({
    commands: COMMANDS.filter((command) =>
      command.effect === "read" || command.effect === "write"
    ),
    automations: [],
    permissions: [],
  });
  assertEquals(
    check(none.judgment, "adapter_isolation").status,
    "not_applicable",
  );
});

Deno.test("problems/tests#R12: observations는 검사한 고정 기준·입력 범위와 인접 불변식을 별도 항목으로 구별한다", async () => {
  const { judgment, plan, frames } = await run();
  for (const item of judgment.observations.checks) {
    assert(item.coverage.criteria.length > 0, item.name);
    assert(item.coverage.input_range.trim() !== "", item.name);
  }
  const read = check(judgment, "read_contract").coverage;
  assertEquals(read.criteria.length, 2);
  assertEquals(read.adjacent_invariants, [{
    name: "external_state_unchanged",
    held: true,
  }]);
  // migration은 업무 정확성을 증명하지 않는다고 범위에 적는다.
  assert(
    check(judgment, "migration_empty").coverage.input_range.includes(
      "업무 정확성은 증명하지 않는다",
    ),
  );
  // 고정 기준은 runner 설치 자료에서 오고 frame이 바꾸지 못한다.
  const forged = frames.map((frame) =>
    frame.name === "read_contract"
      ? {
        ...frame,
        actual: {
          ...(frame.actual as object),
          criteria: ["아무거나"],
          input_range: "전부",
        },
      }
      : frame
  );
  const same = judgeAppTest({ plan, test_hash: TEST_HASH, frames: forged });
  assertEquals(
    check(same, "read_contract").coverage.criteria,
    read.criteria,
  );
  assertEquals(
    check(same, "read_contract").coverage.input_range,
    read.input_range,
  );
  // 인접 불변식이 깨지면 고정 기준을 만족해도 통과가 아니다.
  const broken = frames.map((frame) =>
    frame.name === "read_contract"
      ? {
        ...frame,
        actual: {
          ...(frame.actual as object),
          adjacent: [{ name: "external_state_unchanged", held: false }],
        },
      }
      : frame
  );
  const judged = judgeAppTest({ plan, test_hash: TEST_HASH, frames: broken });
  assertEquals(check(judged, "read_contract").status, "fail");
});

Deno.test("apps/blueprint#R21 problems/tests#R9: 되돌리기를 지원하는 write는 변경 → 되돌림 → 원래 상태, 후속 변경 뒤 conflict, 중복 거절을 검사한다", async () => {
  const pass = await run();
  for (
    const name of ["revert_restore", "revert_conflict", "revert_duplicate"]
  ) {
    assertEquals(check(pass.judgment, name).status, "pass", name);
  }
  for (
    const [omit, name] of [
      ["revert_does_not_restore", "revert_restore"],
      ["revert_ignores_later_change", "revert_conflict"],
      ["revert_twice_accepted", "revert_duplicate"],
    ] as const
  ) {
    const result = await run({}, [omit]);
    assertEquals(result.judgment.result, "fail", omit);
    assert(failed(result.judgment).includes(name), omit);
    assertEquals(check(result.judgment, name).status, "fail");
  }
  // 되돌리기를 지원하는 write가 없으면 이유 있는 not_applicable이다.
  const none = await run({
    commands: COMMANDS.map((command) => ({ ...command, revert: NO_REVERT })),
  });
  for (
    const name of ["revert_restore", "revert_conflict", "revert_duplicate"]
  ) {
    assertEquals(check(none.judgment, name).status, "not_applicable");
  }
});
