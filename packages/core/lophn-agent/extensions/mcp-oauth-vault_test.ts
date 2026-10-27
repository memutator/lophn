import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import {
  createSecretFileStore,
  openSecretStore,
  type SecretFs,
} from "../../secrets/mod.ts";
import { createMcpOAuth } from "./mcp-oauth.ts";
import { createMcpOAuthVault, mcpTokenNames } from "./mcp-oauth-vault.ts";

const NOW = 1_800_000_000_000;

// secrets.json 하나를 메모리에 둔다.
function memoryFs(): SecretFs {
  const files = new Map<string, string>();
  const missing = () =>
    Promise.reject(Object.assign(new Error("no file"), { code: "ENOENT" }));
  return {
    readText: (path) =>
      files.has(path) ? Promise.resolve(files.get(path)!) : missing(),
    mode: (path) => files.has(path) ? Promise.resolve(0o600) : missing(),
    chmod: () => Promise.resolve(),
    writeNew(path, text) {
      files.set(path, text);
      return Promise.resolve();
    },
    rename(from, to) {
      files.set(to, files.get(from)!);
      files.delete(from);
      return Promise.resolve();
    },
    remove(path) {
      files.delete(path);
      return Promise.resolve();
    },
  };
}

test("OAuth token은 각자 알려진 값이 되고 갱신이 거절되면 세 이름이 지워진다", async () => {
  const file = createSecretFileStore({ root: "/data", fs: memoryFs() });
  const store = openSecretStore({
    file,
    channel: {
      register: () => Promise.resolve(ok(undefined)),
      revoke: () => Promise.resolve(ok(undefined)),
      setReady: () => Promise.resolve(ok(undefined)),
    },
    retryMs: 60_000,
  });
  await store.open();
  const vault = createMcpOAuthVault({ secrets: store });
  const key = { place: null, name: "srv" };
  const server = {
    key,
    issuer: "https://id.example.com",
    serverUrl: "https://mcp.example.com/mcp",
    clientId: "client",
  };
  const access = "ACCESS-MARKER-7d1c";
  const refresh = "REFRESH-MARKER-2b9e";
  assert.deepEqual(
    await vault.save(key, {
      access_token: access,
      refresh_token: refresh,
      // 곧 만료되어 다음 사용이 갱신한다.
      expires_at_ms: NOW + 1_000,
      token_endpoint: "https://id.example.com/token",
      binding: {
        issuer: server.issuer,
        server_url: server.serverUrl,
        client_id: server.clientId,
      },
    }),
    ok(undefined),
  );

  // 두 token은 따로 알려진 값이라 글 속 어느 하나도 통째로 지워진다.
  for (const token of [access, refresh]) {
    const found = store.known.match(`before ${token} after`);
    assert.deepEqual([found?.index, found?.length], [7, token.length]);
  }
  const names = mcpTokenNames(key);
  assert.deepEqual(
    store.names(),
    ok([names.access, names.meta, names.refresh]),
  );

  // 발급자가 갱신을 거절한다.
  const oauth = createMcpOAuth({
    vault,
    fetch: () => Promise.resolve(new Response("", { status: 400 })),
    nowMs: () => NOW,
    deadline: () => Promise.resolve("aborted"),
  });
  const used = await oauth.access(server);
  assert.ok(!used.ok && used.error.code === "forbidden");
  assert.deepEqual(store.names(), ok([]));
  assert.equal(store.known.match(`x ${access} ${refresh}`), undefined);
  store.stop();
});
