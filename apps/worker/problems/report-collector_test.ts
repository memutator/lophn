// report collector worker 경계의 테스트. 이름은 요구 번호로 시작한다(dev/tasks.md).
// 실제 startChild 경계를 흔든다: stdin frame은 미리 준비하고 run() 종료를 기다린다.
import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  encodeFrame,
  type Frame,
  FrameDecoder,
} from "../../../packages/contracts/platform/mod.ts";
import {
  type ByteReader,
  type ByteWriter,
} from "../../../packages/platform/responsiveness/frames.ts";
import { type ChildStreams } from "../../../packages/platform/responsiveness/mod.ts";
import {
  acceptReportProblem,
  COLLECTOR_KIND,
  type CollectorPosition,
  createCollectorWorker,
} from "./report-collector.ts";
import { reportCollectorSpec } from "../../core/problems-runner.ts";
import { createCollectorQueue } from "../../../packages/problems/reporting/mod.ts";
import {
  createKnownSecretRegistry,
  createRedactionEngine,
} from "../../../packages/platform/redaction/mod.ts";
import type { CoreClientOptions } from "../../../packages/problems/reporting/adapters/core-client.ts";

const hello = {
  type: "hello" as const,
  core_epoch: "epoch",
  process_identity: "process",
  kind: COLLECTOR_KIND,
  task: "problems",
  scope: { operations: ["problems/record-report"], targets: {} },
  credential: "token-never-record",
  api_port: 7431,
};

// 미리 준 frame들을 순서대로 내주고 끝나면 EOF로 막는다(child_test.ts 모양).
function queuedStdin(frames: Uint8Array[]): ByteReader {
  const queue = [...frames];
  let closed = false;
  return {
    read: (buffer) => {
      const next = queue.shift();
      if (next) {
        buffer.set(next.subarray(0, buffer.length));
        return Promise.resolve(Math.min(buffer.length, next.length));
      }
      closed = true;
      return Promise.resolve(closed ? null : 0);
    },
  };
}

function streams(stdin: ByteReader): {
  streams: ChildStreams;
  output: Frame[];
} {
  const lines: string[] = [];
  const output: Frame[] = [];
  const decoder = new FrameDecoder();
  const writer: ByteWriter = {
    write: (bytes) => {
      lines.push(new TextDecoder().decode(bytes));
      output.push(...decoder.push(bytes));
      return Promise.resolve(bytes.length);
    },
  };
  return {
    streams: {
      stdin,
      stdout: writer,
      stderr: { write: () => Promise.resolve(0) },
    },
    output,
  };
}

Deno.test("problems/reporting#R1: 다른 kind hello는 protocol 위반으로 run을 reject한다", async () => {
  const { streams: pipes } = streams(
    queuedStdin([
      encodeFrame({
        kind: "json",
        channel: 0,
        payload: { ...hello, kind: "problems/test-runner" },
      }),
    ]),
  );
  const session = createCollectorWorker({
    streams: pipes,
    accept: () => Promise.resolve({}),
  });
  await assertRejects(() => session.run(), Error, "invalid worker kind");
});

Deno.test("problems/reporting#R1: 준비 hello 뒤 ready를 내고 EOF 뒤 stopped를 보낼 수 있다", async () => {
  const { streams: pipes, output } = streams(
    queuedStdin([
      encodeFrame({ kind: "json", channel: 0, payload: hello }),
    ]),
  );
  let cancelled = 0;
  const session = createCollectorWorker({
    streams: pipes,
    cancelled: () => {
      cancelled += 1;
      return true;
    },
    accept: () => Promise.resolve({}),
  });
  await session.run();
  assertEquals(cancelled, 1, "EOF는 cleanup을 정확히 한 번 부른다");
  assertEquals(output.length, 2, "ready와 stopped가 나온다");
  assertEquals((output[0] as { kind: string; payload: unknown }).payload, {
    type: "ready",
  });
  assertEquals(
    output.filter((value) =>
      value.kind === "json" &&
      (value.payload as { type: string }).type === "stopped"
    ).length,
    1,
  );
});

Deno.test("problems/reporting#R2: 요청은 accept로 넘기고 응답은 ok true payload다", async () => {
  const { streams: pipes, output } = streams(
    queuedStdin([
      encodeFrame({ kind: "json", channel: 0, payload: hello }),
      encodeFrame({
        kind: "json",
        channel: 0,
        payload: {
          type: "worker_request",
          request_id: "cred-1/1",
          op: "AssembleReport",
          payload: { claimed: true },
        },
      }),
    ]),
  );
  const accepted: unknown[] = [];
  const session = createCollectorWorker({
    streams: pipes,
    accept: (request) => {
      accepted.push(request);
      return Promise.resolve({ answer: "ok" });
    },
  });
  await session.run();
  assertEquals(accepted.length, 1);
  assertEquals(
    (accepted[0] as { payload: unknown }).payload,
    { claimed: true },
  );
  const responses = output.filter((value) =>
    value.kind === "json" &&
    (value.payload as { type: string }).type === "worker_response"
  );
  assertEquals(responses.length, 1);
  assertEquals((responses[0] as { payload: unknown }).payload, {
    type: "worker_response",
    request_id: "cred-1/1",
    ok: true,
    payload: { answer: "ok" },
  });
});

Deno.test("problems/reporting#R2: accept 실패는 unavailable 응답이고 본문을 노출하지 않는다", async () => {
  const { streams: pipes, output } = streams(
    queuedStdin([
      encodeFrame({ kind: "json", channel: 0, payload: hello }),
      encodeFrame({
        kind: "json",
        channel: 0,
        payload: {
          type: "worker_request",
          request_id: "cred-1/2",
          op: "AssembleReport",
          payload: { secret: "token-never-record" },
        },
      }),
    ]),
  );
  const session = createCollectorWorker({
    streams: pipes,
    accept: () => Promise.reject(new Error("secret-body leaked")),
  });
  await session.run();
  const responses = output.filter((value) =>
    value.kind === "json" &&
    (value.payload as { type: string }).type === "worker_response"
  );
  assertEquals(responses.length, 1);
  const failure = (responses[0] as { payload: unknown }).payload as {
    type: string;
    ok: boolean;
    error: { code: string; message: string };
  };
  assertEquals(failure.ok, false);
  assertEquals(failure.error.code, "unavailable");
  assertEquals(failure.error.message, "report collector failed");
  assertEquals(
    output.every((value) => !JSON.stringify(value).includes("secret-body")),
    true,
  );
});

Deno.test("problems/tests#R13: collector launch spec은 쓰기·자식 실행·FFI 권한이 없고 loopback만 닿는다", () => {
  const spec = reportCollectorSpec({ dataRoot: "/tmp/lophn-home" });
  assertEquals(spec?.kind, "problems/report-collector");
  assertEquals(spec?.allow_write, []);
  assertEquals(spec?.allow_run, []);
  assertEquals(spec?.allow_sys, []);
  assertEquals(spec?.allow_net, ["127.0.0.1"]);
  assertEquals(spec?.policy, "always");
  // architecture 2.2: LOPHN_HOME 전체가 아니라 읽기 전용 준비 폴더만 닿는다.
  assertEquals(spec?.allow_read.includes("/tmp/lophn-home"), false);
  // 환경은 띄운 뒤 root·kind를 읽는 것뿐이다. HOME·PATH 같은 일반 env는 없다.
  assertEquals(spec?.allow_env, ["LOPHN_HOME", "LOPHN_WORKER_KIND"]);
  assertEquals(reportCollectorSpec({ dataRoot: "relative" }), undefined);
});

// 실제 redaction 엔진을 거친 보고 접수(problems/reporting#R1). ledger 행에
// 닿는 조립값은 POST envelope이므로 fetch를 갈아껴 envelope을 모은다.
function capturingClient(
  captured: { envelope?: unknown },
): CoreClientOptions {
  const acceptance = {
    report: "rpt_01arz3ndektsv4rrffq69g5fav",
    snapshot: "snp_01arz3ndektsv4rrffq69g5fav",
    problem: "prb_01arz3ndektsv4rrffq69g5fav",
    diagnostic_scope: null,
  };
  return {
    baseUrl: "http://127.0.0.1:0",
    credential: "token-never-record",
    fetch: (_input, init) => {
      captured.envelope = JSON.parse(init.body);
      return Promise.resolve({
        status: 200,
        bytes: new TextEncoder().encode(JSON.stringify(acceptance)),
      });
    },
  };
}

function position(claims: CollectorPosition["claims"]): CollectorPosition {
  return { credential: "token-never-record", api_port: 0, claims };
}

function fakeSession(): import("../../../packages/platform/responsiveness/mod.ts").ChildSession {
  const noop = () => Promise.resolve();
  return {
    send: noop,
    sendBytes: noop,
    stopped: false,
    credentialUsable: true,
    readAhead: {} as never,
    run: noop,
  };
}

const CLAIMED = position({
  app: "app_01arz3ndektsv4rrffq69g5fav",
  release: "rel_01arz3ndektsv4rrffq69g5fav",
  process: "collector-test",
  mode: "test",
  diagnostic_scope: "apps/worker/problems/report-collector",
});

Deno.test("problems/reporting#R1: secret 형태의 text·details는 redaction 엔진을 거치고 저장 조립값과 snapshot에 남지 않는다", async () => {
  const known = createKnownSecretRegistry();
  const secret = "sk-ant-AAAAdemo1234567890abcdef";
  known.register([secret]);
  const redaction = createRedactionEngine({ registry: known });
  const queue = createCollectorQueue({
    pending_count: 8,
    pending_bytes: 65536,
  });
  const captured: { envelope?: Record<string, unknown> } = {};
  const payload = {
    report_id: "rpt_01arz3ndektsv4rrffq69g5fav",
    code: "save_failed",
    observed_at: "2026-10-04T12:00:00.000Z",
    text: `token: ${secret} and sk-[A-Za-z0-9]{20,} is not a literal but AKIA${
      "B".repeat(16)
    } is`,
    details: {
      nested: {
        openai: `sk-${"C".repeat(24)}`,
        jwt: `${"D".repeat(12)}.${"E".repeat(12)}.${"F".repeat(12)}`,
      },
    },
  };
  await acceptReportProblem(
    payload,
    capturingClient(captured),
    redaction,
    queue,
    fakeSession(),
    CLAIMED,
  );
  assert(captured.envelope !== undefined);
  const serialized = JSON.stringify(captured.envelope);
  // 등록한 known secret과 credential pattern 값이 조립값 어디에도 남지 않는다.
  assertEquals(serialized.includes(secret), false);
  assertEquals(serialized.includes(`sk-${"C".repeat(24)}`), false);
  assertEquals(
    serialized.includes(
      `${"D".repeat(12)}.${"E".repeat(12)}.${"F".repeat(12)}`,
    ),
    false,
  );
  assertEquals(serialized.includes(`AKIA${"B".repeat(16)}`), false);
  assertEquals(captured.envelope["prepared"], []);
  const input = captured.envelope["input"] as {
    report: { text: string | null; details: string | null };
    snapshot: Record<string, unknown>;
  };
  // permanent content는 hash뿐이다: text·details 열은 null이고 snapshot 증거도 없다.
  assertEquals(input.report.text, null);
  assertEquals(input.report.details, null);
  assertEquals(input.snapshot.invocation, null);
  assertEquals(input.snapshot.error, null);
  assertEquals(input.snapshot.logs, null);
  assertEquals(input.snapshot.screen, null);
  // 제출 성공 뒤 대기 큐에서 빠진다(R16).
  assertEquals(queue.size, 0);
});

Deno.test("problems/reporting#R1: app·mode 주장이 없는 credential은 추측값 대신 잘못된 보고 진단으로 거절한다", async () => {
  const redaction = createRedactionEngine({
    registry: createKnownSecretRegistry(),
  });
  const queue = createCollectorQueue({
    pending_count: 8,
    pending_bytes: 65536,
  });
  const captured: { envelope?: Record<string, unknown> } = {};
  const payload = {
    report_id: "rpt_01arz3ndektsv4rrffq69g5fav",
    code: "save_failed",
    observed_at: "2026-10-04T12:00:00.000Z",
    text: "no claims here",
  };
  await assertRejects(
    () =>
      acceptReportProblem(
        payload,
        capturingClient(captured),
        redaction,
        queue,
        fakeSession(),
        position({}),
      ),
    Error,
    "report credential has no app or mode claim",
  );
  // envelope에 닿지 않았다: 거절이 제출보다 앞선다.
  assertEquals(captured.envelope, undefined);
  assertEquals(queue.size, 0);
});
