// 실제 core를 임시 LOPHN_HOME으로 띄워 응답을 새는 측정 시나리오
// (docs/plan/platform.md T51). `LOPHN_MEASURE=1 deno test --allow-all
// packages/core/supervision/responsiveness/measure-scenario_test.ts`로 opt-in으로만
// 돈다. 사람 장치에서 여러 worker가 도는 동안엔 무겁고 흔들리므로,
// `deno task check`의 test 단계에서는 건너뛴다. 실제 ~/.lophn은 읽지도 쓰지도 않는다.
import { assert } from "@std/assert";

import { createCoreHarness } from "../../testing/core.ts";
import {
  createRpcClient,
  platformHealth,
} from "../../../protocol/server/mod.ts";
import { buildReport, formatReport } from "./measure-report.ts";
import { runScenario } from "./measure-run.ts";

/** 측정을 켜는 env. `deno task check`의 test 단계에선 꺼져 있다. */
export const MEASURE_FLAG = "LOPHN_MEASURE";

/** 측정 시나리오를 돌릴지. `LOPHN_MEASURE=1`일 때만 돈다. */
export function measureEnabled(): boolean {
  return Deno.env.get(MEASURE_FLAG) === "1";
}

// R8의 방법: warm-up 30초 뒤 대상별 반복 요청. 이 시나리오는 merge gate가
// 아니므로 반복 개수는 사람의 opt-in 실행에서 바꾼다.
const WARMUP_MS = 30_000;
const REPETITIONS = 1_000;

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

/** read 하나의 전송 직전부터 완전 응답까지를 잰다. */
async function sendRead(
  client: ReturnType<typeof rpc>,
): Promise<number | "error"> {
  const start = performance.now();
  const result = await client.call(platformHealth, {});
  const ms = performance.now() - start;
  return result.ok ? ms : "error";
}

Deno.test({
  name:
    "platform/responsiveness#R8: 측정 시나리오는 warm-up 뒤 실제 core에 대상별 요청을 반복해 표본을 남긴다",
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
          operations: ["PlatformStatus", "PlatformHealth"],
          targets: {},
        },
        conditions: {},
      });
      assert(issued.ok, issued.ok ? "" : issued.error.message);
      const client = rpc(harness.port, issued.value.token);

      // warm-up: 준비가 끝난 core에서 대상 요청을 미리 보낸다(R8).
      const warmDeadline = performance.now() + WARMUP_MS;
      while (performance.now() < warmDeadline) {
        const warmed = await sendRead(client);
        assert(warmed !== "error", "warm-up 요청이 실패했다");
      }

      // 대상 측정: 반복 요청마다 끝 상태와 시간을 기록한다(R8, R10).
      const read = await runScenario(
        {
          target: "small_local_read",
          warmup: 0,
          repetitions: REPETITIONS,
        },
        async () => {
          const ms = await sendRead(client);
          return ms === "error"
            ? { outcome: "error" as const, ms: 0, reason: "read 실패" }
            : { outcome: "ended" as const, ms };
        },
        (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        {
          nowMs: () => performance.now(),
        },
      );

      const report = buildReport(
        {
          device: `${navigator.hardwareConcurrency ?? "?"} logical CPU`,
          os: Deno.build.os,
          dataScale: "harness temp root(비어 있는 ledger)",
          concurrency: 1,
        },
        [{ target: read.target, samples: read.samples }],
      );
      console.log(formatReport(report));
      // 목표 미달은 이 테스트의 실패가 아니라 사람의 판단 몫이다. 측정 조건이
      // 사람 장치마다 다르므로 결과만 보고한다.
    } finally {
      await harness.close();
    }
  },
});
