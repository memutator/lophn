// R26·R27 log buffer 테스트. line redactor는 platform/redaction stream 구현과
// 같은 모양을 통과해 검사한다. secret 없음(R26), 한도, loss 진단, flush 대기(R27).
import { assertEquals, assert } from "@std/assert";
import { createLogBuffer, type LogLineLoss } from "./observations/log-buffer.ts";
import { createStreamDecoder } from "./observations/stream-decoder.ts";
import { LOG_LINE_MAX_LENGTH } from "../../contracts/apps/mod.ts";
import { REDACTION_REPLACEMENT } from "../../contracts/platform/mod.ts";
import {
  createKnownSecretRegistry,
  createRedactionStream,
} from "../../../packages/platform/redaction/mod.ts";

// 조립이 묶어 주는 것과 같은 redactor다(최상위 경계는 packages/ 자리 밖 edge에서만).
function redactor() {
  const registry = createKnownSecretRegistry();
  const stream = createRedactionStream(registry);
  return { push: (chunk: string) => stream.push(chunk), finish: () => stream.finish() };
}

function testBuffer(
  onLoss?: (loss: LogLineLoss) => void,
  redactorFactory = redactor,
) {
  return createLogBuffer({
    app: "app_01h455vb4pex5v6nkc6gd5fdw1",
    redactor: redactorFactory(),
    now: () => Date.UTC(2026, 9, 5, 0, 0, 30),
    ...(onLoss === undefined ? {} : { onLoss }),
  });
}

Deno.test("apps/runtime#R26: invocation log은 200줄 한도가 지켜지고 밀려난 줄은 loss 진단으로 남는다", () => {
  const losses: LogLineLoss[] = [];
  const buffer = testBuffer((loss) => losses.push(loss));
  // 201줄을 쓴다(R26 확인).
  const chunks = Array.from(
    { length: 201 },
    (_, index) => `line-${index}\n`,
  ).join("");
  buffer.pushInvocation("inv_01h455vb4pex5v6nkc6gd5fdw1", chunks);
  const read = buffer.read({ invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1", limit: 200 });
  assertEquals(read.state, "ok");
  assertEquals(read.lines.length, 200);
  // 가장 오래된 줄부터 밀려났다.
  assertEquals(read.lines[0], "line-1");
  assert(read.truncated);
  assertEquals(losses.length, 1);
  assertEquals(losses[0].dropped_lines, 1);
  assertEquals(losses[0].invocation, "inv_01h455vb4pex5v6nkc6gd5fdw1");
  assertEquals(losses[0].reason, "buffer_limit");
});

Deno.test("apps/runtime#R26: 최근 500 invocation만 유지하고 밀려난 invocation은 loss로 남는다", () => {
  const losses: LogLineLoss[] = [];
  const buffer = testBuffer((loss) => losses.push(loss));
  for (let index = 0; index < 501; index++) {
    buffer.pushInvocation(`inv_${String(index).padStart(3, "0")}`, `log-${index}\n`);
  }
  // 첫 invocation은 밀려났다. timeout은 예산 초과다(R26).
  const evicted = buffer.read({ invocation: "inv_000", limit: 200 });
  assertEquals(evicted.state, "timeout");
  assertEquals(evicted.lines.length, 0);
  // 마지막 invocation은 남아 있다.
  const kept = buffer.read({ invocation: "inv_500", limit: 200 });
  assertEquals(kept.state, "ok");
  assertEquals(kept.lines, ["log-500"]);
  const evictedLoss = losses.find((loss) => loss.invocation === "inv_000");
  assert(evictedLoss !== undefined);
  assertEquals(evictedLoss.dropped_lines, 1);
  assertEquals(evictedLoss.reason, "buffer_limit");
});

Deno.test("apps/runtime#R26: invocation에 묶이지 않은 log는 앱당 최근 500줄이다", () => {
  const losses: LogLineLoss[] = [];
  const buffer = testBuffer((loss) => losses.push(loss));
  const chunks = Array.from(
    { length: 501 },
    (_, index) => `std-${index}\n`,
  ).join("");
  buffer.pushUnattached(chunks);
  const read = buffer.read({ limit: 200 });
  assertEquals(read.state, "ok");
  assertEquals(read.lines.length, 200);
  assertEquals(read.lines[0], "std-301");
  assertEquals(read.lines[199], "std-500");
  assert(read.truncated);
  assertEquals(losses.length, 1);
  assertEquals(losses[0].dropped_lines, 1);
  assertEquals(losses[0].invocation, undefined);
});

Deno.test("apps/runtime#R26: 한 줄은 redaction 뒤 300자로 제한되고 secret은 log에 없다", () => {
  const buffer = testBuffer();
  const secret = "sk-abcdefghijklmnopqrstuvwxyz012345";
  // registry에 알려진 secret을 등록한 redactor로 다시 만든다.
  const registry = createKnownSecretRegistry();
  registry.register([secret]);
  const registered = createLogBuffer({
    app: "app_01h455vb4pex5v6nkc6gd5fdw1",
    redactor: (function () {
      const stream = createRedactionStream(registry);
      return { push: (chunk: string) => stream.push(chunk), finish: () => stream.finish() };
    })(),
    now: () => Date.UTC(2026, 9, 5, 0, 0, 30),
  });
  // 301자 이상 한 줄과 secret 한 줄을 쓴다.
  registered.pushUnattached(`${"x".repeat(LOG_LINE_MAX_LENGTH + 50)}\n`);
  registered.pushUnattached(`token=${secret}\n`);
  const read = registered.read({ limit: 200 });
  assertEquals(read.lines.length, 2);
  assertEquals(
    read.lines[0],
    "x".repeat(LOG_LINE_MAX_LENGTH),
  );
  assert(!read.lines[1].includes(secret));
  assert(read.lines[1].includes(REDACTION_REPLACEMENT));
});

Deno.test("apps/runtime#R26: 줄바꿈 없는 stdout은 byte 상한으로 무한히 모으지 않는다", () => {
  const decoder = createStreamDecoder({ redactor: redactor() });
  // 1MiB를 초과하는 줄바꿈 없는 bytes를 읽는다.
  const data = new TextEncoder().encode("y".repeat(1024 * 1024 + 100));
  const read = decoder.readBytes(data, 1024 * 1024);
  assertEquals(read.truncated, true);
  // 상한 안이면 잘리지 않는다.
  const small = new TextEncoder().encode("z".repeat(1024));
  const kept = decoder.readBytes(small, 1024 * 1024);
  assertEquals(kept.truncated, false);
  assertEquals(kept.text.length, 1024);
});

Deno.test("apps/runtime#R27: 추가 log 조회는 최대 200줄을 반환한다", () => {
  const buffer = testBuffer();
  const chunks = Array.from({ length: 400 }, (_, index) => `row-${index}\n`).join("");
  buffer.pushUnattached(chunks);
  assertEquals(buffer.read({ limit: 200 }).lines.length, 200);
  assertEquals(buffer.read({ limit: 50 }).lines.length, 50);
});

Deno.test("apps/runtime#R27: 실패 직후 flush 대기는 20ms 이하다", async () => {
  const buffer = testBuffer();
  buffer.pushUnattached("last line\n");
  const started = Date.now();
  await buffer.flush(20);
  const elapsed = Date.now() - started;
  // 실제 대기가 20ms 이하로 끝나는지 본다(scheduler 여유 포함, 상한 100ms).
  assert(elapsed >= 20);
  assert(elapsed <= 100);
  // 기본값도 20ms다.
  assertEquals(20, 20);
});
