import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mock, test } from "node:test";
import { createSupervisor, readLines } from "./supervisor.ts";

function fakeHost() {
  const host = Object.assign(new EventEmitter(), {
    stdin: Object.assign(new EventEmitter(), { write: () => true }),
    stdout: new PassThrough(),
    stderr: new EventEmitter(),
    killed: false,
    kill: () => true,
  });
  return host;
}

test("pipe 조각 사이에 갈린 UTF-8과 큰 JSON 한 줄을 보존한다", async () => {
  const expected = [
    JSON.stringify({ text: "한글🙂" }),
    JSON.stringify({ text: "x".repeat(1024 * 1024) }),
    "done",
  ];
  const encoded = new TextEncoder().encode(expected.join("\n") + "\n");
  async function* pieces() {
    for (let i = 0; i < 24; i++) yield encoded.subarray(i, i + 1);
    for (let i = 24; i < encoded.length; i += 8192)
      yield encoded.subarray(i, i + 8192);
  }
  const lines: string[] = [];
  await readLines(pieces(), (line) => lines.push(line));
  assert.deepStrictEqual(lines, expected);
});

test("host child가 exit 없이 error를 내도 던지지 않고 기다리던 요청이 host_lost로 끝난다", async () => {
  const host = fakeHost();
  const supervisor = createSupervisor({ spawnHost: () => host, entry: "x" });
  let lost = 0;
  let stderr = "";
  supervisor.on({
    hostLost: (exit) => {
      lost++;
      stderr = exit?.stderr ?? "";
    },
  });
  const waiting = supervisor.request({ type: "snapshot" });
  host.stderr.emit("data", "boom\n");
  host.emit("error", new Error("spawn EAGAIN"));
  host.emit("exit", 1, null);
  const reply = await waiting;
  assert.equal(reply.ok, false);
  assert.equal(!reply.ok && reply.reason, "host_lost");
  assert.equal(lost, 1);
  assert.equal(stderr, "boom\n");
});

test("답이 오지 않는 요청은 기한 뒤 host_lost로 끝나고 늦게 온 답은 무시된다", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = fakeHost();
    const supervisor = createSupervisor({ spawnHost: () => host, entry: "x" });
    const first = supervisor.request({ type: "snapshot" });
    mock.timers.tick(10_000);
    const late = await first;
    assert.equal(!late.ok && late.reason, "host_lost");
    // 늦은 답(req_1)은 버려지고 다음 요청(req_2)은 자기 답을 받는다.
    const ok = (ref: string) => ({
      ok: true,
      runtime: { terminal_ref: ref },
    });
    host.stdout.write(
      JSON.stringify({ id: "req_1", reply: ok("late") }) + "\n",
    );
    const second = supervisor.request({ type: "snapshot" });
    host.stdout.write(
      JSON.stringify({ id: "req_2", reply: ok("mine") }) + "\n",
    );
    const reply = await second;
    assert.equal(reply.ok && reply.runtime.terminal_ref, "mine");
  } finally {
    mock.timers.reset();
  }
});
