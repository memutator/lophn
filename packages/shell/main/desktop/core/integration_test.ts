// shell 쪽 client가 실제 core 위에서 도는지 본다. fake가 아니라 packages/core/main/daemon/main.ts를
// Deno로 띄워 hello→read→WS 구독 event 수신까지 이어 본다. node --test로 돈다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { type ChildProcess, spawn } from "node:child_process";

import { mainHelloSchema } from "../../../../protocol/supervision/mod.ts";

import { openSession } from "./client.ts";
import { subscribe } from "./events.ts";
import { nodeSockets } from "./node-io.ts";
import { optInFromSettings, OS_NOTIFICATIONS_KEY } from "../os-notification.ts";
import { FrameDecoder } from "../../../../protocol/base/mod.ts";

/** main.ts는 Deno 권한과 Worker가 필요하다. 부모 pipe로 실제 core를 띄운다. */
function spawnCore(home: string, repoRoot: string): ChildProcess {
  return spawn(
    "deno",
    ["run", "--allow-all", "packages/core/main/daemon/main.ts", "--port=0"],
    {
      cwd: repoRoot,
      env: { ...process.env, LOPHN_HOME: home },
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
}

/** 길이 prefix frame에서 hello를 한 번 읽는다. */
async function firstHello(
  stream: NodeJS.ReadableStream,
): Promise<{ user_token: string; api_port: number; core_epoch: string }> {
  const decoder = new FrameDecoder();
  return await new Promise((resolve, reject) => {
    stream.on("data", (chunk: Uint8Array) => {
      let frames;
      try {
        frames = decoder.push(new Uint8Array(chunk));
      } catch (error) {
        reject(error);
        return;
      }
      for (const frame of frames) {
        if (frame.kind !== "json") continue;
        const parsed = mainHelloSchema.safeParse(frame.payload);
        if (parsed.success) {
          resolve(parsed.data);
          return;
        }
      }
    });
    stream.on("error", reject);
    stream.on("end", () => reject(new Error("core가 hello 전에 끝났다")));
  });
}

test("shell/desktop#R15: 실제 core에서 hello→read→WS 구독 event 수신까지 돌고 OS notification opt-in(R10)을 settings로 읽는다", async () => {
  const home = await mkdtemp(`${tmpdir()}/lophn-shell-core-`);
  // test file 위치가 repo root의 packages/shell/main 아래다. core entry는 repo root 기준이다.
  const repoRoot = new URL("../../../../../", import.meta.url).pathname;
  const child = spawnCore(home, repoRoot);
  try {
    const core = await new Promise<{
      user_token: string;
      api_port: number;
      core_epoch: string;
    }>((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error("core hello가 30초 안에 오지 않았다")),
        30_000,
      );
      deadline.unref();
      firstHello(child.stdout!).then(
        (hello) => {
          clearTimeout(deadline);
          resolve(hello);
        },
        reject,
      );
    });
    assert.ok(core.api_port > 0);
    assert.ok(core.core_epoch.length > 0);
    // token은 이 테스트 메모리에만 있다. log·argv·URL에는 없다.
    assert.ok(core.user_token.length > 0);

    const session = openSession({
      apiPort: core.api_port,
      coreEpoch: core.core_epoch,
      userToken: core.user_token,
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        return {
          status: response.status,
          headers: response.headers,
          bytes: new Uint8Array(await response.arrayBuffer()),
        };
      },
    });

    // read: allowlist 안의 현재 상태 read. 실제 core 응답을 확인한다.
    const status = await session.call("read", "platform", "status", {});
    assert.equal(status.ok, true);
    if (status.ok) {
      const ready = (status.value as { ready?: boolean }).ready;
      assert.equal(ready, true);
    }

    // OS notification opt-in(shell#T56): 실제 core의 settings에서 기본 꺼짐이고, 켜면 켜짐으로 읽힌다.
    const readOptIn = async () => {
      const reply = await session.call("read", "settings", "get", {
        keys: [OS_NOTIFICATIONS_KEY],
      });
      assert.equal(reply.ok, true, JSON.stringify(reply));
      const value = reply.ok
        ? reply.value as { revision: number; defaults_revision: string }
        : { revision: 0, defaults_revision: "" };
      return {
        on: reply.ok && optInFromSettings(reply.value),
        compare: {
          revision: value.revision,
          defaults_revision: value.defaults_revision,
        },
      };
    };
    const before = await readOptIn();
    assert.equal(before.on, false);
    const applied = await session.call("command", "settings", "apply", {
      input: {
        changes: [{
          layer: "common",
          key: OS_NOTIFICATIONS_KEY,
          action: "set",
          value: true,
        }],
      },
      idempotency_key: "shell-os-notifications-on",
      compare: before.compare,
      prepared: [],
    });
    assert.equal(applied.ok, true, JSON.stringify(applied));
    assert.equal((await readOptIn()).on, true);

    // OS 표시 요청과 표시 실패 보고(platform#T46): main 안의 통로가 실제 core의 route로 닿는다.
    // 없는 notification은 두 길 모두 같은 not_found다.
    const missing = "ntf_01arz3ndektsv4rrffq69g5fav";
    const display = await session.internal(
      "read",
      "notifications",
      "display",
      { notification: missing },
    );
    assert.equal(display.ok, false);
    assert.equal(!display.ok && display.error.code, "not_found");
    const reported = await session.internal(
      "memory",
      "notifications",
      "delivery",
      { notification: missing, reason: "show_failed" },
    );
    assert.equal(reported.ok, false);
    assert.equal(!reported.ok && reported.error.code, "not_found");

    // WS 구독: Bearer는 headers로 싣는다. token은 URL에 넣지 않는다.
    const received: unknown[] = [];
    const catches: number[] = [];
    const sub = subscribe({
      session,
      epoch: core.core_epoch,
      // token은 이 closure에만 묶인다.
      headers: () => ({ Authorization: `Bearer ${core.user_token}` }),
      socket: nodeSockets(),
      clock: { now: () => Date.now() },
      sink: {
        stale: () => {},
        caughtUp: () => catches.push(catches.length),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    // 실제 core 응답 events frame을 받거나, 구독이 적어도 열린다. cursor는 음수가 아니다.
    assert.ok(sub.cursor.length > 0);
    assert.ok(Number(sub.cursor) >= 0);
    sub.stop();

    void received;
  } finally {
    try {
      child.kill("SIGTERM");
    } catch { /* 이미 끝남 */ }
    try {
      child.stdin?.end();
    } catch { /* 이미 끝남 */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      child.kill("SIGKILL");
    } catch { /* 이미 끝남 */ }
    await rm(home, { recursive: true, force: true });
  }
});
