import assert from "node:assert/strict";
import { test } from "node:test";

import { encodeFrame } from "../../../../../packages/contracts/platform/mod.ts";

import {
  CORE_PERMISSION_FLAGS,
  type CoreChild,
  coreLaunch,
  HELLO_TIMEOUT_MS,
  spawnCore,
  STOP_GRACE_MS,
  supervise,
} from "./supervise.ts";

function fakeChild(): CoreChild & {
  sent: Uint8Array[];
  push(bytes: Uint8Array): void;
  exit(): void;
  throw(error: Error): void;
  killed: boolean;
} {
  const data: ((chunk: Uint8Array) => void)[] = [];
  const exits: (() => void)[] = [];
  const errors: ((error?: Error) => void)[] = [];
  const child = {
    sent: [] as Uint8Array[],
    killed: false,
    stdin: {
      write(bytes: Uint8Array) {
        child.sent.push(bytes);
      },
    },
    stdout: {
      on(event: "data", listener: (chunk: Uint8Array) => void) {
        if (event === "data") data.push(listener);
      },
    },
    on(
      event: "exit" | "error",
      listener: (error?: Error) => void,
    ) {
      if (event === "exit") exits.push(listener);
      if (event === "error") errors.push(listener);
    },
    kill() {
      child.killed = true;
    },
    push(bytes: Uint8Array) {
      for (const listener of data) listener(bytes);
    },
    exit() {
      for (const listener of exits) listener();
    },
    throw(error: Error) {
      for (const listener of errors) listener(error);
    },
  };
  return child;
}

const hello = {
  user_token: "user-token-value",
  api_port: 7431,
  core_epoch: "epoch-1",
};

test("shell/desktop#R20: 개발 core는 deno run과 data root만 받고 credential은 argv·env에 없다", () => {
  const launch = coreLaunch({
    repoRoot: "/repo",
    dataRoot: "/data/root",
    denoBinary: "deno",
    packaged: false,
  });
  assert.equal(launch.command, "deno");
  assert.ok(launch.args.includes("run"));
  assert.ok(launch.args.includes("--allow-all"));
  assert.ok(launch.args.some((arg) => arg.endsWith("apps/core/main.ts")));
  assert.ok(launch.args.includes("--port=0"));
  assert.equal(launch.env.LOPHN_HOME, "/data/root");
  assert.equal(JSON.stringify(launch).includes("token"), false);
});

test("shell/desktop#R20: packaged core는 bundle된 Deno와 좁힌 권한으로 시작한다", () => {
  const launch = coreLaunch({
    repoRoot: "/opt/lophn",
    dataRoot: "/home/person/.lophn",
    denoBinary: "/opt/lophn/deno",
    packaged: true,
    port: 7431,
  });
  assert.equal(launch.command, "/opt/lophn/deno");
  for (const flag of CORE_PERMISSION_FLAGS) {
    assert.ok(launch.args.includes(flag));
  }
  assert.equal(launch.args.includes("--allow-all"), false);
  assert.equal(launch.args.includes("--allow-ffi"), false);
  assert.ok(launch.args.includes("--port=7431"));
});

test("shell/desktop#R15: hello는 실제 port·core epoch·user token을 한 번만 준다", async () => {
  const child = fakeChild();
  const core = supervise(child);
  const frame = encodeFrame({ kind: "json", channel: 0, payload: hello });
  child.push(frame.subarray(0, 4));
  child.push(frame.subarray(4));
  assert.deepEqual(await core.hello, hello);
  child.push(
    encodeFrame({ kind: "json", channel: 0, payload: { type: "ready" } }),
  );
  assert.equal(core.phase, "ready");
});

test("shell/desktop#R21: 명시 종료만 stop frame을 보내고 창 닫기는 core를 멈추지 않는다", () => {
  const child = fakeChild();
  const core = supervise(child);
  child.push(encodeFrame({ kind: "json", channel: 0, payload: hello }));
  assert.equal(child.sent.length, 0);
  core.stop();
  assert.equal(child.sent.length, 1);
  const text = new TextDecoder().decode(child.sent[0]);
  assert.ok(text.includes(`"grace_ms":${STOP_GRACE_MS}`));
  assert.equal(text.includes("user-token-value"), false);
});

test("shell/desktop#R20: frame이 아닌 stdout은 protocol 위반으로 core를 멈춘다", async () => {
  const child = fakeChild();
  const core = supervise(child);
  child.push(new TextEncoder().encode("not a frame"));
  await assert.rejects(core.hello);
  assert.equal(child.killed, true);
  assert.equal(core.phase, "stopped");
});

test("shell/desktop#R20: coreLaunch는 프로세스 환경을 바탕으로 LOPHN_HOME만 덮어써 PATH를 남긴다", () => {
  process.env.LOPHN_TEST_SENTINEL = "sentinel-value";
  try {
    const launch = coreLaunch({
      repoRoot: "/repo",
      dataRoot: "/data/root",
      denoBinary: "deno",
      packaged: false,
      env: { LOPHN_HOME: "/should/not/win" },
    });
    assert.equal(launch.env.LOPHN_HOME, "/data/root");
    // spawn('deno')가 ENOENT로 죽지 않으려면 PATH가 살아 있어야 한다.
    assert.equal(launch.env.PATH, process.env.PATH);
    assert.equal(launch.env.LOPHN_TEST_SENTINEL, "sentinel-value");
    // credential은 env에 넣지 않는다.
    assert.equal(JSON.stringify(launch).includes("user_token"), false);
  } finally {
    delete process.env.LOPHN_TEST_SENTINEL;
  }
});

test("shell/desktop#R20: 없는 binary의 spawn error는 uncaught가 아니라 failed로 끝난다", async () => {
  const core = spawnCore({
    repoRoot: "/repo",
    dataRoot: "/data/root",
    denoBinary: "lophn-missing-deno-binary-for-test",
    packaged: false,
  });
  await assert.rejects(core.hello);
  assert.equal(core.phase, "stopped");
  core.ended();
});

test("shell/desktop#R20: hello가 기한 안에 오지 않으면 failed로 끝낸다", async () => {
  const cleared: unknown[] = [];
  const child = fakeChild();
  const timers: { at: number; fire: () => void }[] = [];
  const core = supervise(child, {
    setTimeout: (fn, ms) => {
      timers.push({ at: ms, fire: fn });
      return timers.length;
    },
    clearTimeout: (id) => cleared.push(id),
  });
  child.push(encodeFrame({ kind: "json", channel: 0, payload: hello }));
  assert.deepEqual(await core.hello, hello);
  // hello timer 하나만 선 뒤 clear됐다.
  assert.equal(timers.length, 1);
  assert.equal(timers[0]!.at, HELLO_TIMEOUT_MS);
  assert.deepEqual(cleared, [1]);
  core.stop();
  child.exit();
  core.ended();
});

test("shell/desktop#R20: hello 기한이 지나면 timer가 core를 failed로 끝낸다", async () => {
  const fires: (() => void)[] = [];
  const child = fakeChild();
  const core = supervise(child, {
    setTimeout: (fn) => {
      fires.push(fn);
      return fires.length;
    },
    clearTimeout: () => {},
  });
  // 아무 frame도 오지 않는다. timer가 기한을 지킨다.
  for (const fire of [...fires]) fire();
  assert.equal(core.phase, "stopped");
  await assert.rejects(core.hello);
  assert.equal(child.killed, true);
  core.ended();
});

test("shell/desktop#R21: stop 뒤 grace가 지나도 core가 끝나지 않으면 강제로 끝낸다", () => {
  const fires: (() => void)[] = [];
  const child = fakeChild();
  const core = supervise(child, {
    setTimeout: (fn, ms) => {
      fires.push(fn);
      void ms;
      return fires.length;
    },
    clearTimeout: () => {},
  });
  child.push(encodeFrame({ kind: "json", channel: 0, payload: hello }));
  core.stop(100);
  // hello timer와 stop fallback 두 개다.
  assert.equal(fires.length, 2);
  child.exit();
  // exit 뒤의 stop fallback timer는 이미 stopped라 강제 종료를 다시 부르지 않는다.
  fires.forEach((fire) => fire());
  assert.equal(child.killed, false);
  core.ended();
});

test("shell/desktop#R21: grace가 지나도 core가 살아 있으면 kill한다", () => {
  const fires: (() => void)[] = [];
  const child = fakeChild();
  const core = supervise(child, {
    setTimeout: (fn, ms) => {
      fires.push(fn);
      void ms;
      return fires.length;
    },
    clearTimeout: () => {},
  });
  child.push(encodeFrame({ kind: "json", channel: 0, payload: hello }));
  core.stop(100);
  assert.equal(fires.length, 2);
  // hello timer는 이미 clear돼 부르지 않는다. stop fallback만 부른다.
  fires[1]!();
  assert.equal(core.phase, "stopped");
  assert.equal(child.killed, true);
  core.ended();
});
