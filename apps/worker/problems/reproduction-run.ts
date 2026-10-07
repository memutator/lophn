// reproduction test 한 건을 실제 runner 경로로 돌린다(problems/tests#R10, R11, R12, R15). before와 after를 차례로,
// side마다 새 작업 폴더(새 fixture DB)에서 같은 고정 시험·입력·기대·환경으로 돌린다. 앱 source는 읽기 전용
// 봉인 bundle 사본이고, 운영 DB는 어디에서도 복사하지 않으며 외부 접속은 apps/preview의 고정 대역뿐이다.
// 판정은 stdout이 아니라 자식의 관측 frame·runner가 직접 관측한 종료·고정 bundle 근거가 정한다. 결과를
// ledger에 쓰는 것(RecordVerification)은 이 함수를 부른 쪽의 몫이다.
import {
  createIdSource,
  cryptoRandom,
  err,
  ok,
  type Result,
  sha256Hex,
  systemClock,
} from "../../../packages/base/mod.ts";
import type { Blueprint } from "../../../packages/apps/blueprint/mod.ts";
import {
  generateAppTestChecks,
  judgeReproduction,
  loadSources,
  type ReproductionJudgment,
  type ReproductionScenario,
  type ReproductionSide,
  scanCodeUsage,
  sdkDependenciesHash,
  serveRpc,
  type SideRun,
} from "../../../packages/problems/tests/mod.ts";
import { createRealAppDriver, type RealDriverInput } from "./app-driver.ts";
import { acceptRun, platformMemory } from "./runner-core.ts";

export type ReproductionSideTarget = {
  // 봉인 bundle 사본(읽기 전용)과 그 hash.
  bundle: string;
  bundle_hash: string;
};

export type ReproductionJob = {
  request_key: string;
  // 같은 runner가 동시에 도는 두 요청이 socket 자리를 나눠 쓴다(launch spec이 정확한 경로를 허락한다).
  slot: 0 | 1;
  // 이 실행의 작업 폴더. runner 작업 root 안이고 비어 있어야 한다. side마다 하위 폴더를 새로 만든다.
  work: string;
  sockets: { broker: string; direct: string; probe: string };
  before: ReproductionSideTarget;
  after: ReproductionSideTarget;
  scenario: ReproductionScenario;
  // 고정 시험(FrozenTest)의 hash. 관측 frame은 이 hash를 달고 와야 한다.
  test_hash: string;
  inputs?: Record<string, unknown>;
  timeout_ms: number;
  deno: string;
  environment: { home?: string; denoDir?: string; xdgCacheHome?: string };
};

export type SideExecutionRecord = {
  side: ReproductionSide;
  bundle_hash: string;
  started_at: string;
  ended_at: string;
  exit_code: number | null;
  end_reason: SideRun["end_reason"];
  mode: string | null;
  frames: number;
  // 자식이 쓴 안전 출력의 끝부분이다. 판정에는 쓰지 않는다.
  output_tail: string;
  // 이 side가 쓴 fixture 폴더(새로 만들었다)와 source를 쓸 수 없었다는 runner의 직접 확인이다.
  isolation: {
    fixture_dir: string;
    fresh_fixture: boolean;
    source_read_only: boolean;
  };
  // 이 side의 앱이 collector 대역에 넘긴 보고(mode=test와 scope)다.
  forwarded: { kind: string; code: string; scope: string }[];
};

export type ReproductionJobResult = {
  judgment: ReproductionJudgment;
  // 실제로 시작한 side의 실행이다. 시작하지 않은 side는 없다.
  executions: SideExecutionRecord[];
  not_started: { side: ReproductionSide; reason: string } | null;
};

const HARNESS_TEST = (child: string, scratch: string) =>
  `import { runReproductionChild } from ${JSON.stringify(child)};
Deno.test("problems/tests#R10: platform reproduction child", async () => {
  await runReproductionChild(${JSON.stringify(scratch)});
});
`;

async function migrationSchema(bundle: string): Promise<number> {
  let schema = 0;
  try {
    for await (const entry of Deno.readDir(`${bundle}/migrations`)) {
      const match = /^(\d+)-(\d+)\.sql$/.exec(entry.name);
      if (match) schema = Math.max(schema, Number(match[2]));
    }
  } catch { /* migration이 없는 앱이다 */ }
  return schema;
}

// 고정 bundle에서 runner가 직접 읽는 약화 검사 근거다. harness가 낸 값이 아니다.
async function bundleEvidence(
  bundle: string,
  blueprint: Blueprint,
): Promise<SideRun["evidence"]> {
  const usage = scanCodeUsage(await loadSources(bundle));
  return {
    declared_codes: blueprint.problem_codes.map((item) => item.code),
    report_literals: [...new Set(usage.literals.map((item) => item.code))],
  };
}

// source가 읽기 전용인지 직접 써 보아 확인한다. runner에는 bundle 폴더의 쓰기 권한이 없어 거절돼야 한다.
async function sourceReadOnly(bundle: string): Promise<boolean> {
  try {
    await Deno.writeTextFile(`${bundle}/.reproduction-write-probe`, "x");
    await Deno.remove(`${bundle}/.reproduction-write-probe`).catch(() =>
      undefined
    );
    return false;
  } catch {
    return true;
  }
}

type SideStart = {
  run: SideRun;
  record: SideExecutionRecord;
};

async function runSide(
  job: ReproductionJob,
  side: ReproductionSide,
  target: ReproductionSideTarget,
): Promise<Result<SideStart>> {
  const root = new URL("../../../", import.meta.url);
  let blueprintText: string;
  let blueprint: Blueprint;
  try {
    blueprintText = await Deno.readTextFile(`${target.bundle}/blueprint.json`);
    blueprint = JSON.parse(blueprintText) as Blueprint;
  } catch {
    return err({
      code: "unavailable",
      message: `${side} 묶음의 blueprint를 읽을 수 없다`,
    });
  }
  const sideWork = `${job.work}/${side}`;
  // side마다 새 폴더다. 앞 side가 남긴 DB·socket 자료를 받지 않는다.
  let fresh = true;
  try {
    await Deno.stat(sideWork);
    fresh = false;
  } catch { /* 없다 */ }
  const scratch = `${sideWork}/scratch`;
  const harness = `${sideWork}/harness`;
  const driverWork = `${sideWork}/driver`;
  for (const dir of [scratch, harness, driverWork]) {
    await Deno.mkdir(dir, { recursive: true, mode: 0o700 });
  }
  const childUrl = new URL(
    "packages/problems/tests/reproduction/child.ts",
    root,
  ).href;
  await Deno.writeTextFile(
    `${harness}/child_test.ts`,
    HARNESS_TEST(childUrl, scratch),
  );
  const rootConfig = JSON.parse(
    await Deno.readTextFile(new URL("deno.json", root)),
  ) as { imports: Record<string, string> };
  await Deno.writeTextFile(
    `${harness}/import-map.json`,
    JSON.stringify({ imports: rootConfig.imports }),
  );
  const blueprintHash = await sha256Hex(blueprintText);
  const plan = generateAppTestChecks({
    bundle_hash: target.bundle_hash,
    test_hash: job.test_hash,
    blueprint: blueprint as never,
    data: {
      schema: await migrationSchema(target.bundle),
      previous_schema: null,
    },
    blueprint_hash: blueprintHash,
    frozen: {
      blueprint: blueprintHash,
      sdk_dependencies: sdkDependenciesHash(blueprint.sdk_dependencies),
      failure_paths: [],
    },
    fixed_sdk: blueprint.sdk_dependencies,
    previous_declarations: null,
  }).harness;

  const ids = createIdSource({ clock: systemClock, random: cryptoRandom });
  const scope = `reproduction-${job.request_key}-${side}`;
  const forwarded: SideExecutionRecord["forwarded"] = [];
  const accepted = (id: string) => ({
    report: id,
    snapshot: `snp_${id.slice(4)}`,
    problem: null,
    diagnostic_scope: scope,
  });
  const created = await createRealAppDriver(
    {
      plan,
      blueprint,
      bundle: target.bundle,
      bundle_hash: target.bundle_hash,
      work: driverWork,
      sockets: job.sockets,
      deno: job.deno,
      entrypoint: new URL(
        "packages/apps/runtime/entrypoint/main.ts",
        root,
      ).pathname,
      base_module: new URL("packages/base/mod.ts", root).href,
      environment: job.environment,
      inputs: job.inputs ?? {},
      sink: {
        report(report) {
          forwarded.push({ kind: "report", code: report.code, scope });
          return Promise.resolve(ok(accepted(report.report_id)));
        },
        exception(body) {
          const id = (body as { report_id?: string } | null)?.report_id ??
            ids.newId("rpt");
          forwarded.push({ kind: "exception", code: "_exception", scope });
          return Promise.resolve(ok(accepted(id)));
        },
      },
      view: null,
    } satisfies RealDriverInput,
  );
  if (!created.ok) return created;
  const driver = created.value;
  const served = serveRpc(scratch, driver);
  try {
    await Deno.writeTextFile(
      `${scratch}/child.json`,
      JSON.stringify({
        side,
        test_hash: job.test_hash,
        scenario: job.scenario,
      }),
    );
    const finished = await acceptRun(
      {
        request_key: `${job.request_key}:${side}`,
        prepare: {
          method: {
            argv: ["test", "child_test.ts"],
            cwd: ".",
            timeout_ms: job.timeout_ms,
            expected_exit_code: 0,
            environment: await sha256Hex("problems/tests runner environment"),
          },
          source: harness,
          scratch,
          reads: [target.bundle, scratch],
          env: {},
          deno: job.deno,
          import_map: `${harness}/import-map.json`,
          runtime_env: {
            ...(job.environment.home ? { HOME: job.environment.home } : {}),
            ...(job.environment.denoDir
              ? { DENO_DIR: job.environment.denoDir }
              : {}),
            ...Object.fromEntries(
              ["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"].flatMap(
                (name) => {
                  const value = Deno.env.get(name);
                  return value === undefined ? [] : [[name, value]];
                },
              ),
            ),
          },
        },
        test_hash: job.test_hash,
        side,
        start_attempt_at: new Date().toISOString(),
        running: 0,
        preparing: 0,
      },
      { memory: platformMemory },
    );
    if (!finished.ok) return finished;
    const verdict = finished.value;
    const outcome = verdict.outcome;
    const endReason = outcome?.end_reason ?? "killed";
    const run: SideRun = {
      side,
      bundle_hash: target.bundle_hash,
      end_reason: endReason,
      // 판정 불가 이유가 관측이면 protocol이 어긋난 것이다.
      protocol_ok: verdict.result !== "inconclusive" ||
        verdict.reason !== "observation",
      exit_code: outcome?.exit_code ?? null,
      frames: verdict.frames,
      evidence: await bundleEvidence(target.bundle, blueprint),
    };
    return ok({
      run,
      record: {
        side,
        bundle_hash: target.bundle_hash,
        started_at: verdict.started_at,
        ended_at: outcome?.ended_at ?? new Date().toISOString(),
        exit_code: outcome?.exit_code ?? null,
        end_reason: endReason,
        mode: verdict.mode,
        frames: verdict.frames.length,
        output_tail: new TextDecoder().decode(outcome?.output).slice(-4000),
        isolation: {
          fixture_dir: `${driverWork}/data`,
          fresh_fixture: fresh,
          source_read_only: await sourceReadOnly(target.bundle),
        },
        forwarded,
      },
    });
  } finally {
    await served.stop();
    await driver.close();
  }
}

export async function runReproductionJob(
  job: ReproductionJob,
): Promise<Result<ReproductionJobResult>> {
  const before = await runSide(job, "before", job.before);
  // 시작한 side가 없으면 결과도 없다.
  if (!before.ok) return before;
  const executions = [before.value.record];
  let after: SideStart | null = null;
  let notStarted: ReproductionJobResult["not_started"] = null;
  if (before.value.run.end_reason !== "exited") {
    notStarted = {
      side: "after",
      reason:
        `before가 ${before.value.run.end_reason}로 끝나 after를 시작하지 않았다`,
    };
  } else {
    const started = await runSide(job, "after", job.after);
    if (started.ok) {
      after = started.value;
      executions.push(started.value.record);
    } else {
      notStarted = { side: "after", reason: started.error.message };
    }
  }
  const judgment = judgeReproduction({
    scenario: job.scenario,
    test_hash: job.test_hash,
    before: before.value.run,
    after: after?.run ?? null,
    ...(notStarted ? { not_started: notStarted } : {}),
  });
  return ok({ judgment, executions, not_started: notStarted });
}
