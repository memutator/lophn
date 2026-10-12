// R5 앱 프로세스 독립 확인(docs/plan/platform.md T52). 한 앱이 ready 없이
// 정지해도, 다른 앱의 crash가 반복돼도, core 자신의 응답(PlatformHealth)이
// 기한 안에 계속된다. 감독 대상 앱은 실제 Deno fixture child(supervisor_test의
// real과 같은 모양)로 띄우고, 감독이 도는 동안 표본을 겹쳐 모은다. 감독 결과는
// 기한을 정리한다(bounded). core 응답은 T51 측정 harness(MEASURE_GOALS)의
// 목표로 잰다.
//
// Electron main 쪽 R5(shell과 함께)는 이 확인에 없다.
//
// 실행: deno test --allow-all packages/core/supervision/responsiveness/app-isolation_test.ts
import { assert, assertEquals, assertFalse } from "@std/assert";

import { createCoreHarness } from "../../testing/core.ts";
import { platformHealth } from "../../../protocol/server/mod.ts";
import { createRpcClient } from "../../../protocol/client/mod.ts";
import { systemClock } from "../../../base/mod.ts";
import { runScenario } from "./measure-run.ts";
import { MEASURE_GOALS, type RequestSample } from "./measure.ts";
import { measureEnabled } from "./measure-scenario_test.ts";
import { createSupervisor } from "./supervisor.ts";
import { hello, spec } from "./supervisor-fixture.ts";
import {
  buildReport,
  formatReport,
  type TargetSamples,
} from "./measure-report.ts";

const testdata = new URL("./testdata/", import.meta.url).pathname;
const SAMPLES = 20;
// 감독 최악 경로(기한 4회 + 재기동 대기 + teardown + adapter 확인)보다 큰 바깥 기한.
const SETTLE_MS = 30_000;

function readable() {
  return spec({
    entry: `${testdata}child.ts`,
    allow_read: [testdata],
    allow_env: ["LOPHN_FIXTURE_MODE"],
  });
}

/** fixture child를 감독한다. mode는 LOPHN_FIXTURE_MODE로 고른다. 기한은 테스트가 줄인다. */
function supervised(mode: string, readyMs: number) {
  return createSupervisor({
    clock: systemClock,
    denoCommand: Deno.execPath(),
    readyMs,
    env: () => ({ LOPHN_FIXTURE_MODE: mode }),
  });
}

async function sendRead(client: ReturnType<typeof rpc>) {
  const started = performance.now();
  const result = await client.call(platformHealth, {});
  const ms = performance.now() - started;
  return result.ok ? ms : "error";
}

const rpc = (port: number, token: string) =>
  createRpcClient({
    baseUrl: `http://127.0.0.1:${port}`,
    token,
    fetch: (input, init) =>
      fetch(input, init).then(async (response) => ({
        status: response.status,
        headers: response.headers,
        bytes: new Uint8Array(await response.arrayBuffer()),
      })),
  });

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 기한 안에 settle되는지 잰다. 감독이 막히지 않음을 증명한다(R5). */
async function settledWithin<T>(work: Promise<T>): Promise<T | "timeout"> {
  return await Promise.race([
    work,
    sleep(SETTLE_MS).then(() => "timeout" as const),
  ]);
}

/** 나쁜 앱이 도는 동안 무관한 대상 표본을 모은다(R5, R9와 같은 모양). */
async function sampleLoop(
  client: ReturnType<typeof rpc>,
): Promise<TargetSamples> {
  const samples: RequestSample[] = [];
  // 값은 안 버리고 그 표본의 끝 상태가 측정 누락이 없게 한다(R8).
  for (let index = 0; index < SAMPLES; index++) {
    const ms = await sendRead(client);
    samples.push(
      ms === "error"
        ? {
          outcome: "error" as const,
          ms: 0,
          exception: "insufficient_resources" as const,
        }
        : { outcome: "ended" as const, ms },
    );
  }
  return { target: "small_local_read", samples };
}

Deno.test({
  name:
    "platform/responsiveness#R5: 한 앱의 무한 loop와 다른 앱의 crash가 다른 앱·core 응답을 막지 않는다",
  ignore: !measureEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const opened = await createCoreHarness();
    assert(opened.ok, opened.ok ? "" : JSON.stringify(opened.error));
    const harness = opened.value;
    try {
      const issued = await harness.credential({
        actor: "user",
        principal: "measure-user",
        scope: {
          operations: ["PlatformHealth"],
          targets: {},
        },
        conditions: {},
      });
      assert(issued.ok, issued.ok ? "" : JSON.stringify(issued.error));
      const client = rpc(harness.port, issued.value.token);

      // 무부하 표본
      const quiet = await runScenario(
        { target: "small_local_read", warmup: 0, repetitions: SAMPLES },
        async () => {
          const ms = await sendRead(client);
          return ms === "error"
            ? { outcome: "error" as const, ms: 0, reason: "read 실패" }
            : { outcome: "ended" as const, ms };
        },
        sleep,
        { nowMs: () => performance.now() },
      );

      // 부하 1: 한 앱이 ready 없이 정지한다. supervisor는 ready 기한 안에 시작
      // 실패로 치고 그 child만 끝낸다. 그 감독이 도는 동안 표본을 겹쳐 모은다.
      const spinning = supervised("silent", 300);
      const spinStart = spinning.start(readable(), hello(), {
        onMessage: () => {},
      });
      await sleep(100);
      const underSpin = await sampleLoop(client);
      const spinResult = await settledWithin(spinStart);
      assert(spinResult !== "timeout", "정지 앱 감독이 기한을 넘겼다");
      assert(
        !spinResult.ok,
        JSON.stringify(spinning.observation("platform/io")),
      );
      assertFalse(spinning.observation("platform/io").available);
      // 그 child만 끝낸다. terminate는 group 전체 SIGKILL이다.
      assert(await spinning.stopAll());

      // 부하 2: 다른 앱이 ready 뒤 곧 crash한다(fixture "crash"). supervisor의
      // 반복 감독이 도는 동안 표본을 겹쳐 모은다.
      const crashing = supervised("crash", 2_000);
      const crashStart = crashing.start(readable(), hello(), {
        onMessage: () => {},
      });
      await sleep(100);
      const underCrash = await sampleLoop(client);
      const crashResult = await settledWithin(crashStart);
      assert(crashResult !== "timeout", "crash 앱 감독이 기한을 넘겼다");
      // crash child의 감독도 그 child만 정리하고 기한을 정리한다.
      assert(await crashing.stopAll());

      const report = buildReport(
        {
          device: `${navigator.hardwareConcurrency ?? "?"} logical CPU`,
          os: Deno.build.os,
          dataScale: "정지 앱 1 · crash 앱 1 · core harness",
          concurrency: 1,
        },
        [
          { target: quiet.target, samples: quiet.samples },
          underSpin,
          underCrash,
        ],
      );
      console.log(formatReport(report));
      // 무관한 대상의 응답은 어떤 부하에서도 끝 상태를 가진다(R8).
      assert(report.complete, "측정 누락이 있다");
      // 정지 감독과 crash 반복 동안 잰 read는 전부 ended다.
      for (const set of [underSpin, underCrash]) {
        const ended = set.samples.filter((sample) =>
          sample.outcome === "ended"
        ).length;
        assertEquals(ended, SAMPLES, "정지·crash 동안 read가 실패했다");
      }
      assert(
        MEASURE_GOALS["small_local_read"] !== undefined,
        "목표 표에 small_local_read가 있다",
      );
    } finally {
      await harness.close();
    }
  },
});
