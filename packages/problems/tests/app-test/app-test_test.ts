import { assert, assertEquals, assertFalse } from "@std/assert";
import { fileURLToPath } from "node:url";
import type {
  FrozenTest,
  ProblemCodeDeclaration,
  TestObservationFrame,
} from "../../../contracts/problems/mod.ts";
import { acceptFrame, emptySides } from "../work/ipc.ts";
import { canonicalHash, canonicalJson } from "../canonical.ts";
import { handleRecordVerification } from "../record.ts";
import { appendActualSideStart } from "../commands.ts";
import { readVerificationList } from "../reads.ts";
import { fileLedger } from "../testing/mod.ts";
import { fixtureDriver, type FixtureOmission } from "../testing/app-driver.ts";
import { ctx } from "../support.ts";
import {
  accept,
  APP,
  attempt,
  blob,
  evidence,
  executed,
  HASH,
  proof,
  REQUEST_HASH,
  runner,
  verification,
} from "../fixtures.ts";
import { createEmitter } from "../harness/emit.ts";
import { observeFailurePath, runPlatformChecks } from "../harness/checks.ts";
import { scanCodeUsage } from "../harness/source-scan.ts";
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

function declaration(
  code: string,
  message = "Saving failed.",
): ProblemCodeDeclaration {
  return {
    code,
    message_key: `app-detail.issue.${code}`,
    message,
    fixer: "coding_agent",
  };
}

type Shape = {
  codes?: string[];
  view?: boolean;
  previous?: ProblemCodeDeclaration[] | null;
  patch?: (input: AppTestInput) => void;
};

function inputFor(shape: Shape = {}): AppTestInput {
  const codes = shape.codes ?? ["save_failed"];
  const blueprint = {
    problem_codes: codes.map((code) => declaration(code)),
    commands: [
      {
        key: "save",
        effect: "write",
        confirm: false,
        revert: { supported: false },
      },
      {
        key: "load",
        effect: "write",
        confirm: false,
        revert: { supported: false },
      },
    ],
    screens: shape.view ? [{ key: "main" }] : [],
    sdk_dependencies: SDK,
    automatic_tasks: [],
    permissions: [],
    app_connections: [],
  } as unknown as AppTestInput["blueprint"];
  const frozen: Pick<
    FrozenTest,
    "blueprint" | "sdk_dependencies" | "failure_paths"
  > = {
    blueprint: HASH,
    sdk_dependencies: sdkDependenciesHash(SDK),
    failure_paths: codes.map((code) => ({ code, test_hash: HASH })),
  };
  const input: AppTestInput = {
    bundle_hash: BUNDLE,
    test_hash: TEST_HASH,
    blueprint,
    blueprint_hash: HASH,
    frozen,
    fixed_sdk: SDK,
    previous_declarations: shape.previous ?? null,
    data: { schema: 0, previous_schema: null },
  };
  shape.patch?.(input);
  return input;
}

function driverFor(
  plan: AppTestPlan,
  omit: readonly FixtureOmission[] = [],
) {
  return fixtureDriver({
    bundle_hash: BUNDLE,
    commands: plan.harness.commands,
    declared_codes: plan.harness.declared_codes,
    failure_commands: Object.fromEntries(
      plan.harness.declared_codes.map((code, index) => [
        plan.harness.commands[index % plan.harness.commands.length],
        code,
      ]),
    ),
    has_view: plan.harness.has_view,
    omit,
    plan: plan.harness,
  });
}

const CLEAN_SOURCE = [{
  path: "app.ts",
  text:
    `import { reportProblem } from "@lophn/cap-problem";\nreportProblem("save_failed");`,
}];

// 같은 harness를 앱 test 대신 in-process로 돌려 frame을 모은다.
async function run(
  shape: Shape = {},
  options: {
    omit?: readonly FixtureOmission[];
    skip_failure_test?: boolean;
    sources?: typeof CLEAN_SOURCE;
  } = {},
) {
  const plan = generateAppTestChecks(inputFor(shape));
  const bytes: Uint8Array[] = [];
  const emitter = createEmitter({
    side: "single",
    test_hash: TEST_HASH,
    write: (frame) => bytes.push(frame),
  });
  const driver = driverFor(plan, options.omit);
  const ran = await runPlatformChecks({
    driver,
    plan: plan.harness,
    emitter,
    sources: options.sources ?? CLEAN_SOURCE,
  });
  assert(ran.ok);
  if (!options.skip_failure_test) {
    for (const code of plan.harness.declared_codes) {
      const command = plan.harness.commands[
        plan.harness.declared_codes.indexOf(code) % plan.harness.commands.length
      ];
      await observeFailurePath({
        driver,
        plan: plan.harness,
        emitter,
        code,
        command,
        command_input: {},
      });
    }
  }
  const sides = emptySides();
  for (const frame of bytes) assert(acceptFrame(sides, frame).ok);
  const frames: TestObservationFrame[] = sides.single.frames;
  return {
    plan,
    frames,
    judgment: judgeAppTest({ plan, test_hash: TEST_HASH, frames }),
  };
}

function statusOf(
  judgment: Awaited<ReturnType<typeof run>>["judgment"],
  name: string,
) {
  return judgment.observations.checks.find((check) => check.name === name);
}

Deno.test("problems/tests#R7: 모든 필수 검사가 실제 pass일 때만 pass이고 검사별 status·reason·evidence가 observations에 있다", async () => {
  const { judgment, plan } = await run({ view: true });
  assertEquals(judgment.result, "pass");
  assertEquals(judgment.observations.checks.length, plan.checks.length);
  for (const check of judgment.observations.checks) {
    // 선언이 없는 앱 계약 검사만 이유 있는 not_applicable이다.
    if (check.status === "not_applicable") {
      assert(check.reason.trim() !== "");
      continue;
    }
    assertEquals(check.status, "pass");
    assert(check.reason.trim() !== "");
    assert(/^[0-9a-f]{64}$/.test(check.evidence.actual_hash ?? ""));
  }
  assertEquals(
    judgment.observations.platform_checks_hash,
    plan.platform_hash,
  );
  // 원문은 observations에 없고 hash만 있다.
  assertFalse(canonicalJson(judgment.observations).includes("nonce-1"));
});

const OMISSIONS: [FixtureOmission, string][] = [
  ["sdk_receipt", "sdk_receipt"],
  ["process_exception", "process_exception"],
  ["redaction", "redaction"],
  ["permission_denial", "permission_denial"],
  ["view_exception", "view_exception"],
  ["feedback", "feedback"],
  ["view_host", "view_exception"],
  ["dynamic_guard", "code_usage_dynamic"],
  ["handler", "blueprint_handler_match"],
  ["failure_report", "failure_path:save_failed"],
  ["failure_via_sdk_only", "failure_path:save_failed"],
];

for (const [omit, name] of OMISSIONS) {
  Deno.test(`problems/tests#R7 problem-codes#R8: ${omit} 경로를 뺀 fixture는 통과하지 못한다`, async () => {
    const { judgment } = await run({ view: true }, { omit: [omit] });
    assertEquals(judgment.result, "fail");
    assertEquals(statusOf(judgment, name)?.status, "fail");
    assertEquals(
      judgment.observations.checks.filter((check) => check.status === "fail")
        .length,
      omit === "view_host" ? 2 : 1,
    );
  });
}

Deno.test("problem-codes#R8: 선언 0개 앱도 process 예외·redaction 경로를 요구하고 화면 없는 앱의 화면 검사만 이유 있는 not_applicable이다", async () => {
  const NO_SOURCE = { sources: [{ path: "a.ts", text: "export {};" }] };
  const none = await run({ codes: [] }, NO_SOURCE);
  assertEquals(none.judgment.result, "pass");
  assertEquals(
    statusOf(none.judgment, "view_exception")?.status,
    "not_applicable",
  );
  assertEquals(statusOf(none.judgment, "feedback")?.status, "not_applicable");
  assert(statusOf(none.judgment, "feedback")?.reason.includes("화면"));
  for (const omit of ["process_exception", "redaction"] as const) {
    const result = await run({ codes: [] }, { ...NO_SOURCE, omit: [omit] });
    assertEquals(result.judgment.result, "fail");
  }
  // 화면이 있으면 화면 검사는 필수다.
  const withView = await run({ codes: [], view: true }, NO_SOURCE);
  assertEquals(statusOf(withView.judgment, "view_exception")?.status, "pass");
});

Deno.test("problem-codes#R9: 선언 code의 실패 경로 test가 없으면 통과하지 못한다", async () => {
  const noTest = await run({}, { skip_failure_test: true });
  assertEquals(noTest.judgment.result, "fail");
  assertEquals(
    statusOf(noTest.judgment, "failure_path:save_failed")?.status,
    "fail",
  );
  const uncovered = await run({
    patch: (input) => {
      input.frozen = { ...input.frozen, failure_paths: [] };
    },
  });
  assertEquals(uncovered.judgment.result, "fail");
  assertEquals(
    statusOf(uncovered.judgment, "failure_path_coverage")?.status,
    "fail",
  );
  const extra = await run({
    patch: (input) => {
      input.frozen = {
        ...input.frozen,
        failure_paths: [
          ...(input.frozen.failure_paths ?? []),
          { code: "other_code", test_hash: HASH },
        ],
      };
    },
  });
  assertEquals(
    statusOf(extra.judgment, "failure_path_coverage")?.status,
    "fail",
  );
});

Deno.test("problem-codes#R9: SDK 직접 호출 frame은 실패 경로 근거가 아니다", async () => {
  const { plan, frames } = await run({});
  const check = plan.checks.find((item) =>
    item.name === "failure_path:save_failed"
  )!;
  const forged = frames.map((frame) =>
    frame.name === check.name
      ? {
        ...frame,
        actual: { ...(frame.actual as object), via: "sdk_direct" },
      }
      : frame
  );
  const judged = judgeAppTest({ plan, test_hash: TEST_HASH, frames: forged });
  assertEquals(judged.result, "fail");
  assertEquals(
    judged.observations.checks.find((item) => item.name === check.name)?.status,
    "fail",
  );
});

Deno.test("problems/tests#R6: 검사 삭제·수정·위조는 통과하지 못하고 bundle이 목록을 바꾸지 못한다", async () => {
  const { plan, frames } = await run({ view: true });
  // 삭제: 필수 검사 frame 하나를 빼면 fail
  const removed = judgeAppTest({
    plan,
    test_hash: TEST_HASH,
    frames: frames.filter((frame) => frame.name !== "redaction"),
  });
  assertEquals(removed.result, "fail");
  assertEquals(statusOf(removed, "redaction")?.status, "fail");
  // 수정: 정의 digest가 설치 자료와 다르면 fail
  const modified = judgeAppTest({
    plan,
    test_hash: TEST_HASH,
    frames: frames.map((frame) =>
      frame.name === "redaction"
        ? {
          ...frame,
          actual: { ...(frame.actual as object), check_digest: "0".repeat(64) },
        }
        : frame
    ),
  });
  assertEquals(modified.result, "fail");
  assert(statusOf(modified, "redaction")!.reason.includes("설치 자료"));
  // 더한 검사 이름, 겹친 이름, 다른 hash는 판정 불가
  const added = judgeAppTest({
    plan,
    test_hash: TEST_HASH,
    frames: [...frames, { ...frames[0], name: "my_own_check" }],
  });
  assertEquals(added.result, "inconclusive");
  assertEquals(
    judgeAppTest({ plan, test_hash: TEST_HASH, frames: [...frames, frames[0]] })
      .result,
    "inconclusive",
  );
  assertEquals(
    judgeAppTest({ plan, test_hash: "e".repeat(64), frames }).result,
    "inconclusive",
  );
  assertEquals(
    judgeAppTest({ plan, test_hash: TEST_HASH, frames: [] }).result,
    "inconclusive",
  );
  // expectation_met가 없는 frame은 통과로 세지 않는다
  assertEquals(
    judgeAppTest({
      plan,
      test_hash: TEST_HASH,
      frames: frames.map((frame) => {
        const { expectation_met: _met, ...rest } = frame;
        return rest;
      }),
    }).result,
    "inconclusive",
  );
  // 검사 목록과 digest는 blueprint가 같으면 같다. bundle source는 입력이 아니다
  const again = generateAppTestChecks(inputFor({ view: true }));
  assertEquals(again.platform_hash, plan.platform_hash);
  // blueprint가 바뀌면 새 목록이고 hash도 다르다(새 hash의 새 app test)
  const changed = generateAppTestChecks(
    inputFor({ view: true, codes: ["save_failed", "load_failed"] }),
  );
  assert(changed.platform_hash !== plan.platform_hash);
});

Deno.test("problems/tests#R7 problem-codes#R8: 선언·고정 SDK·blueprint hash 불일치는 통과하지 못한다", async () => {
  const badDeclaration = await run({
    patch: (input) => {
      (input.blueprint as { problem_codes: unknown }).problem_codes = [
        { ...declaration("Bad-Code") },
      ];
    },
  });
  assertEquals(badDeclaration.judgment.result, "fail");
  assertEquals(
    statusOf(badDeclaration.judgment, "declarations")?.status,
    "fail",
  );
  const differentSdk = await run({
    patch: (input) => {
      (input.blueprint as { sdk_dependencies: unknown }).sdk_dependencies = [
        { name: "@lophn/cap-problem", version: "9.9.9" },
      ];
    },
  });
  assertEquals(statusOf(differentSdk.judgment, "fixed_sdk")?.status, "fail");
  const noHash = await run({
    patch: (input) => {
      input.frozen = { ...input.frozen, sdk_dependencies: HASH };
    },
  });
  assertEquals(statusOf(noHash.judgment, "fixed_sdk")?.status, "fail");
  const blueprintHash = await run({
    patch: (input) => {
      input.blueprint_hash = "f".repeat(64);
    },
  });
  assertEquals(
    statusOf(blueprintHash.judgment, "declarations")?.status,
    "fail",
  );
});

Deno.test("problems/tests#R7: 정적 code 사용 검사는 선언 없는·예약·계산한 code와 주석 속 호출을 구별한다", async () => {
  const usage = scanCodeUsage([
    {
      path: "a.ts",
      text:
        `// reportProblem("commented")\nreportProblem("save_failed");\nreportProblem('other');\nreportProblem(\`x_\${y}\`);\nreportProblem(name);\nreportProblem("_exception", {a:1})`,
    },
  ]);
  assertEquals(
    usage.literals.map((use) => use.code),
    ["save_failed", "other", "_exception"],
  );
  assertEquals(usage.dynamic.length, 2);
  for (
    const text of [
      `reportProblem("undeclared_one");`,
      `reportProblem("_exception");`,
    ]
  ) {
    const { judgment } = await run({}, { sources: [{ path: "a.ts", text }] });
    assertEquals(judgment.result, "fail");
    assertEquals(statusOf(judgment, "code_usage_static")?.status, "fail");
  }
  const sources = [{ path: "a.ts", text: `reportProblem(\`x_\${y}\`);` }];
  const dynamic = await run({}, { sources });
  assertEquals(dynamic.judgment.result, "pass");
  assertEquals(statusOf(dynamic.judgment, "code_usage_static")?.status, "pass");
  const unguarded = await run({}, { sources, omit: ["dynamic_guard"] });
  assertEquals(unguarded.judgment.result, "fail");
  assertEquals(statusOf(unguarded.judgment, "code_usage_dynamic")?.status, "fail");
});

Deno.test("problem-codes#R3: 같은 code의 의미 변경을 observations에 남긴다", async () => {
  const same = await run({ previous: [declaration("save_failed")] });
  assertEquals(same.judgment.observations.meaning_changes, []);
  const changed = await run({
    previous: [declaration("save_failed", "Importing failed.")],
  });
  assertEquals(changed.judgment.observations.meaning_changes, [
    { code: "save_failed", changed: ["message"] },
  ]);
  // 관측일 뿐 pass를 막지 않고, 새 code는 변경이 아니다
  assertEquals(changed.judgment.result, "pass");
  const renamed = await run({ previous: [declaration("other_code")] });
  assertEquals(renamed.judgment.observations.meaning_changes, []);
});

async function realChild(omit: boolean) {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const temp = await Deno.makeTempDir({ prefix: "app-test-child-" });
  try {
    const scratch = `${temp}/scratch`;
    const source = `${temp}/source`;
    await Deno.mkdir(scratch);
    await Deno.mkdir(source);
    await Deno.writeTextFile(`${source}/app.ts`, CLEAN_SOURCE[0].text);
    const plan = generateAppTestChecks(inputFor({ view: false }));
    await Deno.writeTextFile(
      `${scratch}/child.json`,
      JSON.stringify({
        plan: plan.harness,
        source_dir: source,
        driver: {
          bundle_hash: BUNDLE,
          commands: plan.harness.commands,
          declared_codes: plan.harness.declared_codes,
          failure_commands: { save: "save_failed" },
          has_view: false,
          omit: omit ? ["process_exception"] : [],
        },
      }),
    );
    const child = await new Deno.Command(Deno.execPath(), {
      args: [
        "test",
        "--no-prompt",
        `--config=${root}deno.json`,
        `--allow-read=${root},${temp}`,
        `--allow-write=${scratch}`,
        `${root}packages/problems/tests/testdata/app-test-child_test.ts`,
        "--",
        scratch,
      ],
      cwd: temp,
      clearEnv: true,
      env: { PATH: Deno.env.get("PATH") ?? "", HOME: temp },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(
      child.success,
      new TextDecoder().decode(child.stderr) +
        new TextDecoder().decode(child.stdout),
    );
    const lines = (await Deno.readTextFile(`${scratch}/frames.jsonl`))
      .split("\n").filter((line) => line !== "");
    const sides = emptySides();
    for (const line of lines) {
      assert(acceptFrame(sides, new TextEncoder().encode(line)).ok);
    }
    return judgeAppTest({
      plan,
      test_hash: TEST_HASH,
      frames: sides.single.frames,
    });
  } finally {
    await Deno.remove(temp, { recursive: true });
  }
}

Deno.test("problems/tests#R6 R7: 실제 Deno test 자식이 harness로 낸 관측이 pass이고 경로를 뺀 자식은 fail이다", async () => {
  const good = await realChild(false);
  assertEquals(good.result, "pass", good.reason);
  const bad = await realChild(true);
  assertEquals(bad.result, "fail");
  assertEquals(statusOf(bad, "process_exception")?.status, "fail");
});

Deno.test("problems/tests#R6 R7: 판정한 app test pass Verification을 같은 bundle hash로 읽는다", async () => {
  const { judgment } = await run({});
  assertEquals(judgment.result, "pass");
  const observationsHash = canonicalHash(judgment.observations);
  const recorded = verification({
    observations: observationsHash,
    result: judgment.result,
    reason: judgment.reason,
  });
  const prepared = {
    ...evidence(),
    verification_canonical: canonicalJson(recorded),
    observations_json: judgment.observations,
    observations: observationsHash,
  };
  const ledger = fileLedger();
  try {
    assert(ledger.transaction(accept).ok);
    assert(ledger.transaction(attempt).ok);
    assert(
      ledger.transaction((tx) =>
        appendActualSideStart(tx, runner(), {
          request_principal: "user-1",
          request_key: "key-1",
          request_hash: REQUEST_HASH,
          side: "single",
          bundle_hash: HASH,
          test_hash: recorded.test,
          started_at: executed.started_at,
        }, proof())
      ).ok,
    );
    const done = ledger.transaction((tx) =>
      handleRecordVerification(tx, runner(), {
        verification: recorded,
        blobs: blob("runner-1", recorded, prepared),
      }, prepared)
    );
    assert(done.ok, done.ok ? "" : JSON.stringify(done.error));
    const reader = ctx({
      scope: {
        operations: ["ListVerifications"],
        targets: { app: APP },
      },
      conditions: { app: APP },
    });
    const list = readVerificationList(ledger.snapshot(done.value.seq), reader, {
      app: APP,
      kind: "app_test",
    });
    assert(list.ok);
    assertEquals(list.value.verifications.length, 1);
    const found = list.value.verifications[0];
    assertEquals(found.target.bundle_hash, HASH);
    assertEquals(found.result, "pass");
    assertEquals(found.observations, observationsHash);
  } finally {
    ledger.close();
  }
});
