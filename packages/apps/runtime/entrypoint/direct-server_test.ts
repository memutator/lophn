import { assert, assertEquals } from "@std/assert";
import { sha256Hex } from "@lophn/base";
import {
  appConnectionSchema,
  commandInvokeInputSchema,
  controlOpenInputSchema,
} from "@lophn/contracts/apps";
import { startRuntime } from "./startup.ts";
import { startDirectServer } from "./direct-server.ts";
import {
  APP,
  AT,
  blueprint,
  clockAt,
  connection,
  HASH,
  installHandlers,
  NONCE,
  REL,
  shaKey,
  sign,
  startLine,
} from "./testing.ts";
import { SOCKET_HOST } from "./limits.ts";

const calls: string[] = [];
const schedule = installHandlers([
  { command: "undo", handle: () => undefined },
  {
    command: "usage.read",
    handle: (input) => {
      calls.push(`read:${JSON.stringify(input)}`);
      return { rows: [], source: { coverage: "complete", freshness: "fresh" } };
    },
  },
  {
    command: "usage.save",
    handle: () => {
      calls.push("save");
      return { saved: true };
    },
  },
]);

Deno.test("apps/runtime#R11 apps/runtime#R8 apps/runtime#R31 apps/blueprint#R7: direct socket rejects bad calls and normalizes input", async () => {
  const dir = await Deno.makeTempDir();
  const socket = `${dir}/a.sock`;
  const clock = clockAt();
  const started = startRuntime({
    line: startLine({ direct_socket: socket, broker_socket: `${dir}/b.sock` }),
    blueprint: blueprint(),
    key: shaKey(),
    clock,
    ids: { newId: () => "inv_01h455vb4pex5v6nkc6gd5fdw9" },
    broker: () => Promise.resolve({ status: 200, body: { accepted: true } }),
    dataSchema: 0,
    screenBytes: (screen, path) =>
      screen === "usage" && path === "app.js"
        ? new TextEncoder().encode(`<p>${screen}</p>`)
        : undefined,
  });
  const server = startDirectServer(started.state);
  try {
    const forged = await post(
      socket,
      "/_lophn/commands/invoke",
      await sign(connection()),
      {
        request_key: "a",
        release: REL,
        command: "usage.read",
      },
      "deadbeef",
    );
    assertEquals(forged.status, 401);

    const stale = connection();
    const old = JSON.parse(await sign(stale));
    old.payload.process_nonce = "old-nonce";
    const oldNonce = await post(
      socket,
      "/_lophn/commands/invoke",
      JSON.stringify(old),
      {
        request_key: "b",
        command: "usage.read",
      },
    );
    assertEquals(oldNonce.status, 401);

    const otherRelease = await post(
      socket,
      "/_lophn/commands/invoke",
      await sign(connection({
        release: "rel_01h455vb4pex5v6nkc6gd5fdw2",
      })),
      { request_key: "c", command: "usage.read" },
    );
    assertEquals(otherRelease.status, 409);

    const otherBundle = await post(
      socket,
      "/_lophn/commands/invoke",
      await sign(connection({
        bundle_hash: "cd".repeat(32),
      })),
      { request_key: "d", command: "usage.read" },
    );
    assertEquals(otherBundle.status, 409);

    const otherMode = await post(
      socket,
      "/_lophn/commands/invoke",
      await sign(connection({
        mode: "preview",
        release: null,
      })),
      { request_key: "e", command: "usage.read" },
    );
    assertEquals(otherMode.status, 409);

    clock.set(Date.parse("2026-10-04T00:02:00.000Z"));
    const expired = await post(
      socket,
      "/_lophn/commands/invoke",
      await sign(connection()),
      {
        request_key: "f",
        command: "usage.read",
      },
    );
    assertEquals(expired.status, 401);
    clock.set(Date.parse(AT));

    const outsideScreen = await get(
      socket,
      "/screens/other/app.js?size=full&view_session=v1",
      await sign(connection()),
    );
    assertEquals(outsideScreen.status, 403);
    const outsideCommand = await post(
      socket,
      "/_lophn/commands/invoke",
      await sign(connection()),
      {
        request_key: "g",
        release: REL,
        command: "usage.other",
      },
    );
    assertEquals(outsideCommand.status, 400);

    const badInput = await post(
      socket,
      "/_lophn/commands/invoke",
      await sign(connection()),
      {
        request_key: "h",
        release: REL,
        command: "usage.read",
        input: { limit: "nope" },
        actor: "app:app_01h455vb4pex5v6nkc6gd5fdw9",
        effect: "read",
      },
    );
    assertEquals(badInput.status, 400);
    assertEquals(calls.includes('read:{"limit":"nope"}'), false);

    started.state.accepting = true;
    const normalized = await post(
      socket,
      "/_lophn/commands/invoke",
      await sign(connection()),
      {
        request_key: "i",
        release: REL,
        command: "usage.read",
      },
    );
    assertEquals(normalized.status, 200);
    assert(calls.includes('read:{"limit":10}'));

    const claimed = await post(
      socket,
      "/_lophn/commands/invoke",
      await sign(connection()),
      {
        request_key: "j",
        release: REL,
        command: "usage.save",
        effect: "read",
        actor: "user",
      },
    );
    assertEquals(claimed.status, 200);
    assert(calls.includes("save"));

    const panel = await get(
      socket,
      "/screens/usage/app.js?size=panel&view_session=panel-1",
      await sign(connection()),
    );
    const card = await get(
      socket,
      "/screens/usage/app.js?size=full&view_session=full-1",
      await sign(connection()),
    );
    assertEquals(panel.status, 200);
    assertEquals(card.status, 200);
    assertEquals(started.state.views.get("panel-1")?.size, "panel");
    assertEquals(started.state.views.get("full-1")?.size, "full");
    const mixed = await get(
      socket,
      "/screens/usage/app.js?size=full&view_session=panel-1",
      await sign(connection()),
    );
    assertEquals(mixed.status, 409);

    const foreign = await get(
      socket,
      "/screens/usage/app.js?size=full&view_session=v2",
      await sign(connection()),
      "evil.example",
    );
    assertEquals(foreign.status, 400);

    const postedStatus = await post(
      socket,
      "/_lophn/commands/status",
      await sign(connection()),
      { request_key: "i", invocation: "inv_01h455vb4pex5v6nkc6gd5fdw9" },
    );
    assertEquals(postedStatus.status, 400);
    assertEquals(schedule.current(), null);
  } finally {
    await server.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("apps/runtime#R11: hand-written wire agrees with contract schemas", () => {
  const body = {
    request_key: "k",
    release: REL,
    command: "usage.read",
    input: { limit: 1 },
  };
  assert(commandInvokeInputSchema.safeParse(body).success);
  const open = { process_nonce: NONCE, release: REL };
  assert(controlOpenInputSchema.safeParse(open).success);
  // release 없는 preview의 open도 contract와 같이 받는다(apps/preview#R9).
  assert(
    controlOpenInputSchema.safeParse({ process_nonce: NONCE, release: null })
      .success,
  );
  assert(appConnectionSchema.safeParse(connection()).success);
  assert(
    !commandInvokeInputSchema.safeParse({ ...body, actor: "user" }).success,
  );
});

async function post(
  socket: string,
  path: string,
  authorization: string,
  body: unknown,
  signatureOverride?: string,
) {
  const header = signatureOverride
    ? authorization.replace(
      /"signature":"[^"]*"/,
      `"signature":"${signatureOverride}"`,
    )
    : authorization;
  return await call(socket, "POST", path, header, JSON.stringify(body));
}

async function get(
  socket: string,
  path: string,
  authorization: string,
  host = SOCKET_HOST,
) {
  return await call(socket, "GET", path, authorization, undefined, host);
}

async function call(
  socket: string,
  method: string,
  path: string,
  authorization: string,
  body?: string,
  host = SOCKET_HOST,
) {
  const conn = await Deno.connect({ path: socket, transport: "unix" });
  const headers = [
    `${method} ${path} HTTP/1.1`,
    `host: ${host}`,
    `authorization: ${authorization}`,
    "connection: close",
  ];
  if (body) {
    headers.push("content-type: application/json");
    headers.push(
      `content-length: ${new TextEncoder().encode(body).byteLength}`,
    );
  }
  const payload = headers.join("\r\n") + "\r\n\r\n" + (body ?? "");
  await conn.write(new TextEncoder().encode(payload));
  const bytes = await readAll(conn);
  conn.close();
  const text = new TextDecoder().decode(bytes);
  const status = Number(text.split(" ")[1]);
  const raw = text.slice(text.indexOf("\r\n\r\n") + 4);
  return { status, body: raw };
}

async function readAll(conn: Deno.Conn): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const buffer = new Uint8Array(8192);
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const n = await Promise.race([
      conn.read(buffer),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
    ]);
    if (n === null) break;
    chunks.push(buffer.slice(0, n));
    const bytes = concat(chunks);
    const text = new TextDecoder().decode(bytes);
    const marker = text.indexOf("\r\n\r\n");
    if (marker < 0) continue;
    const headerBytes =
      new TextEncoder().encode(text.slice(0, marker + 4)).byteLength;
    const length = Number(
      text.slice(0, marker).match(/content-length: (\d+)/i)?.[1] ?? "0",
    );
    if (bytes.byteLength >= headerBytes + length) break;
  }
  return concat(chunks);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

void sha256Hex;
void APP;
void HASH;
