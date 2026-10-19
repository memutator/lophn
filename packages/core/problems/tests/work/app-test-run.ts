// app test 한 건을 실제 runner 경로로 돌린다. 고정 bundle 사본에서 필수 검사 계획을 만들고, 실제 앱
// 자식·broker(app-driver.ts)를 띄우고, 요청마다 새 Deno test 자식(플랫폼 harness)을 runner의 격리 flag로
// 띄운 뒤, 자식이 private 통로로 낸 관측 frame을 판정한다. 결과를 ledger에 쓰는 것(RecordVerification)은
// 이 함수를 부른 쪽의 몫이다.
import { err, ok, type Result, sha256Hex } from "../../../../base/mod.ts";
import {
  type AppTestInput,
  type AppTestJudgment,
  generateAppTestChecks,
  readBundleFacts,
  serveRpc,
} from "../mod.ts";
import type { HarnessExample } from "../harness/mod.ts";
import { createRealAppDriver, type RealDriverInput } from "./app-driver.ts";
import { acceptAppTest, platformMemory } from "./runner-core.ts";

export type AppTestJob = {
  request_key: string;
  // 같은 runner가 동시에 도는 두 요청이 socket slot을 나눠 쓴다(launch spec이 정확한 경로를 허락한다).
  slot: 0 | 1;
  // 이 실행의 작업 폴더. runner 작업 root 안이고 비어 있어야 한다.
  work: string;
  // 이 slot의 고정 socket 경로(broker·control).
  sockets: { broker: string; control: string };
  // 봉인 bundle 사본(읽기 전용)과 그 hash.
  bundle: string;
  bundle_hash: string;
  // 고정 시험(FrozenTest)의 hash다. 관측 frame은 이 hash를 달고 와야 한다.
  test_hash: string;
  // 고정 시험이 고정한 의존 목록의 hash(FrozenTest.sdk_dependencies).
  dependencies_hash: string;
  // 이전 release의 data schema(없으면 null).
  previous_schema: number | null;
  // 있으면 ticket의 예시를 검증하는 실행이다(예시 검사만 돈다).
  examples?: HarnessExample[];
  timeout_ms: number;
  // 접수한 요청의 실행 기한(RequestTest `timeout_ms`)이다. 동결 method의 timeout_ms보다 길어지지 않는다(짧은 쪽).
  request_timeout_ms?: number;
  // 보고의 진단 scope. 제품 경로에서는 요청별 credential이 고정한 값이다. 없으면 요청 key에서 정한다.
  scope?: string;
  // 자식 flag·환경에 쓰는 runner 설치 자료.
  deno: string;
  environment: { home?: string; denoDir?: string; xdgCacheHome?: string };
};

type AppTestJobResult = {
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
  // collector에 mode=test와 scope로 넘긴 보고(이름과 종류)다.
  forwarded: { kind: string; name: string; scope: string }[];
};

// 제품 runner의 연결이다. 없으면(stdin 한 건 모드) 한 요청 안의 collector 대역이 mode=test·scope로 접수한
// 보고를 모은다.
export type AppTestHooks = {
  // 자식이 실제로 시작한 것을 관측한 직후, 끝나기를 기다리기 전에 부른다.
  started?: (child: { started_at: string; mode: string }) => Promise<void>;
  // 실제 collector 연결. 앱 SDK 보고와 잡은 예외를 그 요청의 mode=test·scope로 core에 넘긴다.
  collector?: {
    report: RealDriverInput["sink"]["report"];
    exception: RealDriverInput["sink"]["exception"];
  };
};

const HARNESS_TEST = (child: string, scratch: string) =>
  `import { runHarnessChild } from ${JSON.stringify(child)};
Deno.test("problems/tests: platform harness child", async () => {
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
  const read = await readBundleFacts(job.bundle);
  if (!read.ok) return err({ code: "invalid_input", message: read.reason });
  const facts = read.value;
  const blueprint = facts.blueprint;
  const input: AppTestInput = {
    bundle_hash: job.bundle_hash,
    test_hash: job.test_hash,
    tools: blueprint.tools.map((tool) => ({
      key: tool.name,
      effect: tool.effect,
    })),
    data: {
      schema: await migrationSchema(job.bundle),
      previous_schema: job.previous_schema,
    },
    dependencies: facts.dependencies,
    imports: facts.imports,
    frozen: { sdk_dependencies: job.dependencies_hash },
    ...(job.examples === undefined ? {} : { examples: job.examples }),
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

  const scope = job.scope ?? `app-test-${job.request_key}`;
  const forwarded: AppTestJobResult["forwarded"] = [];
  const now = () => new Date().toISOString();
  const created = await createRealAppDriver({
    plan: plan.harness,
    blueprint,
    bundle: job.bundle,
    bundle_hash: job.bundle_hash,
    entrypoint: facts.entrypoint,
    work: `${job.work}/driver`,
    sockets: job.sockets,
    deno: job.deno,
    environment: job.environment,
    sink: {
      report(report) {
        forwarded.push({ kind: "report", name: report.name, scope });
        return hooks.collector
          ? hooks.collector.report(report)
          : Promise.resolve(ok(null));
      },
      exception(body) {
        forwarded.push({ kind: "exception", name: "exception", scope });
        return hooks.collector
          ? hooks.collector.exception(body)
          : Promise.resolve(ok(null));
      },
    },
  });
  if (!created.ok) return created;
  const driver = created.value;
  const served = serveRpc(scratch, driver);
  try {
    await Deno.writeTextFile(
      `${scratch}/child.json`,
      JSON.stringify({ plan: plan.harness }),
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
        test_hash: job.test_hash,
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
      forwarded,
    });
  } finally {
    await served.stop();
    await driver.close();
  }
}
