// 사람의 연결 결정 입구(coding-agent#T36, connection#R2·R17): 임시 LOPHN_HOME과 fake keychain으로
// core를 띄워 `connect` route가 사람 credential에만 열리고 token 없는 결과만 돌려주며, connection
// credential의 값이 core의 알려진 값 registry에 등록·회수되는지 본다. 사람의 실제 keychain·데이터
// root는 열지 않는다.
import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals, assertFalse } from "@std/assert";
import { manualClock, ok, seededRandom } from "../../../base/mod.ts";
import { createConnectionSecretRefSource } from "../../../coding-agent/mod.ts";
import { connectionSchemaSteps } from "../../../coding-agent/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { KnownSecretChannel } from "../../storage/ledger/mod.ts";
import {
  codingCredentialRef,
  createCodingCredentialKeychain,
  createFakeKeychain,
  type FakeKeychain,
  SECRET_SCHEMA_STEPS,
} from "../../secrets/mod.ts";
import { codingAgentConnectionDefinitions } from "./coding-connection.ts";
import { type Core, startCore } from "../../main/daemon/core.ts";
import { closeUnlessKept } from "../../testing/close-on-throw.ts";
import { openSecretStore } from "../../secrets/store.ts";

const decoder = new TextDecoder();
const CAC = "cac_01arz3ndektsv4rrffq69g5fax";
const REVOKED = "cac_01arz3ndektsv4rrffq69g5fay";

type Reply = { status: number; body: Record<string, unknown> };

async function post(
  core: Core,
  path: string,
  token: string,
  body: unknown,
): Promise<Reply> {
  const response = await fetch(`http://127.0.0.1:${core.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function start(home: string, keychain: FakeKeychain): Promise<Core> {
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ codingAgentConnectionDefinitions }],
    teamModules: [new URL("./coding-connection.ts", import.meta.url).href],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(71),
    testCredentials: true,
    superviseIo: false,
    codingKeychain: keychain,
    codingLoaders: ["lophn-mcp-loader"],
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
  });
  await started.value.codingCredentialsReady;
  guard.keep();
  return started.value;
}

async function login(
  core: Core,
  token: string,
  operations: string[],
): Promise<string> {
  const context: AuthenticatedContext = {
    principal: "user",
    actor: "user",
    scope: { operations, targets: {} },
    conditions: {},
    credential_ref: `cred-${token.slice(0, 4)}-${core.epoch}`,
  };
  assert(core.acceptTestCredential);
  assert((await core.acceptTestCredential(context, token)).ok);
  assert((await core.record(context)).ok);
  return token;
}

Deno.test("coding-agent/connection#R2 coding-agent/connection#R17: connect 입구는 사람 선택만으로 connection을 만들고 결과·응답에 token과 hash가 없으며 keychain 항목은 고정 위치다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-connect-entry-" });
  const keychain = createFakeKeychain();
  const core = await start(home, keychain);
  try {
    const user = await login(core, "U".repeat(43), [
      "ConnectCodingAgent",
      "CreateCodingAgentConnection",
      "ListCodingAgentConnections",
      "platform/status",
    ]);
    const made = await post(core, "coding_agent_connections/connect", user, {
      label: "claude",
      scope: { kind: "all", app: null },
    });
    assertEquals(made.status, 200, JSON.stringify(made.body));
    const connection = made.body["connection"] as string;
    assert(connection.startsWith("cac_"), JSON.stringify(made.body));
    const stored = keychain.stored.get(codingCredentialRef(connection)!);
    assert(stored !== undefined);
    const token = decoder.decode(stored);
    // 응답 어디에도 원문 token도 검증 hash도 없다.
    const text = JSON.stringify(made.body);
    assertFalse(text.includes(token));
    assertFalse(text.includes("token"));
    assertEquals(Object.keys(made.body), ["connection"]);
    // 생긴 connection의 token으로 인증된다. 사람이 token을 만들거나 붙여 넣지 않았다.
    assertEquals(
      (await post(core, "platform/status", token, {})).status,
      200,
    );
    // 사람 token의 list에는 원문·hash 없는 connection이 보인다.
    const listed = await post(core, "coding_agent_connections/list", user, {});
    assertEquals(listed.status, 200);
    assertFalse(JSON.stringify(listed.body).includes(token));

    // 앱 하나 범위도 같은 입구다. 잘못된 범위·공백 이름은 만들지 않는다.
    const bad = await post(core, "coding_agent_connections/connect", user, {
      label: "  ",
      scope: { kind: "all", app: null },
    });
    assert(bad.status >= 400 && bad.status < 500, String(bad.status));
    const extra = await post(core, "coding_agent_connections/connect", user, {
      label: "x",
      scope: { kind: "all", app: null },
      token: "pasted-token-value",
    });
    assert(extra.status >= 400 && extra.status < 500, String(extra.status));
    assertEquals(keychain.stored.size, 1);

    // coding agent 자신의 credential은 입구를 쓰지 못한다(발급·확대 거절).
    const denied = await post(
      core,
      "coding_agent_connections/connect",
      token,
      { label: "self", scope: { kind: "all", app: null } },
    );
    assert(
      denied.status === 401 || denied.status === 403,
      String(denied.status),
    );
    assertEquals(keychain.stored.size, 1);
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("coding-agent/connection#R2: 보관 준비가 실패하면 connection을 만들지 않고 성공 표시도 없다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-connect-entry-" });
  const keychain = createFakeKeychain();
  const core = await start(home, keychain);
  try {
    const user = await login(core, "V".repeat(43), [
      "ConnectCodingAgent",
      "ListCodingAgentConnections",
    ]);
    keychain.setStatus("unavailable");
    const failed = await post(core, "coding_agent_connections/connect", user, {
      label: "claude",
      scope: { kind: "all", app: null },
    });
    assertEquals(
      (failed.body["error"] as { code: string }).code,
      "unavailable",
      JSON.stringify(failed.body),
    );
    keychain.setStatus("available");
    const listed = await post(core, "coding_agent_connections/list", user, {});
    assertEquals(listed.status, 200);
    assertEquals(
      (listed.body["connections"] as unknown[]).length,
      0,
      JSON.stringify(listed.body),
    );
    assertEquals(keychain.stored.size, 0);
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

function row(db: DatabaseSync, id: string, state: string): void {
  db.prepare(
    `insert into coding_agent_connections
     (id, label, scope_kind, scope_app, principal, token_hash, state, revision)
     values (?, 'label', 'all', null, ?, ?, ?, '1')`,
  ).run(id, `coding_agent:${id}`, `hash-${id}`, state);
}

Deno.test("coding-agent/connection#R17 platform/redaction#R1: connection token은 알려진 값으로 등록되고 회수된 연결의 token도 참조가 남는 동안 알려진 값이다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-connect-known-" });
  const path = `${home}/lophn.db`;
  const db = new DatabaseSync(path);
  for (const step of SECRET_SCHEMA_STEPS) db.exec(step.sql);
  for (const step of connectionSchemaSteps) db.exec(step.sql);
  row(db, CAC, "active");
  row(db, REVOKED, "revoked");
  const keychain = createFakeKeychain();
  const vault = createCodingCredentialKeychain({ keychain });
  assert((await vault.prepare(CAC, "active-connection-token-7f3a")).ok);
  assert((await vault.prepare(REVOKED, "revoked-connection-token-9b1c")).ok);
  const registered: string[] = [];
  const revoked: string[] = [];
  const channel: KnownSecretChannel = {
    register: (values) => {
      registered.push(...values);
      return Promise.resolve(ok(undefined));
    },
    revoke: (values) => {
      revoked.push(...values);
      return Promise.resolve(ok(undefined));
    },
    setReady: () => Promise.resolve(ok(undefined)),
  };
  const store = openSecretStore({
    ledgerPath: path,
    channel,
    keychain: () => keychain,
    sources: [createConnectionSecretRefSource()],
  });
  try {
    assert((await store.sync()).ok);
    assert(store.known.ready);
    assert(
      store.known.match("앞 active-connection-token-7f3a 뒤") !== undefined,
    );
    // 회수된 연결의 token도 참조가 남아 있으니 알려진 값이다.
    assert(
      store.known.match("revoked-connection-token-9b1c") !== undefined,
    );
    assertEquals(registered.length, 2);
    // keychain 항목이 없는 connection은 읽을 값이 없을 뿐 준비 상태를 막지 않는다.
    assert((await vault.discard(REVOKED)).ok);
    db.exec(
      `insert into coding_agent_connections
       (id, label, scope_kind, scope_app, principal, token_hash, state, revision)
       values ('cac_01arz3ndektsv4rrffq69g5faz', 'x', 'all', null,
         'coding_agent:cac_01arz3ndektsv4rrffq69g5faz', 'hash-z', 'active', '1')`,
    );
    assert((await store.sync()).ok);
    assert(store.known.ready);
  } finally {
    store.stop();
    db.close();
    await Deno.remove(home, { recursive: true });
  }
});
