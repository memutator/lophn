import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { OsPlatform } from "../../../base/mod.ts";
import { prepareRunDir, type RunDirDeps } from "./run-dir.ts";

// 실제 file을 만들지 않고 어떤 fs 호출이 있었는지만 본다.
function memoryFs() {
  const calls: string[] = [];
  return {
    calls,
    fs: {
      mkdir: (path: string) => void calls.push(`mkdir:${path}`),
      chmod: (path: string) => void calls.push(`chmod:${path}`),
      list: (path: string) => {
        calls.push(`list:${path}`);
        return [];
      },
      remove: (path: string) => void calls.push(`remove:${path}`),
    },
  };
}

function memoryDeps(
  platform: OsPlatform,
  xdgRuntimeDir: string | undefined,
): { deps: RunDirDeps; calls: string[] } {
  const { fs, calls } = memoryFs();
  const env =
    xdgRuntimeDir === undefined ? {} : { XDG_RUNTIME_DIR: xdgRuntimeDir };
  return {
    calls,
    deps: {
      platform,
      dataRoot: "/data/lophn",
      env,
      tmpdir: "/tmp",
      uid: 1000,
      pid: 4321,
      fs,
      isAlive: () => true,
    },
  };
}

test("socket 경로가 OS byte 한도를 넘으면 폴더를 만지기 전에 준비가 거절된다", () => {
  for (const [platform, limit] of [
    ["linux", 107],
    ["darwin", 103],
  ] as const) {
    const short = memoryDeps(platform, "/run/x");
    const prepared = prepareRunDir(short.deps);
    if (!prepared.ok) assert.fail(prepared.error.message);
    // hash 폴더 이름은 고정 길이라 xdg를 늘린 만큼 두 endpoint가 같이 길어진다.
    const padding = limit - Buffer.byteLength(prepared.value.bridgeSocket);
    // 한글은 한 글자 3 byte다. 남는 byte는 ascii로 채워 xdg를 정확히 한도까지 늘린다.
    const filler =
      "한".repeat(Math.floor(padding / 3)) + "a".repeat(padding % 3);

    const exact = memoryDeps(platform, "/run/x" + filler);
    const accepted = prepareRunDir(exact.deps);
    if (!accepted.ok) assert.fail(accepted.error.message);
    // bridge와 hook이 같은 폴더를 공유하되 이름 길이가 같아 둘 다 정확히 한도다.
    for (const endpoint of [
      accepted.value.bridgeSocket,
      accepted.value.hookSocket,
    ]) {
      assert.equal(Buffer.byteLength(endpoint), limit);
    }

    const over = memoryDeps(platform, "/run/x" + filler + "a");
    const rejected = prepareRunDir(over.deps);
    if (rejected.ok) {
      assert.fail(`${platform} ${limit} accepted an over-limit path`);
    }
    assert.equal(rejected.error.code, "invalid_input");
    assert.deepEqual(over.calls, []);
  }
});

test("Windows pipe는 긴 data root여도 pipe 한도 안에 들고 uid·chmod를 요구하지 않는다", () => {
  const dataRoot = `C:\\Users\\${"한".repeat(200)}\\.lophn`;
  const { fs, calls } = memoryFs();
  const prepared = prepareRunDir({
    platform: "win32",
    dataRoot,
    env: {},
    tmpdir: "C:\\Temp",
    uid: -1,
    pid: 4321,
    fs,
    isAlive: () => true,
  });
  if (!prepared.ok) assert.fail(prepared.error.message);
  const run = prepared.value;
  assert.equal(run.dir, join(dataRoot, "run", "shell-4321"));
  for (const socket of [run.bridgeSocket, run.hookSocket]) {
    assert.match(socket, /^\\\\\.\\pipe\\lophn-/);
    assert.ok(Buffer.byteLength(socket) <= 256);
  }
  assert.equal(
    calls.some((call) => call.startsWith("chmod:")),
    false,
  );
});

test("run 폴더 정리는 죽은 shell만 지우고 POSIX private mode를 유지한다", () => {
  const root = mkdtempSync(join(tmpdir(), "lophn-run-dir-"));
  try {
    const deps: RunDirDeps = {
      platform: "linux",
      dataRoot: join(root, "data"),
      env: { XDG_RUNTIME_DIR: join(root, "runtime") },
      tmpdir: root,
      uid: 1000,
      pid: 4242,
      fs: {
        mkdir: (path, mode) => void mkdirSync(path, { recursive: true, mode }),
        chmod: (path, mode) => chmodSync(path, mode),
        list: (path) => {
          try {
            return readdirSync(path);
          } catch {
            return [];
          }
        },
        remove: (path) => rmSync(path, { recursive: true, force: true }),
      },
      // 7777은 지금 다른 shell이 쓰는 pid다.
      isAlive: (pid) => pid === 7777,
    };
    const first = prepareRunDir(deps);
    if (!first.ok) assert.fail(first.error.message);
    const keyDir = dirname(first.value.dir);
    mkdirSync(join(keyDir, "shell-7777"));
    mkdirSync(join(keyDir, "shell-9999"));
    mkdirSync(join(keyDir, "core"));
    writeFileSync(join(keyDir, "b0.sock"), "");
    writeFileSync(join(first.value.dir, "browser.js"), "old");

    // data root가 다르면 hash 폴더도 다르다. 이 root의 정리가 다른 실행의 file을 지우면 안 된다.
    const other = prepareRunDir({
      ...deps,
      dataRoot: join(root, "other-data"),
    });
    if (!other.ok) assert.fail(other.error.message);
    const sentinel = join(other.value.dir, "sentinel.txt");
    writeFileSync(sentinel, "keep");

    const again = prepareRunDir(deps);
    if (!again.ok) assert.fail(again.error.message);
    assert.deepEqual(
      readdirSync(keyDir).sort(),
      ["b0.sock", "core", "shell-4242", "shell-7777"].sort(),
    );
    assert.deepEqual(readdirSync(again.value.dir), []);
    assert.equal(readFileSync(sentinel, "utf8"), "keep");
    if (process.platform !== "win32") {
      for (const path of [dirname(keyDir), keyDir, again.value.dir]) {
        assert.equal(statSync(path).mode & 0o777, 0o700);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
