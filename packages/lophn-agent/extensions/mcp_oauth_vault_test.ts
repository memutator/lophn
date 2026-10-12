// lophn-agent/extensions#R17: OAuth token은 platform/secrets의 보관 방식(OS keychain)에만 있고 서버(자리+이름)와
// 발급자·URL에 묶인다. 값은 보관 모양 어디에도 새지 않고 참조만 밖으로 나간다. 사람의 실제 keychain에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../base/mod.ts";
import { mcpAuthSchema } from "../../protocol/lophn-agent/mod.ts";
import {
  createMcpOAuthVault,
  type McpGrant,
  mcpTokenRef,
  type McpVaultKeychain,
} from "./mcp-oauth-vault.ts";
import { fakeVaultKeychain as fakeKeychain } from "./testing/mod.ts";

const PRJ = "prj_01arz3ndektsv4rrffq69g5fa1";
const APP = "app_01arz3ndektsv4rrffq69g5fa2";

const ACCESS = "access-value-teal-orchard-1";
const REFRESH = "refresh-value-saffron-meadow-1";

const GRANT: McpGrant = {
  access_token: ACCESS,
  refresh_token: REFRESH,
  expires_at_ms: 1_000_000,
  token_endpoint: "https://issuer.example.test/token",
  binding: {
    issuer: "https://issuer.example.test",
    server_url: "https://mcp.example.test/rpc",
    client_id: "lophn",
  },
};

function vaultOver(keychain: McpVaultKeychain) {
  let serial = 0;
  return createMcpOAuthVault({
    keychain: () => keychain,
    randomRef: () => `rand-${++serial}-${crypto.randomUUID()}`,
  });
}

const GLOBAL = { place: null, name: "notes" } as const;
const IN_PROJECT = {
  place: { kind: "project", id: PRJ },
  name: "notes",
} as const;
const IN_APP = { place: { kind: "app", id: APP }, name: "notes" } as const;

function unwrap<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? "" : JSON.stringify(result.error));
  return result.value;
}

Deno.test("lophn-agent/extensions#R17 [agent-I52]: the token reference names the server and its place, and the setting schema accepts it", () => {
  assertEquals(mcpTokenRef(GLOBAL), "sec:mcp-oauth:global:notes");
  assertEquals(mcpTokenRef(IN_PROJECT), `sec:mcp-oauth:${PRJ}:notes`);
  assertEquals(mcpTokenRef(IN_APP), `sec:mcp-oauth:${APP}:notes`);
  // 같은 이름의 서버도 자리가 다르면 다른 참조다.
  assertEquals(
    new Set([GLOBAL, IN_PROJECT, IN_APP].map(mcpTokenRef)).size,
    3,
  );
  for (const key of [GLOBAL, IN_PROJECT, IN_APP]) {
    assert(
      mcpAuthSchema.safeParse({
        kind: "oauth2",
        issuer: "https://issuer.example.test",
        client_id: "lophn",
        client_secret_ref: null,
        scopes: [],
        token_ref: mcpTokenRef(key),
      }).success,
    );
  }
});

Deno.test("lophn-agent/extensions#R17 platform/secrets#R1 [agent-I52]: a saved grant lives only in the keychain, comes back after a restart, and only references leave the vault", async () => {
  const keychain = fakeKeychain();
  const vault = vaultOver(keychain);
  unwrap(await vault.save(GLOBAL, GRANT));
  // 값은 keychain 항목에만 있다: 접근·갱신 token이 각자의 항목이고 관측 모양에는 값이 없다.
  const stored = [...keychain.items.values()].map((item) => item.value);
  assert(stored.includes(ACCESS));
  assert(stored.includes(REFRESH));
  assert(
    [...keychain.items.values()].every((item) =>
      item.purpose === "external_mcp_credential"
    ),
  );
  const refs = vault.refs();
  assertEquals(refs.map((ref) => ref.name).sort(), [
    "mcp-oauth/global/notes/access",
    "mcp-oauth/global/notes/refresh",
  ]);
  const shown = JSON.stringify(refs);
  assert(!shown.includes(ACCESS) && !shown.includes(REFRESH));
  // 다시 뜬 vault(같은 keychain)가 같은 grant를 읽고, 읽은 뒤 알려진 값 참조를 채운다.
  const restarted = vaultOver(keychain);
  assertEquals(restarted.refs(), []);
  assertEquals(unwrap(await restarted.load(GLOBAL)), GRANT);
  assertEquals(
    restarted.refs().map((ref) => ref.name).sort(),
    refs.map((ref) => ref.name).sort(),
  );
  assertEquals(
    restarted.sealedRefOf(GLOBAL, "access"),
    refs.find((ref) => ref.name.endsWith("/access"))!.sealedRef,
  );
});

Deno.test("lophn-agent/extensions#R17 [agent-I52]: saving again replaces the values under new references and the old items are gone", async () => {
  const keychain = fakeKeychain();
  const vault = vaultOver(keychain);
  unwrap(await vault.save(GLOBAL, GRANT));
  const before = vault.refs().map((ref) => ref.sealedRef).sort();
  unwrap(
    await vault.save(GLOBAL, {
      ...GRANT,
      access_token: "access-value-two",
      refresh_token: "refresh-value-two",
    }),
  );
  const after = vault.refs().map((ref) => ref.sealedRef).sort();
  // 값이 바뀐 이름은 참조도 바뀌어야 secret store가 새 값을 읽고 옛 값을 회수한다.
  assert(before.every((ref) => !after.includes(ref)));
  const values = [...keychain.items.values()].map((item) => item.value);
  assert(!values.includes(ACCESS) && !values.includes(REFRESH));
  assert(values.includes("access-value-two"));
  assertEquals(
    unwrap(await vault.load(GLOBAL))?.access_token,
    "access-value-two",
  );
});

Deno.test("lophn-agent/extensions#R17 [agent-I52]: the same name in different places keeps separate grants, and removing one leaves the others", async () => {
  const keychain = fakeKeychain();
  const vault = vaultOver(keychain);
  unwrap(await vault.save(GLOBAL, GRANT));
  unwrap(await vault.save(IN_PROJECT, { ...GRANT, access_token: "project" }));
  unwrap(await vault.save(IN_APP, { ...GRANT, access_token: "app" }));
  assertEquals(unwrap(await vault.load(IN_PROJECT))?.access_token, "project");
  assertEquals(unwrap(await vault.load(IN_APP))?.access_token, "app");
  assertEquals(unwrap(await vault.load(GLOBAL))?.access_token, ACCESS);
  unwrap(await vault.remove(IN_PROJECT));
  assertEquals(unwrap(await vault.load(IN_PROJECT)), null);
  assertEquals(unwrap(await vault.load(IN_APP))?.access_token, "app");
  assertEquals(unwrap(await vault.load(GLOBAL))?.access_token, ACCESS);
  assert(
    vault.refs().every((ref) => !ref.name.includes(PRJ)),
    "removed grant leaves no known-value reference",
  );
  // 없는 grant를 지워도 오류가 아니다.
  unwrap(await vault.remove(IN_PROJECT));
});

Deno.test("lophn-agent/extensions#R17 [agent-I52]: a grant without a refresh token has only the access reference", async () => {
  const keychain = fakeKeychain();
  const vault = vaultOver(keychain);
  unwrap(await vault.save(GLOBAL, { ...GRANT, refresh_token: null }));
  assertEquals(
    vault.refs().map((ref) => ref.name),
    ["mcp-oauth/global/notes/access"],
  );
  assertEquals(unwrap(await vault.load(GLOBAL))?.refresh_token, null);
  assertEquals(vault.sealedRefOf(GLOBAL, "refresh"), undefined);
});

Deno.test("platform/secrets#R8 [agent-I52]: a locked keychain is unavailable, never an empty vault, and nothing falls back to a file", async () => {
  const keychain = fakeKeychain();
  const vault = vaultOver(keychain);
  unwrap(await vault.save(GLOBAL, GRANT));
  keychain.unavailable = true;
  const locked = vaultOver(keychain);
  const loaded = await locked.load(GLOBAL);
  assert(!loaded.ok);
  assertEquals(loaded.error.code, "unavailable");
  const saved = await locked.save(IN_PROJECT, GRANT);
  assert(!saved.ok);
  assertEquals(saved.error.code, "unavailable");
  assertEquals(locked.refs(), []);
  // 값이 오류 글에 새지 않는다.
  assert(!JSON.stringify(loaded.error).includes(ACCESS));
  keychain.unavailable = false;
  // 풀리면 같은 grant가 그대로다: 잠겨 있던 동안 지워지지 않았다.
  assertEquals(unwrap(await locked.load(GLOBAL)), GRANT);
});
