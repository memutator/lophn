import assert from "node:assert/strict";
import { test } from "node:test";

import { encodeFrame } from "../../../../../packages/contracts/platform/mod.ts";

import {
  CORE_PERMISSION_FLAGS,
  type CoreChild,
  coreLaunch,
  STOP_GRACE_MS,
  supervise,
} from "./supervise.ts";

function fakeChild(): CoreChild & {
  sent: Uint8Array[];
  push(bytes: Uint8Array): void;
  exit(): void;
  killed: boolean;
} {
  const data: ((chunk: Uint8Array) => void)[] = [];
  const exits: (() => void)[] = [];
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
    on(event: "exit", listener: () => void) {
      if (event === "exit") exits.push(listener);
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
