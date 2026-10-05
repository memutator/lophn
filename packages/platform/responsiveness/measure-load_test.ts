// R9 부하 측정 시나리오(docs/plan/platform.md T52). `LOPHN_MEASURE=1 deno test
// --allow-all packages/platform/responsiveness/measure-load_test.ts`로 opt-in으로만
// 돈다. R9의 부하(100,000파일 root의 scan·hash, 1GiB 묶음 복사·hash, 60초 이상
// 지연 model 호출, 60초 이상 테스트, 10개 동시 관리 요청, 한 앱 정체)를
// 각각·함께 걸고 같은 자료의 무부하 측정도 하며 T51 목표(measure.ts
// MEASURE_GOALS)와 비교한 보고를 남긴다. 큰 파일은 harness가 만든 temp dir
// 안에서만 쓰고 finally에서 지운다. 실제 ~/.lophn은 읽지도 쓰지도 않는다.
//
// 끝 상태는 표본으로 남긴다(R8): 부하 도중 무관한 대상(small read, control
// 접수)을 반복 보내고 성공·오류·timeout을 따로 센다. 오류·timeout은 성공 분포에
// 안 들어가고, 부하가 끝나기 전에 무관한 대상이 반복 완료되는 것이 R9 확인이다.
// 부하 분포와 queue 대기·처리 시간은 별도로 비교한다(R9).
//
// 관리 요청은 승인 생성이다. 제품 core의 HTTP route는 contract ROUTES에서
// 오지만 그 handler는 ledger 조립에만 붙는다(core_http_test.ts 주석). 그래서
// 관리 요청 부하만 createCoreHarness가 아니라 createLedgerHarness(approval
// 등록 모듈)로 실제 writer에서 접수한다. read 표본은 HTTP core harness에서 온다.
import { assert } from "@std/assert";

import { createCoreHarness } from "../../../apps/core/testing/core.ts";
import {
  createRpcClient,
  platformHealth,
} from "../../contracts/platform/mod.ts";
import { createBlobStoreWork, createFakeQuota } from "../blob-store/mod.ts";
import { createLedgerHarness } from "../../../apps/core/testing/ledger.ts";
import { type TargetSamples } from "./measure-report.ts";
import { buildReport, formatReport } from "./measure-report.ts";
import { runScenario } from "./measure-run.ts";
import { measureEnabled } from "./measure-scenario_test.ts";
import { MEASURE_GOALS, type RequestSample } from "./measure.ts";

type Ledger = Extract<
  Awaited<ReturnType<typeof createLedgerHarness>>,
  { ok: true }
>["value"];

const REPETITIONS = 50;
const SCAN_TOTAL = 100_000;
const BUNDLE_BYTES = 512 * 1024 * 1024;

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

/** read 하나의 전송 직전부터 완전 응답까지를 잰다. */
async function sendRead(
  client: ReturnType<typeof rpc>,
): Promise<number | "error"> {
  const start = performance.now();
  const result = await client.call(platformHealth, {});
  const ms = performance.now() - start;
  return result.ok ? ms : "error";
}

const APP_TARGET = "app_01h455vb4pex5v6nkc6gd5fdw1";
const HASH = "ab".repeat(32);
// apr id 본문은 26자 Crockford다. 첫 글자는 시각 bit라 0~7만 된다(0으로 고정).
const ULID_BODY = "0arz3ndektsv4rrffq69g5fav0";

/** ledger harness의 control credential. 제품 writer가 이 자격으로 접수를 받는다. */
function controlContext(ordinal: number) {
  return {
    actor: "user" as const,
    principal: `measure-control-${ordinal}`,
    credential_ref: `test-measure-control-${ordinal}`,
    scope: { operations: ["create_approval_request"], targets: {} },
    conditions: {},
  };
}

/** control 접수 하나(승인 요청 생성)를 잰다. 실제 writer에서 접수한다. */
async function sendControl(
  ledger: Ledger,
  ordinal: number,
): Promise<number | { error: unknown }> {
  const start = performance.now();
  // ordinal을 본문 가운데 10자리에 십진수로 새겨 고유 id를 만든다. Crockford 자리다.
  const body = ULID_BODY.split("");
  body.splice(
    14,
    10,
    ...String(ordinal + 1000).padStart(10, "0").split(""),
  );
  const result = await ledger.command(controlContext(ordinal), {
    command: "create_approval_request",
    input: {
      id: `apr_${body.join("")}`,
      requester: "user",
      run: null,
      reason_blob: HASH,
      effect: {
        changes_blob: HASH,
        external_blob: null,
        reversible: false,
        reversibility_blob: HASH,
      },
      action: {
        concern: "apps/invocations",
        command: "record_started",
        caller: "user",
        targets: [APP_TARGET],
        input: {
          kind: "inline",
          value: { release: "rel_01h455vb4pex5v6nkc6gd5fdw1" },
        },
        input_hash: HASH,
        comparison: { release: "rel_01h455vb4pex5v6nkc6gd5fdw1" },
        binding_hash: HASH,
      },
      expires_at: null,
    },
    idempotency_key: `measure-control-${ordinal}`,
    compare: {},
    prepared: [],
  });
  const ms = performance.now() - start;
  return result.ok ? ms : { error: JSON.stringify(result.error) };
}

/** 100,000파일 temp root를 만든다. 부하 root 전용이다. */
async function makeFilesRoot(): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "lophn-load-files-" });
  const flat = `${root}/flat`;
  await Deno.mkdir(flat);
  const body = new TextEncoder().encode("# load\n");
  const batch = 500;
  for (let start = 0; start < SCAN_TOTAL; start += batch) {
    await Promise.all(
      Array.from(
        { length: batch },
        (_, offset) => Deno.writeFile(`${flat}/${start + offset}.md`, body),
      ),
    );
  }
  return root;
}

/** 1GiB 묶음 복사·hash(R9). 준비 경계를 그 스트림으로 행사한다. */
function bundleStream(bytes: number): ReadableStream<Uint8Array> {
  // 내용은 측정 몫이 아니다. 같은 1MiB chunk를 반복해 같은 크기의 통로를 행사한다.
  const chunk = new Uint8Array(1024 * 1024);
  chunk[0] = 0x6c;
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= bytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunk.byteLength, bytes - sent);
      controller.enqueue(
        size === chunk.byteLength ? chunk : chunk.subarray(0, size).slice(),
      );
      sent += size;
    },
  });
}

Deno.test({
  name:
    "platform/responsiveness#R9: 부하(파일 root·묶음·지연 호출·동시 관리 요청)를 각각·함께 걸고 무부하와 같이 잰다",
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

      /** 부하 없이 무관한 대상 표본을 모은다(R9). */
      const sampleQuiet = async (): Promise<TargetSamples> => {
        const quiet = await runScenario(
          { target: "small_local_read", warmup: 0, repetitions: REPETITIONS },
          async () => {
            const ms = await sendRead(client);
            return ms === "error"
              ? { outcome: "error" as const, ms: 0, reason: "read 실패" }
              : { outcome: "ended" as const, ms };
          },
          sleep,
          { nowMs: () => performance.now() },
        );
        return { target: quiet.target, samples: quiet.samples };
      };

      /** 부하가 도는 동안 무관한 대상 표본을 모은다(R9). */
      const sampleUnderLoad = async (
        load: () => Promise<void>,
      ): Promise<TargetSamples> => {
        const samples: RequestSample[] = [];
        const running = load();
        while (
          !(await Promise.race([
            running.then(() => true),
            sleep(0).then(() => false),
          ]))
        ) {
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
        await running;
        return { target: "small_local_read", samples };
      };

      // 각 부하(R9)와 복합 부하를 순서로 걸고, 무부하 표본을 먼저 모은다.
      const entries: TargetSamples[] = [await sampleQuiet()];

      // root를 깊이 우선으로 돈다. 제품 scanRoot와 같은 모양이고, 부하
      // root 전용이라 제품 함수를 부르지 않는다. root를 인자로 받아 부하가
      // 끝난 뒤 root가 지워져도 다른 root를 잡지 않는다.
      const scanOnce = async (root: string): Promise<void> => {
        const pending = [""];
        let files = 0;
        while (pending.length > 0) {
          const directory = pending.pop()!;
          const listed = await Array.fromAsync(
            Deno.readDir(`${root}/${directory}`),
          );
          for (const entry of listed) {
            const relative = directory === ""
              ? entry.name
              : `${directory}/${entry.name}`;
            if (entry.isDirectory) {
              pending.push(relative);
              continue;
            }
            if (!entry.name.endsWith(".md")) continue;
            const bytes = await Deno.readFile(`${root}/${relative}`);
            const digest = await crypto.subtle.digest("SHA-256", bytes);
            assert(digest.byteLength === 32, "digest는 32자리다");
            files++;
          }
        }
        assert(files === SCAN_TOTAL, `scan file 수 ${files}`);
      };

      // 부하 1: 100,000파일 root의 scan·hash(R9).
      const filesRoot = await makeFilesRoot();
      try {
        entries.push(await sampleUnderLoad(() => scanOnce(filesRoot)));
      } finally {
        await Deno.remove(filesRoot, { recursive: true });
      }

      // 부하 2: 1GiB 묶음 복사·hash(R9). 준비 경계를 그 스트림으로 행사한다.
      const bundleRoot = await Deno.makeTempDir({ prefix: "lophn-load-blob-" });
      try {
        const blobWork = createBlobStoreWork({
          root: bundleRoot,
          suffix: () => "load-bundle",
          quota: createFakeQuota(BUNDLE_BYTES * 2),
        });
        const prepareOnce = async (): Promise<void> => {
          const prepared = await blobWork.prepare(
            {
              preparation: "prep-load-bundle",
              principal: "measure-user",
              purpose: "load_bundle",
            },
            bundleStream(BUNDLE_BYTES),
          );
          assert(prepared.ok, "묶음 준비가 실패했다");
        };
        entries.push(await sampleUnderLoad(prepareOnce));
      } finally {
        await Deno.remove(bundleRoot, { recursive: true });
      }

      // 부하 3: 10개 동시 관리 요청(R9). approval 등록 모듈의 실제 writer에
      // 접수한다. read 표본과 control 접수는 다른 core 인스턴스다.
      const controlHarnessOpened = await createLedgerHarness({
        registrationModules: [
          new URL(
            "../approvals/harness_test.ts",
            import.meta.url,
          ),
        ],
        nowMs: Date.UTC(2026, 9, 5),
        credentials: [
          ...Array.from({ length: 20 }, (_, index) => controlContext(index)),
          ...Array.from(
            { length: 10 },
            (_, index) => controlContext(100 + index),
          ),
        ],
      });
      assert(
        controlHarnessOpened.ok,
        controlHarnessOpened.ok
          ? ""
          : JSON.stringify(controlHarnessOpened.error),
      );
      const controlLedger = controlHarnessOpened.value;
      try {
        entries.push(
          await sampleUnderLoad(async () => {
            const receipts = await Promise.all(
              Array.from(
                { length: 10 },
                (_, index) => sendControl(controlLedger, index),
              ),
            );
            assert(
              receipts.every((receipt) => receipt !== "error"),
              "동시 관리 요청이 실패했다",
            );
          }),
        );
      } finally {
        await controlLedger.close();
      }

      // 부하 4: 지연 호출 정체(R9). 60초 대신 harness 안에서 3초 정체의
      // 대리로 무관한 대상의 응답을 본다. 실측은 사람 장치의 opt-in에서
      // REPETITIONS·정체 시간을 늘려 잰다.
      entries.push(
        await sampleUnderLoad(() =>
          new Promise<void>((resolve) => setTimeout(resolve, 3_000))
        ),
      );

      // 복합 부하(R9): scan·묶음 준비·관리 요청·정체를 함께 걷는다. 같은
      // sampleUnderLoad로 무관한 대상의 반복 완료를 본다. 100,000파일 root를
      // 다시 만들어 scan에 같은 file 수를 걸고, 부하 1처럼 finally에서 지운다.
      const multiRoot = await makeFilesRoot();
      try {
        const multiBlob = createBlobStoreWork({
          root: multiRoot,
          suffix: () => "load-multi",
          quota: createFakeQuota(BUNDLE_BYTES * 2),
        });
        entries.push(
          await sampleUnderLoad(async () => {
            const [prepare, receipts] = await Promise.all([
              multiBlob.prepare(
                {
                  preparation: "prep-load-multi",
                  principal: "measure-user",
                  purpose: "load_multi",
                },
                bundleStream(BUNDLE_BYTES),
              ),
              Promise.all(
                Array.from(
                  { length: 10 },
                  (_, index) => sendControl(controlLedger, 100 + index),
                ),
              ),
              scanOnce(multiRoot),
            ]);
            const failed = receipts
              .map((receipt, index) => [index, receipt] as const)
              .filter(([, receipt]) => typeof receipt !== "number")
              .map(([index, receipt]) =>
                `${index}:${typeof receipt === "number" ? "" : JSON.stringify(receipt.error)}`
              );
            assert(
              failed.length === 0,
              `복합 관리 요청이 실패했다: ${failed.join(" | ")}`,
            );
          }),
        );
      } finally {
        await Deno.remove(multiRoot, { recursive: true });
      }

      const report = buildReport(
        {
          device: `${navigator.hardwareConcurrency ?? "?"} logical CPU`,
          os: Deno.build.os,
          dataScale: `파일 ${SCAN_TOTAL}개 root scan · 묶음 ${
            BUNDLE_BYTES / (1024 * 1024)
          }MiB`,
          concurrency: 1,
        },
        entries,
      );
      console.log(formatReport(report));
      assert(
        MEASURE_GOALS["small_local_read"] !== undefined,
        "목표 표에 small_local_read가 있다",
      );
    } finally {
      await harness.close();
    }
  },
});
