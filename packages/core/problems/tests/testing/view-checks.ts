import type { Result } from "../../../../base/mod.ts";
import {
  createIdSource,
  cryptoRandom,
  ok,
  systemClock,
} from "../../../../base/mod.ts";
import {
  type AcceptedReport,
  type FrozenTest,
  observeExceptionInputSchema,
  type ProblemCodeDeclaration,
  type TestObservationFrame,
} from "../../../../protocol/problems/mod.ts";
import {
  type AppTestInput,
  generateAppTestChecks,
  judgeAppTest,
  openViewDriver,
  type ScreenHostResult,
  type ScreenReportSink,
  type ScreenReportTarget,
  sdkDependenciesHash,
} from "../app-test/mod.ts";
import { observeFailurePath, runPlatformChecks } from "../harness/checks.ts";
import { createEmitter } from "../harness/emit.ts";
import { acceptFrame, emptySides } from "../work/ipc.ts";
import { fixtureDriver } from "./app-driver.ts";

const TEST_HASH = "c".repeat(64);
const BUNDLE = "d".repeat(64);
const BLUEPRINT = "a".repeat(64);
const SDK = [{ name: "@lophn/cap-problem", version: "1.0.0" }];
const CODE = "save_failed";
const SOURCE = [{
  path: "app.ts",
  text:
    `import { reportProblem } from "@lophn/cap-problem";\nreportProblem("${CODE}");`,
}];

export type FakeCollector = {
  sink: ScreenReportSink;
  // collector가 받은 호출. mode와 scope는 runner가 붙인 것이다.
  received: { kind: "exception" | "feedback"; target: ScreenReportTarget }[];
};

// 접수 결과를 정하는 collector 대역. scope는 test 진단 scope로 접수한다.
export function fakeCollector(options: {
  reject?: readonly ("exception" | "feedback")[];
  // 문제에 묶어 접수한다(test scope가 아니다).
  as_problem?: boolean;
} = {}): FakeCollector {
  const received: FakeCollector["received"] = [];
  let count = 0;
  const accept = (
    kind: "exception" | "feedback",
    target: ScreenReportTarget,
  ): Result<AcceptedReport> => {
    received.push({ kind, target });
    count += 1;
    const ids = { report: `rpt_${count}`, snapshot: `snp_${count}` };
    return options.as_problem
      ? ok({ ...ids, problem: `prb_${count}`, diagnostic_scope: null })
      : ok({ ...ids, problem: null, diagnostic_scope: target.scope });
  };
  const rejected = (kind: "exception" | "feedback") =>
    options.reject?.includes(kind) ?? false;
  return {
    received,
    sink: {
      exception(input, target) {
        // host 관측에서 만든 입력은 contract schema를 지나야 한다.
        observeExceptionInputSchema.parse(input);
        if (rejected("exception")) {
          return Promise.resolve({
            ok: false,
            error: { code: "unavailable", message: "rejected" },
          });
        }
        return Promise.resolve(accept("exception", target));
      },
      feedback(_facts, target) {
        if (rejected("feedback")) {
          return Promise.resolve({
            ok: false,
            error: { code: "unavailable", message: "rejected" },
          });
        }
        return Promise.resolve(accept("feedback", target));
      },
    },
  };
}

// 화면 있는 앱의 app test를 화면 검사 host 결과로 in-process 판정한다. 화면 검사만
// 주어진 host 결과이고 나머지 경로는 모두 갖춘 앱이다.
export const PROBE_NONCE = "testnonce12345678";

export async function judgeWithScreens(options: {
  host: (nonce: string) => Promise<ScreenHostResult>;
  // 화면에 루트 오류 경계가 있는가. 없으면 모든 화면에 있다.
  has_boundary?: (screen: string) => boolean;
  collector: FakeCollector;
  has_view?: boolean;
}) {
  const hasView = options.has_view ?? true;
  const declaration: ProblemCodeDeclaration = {
    code: CODE,
    message_key: `app-detail.issue.${CODE}`,
    message: "Saving failed.",
    fixer: "coding_agent",
  };
  const frozen: Pick<
    FrozenTest,
    "blueprint" | "sdk_dependencies" | "failure_paths"
  > = {
    blueprint: BLUEPRINT,
    sdk_dependencies: sdkDependenciesHash(SDK),
    failure_paths: [{ code: CODE, test_hash: BLUEPRINT }],
  };
  const input: AppTestInput = {
    bundle_hash: BUNDLE,
    test_hash: TEST_HASH,
    blueprint: {
      problem_codes: [declaration],
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
      screens: hasView ? [{ key: "main" }] : [],
      sdk_dependencies: SDK,
      automatic_tasks: [],
      permissions: [],
      app_connections: [],
    } as unknown as AppTestInput["blueprint"],
    blueprint_hash: BLUEPRINT,
    frozen,
    fixed_sdk: SDK,
    previous_declarations: null,
    data: { schema: 0, previous_schema: null },
  };
  const plan = generateAppTestChecks(input);
  const base = fixtureDriver({
    bundle_hash: BUNDLE,
    commands: plan.harness.commands,
    declared_codes: plan.harness.declared_codes,
    failure_commands: { save: CODE },
    has_view: false,
  });
  const ids = createIdSource({ clock: systemClock, random: cryptoRandom });
  let hostRuns = 0;
  const view = plan.harness.has_view
    ? await openViewDriver({
      run: (nonce) => {
        hostRuns += 1;
        return options.host(nonce);
      },
      nonce: PROBE_NONCE,
      has_boundary: options.has_boundary ?? (() => true),
      sink: options.collector.sink,
      scope: "app-test-scope-1",
      newReportId: () => ids.newId("rpt"),
      now: () => new Date().toISOString(),
    })
    : null;
  const driver = { ...base, view };
  const bytes: Uint8Array[] = [];
  const emitter = createEmitter({
    side: "single",
    test_hash: TEST_HASH,
    write: (frame) => bytes.push(frame),
  });
  await runPlatformChecks({
    driver,
    plan: plan.harness,
    emitter,
    sources: SOURCE,
  });
  await observeFailurePath({
    driver,
    plan: plan.harness,
    emitter,
    code: CODE,
    command: "save",
    command_input: {},
  });
  const sides = emptySides();
  for (const frame of bytes) acceptFrame(sides, frame);
  const frames: TestObservationFrame[] = sides.single.frames;
  return {
    plan,
    host_runs: () => hostRuns,
    judgment: judgeAppTest({ plan, test_hash: TEST_HASH, frames }),
  };
}
