import { assert, assertEquals } from "@std/assert";
import {
  type AppChannelTransport,
  createAppChannelClient,
} from "./channel-client.ts";
import type { AppConnectInput } from "./channel.ts";
import { DIRECT_SOCKET_PATHS, SOCKET_HOST } from "./channel-values.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const HASH = "ab".repeat(32);
const AT = "2026-10-04T00:00:00.000Z";

const connection = {
  app: APP,
  release: REL,
  bundle_hash: HASH,
  mode: "live",
  process_nonce: "nonce-1",
  actor: "user",
  credential_ref: "cred-1",
  screens: ["usage"],
  screen_sizes: { usage: ["full"] },
  caller: null,
  commands: ["usage.list"],
  expires_at: AT,
};

Deno.test("apps/runtime#R5, apps/runtime#R8, apps/preview#R3: transport 주입형 channel client", async () => {
  const seen: string[] = [];
  const transport: AppChannelTransport = {
    connect: (input) => {
      seen.push(input.mode);
      return Promise.resolve({
        status: 200,
        headers: new Headers(),
        bytes: new TextEncoder().encode(JSON.stringify({
          endpoint: "/run/user/lophn/a-1.sock",
          connection,
          signature: "A".repeat(86),
        })),
      });
    },
    direct: (_endpoint, path, init) => {
      seen.push(`${init.method} ${path} ${init.headers.host}`);
      return Promise.resolve({
        status: 200,
        headers: new Headers(),
        bytes: new TextEncoder().encode(JSON.stringify({
          result: {
            result: { rows: [] },
            source: {
              coverage: "complete",
              freshness: "fresh",
              continuation: null,
            },
          },
          mode: "live",
        })),
      });
    },
  };
  const client = createAppChannelClient(transport);
  const input: AppConnectInput = {
    app: APP,
    mode: "live",
    screens: ["usage"],
    screen_sizes: { usage: ["full"] },
    commands: ["usage.list"],
  };
  const connected = await client.connect(input);
  assert(connected.ok);
  assertEquals(connected.value.signature, "A".repeat(86));
  const invoked = await client.invoke(
    connected.value.endpoint,
    "connection-1",
    { request_key: "call-1", release: REL, command: "usage.list" },
  );
  assert(invoked.ok);
  assertEquals(invoked.value.result.source?.coverage, "complete");
  assertEquals(seen[1], `POST ${DIRECT_SOCKET_PATHS.invoke} ${SOCKET_HOST}`);
});

Deno.test("apps/runtime#R12: 전송 단절은 unavailable이다", async () => {
  const transport: AppChannelTransport = {
    connect: () => Promise.reject(new Error("socket closed")),
    direct: () => Promise.reject(new Error("socket closed")),
  };
  const client = createAppChannelClient(transport);
  const connected = await client.connect({
    app: APP,
    mode: "preview",
    screens: ["usage"],
    screen_sizes: { usage: ["full"] },
    commands: ["usage.list"],
    preview_nonce: "preview-1",
  });
  assertEquals(connected.ok, false);
  if (!connected.ok) assertEquals(connected.error.code, "unavailable");
});
