import assert from "node:assert/strict";
import { test } from "node:test";

import { socketDirectoryPath } from "./socket-dir.ts";

// 실제 SHA-256 대신 넣는 hash. 64자 hex를 돌려주고, 경로에는 앞 12자만 들어간다.
function fakeHash(text: string): string {
  let value = 0;
  for (const byte of new TextEncoder().encode(text)) {
    value = (value * 131 + byte) % 0x100000000;
  }
  return value.toString(16).padStart(8, "0").repeat(8);
}

const posix = {
  xdgRuntimeDir: "/run/user/1000",
  tempParent: "/tmp",
  uid: 1000,
  platform: "linux",
  hash: fakeHash,
};

test("data root가 다른 실행은 같은 socket namespace를 쓰지 않는다", () => {
  const dataRoot = "/home/ana/.lophn";
  const otherRoot = "/home/bo/.lophn";
  const key = fakeHash(dataRoot).slice(0, 12);
  const first = socketDirectoryPath({ ...posix, dataRoot });
  const again = socketDirectoryPath({ ...posix, dataRoot });
  const other = socketDirectoryPath({ ...posix, dataRoot: otherRoot });
  assert.ok(first.ok && again.ok && other.ok);
  assert.equal(first.value, again.value);
  assert.notEqual(first.value, other.value);
  assert.equal(first.value, `/run/user/1000/lophn/${key}`);
  assert.equal(key.length, 12);

  // XDG runtime이 없으면 사용자별 임시 디렉터리를 쓴다.
  const tmp = socketDirectoryPath({
    ...posix,
    dataRoot,
    xdgRuntimeDir: undefined,
  });
  assert.ok(tmp.ok);
  assert.equal(tmp.value, `/tmp/lophn-1000/${key}`);

  // Windows는 pipe 이름 공간이라 data root를 그대로 쓰고 uid를 보지 않는다.
  const win32 = socketDirectoryPath({
    ...posix,
    dataRoot: "C:\\Users\\ana\\.lophn",
    platform: "win32",
    uid: -1,
  });
  assert.ok(win32.ok);
  assert.equal(win32.value, "C:\\Users\\ana\\.lophn");

  for (const uid of [-1, 1.5]) {
    const rejected = socketDirectoryPath({ ...posix, dataRoot, uid });
    assert.deepEqual(rejected, {
      ok: false,
      error: { code: "invalid_input", message: "uid is not valid" },
    });
  }
});
