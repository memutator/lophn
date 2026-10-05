// R26·R27: log buffer의 한도, 줄 byte 상한, loss 진단, flush 대기.
// 실제 secret registry redaction은 최상위 경계 밖이라 apps/app-supervisor 조립 test가 본다.
import { assert, assertEquals } from "@std/assert";
import {
  createLogBuffer,
  LOG_FLUSH_MAX_MS,
  type LogLineLoss,
} from "./observations/log-buffer.ts";
import {
  createStreamDecoder,
  LOG_PENDING_LINE_MAX_BYTES,
} from "./observations/stream-decoder.ts";
import { LOG_LINE_MAX_LENGTH } from "../../contracts/apps/mod.ts";

const SECRET = "sk-live-0123456789abcdef";

// 알려진 secret 하나를 지우는 줄 redaction. 한도 test용 주입값이다.
function redact(line: string): string {
  return line.replaceAll(SECRET, "*");
}

function invocationId(index: number): string {
  return `inv_${index.toString(36).padStart(26, "0")}`;
}

function buffer(losses: LogLineLoss[] = []) {
  return createLogBuffer({
    app: "app_01h455vb4pex5v6nkc6gd5fdw1",
    redact,
    now: () => Date.UTC(2026, 10, 5, 0, 0, 30),
    onLoss: (loss) => losses.push(loss),
  });
}

function mark(id: string, text: string): string {
  return `[inv=${id}] ${text}`;
}

Deno.test("apps/runtime#R26: invocation은 200줄까지 남고 201번째는 가장 오래된 줄을 밀어내며 loss 진단을 남긴다", () => {
  const losses: LogLineLoss[] = [];
  const log = buffer(losses);
  const id = invocationId(1);
  for (let index = 0; index < 201; index++) {
    log.addLine(mark(id, `line-${index}`));
  }
  const read = log.read({ invocation: id, limit: 200 });
  assertEquals(read.state, "ok");
  assertEquals(read.lines.length, 200);
  assertEquals(read.lines[0], "line-1");
  assertEquals(read.lines[199], "line-200");
  assertEquals(losses, [{
    app: "app_01h455vb4pex5v6nkc6gd5fdw1",
    invocation: id,
    dropped_lines: 1,
    reason: "buffer_limit",
  }]);
});

Deno.test("apps/runtime#R26: 최근 500 invocation만 유지하고 밀려난 invocation의 줄은 loss로 남는다", () => {
  const losses: LogLineLoss[] = [];
  const log = buffer(losses);
  for (let index = 0; index < 501; index++) {
    log.addLine(mark(invocationId(index), `log-${index}`));
  }
  const gone = log.read({ invocation: invocationId(0), limit: 200 });
  assertEquals(gone.lines, []);
  // 있었지만 이제 못 주므로 완전한 빈 값이 아니라 부분 확보다.
  assertEquals(gone.truncated, true);
  assertEquals(
    log.read({ invocation: invocationId(500), limit: 200 }).lines,
    ["log-500"],
  );
  assertEquals(
    log.read({ invocation: invocationId(1), limit: 200 }).lines,
    ["log-1"],
  );
  assertEquals(losses.length, 1);
  assertEquals(losses[0].invocation, invocationId(0));
  assertEquals(losses[0].dropped_lines, 1);
  // 한 번도 쓰지 않은 invocation은 부분 확보가 아니다.
  assertEquals(
    log.read({ invocation: invocationId(999), limit: 200 }).truncated,
    false,
  );
});

Deno.test("apps/runtime#R26: invocation에 묶이지 않은 log는 앱마다 최근 500줄이고 표시 없는 줄과 알 수 없는 표시는 여기로 간다", () => {
  const losses: LogLineLoss[] = [];
  const log = buffer(losses);
  for (let index = 0; index < 501; index++) log.addLine(`std-${index}`);
  log.addLine("[inv=not-an-id] stray");
  const read = log.read({ limit: 200 });
  assertEquals(read.lines.length, 200);
  assertEquals(read.lines[199], "[inv=not-an-id] stray");
  assertEquals(read.lines[0], "std-302");
  assertEquals(read.truncated, true);
  assertEquals(losses.length, 2);
  assertEquals(losses[0].invocation, undefined);
});

Deno.test("apps/runtime#R26: 한 줄은 redaction을 먼저 하고 300자로 자르므로 경계의 secret 조각이 남지 않는다", () => {
  const log = buffer();
  // 300자 경계가 secret 한가운데를 지나도록 놓는다.
  const line = `${"a".repeat(LOG_LINE_MAX_LENGTH - 10)}${SECRET}${
    "b".repeat(100)
  }`;
  log.addLine(line);
  log.addLine(`token=${SECRET}`);
  const lines = log.read({ limit: 200 }).lines;
  for (const stored of lines) {
    assert(stored.length <= LOG_LINE_MAX_LENGTH);
    assert(!stored.includes(SECRET.slice(0, 6)), stored);
  }
  assertEquals(lines[1], "token=*");
});

Deno.test("apps/runtime#R26: 줄바꿈 없는 출력은 byte 상한 안에서만 쥐고 넘으면 줄을 버리고 unsafe_truncation으로 알린다", () => {
  const losses: LogLineLoss[] = [];
  const log = buffer(losses);
  const lines: string[] = [];
  const decoder = createStreamDecoder({
    onLine: (line) => {
      lines.push(line);
      log.addLine(line);
    },
    onDropped: () => log.addUnsafeDrop(),
  });
  const chunk = new TextEncoder().encode("y".repeat(4096));
  // 줄바꿈 없이 4MiB를 흘려도 상한을 넘은 시점에 한 번만 알리고 계속 버린다.
  for (let index = 0; index < 1024; index++) {
    decoder.push(chunk);
  }
  assert(1024 * 4096 > LOG_PENDING_LINE_MAX_BYTES);
  assertEquals(losses, [{
    app: "app_01h455vb4pex5v6nkc6gd5fdw1",
    dropped_lines: 1,
    reason: "unsafe_truncation",
  }]);
  assertEquals(lines, []);
  // 줄바꿈 뒤 첫 줄은 정상으로 돌아온다.
  decoder.push(new TextEncoder().encode("tail of dropped\nnext\n"));
  assertEquals(lines, ["next"]);
  assertEquals(log.read({ limit: 200 }).lines, ["next"]);
});

Deno.test("apps/runtime#R26: stream decoder는 chunk 경계에 걸린 UTF-8과 CRLF, 줄바꿈 없는 마지막 줄을 온전히 낸다", () => {
  const lines: string[] = [];
  const decoder = createStreamDecoder({
    onLine: (line) => lines.push(line),
    onDropped: () => {
      throw new Error("must not drop");
    },
  });
  const bytes = new TextEncoder().encode("한글 로그\r\n둘째 줄\n마지막");
  // 한글 한 글자의 byte 중간에서 나눈다.
  decoder.push(bytes.subarray(0, 2));
  decoder.push(bytes.subarray(2, 11));
  decoder.push(bytes.subarray(11));
  assertEquals(lines, ["한글 로그", "둘째 줄"]);
  decoder.finish();
  assertEquals(lines, ["한글 로그", "둘째 줄", "마지막"]);
});

Deno.test("apps/runtime#R27: 추가 조회는 200줄을 넘지 않고 max_bytes는 가장 최근 줄부터 예산 안만 돌려준다", () => {
  const log = buffer();
  for (let index = 0; index < 400; index++) log.addLine(`row-${index}`);
  assertEquals(log.read({ limit: 500 }).lines.length, 200);
  assertEquals(log.read({ limit: 50 }).lines.length, 50);
  const budget = log.read({ limit: 200, max_bytes: 3 * "row-399".length });
  assertEquals(budget.lines, ["row-397", "row-398", "row-399"]);
  assertEquals(budget.truncated, true);
  log.setCollecting(false);
  assertEquals(log.read({ limit: 10 }).state, "off");
});

// read가 끝나지 않는 pipe. 앱이 살아 있고 아직 출력을 닫지 않은 상태다.
function openPipe() {
  let wake: (count: number | null) => void = () => {};
  return {
    source: {
      read: (_buffer: Uint8Array) =>
        new Promise<number | null>((resolve) => (wake = resolve)),
    },
    close: () => wake(null),
  };
}

Deno.test("apps/runtime#R27: 실패 직후 flush는 끝나지 않는 stream을 20ms만 기다리고 timeout으로 지금까지 모은 줄을 돌려준다", async () => {
  assertEquals(LOG_FLUSH_MAX_MS, 20);
  const log = buffer();
  log.addLine("already collected");
  const open = openPipe();
  const attached = log.attach(open.source);
  const started = performance.now();
  const result = await log.collect({ limit: 200 });
  const elapsed = performance.now() - started;
  assertEquals(result.state, "timeout");
  assertEquals(result.lines, ["already collected"]);
  assertEquals(result.truncated, true);
  assert(elapsed >= 15 && elapsed < 100, `waited ${elapsed}ms`);
  open.close();
  await attached;
});

Deno.test("apps/runtime#R27: 실제 자식이 실패로 끝나면 flush가 마지막 stdout·stderr 줄을 20ms 안에 받는다", async () => {
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "eval",
      `console.log("[inv=${invocationId(7)}] before failure");` +
      `console.error("fatal: boom");Deno.exit(3);`,
    ],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const toSource = (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    let rest: Uint8Array = new Uint8Array();
    return {
      async read(target: Uint8Array) {
        if (rest.length === 0) {
          const next = await reader.read();
          if (next.done) return null;
          rest = next.value;
        }
        const count = Math.min(target.length, rest.length);
        target.set(rest.subarray(0, count));
        rest = rest.subarray(count);
        return count;
      },
    };
  };
  const log = buffer();
  void log.attach(toSource(child.stdout));
  void log.attach(toSource(child.stderr));
  const status = await child.status;
  assertEquals(status.code, 3);
  const started = performance.now();
  const result = await log.collect({ limit: 200 });
  const elapsed = performance.now() - started;
  assertEquals(result.state, "ok");
  assertEquals(result.lines, ["fatal: boom"]);
  assertEquals(
    log.read({ invocation: invocationId(7), limit: 200 }).lines,
    ["before failure"],
  );
  assert(elapsed < 20 + 30, `flush waited ${elapsed}ms`);
});
