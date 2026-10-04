import { assert, assertEquals } from "@std/assert";
import { SOCKET_PATH_MAX_BYTES } from "../../../contracts/apps/mod.ts";
import { createSocketDirectory } from "./socket-dir.ts";

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
