import { assert, assertEquals } from "@std/assert";
import { SOCKET_PATH_MAX_BYTES } from "../../../protocol/apps/mod.ts";
import {
  allSlotSockets,
  createSocketDirectory,
  slotSockets,
  SOCKET_SLOTS,
} from "./socket-dir.ts";

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

Deno.test("apps/runtime#R6: XDG runtime이 없으면 사용자별 0700 임시 디렉터리를 만든다", () => {
  const made: { path: string; mode: number }[] = [];
  const result = createSocketDirectory({
    xdgRuntimeDir: undefined,
    uid: 1000,
    ensureDir: (path, mode) => made.push({ path, mode }),
    tempParent: "/tmp",
    randomName: () => "abc",
  });
  assert(result.ok);
  assertEquals(made, [{ path: "/tmp/lophn-1000", mode: 0o700 }]);
  assert(result.value.brokerSocket.startsWith("/tmp/lophn-1000/b-"));
  assert(result.value.directSocket.startsWith("/tmp/lophn-1000/a-"));
  assert(bytes(result.value.brokerSocket) < SOCKET_PATH_MAX_BYTES);
});

Deno.test("apps/runtime#R6: XDG runtime이 있으면 거기를 쓰고 slug는 경로에 없다", () => {
  const result = createSocketDirectory({
    xdgRuntimeDir: "/run/user/1000",
    uid: 1000,
    ensureDir: () => {},
    tempParent: "/tmp",
    randomName: () => "xyz",
  });
  assert(result.ok);
  assertEquals(result.value.directory, "/run/user/1000/lophn");
  // 아주 긴 slug를 넣어도 경로는 slug를 담지 않아 한도를 넘지 않는다.
  const slug = "x".repeat(300);
  assert(!result.value.brokerSocket.includes(slug));
  assert(bytes(result.value.directSocket) < SOCKET_PATH_MAX_BYTES);
});

Deno.test("apps/runtime#R6: 104byte를 넘는 경로는 거절한다", () => {
  const result = createSocketDirectory({
    xdgRuntimeDir: `/${"d".repeat(200)}`,
    uid: 1,
    ensureDir: () => {
      throw new Error("should not create");
    },
    tempParent: "/tmp",
    randomName: () => "n",
  });
  assert(!result.ok);
  assertEquals(result.error.code, "invalid_input");
});

Deno.test("apps/runtime#R6: 앱 socket은 고정 자리의 경로이고 허락 목록에 모든 자리가 들어 있다", () => {
  const first = slotSockets("/run/user/1000/lophn", 0);
  assert(first.ok);
  assertEquals(first.value, {
    brokerSocket: "/run/user/1000/lophn/b0.sock",
    directSocket: "/run/user/1000/lophn/a0.sock",
  });
  // 자리 밖과 한도를 넘는 경로는 거절한다.
  assert(!slotSockets("/run/lophn", SOCKET_SLOTS).ok);
  assert(!slotSockets("/run/lophn", -1).ok);
  assert(!slotSockets(`/${"d".repeat(120)}`, 0).ok);
  const all = allSlotSockets("/run/lophn");
  assertEquals(all.length, SOCKET_SLOTS * 2);
  assertEquals(new Set(all).size, all.length);
  for (const path of all) assert(bytes(path) < SOCKET_PATH_MAX_BYTES);
});
