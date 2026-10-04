import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  appStartInputSchema,
  CONFIRM_MARKER_LIMIT,
  decodeAppStartInput,
  encodeAppStartInput,
  READY_TIMEOUT_MS,
  SOCKET_HOST,
  SOCKET_PATH_MAX_BYTES,
} from "./app-start.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const HASH = "ab".repeat(32);

const start = {
  app: APP,
  release: REL,
  bundle_hash: HASH,
  mode: "live" as const,
  process_nonce: "nonce-1",
  broker_socket: "/run/user/lophn/b-1.sock",
  direct_socket: "/run/user/lophn/a-1.sock",
  data_path: "/home/user/.lophn/apps/data.db",
  broker_credential: "child-credential",
};

Deno.test("apps/runtime#R2, apps/runtime#R7, apps/runtime#R8, apps/invocations#R19: 시작 입력 한 줄과 socket·marker 상한", () => {
  const line = encodeAppStartInput(start);
  assert(line.endsWith("\n"));
  assertEquals(line.slice(0, -1).includes("\n"), false);
  assertEquals(decodeAppStartInput(line), appStartInputSchema.parse(start));
  assertEquals(JSON.parse(line).broker_credential, "child-credential");
  assertEquals("token" in JSON.parse(line), false);
  assert(
    appStartInputSchema.safeParse({ ...start, release: null }).success ===
      false,
  );
  assert(
    appStartInputSchema.safeParse({
      ...start,
      mode: "preview",
      release: null,
    }).success,
  );
  assertThrows(() => decodeAppStartInput(`${line}${line}`));
  assertEquals(SOCKET_HOST, "lophn.invalid");
  assertEquals(SOCKET_PATH_MAX_BYTES, 104);
  assertEquals(READY_TIMEOUT_MS, 30_000);
  assertEquals(CONFIRM_MARKER_LIMIT, 4096);
  assert(
    appStartInputSchema.safeParse({
      ...start,
      direct_socket: `/${"a".repeat(SOCKET_PATH_MAX_BYTES)}`,
    }).success === false,
  );
});
