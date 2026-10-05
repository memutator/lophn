// report collector worker 경계의 테스트. 이름은 요구 번호로 시작한다(dev/tasks.md).
// 실제 startChild 경계를 흔든다: stdin frame은 미리 준비하고 run() 종료를 기다린다.
import { assertEquals, assertRejects } from "@std/assert";
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
import { COLLECTOR_KIND, createCollectorWorker } from "./report-collector.ts";
import { reportCollectorSpec } from "../../core/problems-runner.ts";

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

Deno.test("problems/tests#R13: collector launch spec은 쓰기와 자식 실행 권한이 없고 loopback만 닿는다", () => {
  const spec = reportCollectorSpec({
    dataRoot: "/tmp/lophn-home",
    deno: "/usr/bin/deno",
  });
  assertEquals(spec?.kind, "problems/report-collector");
  assertEquals(spec?.allow_write, []);
  assertEquals(spec?.allow_net, ["127.0.0.1"]);
  assertEquals(spec?.policy, "always");
  assertEquals(spec?.allow_read.includes("/tmp/lophn-home"), true);
  assertEquals(
    reportCollectorSpec({ dataRoot: "relative", deno: "/usr/bin/deno" }),
    undefined,
  );
});
