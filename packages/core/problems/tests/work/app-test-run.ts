// app test 한 건을 실제 runner 경로로 돌린다. 고정 bundle 사본과 고정
// 시험(실패 경로 목록)에서 필수 검사 계획을 만들고, 실제 앱 자식·broker(app-driver.ts)를 띄우고, 요청마다
// 새 Deno test 자식(플랫폼 harness)을 runner의 격리 flag로 띄운 뒤, 자식이 private 통로로 낸 관측 frame을
// 판정한다. 결과를 ledger에 쓰는 것(RecordVerification)은 이 함수를 부른 쪽의 몫이다.
import {
  createIdSource,
  cryptoRandom,
  err,
  ok,
  type Result,
  sha256Hex,
  systemClock,
} from "../../../../base/mod.ts";
import type { Blueprint } from "../../../apps/blueprint/mod.ts";
import type { ProblemCodeDeclaration } from "../../../../protocol/problems/mod.ts";
import {
  type AppTestInput,
  type AppTestJudgment,
  generateAppTestChecks,
  type HarnessFailurePath,
  sdkDependenciesHash,
  serveRpc,
} from "../mod.ts";
import type { ScreenReportSink } from "../app-test/mod.ts";
import type { ViewDriver } from "../harness/mod.ts";
import { canonicalHash } from "../canonical.ts";
import {
  createRealAppDriver,
  type RealDriver,
  type RealDriverInput,
} from "./app-driver.ts";
import { acceptAppTest, platformMemory, runnerView } from "./runner-core.ts";

export type AppTestJob = {
  request_key: string;
  // 같은 runner가 동시에 도는 두 요청이 socket 자리를 나눠 쓴다(launch spec이 정확한 경로를 허락한다).
  slot: 0 | 1;
  // 이 실행의 작업 폴더. runner 작업 root 안이고 비어 있어야 한다.
  work: string;
  // 이 slot의 고정 socket 경로(broker·direct·probe).
  sockets: { broker: string; direct: string; probe: string };
  // 봉인 bundle 사본(읽기 전용)과 그 hash.
  bundle: string;
  bundle_hash: string;
  blueprint_hash: string;
  // 고정 시험. 실패 경로 test 목록이고 hash는 FrozenTest.failure_paths에 고정된다.
  scenarios: HarnessFailurePath[];
  frozen_failure_paths: { code: string; test_hash: string }[];
  // 고정 시험(FrozenTest)의 hash다. 관측 frame은 이 hash를 달고 와야 한다.
  test_hash: string;
  inputs: Record<string, unknown>;
  prepare?: RealDriverInput["prepare"];
  journal_tables?: string[];
  // 앱의 업무 관측이다. 앱의 고유한 동작(기간·시간대·coverage, blob·충돌, 효과 불확실성)을 실제 command로
  // 한 번씩 불러 응답을 결과에 싣는다. 판정에는 쓰지 않는다.
  domain?: {
    name: string;
    command: string;
    input?: unknown;
    fault?: "store" | "net" | "none";
  }[];
  // 이전 release의 data schema와 선언(없으면 null).
  previous_schema: number | null;
  previous_declarations: ProblemCodeDeclaration[] | null;
  // 화면 검사 host(shell이 설치한 실행 파일). 없으면 화면 있는 bundle은 pass하지 못한다.
  screen_host: { command: string; args: string[] } | null;
  timeout_ms: number;
  // 접수한 요청의 실행 기한(RequestTest `timeout_ms`)이다. 동결 method의 timeout_ms보다 길어지지 않는다(짧은 쪽).
  request_timeout_ms?: number;
  // 보고의 진단 scope. 제품 경로에서는 요청별 credential이 고정한 값이다. 없으면 요청 key에서 정한다.
  scope?: string;
  // 자식 flag·환경에 쓰는 runner 설치 자료.
  deno: string;
  environment: { home?: string; denoDir?: string; xdgCacheHome?: string };
};

export type AppTestJobResult = {
  judgment: AppTestJudgment;
  execution: {
    result: "pass" | "fail" | "inconclusive";
    reason: string;
    mode: string | null;
    exit_code: number | null;
    end_reason: string | null;
    started_at: string;
    ended_at: string | null;
    frames: number;
    // 자식이 쓴 안전 출력의 끝부분이다. 판정에는 쓰지 않고 실패를 설명하는 데만 쓴다.
    output_tail: string;
  };
  domain: {
    name: string;
    command: string;
    outcome: "ok" | "error";
    status: number | null;
    body: unknown;
    reports: string[];
  }[];
  // collector에 mode=test와 scope로 넘긴 보고(코드와 종류)다.
  forwarded: { kind: string; code: string; scope: string }[];
};

// 제품 runner의 연결 자리다. 없으면(stdin 한 건 모드) 한 요청 안의 collector 대역이 mode=test·scope로 접수한
// 보고를 모은다.
export type AppTestHooks = {
  // 자식이 실제로 시작한 것을 관측한 직후, 끝나기를 기다리기 전에 부른다.
  started?: (child: { started_at: string; mode: string }) => Promise<void>;
  // 실제 collector 연결. 앱 SDK 보고·process 예외·화면 host 관측을 그 요청의 mode=test·scope로 core에 넘긴다.
  collector?: {
    report: RealDriverInput["sink"]["report"];
    exception: RealDriverInput["sink"]["exception"];
    screen: ScreenReportSink;
  };
};

const HARNESS_TEST = (child: string, scratch: string) =>
  `import { runHarnessChild } from ${JSON.stringify(child)};
Deno.test("problems/tests#R6: platform harness child", async () => {
  await runHarnessChild(${JSON.stringify(scratch)});
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

export async function runAppTestJob(
  job: AppTestJob,
  hooks: AppTestHooks = {},
): Promise<Result<AppTestJobResult>> {
  const blueprint = JSON.parse(
    await Deno.readTextFile(`${job.bundle}/blueprint.json`),
  ) as Blueprint;
  const dataSchema = await migrationSchema(job.bundle);
  const testHash = job.test_hash;
  const input: AppTestInput = {
    bundle_hash: job.bundle_hash,
    test_hash: testHash,
    blueprint: blueprint as AppTestInput["blueprint"],
    data: { schema: dataSchema, previous_schema: job.previous_schema },
    blueprint_hash: job.blueprint_hash,
    frozen: {
      blueprint: job.blueprint_hash,
      sdk_dependencies: sdkDependenciesHash(blueprint.sdk_dependencies),
      failure_paths: job.frozen_failure_paths,
    },
    fixed_sdk: blueprint.sdk_dependencies,
    previous_declarations: job.previous_declarations,
  };
  const plan = generateAppTestChecks(input);

  const scratch = `${job.work}/scratch`;
  const harness = `${job.work}/harness`;
  for (const dir of [scratch, harness, `${job.work}/driver`]) {
    await Deno.mkdir(dir, { recursive: true, mode: 0o700 });
  }
  const root = new URL("../../../../../", import.meta.url);
  const childUrl = new URL(
    "packages/core/problems/tests/harness/child.ts",
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

  const ids = createIdSource({ clock: systemClock, random: cryptoRandom });
  const scope = job.scope ?? `app-test-${job.request_key}`;
  const forwarded: AppTestJobResult["forwarded"] = [];
  const nonce = (await sha256Hex(`${job.request_key}:probe`)).slice(0, 32);
  const now = () => new Date().toISOString();
  const accepted = (id: string) => ({
    report: id,
    snapshot: `snp_${id.slice(4)}`,
    problem: null,
    diagnostic_scope: scope,
  });
  // collector 대역: mode=test와 scope로 접수된 보고를 모은다.
  const screenSink: ScreenReportSink = hooks.collector
    ? {
      exception(exception, target) {
        forwarded.push({
          kind: "exception",
          code: "_exception",
          scope: target.scope,
        });
        return hooks.collector!.screen.exception(exception, target);
      },
      feedback(facts, target) {
        forwarded.push({
          kind: "feedback",
          code: "_feedback",
          scope: target.scope,
        });
        return hooks.collector!.screen.feedback(facts, target);
      },
    }
    : {
      exception(exception, target) {
        forwarded.push({
          kind: "exception",
          code: "_exception",
          scope: target.scope,
        });
        return Promise.resolve(ok(accepted(exception.report_id) as never));
      },
      feedback(_facts, target) {
        const id = ids.newId("rpt");
        forwarded.push({
          kind: "feedback",
          code: "_feedback",
          scope: target.scope,
        });
        return Promise.resolve(ok(accepted(id) as never));
      },
    };

  // 화면 검사 host가 부르는 command가 아래에서 만든 driver를 쓰므로 나중에 채운다.
  const live: { driver?: RealDriver } = {};
  let viewDriver: Promise<ViewDriver | null> | undefined;
  const host = job.screen_host;
  const screens = blueprint.screens.map((screen) => ({
    key: screen.key,
    path: screen.path.replace(/^\/screens\//, ""),
  }));
  const ensureView = () =>
    viewDriver ??= runnerView({
      command: host!.command,
      args: host!.args,
      work_dir: job.work,
      socket_path: job.sockets.probe,
      screens: {
        bundle_screens_dir: `${job.bundle}/screens`,
        screens,
        deadline_ms: 30_000,
      },
      invoke: (command, body) => live.driver!.command(command, body),
      sink: screenSink,
      scope,
      nonce,
      newReportId: () => ids.newId("rpt"),
      now,
    });
  const lazyView = host === null || screens.length === 0 ? null : {
    exception: async () => {
      const view = await ensureView();
      if (view === null) throw new Error("화면 검사 host를 띄울 수 없다");
      return await view.exception();
    },
    feedback: async () => {
      const view = await ensureView();
      if (view === null) throw new Error("화면 검사 host를 띄울 수 없다");
      return await view.feedback();
    },
  };

  const created = await createRealAppDriver({
    plan: plan.harness,
    blueprint,
    bundle: job.bundle,
    bundle_hash: job.bundle_hash,
    work: `${job.work}/driver`,
    sockets: job.sockets,
    deno: job.deno,
    entrypoint: new URL(
      "packages/core/apps/runtime/entrypoint/main.ts",
      root,
    ).pathname,
    base_module: new URL("packages/base/mod.ts", root).href,
    environment: job.environment,
    inputs: job.inputs,
    prepare: job.prepare,
    journal_tables: job.journal_tables,
    sink: {
      report(report) {
        forwarded.push({ kind: "report", code: report.code, scope });
        return hooks.collector
          ? hooks.collector.report(report)
          : Promise.resolve(ok(accepted(report.report_id)));
      },
      exception(body) {
        const id = (body as { report_id?: string } | null)?.report_id ??
          ids.newId("rpt");
        forwarded.push({ kind: "exception", code: "_exception", scope });
        return hooks.collector
          ? hooks.collector.exception(body)
          : Promise.resolve(ok(accepted(id)));
      },
    },
    view: lazyView,
  });
  if (!created.ok) return created;
  const driver = created.value;
  live.driver = driver;
  const served = serveRpc(scratch, driver);
  try {
    await Deno.writeTextFile(
      `${scratch}/child.json`,
      JSON.stringify({
        plan: plan.harness,
        source_dir: job.bundle,
        view: lazyView !== null,
        failure_paths: job.scenarios,
      }),
    );
    const finished = await acceptAppTest(
      {
        request_key: job.request_key,
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
          reads: [job.bundle, scratch],
          env: {},
          ...(job.request_timeout_ms === undefined
            ? {}
            : { request_timeout_ms: job.request_timeout_ms }),
          deno: job.deno,
          import_map: `${harness}/import-map.json`,
          // 자식 프로세스의 환경에만 간다. 메모리 경계를 거는 systemd-run이 사용자 bus를 찾는 데 쓰는
          // 값이고 자식 Deno에는 env 권한이 없어 읽지 못한다.
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
        test_hash: testHash,
        side: "single",
        start_attempt_at: now(),
        running: 0,
        preparing: 0,
      },
      input,
      { memory: platformMemory, started: hooks.started },
    );
    if (!finished.ok) return finished as Result<never>;
    const { execution, judgment } = finished.value;
    const domain: AppTestJobResult["domain"] = [];
    for (const probe of job.domain ?? []) {
      const seen = await driver.invoke(probe.command, probe.input ?? null, {
        inject_failure: probe.fault !== undefined && probe.fault !== "none",
        fault: probe.fault,
      });
      domain.push({
        name: probe.name,
        command: probe.command,
        outcome: seen.outcome,
        status: seen.response?.status ?? null,
        body: seen.response?.body ?? null,
        reports: seen.reports.map((report) => report.code),
      });
    }
    return ok({
      judgment,
      execution: {
        result: execution.result,
        reason: execution.reason,
        mode: execution.mode,
        exit_code: execution.outcome?.exit_code ?? null,
        end_reason: execution.outcome?.end_reason ?? null,
        started_at: execution.started_at,
        ended_at: execution.outcome?.ended_at ?? null,
        frames: execution.frames.length,
        output_tail: new TextDecoder().decode(execution.outcome?.output)
          .slice(-4000),
      },
      domain,
      forwarded,
    });
  } finally {
    await served.stop();
    await driver.close();
  }
}

export function jobError(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

// 시험 hash는 시나리오 하나의 정본 hash다(FrozenTest.failure_paths[].test_hash).
export function scenarioHash(path: HarnessFailurePath): string {
  return canonicalHash(path);
}
