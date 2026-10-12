// report collector worker 경계의 테스트. 이름은 요구 번호로 시작한다(dev/tasks.md).
// 실제 startChild 경계를 흔든다: stdin frame은 미리 준비하고 run() 종료를 기다린다.
import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  encodeFrame,
  type Frame,
  FrameDecoder,
} from "../../../../protocol/supervision/mod.ts";
import {
  type ByteReader,
  type ByteWriter,
} from "../../../supervision/responsiveness/frames.ts";
import { type ChildStreams } from "../../../supervision/responsiveness/mod.ts";
import {
  acceptReportProblem,
  COLLECTOR_KIND,
  type CollectorLogs,
  type CollectorPosition,
  createCollectorWorker,
  observeExceptionPayload,
} from "./collector.ts";
import { ok } from "../../../../base/mod.ts";
import { recordReportInputSchema } from "../../../../protocol/problems/mod.ts";
import type { AppLogQuery } from "../../snapshots/mod.ts";
import { reportCollectorSpec } from "../../tests/runner.ts";
import { createCollectorQueue } from "../mod.ts";
import {
  createKnownSecretRegistry,
  createRedactionEngine,
} from "../../../../base/redaction/mod.ts";
import type { CoreClientOptions } from "../adapters/core-client.ts";

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

type PrepareCall = { purpose: string; sizeBytes: number; text: string };

// prepareBlob은 준비 통로의 결과만 흉내 낸다. hash는 자식이 정하지 않으므로 core가 준
// 값처럼 호출 순서로 정한다. 호출은 calls에 모아 본문이 나갔는지 본다.
function fakeSession(
  calls: PrepareCall[] = [],
  fail = false,
): import("../../../supervision/responsiveness/mod.ts").ChildSession {
  const noop = () => Promise.resolve();
  return {
    send: noop,
    sendBytes: noop,
    sendEnd: noop,
    sendAbort: noop,
    prepareBlob: async (input) => {
      const body = input.bytes as Uint8Array;
      calls.push({
        purpose: input.purpose,
        sizeBytes: input.sizeBytes,
        text: new TextDecoder().decode(body),
      });
      await Promise.resolve();
      if (fail) {
        return { ok: false, error: { code: "unavailable", message: "x" } };
      }
      const n = calls.length;
      return {
        ok: true,
        value: {
          preparation: `prep-${n}`,
          principal: "collector",
          purpose: input.purpose,
          hash: String(n).repeat(64),
          size_bytes: input.sizeBytes,
        },
      };
    },
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

Deno.test("problems/reporting#R1: secret 형태의 text·details는 redaction 통과 내용만 blob 준비하고 snapshot에는 남지 않는다", async () => {
  const known = createKnownSecretRegistry();
  const secret = "sk-ant-AAAAdemo1234567890abcdef";
  known.register([secret]);
  const redaction = createRedactionEngine({ registry: known });
  const queue = createCollectorQueue({
    pending_count: 8,
    pending_bytes: 65536,
  });
  const captured: { envelope?: Record<string, unknown> } = {};
  const prepareCalls: PrepareCall[] = [];
  const payload = {
    report_id: "rpt_01arz3ndektsv4rrffq69g5fav",
    code: "save_failed",
    observed_at: "2026-10-04T12:00:00.000Z",
    text: `token: ${secret} and rest`,
    details: {
      nested: {
        openai: `sk-${"C".repeat(24)}`,
      },
    },
  };
  await acceptReportProblem(
    payload,
    capturingClient(captured),
    redaction,
    queue,
    fakeSession(prepareCalls),
    CLAIMED,
  );
  assert(captured.envelope !== undefined);
  const serialized = JSON.stringify(captured.envelope);
  // 등록한 known secret과 credential pattern 값이 조립값 어디에도 남지 않는다.
  assertEquals(serialized.includes(secret), false);
  assertEquals(serialized.includes(`sk-${"C".repeat(24)}`), false);
  const input = captured.envelope["input"] as {
    report: { text: string | null; details: string | null };
    blobs: {
      purpose: string;
      hash: string;
      size_bytes: number;
      source: {
        kind: string;
        blob: { preparation: string; principal: string; purpose: string };
      };
    }[];
    snapshot: Record<string, unknown>;
  };
  // redaction 통과 내용만 blob 준비되어 Report.text·details hash로 실린다(T4).
  assertEquals(prepareCalls.map((call) => call.purpose), [
    "report_text",
    "report_details",
  ]);
  for (const call of prepareCalls) {
    assertEquals(call.text.includes(secret), false);
    assertEquals(call.text.includes(`sk-${"C".repeat(24)}`), false);
  }
  assertEquals(input.report.text, "1".repeat(64));
  assertEquals(input.report.details, "2".repeat(64));
  assertEquals(input.blobs.map((blob) => blob.purpose), [
    "report_text",
    "report_details",
  ]);
  assertEquals(input.blobs[0]?.source.blob.principal, "collector");
  // snapshot 증거도 없다: 수집 꺼짐 이유다.
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

// exception 접수. observeExceptionPayload를 흔든다: 조립값은 envelope input에
// 닿고 group_key·origin은 observation kind에서 온다(problems#T4).
Deno.test("problems/snapshots#R1 R2: exception observation은 captured_at과 observed_at을 따로 두고 exception group key는 report ID에서 온다", async () => {
  const redaction = createRedactionEngine({
    registry: createKnownSecretRegistry(),
  });
  const queue = createCollectorQueue({
    pending_count: 8,
    pending_bytes: 65536,
  });
  const captured: { envelope?: Record<string, unknown> } = {};
  await observeExceptionPayload(
    {
      report_id: "rpt_01arz3ndektsv4rrffq69g5fav",
      observed_at: "2026-10-04T12:00:00.000Z",
      observation: "unhandledrejection",
      error: {
        name: "TypeError",
        message: "cannot read x",
        message_missing_reason: null,
        stack: null,
        stack_missing_reason: { reason: "collector" },
      },
      error_missing_reason: null,
      invocation: null,
    },
    capturingClient(captured),
    redaction,
    queue,
    fakeSession(),
    CLAIMED,
  );
  assert(captured.envelope !== undefined);
  const input = captured.envelope["input"] as {
    report: {
      source: string;
      code: string;
      observed_at: string;
      snapshot: string;
    };
    snapshot: { id: string; captured_at: string };
    group_key: { kind: string; code: string; discriminator: string };
    origin: { context: { origin: string } };
  };
  // source는 exception이고 code는 예약 code다(reports#validCode).
  assertEquals(input.report.source, "exception");
  assertEquals(input.report.code, "_exception");
  // captured_at(조립 시각)은 observed_at(발생 시각)과 같지 않다(R1).
  assert(input.snapshot.captured_at !== input.report.observed_at);
  // snapshot ID는 제출 rpt ID에서 결정적으로 온다.
  assertEquals(input.snapshot.id, input.report.snapshot);
  assertEquals(input.snapshot.id.startsWith("snp_"), true);
  // app frame 0개면 discriminator는 report ID다(grouping#R2, R3).
  assertEquals(input.group_key, {
    kind: "exception",
    code: "_exception",
    discriminator: "rpt_01arz3ndektsv4rrffq69g5fav",
  });
  // unhandledrejection은 process_observer origin이다(reporting#R2).
  assertEquals(input.origin.context.origin, "process_observer");
  assertEquals(queue.size, 0);
});

Deno.test("problems/snapshots#R8 R9: SDK가 연결한 invocation ID는 그대로 남고 도착하지 않은 기록은 이유만 남긴다", async () => {
  const redaction = createRedactionEngine({
    registry: createKnownSecretRegistry(),
  });
  const queue = createCollectorQueue({
    pending_count: 8,
    pending_bytes: 65536,
  });
  const captured: { envelope?: Record<string, unknown> } = {};
  await observeExceptionPayload(
    {
      report_id: "rpt_01arz3ndektsv4rrffq69g5fav",
      observed_at: "2026-10-04T12:00:00.000Z",
      observation: "error",
      error: {
        name: "RangeError",
        message: null,
        message_missing_reason: { reason: "redaction" },
        stack: null,
        stack_missing_reason: { reason: "collector" },
      },
      error_missing_reason: null,
      invocation: {
        id: "inv_01arz3ndektsv4rrffq69g5fav",
        binding: "sdk_context",
        record_missing_reason: { reason: "deadline" },
      },
    },
    {
      ...capturingClient(captured),
      // 기록 도착 확인 read(apps/invocations#get): 기록이 아직 없다(200 + null).
      // record-report POST와 URL로 구별한다.
      fetch: (input, init) => {
        if (String(input).endsWith("/v1/invocations/get")) {
          return Promise.resolve({
            status: 200,
            bytes: new TextEncoder().encode(
              JSON.stringify({ invocation: null }),
            ),
          });
        }
        // envelope capture는 record-report call에서만 한다.
        captured.envelope = JSON.parse(init.body);
        return Promise.resolve({
          status: 200,
          bytes: new TextEncoder().encode(
            JSON.stringify({
              report: "rpt_01arz3ndektsv4rrffq69g5fav",
              snapshot: "snp_01arz3ndektsv4rrffq69g5fav",
              problem: "prb_01arz3ndektsv4rrffq69g5fav",
              diagnostic_scope: null,
            }),
          ),
        });
      },
    } as CoreClientOptions,
    redaction,
    queue,
    fakeSession(),
    CLAIMED,
  );
  assert(captured.envelope !== undefined);
  const input = captured.envelope["input"] as {
    snapshot: {
      invocation: {
        id: string;
        binding: string;
        record_missing_reason: unknown;
      } | null;
    };
  };
  // SDK가 연결한 ID는 그대로 남고 기록이 없으면 이유만 남는다(R8, R9):
  // 근접 추정·다른 호출로 바꾸지 않는다.
  assertEquals(input.snapshot.invocation, {
    id: "inv_01arz3ndektsv4rrffq69g5fav",
    binding: "sdk_context",
    record_missing_reason: { reason: "deadline" },
  });
  assertEquals(queue.size, 0);
});

Deno.test("problems/snapshots#R8 R9: 기록 도착을 확인하면 record_missing_reason를 비우고 ID는 바꾸지 않는다", async () => {
  const redaction = createRedactionEngine({
    registry: createKnownSecretRegistry(),
  });
  const queue = createCollectorQueue({
    pending_count: 8,
    pending_bytes: 65536,
  });
  const captured: { envelope?: Record<string, unknown> } = {};
  await observeExceptionPayload(
    {
      report_id: "rpt_01arz3ndektsv4rrffq69g5fav",
      observed_at: "2026-10-04T12:00:00.000Z",
      observation: "error",
      error: {
        name: "RangeError",
        message: null,
        message_missing_reason: { reason: "redaction" },
        stack: null,
        stack_missing_reason: { reason: "collector" },
      },
      error_missing_reason: null,
      invocation: {
        id: "inv_01arz3ndektsv4rrffq69g5fav",
        binding: "sdk_context",
        record_missing_reason: { reason: "deadline" },
      },
    },
    {
      ...capturingClient(captured),
      // 기록이 도착했다(200 + row). confirmInvocation은 client.fetch를 건다.
      fetch: (input, init) => {
        if (String(input).endsWith("/v1/invocations/get")) {
          return Promise.resolve({
            status: 200,
            bytes: new TextEncoder().encode(
              JSON.stringify({
                invocation: {
                  id: "inv_01arz3ndektsv4rrffq69g5fav",
                  state: "succeeded",
                },
              }),
            ),
          });
        }
        captured.envelope = JSON.parse(init.body);
        return Promise.resolve({
          status: 200,
          bytes: new TextEncoder().encode(
            JSON.stringify({
              report: "rpt_01arz3ndektsv4rrffq69g5fav",
              snapshot: "snp_01arz3ndektsv4rrffq69g5fav",
              problem: "prb_01arz3ndektsv4rrffq69g5fav",
              diagnostic_scope: null,
            }),
          ),
        });
      },
    } as CoreClientOptions,
    redaction,
    queue,
    fakeSession(),
    CLAIMED,
  );
  assert(captured.envelope !== undefined);
  const input = captured.envelope["input"] as {
    snapshot: {
      invocation: {
        id: string;
        binding: string;
        record_missing_reason: unknown;
      } | null;
    };
  };
  // 도착 확인 뒤 ID·binding은 그대로이고 이유만 비운다(R8, R9).
  assertEquals(input.snapshot.invocation, {
    id: "inv_01arz3ndektsv4rrffq69g5fav",
    binding: "sdk_context",
    record_missing_reason: null,
  });
  assertEquals(queue.size, 0);
});

Deno.test("problems/reporting#R1 problems/snapshots#R5: stack blob 준비가 성공하면 redaction된 stack 본문만 core에 나가고 hash는 준비 결과에서 온다", async () => {
  const known = createKnownSecretRegistry();
  const secret = "sk-ant-AAAAdemo1234567890abcdef";
  known.register([secret]);
  const redaction = createRedactionEngine({ registry: known });
  const queue = createCollectorQueue({
    pending_count: 8,
    pending_bytes: 65536,
  });
  const captured: { envelope?: Record<string, unknown> } = {};
  const calls: PrepareCall[] = [];
  await observeExceptionPayload(
    {
      report_id: "rpt_01arz3ndektsv4rrffq69g5fav",
      observed_at: "2026-10-04T12:00:00.000Z",
      observation: "render_error",
      error: {
        name: "TypeError",
        message: "render failed",
        message_missing_reason: null,
        stack: `Error: render failed\n    at View (app.js:1:1) ${secret}`,
        stack_missing_reason: null,
      },
      error_missing_reason: null,
      invocation: null,
    },
    capturingClient(captured),
    redaction,
    queue,
    fakeSession(calls),
    CLAIMED,
  );
  assertEquals(calls.map((call) => call.purpose), ["snapshot_stack"]);
  assertEquals(calls[0]?.text.includes(secret), false);
  const input = captured.envelope?.["input"] as {
    snapshot: { error: { stack: string | null } };
  };
  assertEquals(input.snapshot.error.stack, "1".repeat(64));
});

Deno.test("problems/snapshots#R4 R10: render_error는 view_observer origin이고 안전하지 않은 오류 이름은 redaction 이유를 남긴다", async () => {
  const known = createKnownSecretRegistry();
  const secret = "sk-ant-AAAAdemo1234567890abcdef";
  known.register([secret]);
  const redaction = createRedactionEngine({ registry: known });
  const queue = createCollectorQueue({
    pending_count: 8,
    pending_bytes: 65536,
  });
  const captured: { envelope?: Record<string, unknown> } = {};
  await observeExceptionPayload(
    {
      report_id: "rpt_01arz3ndektsv4rrffq69g5fav",
      observed_at: "2026-10-04T12:00:00.000Z",
      observation: "render_error",
      error: {
        name: `token ${secret} leak`,
        message: "render failed",
        message_missing_reason: null,
        stack: `Error: render failed\n    at View (app.js:1:1) ${secret}`,
        stack_missing_reason: null,
      },
      error_missing_reason: null,
      invocation: null,
    },
    capturingClient(captured),
    redaction,
    queue,
    fakeSession([], true),
    CLAIMED,
  );
  assert(captured.envelope !== undefined);
  const input = captured.envelope["input"] as {
    origin: { context: { origin: string } };
    snapshot: {
      error: {
        name: string;
        message: string | null;
        stack: string | null;
        stack_missing_reason: unknown;
        truncation_notes: string[];
      } | null;
    };
  };
  // render_error는 view_observer다(reporting#R2, R6).
  assertEquals(input.origin.context.origin, "view_observer");
  // 안전하지 않은 오류 이름·stack 원문은 남지 않는다(snapshots#R4, R10).
  assert(input.snapshot.error !== null);
  assertEquals(
    input.snapshot.error.name.includes("sk-ant-AAAAdemo1234567890abcdef"),
    false,
  );
  assertEquals(input.snapshot.error.stack, null);
  // stack 준비가 실패하면 이유를 남긴다(R5, reporting#R14: 수집 실패).
  assertEquals(
    input.snapshot.error.truncation_notes.some((note) =>
      note.includes("stack blob 준비 실패")
    ),
    true,
  );
  // 남은 자료(message)는 접수된다(R5).
  assertEquals(input.snapshot.error.message, "render failed");
  assertEquals(queue.size, 0);
});

Deno.test("problems/reporting#R1: 잘못된 exception observation 본문은 잘못된 보고 진단으로 거절한다", async () => {
  const redaction = createRedactionEngine({
    registry: createKnownSecretRegistry(),
  });
  const queue = createCollectorQueue({
    pending_count: 8,
    pending_bytes: 65536,
  });
  const captured: { envelope?: Record<string, unknown> } = {};
  await assertRejects(
    () =>
      observeExceptionPayload(
        {
          report_id: "rpt_01arz3ndektsv4rrffq69g5fav",
          observed_at: "2026-10-04T12:00:00.000Z",
          observation: "not_a_kind",
          error: null,
          error_missing_reason: { reason: "collector" },
          invocation: null,
        },
        capturingClient(captured),
        redaction,
        queue,
        fakeSession(),
        CLAIMED,
      ),
    Error,
    "invalid exception observation body",
  );
  // envelope에 닿지 않았다: 거절이 제출보다 앞선다.
  assertEquals(captured.envelope, undefined);
  assertEquals(queue.size, 0);
});

// 로그 증거 접수(problems/snapshots#R7 R12 R6). 운영 source 대신 AppLogSource port를
// 갈아 끼운다: 앱 이름과 질의 범위는 credential 위치에서만 온다.
const LOG_APP = "app_01arz3ndektsv4rrffq69g5fav";
const LOG_INVOCATION = "inv_01arz3ndektsv4rrffq69g5fav";

function fakeLogs(
  lines: string[],
  detailCollection: boolean | null = true,
): { logs: CollectorLogs; queries: AppLogQuery[] } {
  const queries: AppLogQuery[] = [];
  return {
    queries,
    logs: {
      detailCollection: () => Promise.resolve(detailCollection),
      source: (query) => {
        queries.push(query);
        return Promise.resolve(ok({
          state: "ok" as const,
          lines,
          collected_at: "2026-10-04T12:00:00.500Z",
          truncated: false,
        }));
      },
    },
  };
}

function exceptionPayload(withInvocation: boolean) {
  return {
    report_id: "rpt_01arz3ndektsv4rrffq69g5fav",
    observed_at: "2026-10-04T12:00:00.000Z",
    observation: "error",
    error: {
      name: "TypeError",
      message: "cannot read x",
      message_missing_reason: null,
      stack: "TypeError: cannot read x\n    at run (app.js:1:1)",
      stack_missing_reason: null,
    },
    error_missing_reason: null,
    invocation: withInvocation
      ? {
        id: LOG_INVOCATION,
        binding: "sdk_context",
        record_missing_reason: null,
      }
      : null,
  };
}

type CapturedInput = {
  snapshot: {
    logs: { blob: string; line_count: number; scope: string } | null;
    logs_missing_reason: { reason: string } | null;
    invocation: { id: string; record_missing_reason: unknown } | null;
  };
  blobs: { purpose: string; hash: string }[];
};

Deno.test("problems/snapshots#R12 R6: exception 접수는 credential 앱의 로그 조각을 redaction 뒤 snapshot_logs blob으로 접수한다", async () => {
  const known = createKnownSecretRegistry();
  const secret = "sk-ant-AAAAdemo1234567890abcdef";
  known.register([secret]);
  const redaction = createRedactionEngine({ registry: known });
  const queue = createCollectorQueue({
    pending_count: 8,
    pending_bytes: 65536,
  });
  const captured: { envelope?: Record<string, unknown> } = {};
  const calls: PrepareCall[] = [];
  const { logs, queries } = fakeLogs(["start", `token ${secret}`, "end"]);
  await observeExceptionPayload(
    exceptionPayload(true),
    capturingClient(captured),
    redaction,
    queue,
    fakeSession(calls),
    CLAIMED,
    logs,
  );
  assertEquals(queries, [{
    app: LOG_APP,
    invocation: LOG_INVOCATION,
    limit: 30,
    max_bytes: 65536,
  }]);
  assertEquals(calls.map((call) => call.purpose), [
    "snapshot_stack",
    "snapshot_logs",
  ]);
  assertEquals(calls[1]!.text.includes(secret), false);
  assertEquals(calls[1]!.text.split("\n").length, 3);
  const input = captured.envelope!["input"] as CapturedInput;
  assertEquals(input.snapshot.logs?.blob, "2".repeat(64));
  assertEquals(input.snapshot.logs?.line_count, 3);
  assert(input.snapshot.logs!.scope.includes(LOG_INVOCATION));
  assertEquals(input.blobs.map((blob) => blob.purpose), [
    "snapshot_stack",
    "snapshot_logs",
  ]);
  // blob 권한과 snapshot의 hash가 contract 검사를 그대로 통과한다.
  assert(recordReportInputSchema.safeParse(input).success);
});

Deno.test("problems/snapshots#R7: 진단 상세 수집이 꺼졌거나 설정을 읽지 못하면 source를 부르지 않고 이유를 남긴다", async () => {
  for (const setting of [false, null]) {
    const redaction = createRedactionEngine({
      registry: createKnownSecretRegistry(),
    });
    const queue = createCollectorQueue({
      pending_count: 8,
      pending_bytes: 65536,
    });
    const captured: { envelope?: Record<string, unknown> } = {};
    const calls: PrepareCall[] = [];
    const { logs, queries } = fakeLogs(["never read"], setting);
    await observeExceptionPayload(
      exceptionPayload(true),
      capturingClient(captured),
      redaction,
      queue,
      fakeSession(calls),
      CLAIMED,
      logs,
    );
    assertEquals(queries.length, 0);
    assertEquals(calls.map((call) => call.purpose), ["snapshot_stack"]);
    const input = captured.envelope!["input"] as CapturedInput;
    assertEquals(input.snapshot.logs, null);
    assert(
      input.snapshot.logs_missing_reason!.reason.includes(
        setting === false ? "꺼져" : "읽지 못해",
      ),
    );
    // 수집을 꺼도 invocation 연결은 그대로 남는다.
    assertEquals(input.snapshot.invocation?.id, LOG_INVOCATION);
  }
});

Deno.test("problems/snapshots#R12 R4: SDK 직접 보고도 연결한 invocation으로 로그를 좁히고 source가 없으면 이유를 남긴다", async () => {
  const redaction = createRedactionEngine({
    registry: createKnownSecretRegistry(),
  });
  const payload = {
    report_id: "rpt_01arz3ndektsv4rrffq69g5fav",
    code: "save_failed",
    observed_at: "2026-10-04T12:00:00.000Z",
    text: "failed",
    invocation: {
      id: LOG_INVOCATION,
      binding: "sdk_context",
      record_missing_reason: null,
    },
  };
  const first = fakeLogs(["one", "two"]);
  const captured: { envelope?: Record<string, unknown> } = {};
  const calls: PrepareCall[] = [];
  await acceptReportProblem(
    payload,
    capturingClient(captured),
    redaction,
    createCollectorQueue({ pending_count: 8, pending_bytes: 65536 }),
    fakeSession(calls),
    CLAIMED,
    first.logs,
  );
  assertEquals(first.queries.map((query) => query.invocation), [
    LOG_INVOCATION,
  ]);
  assertEquals(calls.map((call) => call.purpose), [
    "report_text",
    "snapshot_logs",
  ]);
  const input = captured.envelope!["input"] as CapturedInput;
  assertEquals(input.snapshot.logs?.line_count, 2);
  assertEquals(input.blobs.map((blob) => blob.purpose), [
    "report_text",
    "snapshot_logs",
  ]);
  // 기록이 도착하지 않았으면 연결한 ID와 이유만 남는다(근접 추정 없음).
  assertEquals(input.snapshot.invocation?.id, LOG_INVOCATION);
  assert(input.snapshot.invocation?.record_missing_reason !== null);
  assert(recordReportInputSchema.safeParse(input).success);

  const none = { source: null, detailCollection: () => Promise.resolve(true) };
  const captured2: { envelope?: Record<string, unknown> } = {};
  await acceptReportProblem(
    { ...payload, invocation: null },
    capturingClient(captured2),
    redaction,
    createCollectorQueue({ pending_count: 8, pending_bytes: 65536 }),
    fakeSession(),
    CLAIMED,
    none,
  );
  const second = captured2.envelope!["input"] as CapturedInput;
  assertEquals(second.snapshot.logs, null);
  assert(second.snapshot.logs_missing_reason!.reason.includes("연결되지 않아"));
  assert(second.snapshot.logs_missing_reason!.reason !== "collector");
  assertEquals(second.snapshot.invocation, null);
});
