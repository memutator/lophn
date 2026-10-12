// coding agent connection credential의 core 조립(platform#T34): 임시 LOPHN_HOME과 fake keychain으로
// core를 띄워 commit 뒤 인증, 회수 뒤 거절, 재시작 뒤 복원과 고아 정리를 실제 HTTP route로 본다.
// 사람의 실제 keychain·데이터 root는 열지 않는다(keychain adapter는 호출자가 준다).
import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals, assertFalse } from "@std/assert";
import { err, manualClock, ok, seededRandom } from "../../packages/base/mod.ts";
import type { Result } from "../../packages/base/mod.ts";
import { connectionRevoke } from "../../packages/protocol/coding-agent/mod.ts";
import type { AuthenticatedContext } from "../../packages/protocol/server/mod.ts";
import { confirmationBinding } from "../../packages/core/server/identity/mod.ts";
import {
  codingCredentialRef,
  createCodingCredentialKeychain,
  createFakeKeychain,
  type FakeKeychain,
} from "../../packages/core/secrets/mod.ts";
import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import { type Core, startCore } from "./core.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";

const LOADER = "lophn-mcp-loader";
const ORPHAN = "cac_01arz3ndektsv4rrffq69g5fax";
const decoder = new TextDecoder();

type Reply = { status: number; body: Record<string, unknown> };

function post(
  core: Core,
  path: string,
  token: string,
  body: unknown,
): Promise<Reply> {
  return (async () => {
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
  })();
}

async function start(
  home: string,
  keychain: FakeKeychain,
  seed: number,
): Promise<Core> {
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ codingAgentConnectionDefinitions }],
    teamModules: [new URL("./coding-agent.ts", import.meta.url).href],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(seed),
    testCredentials: true,
    superviseIo: false,
    codingKeychain: keychain,
    codingLoaders: [LOADER],
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
  });
  const core = started.value;
  assert(core.codingCredentials !== undefined);
  await core.codingCredentialsReady;
  guard.keep();
  return core;
}

async function loginUser(core: Core): Promise<string> {
  const token = "U".repeat(43);
  const context: AuthenticatedContext = {
    principal: "user",
    actor: "user",
    scope: {
      operations: [
        "CreateCodingAgentConnection",
        "RevokeCodingAgentConnection",
      ],
      targets: {},
    },
    conditions: {},
    credential_ref: `cred-user-${core.epoch}`,
  };
  assert(core.acceptTestCredential);
  const accepted = await core.acceptTestCredential(context, token);
  assert(accepted.ok);
  const recorded = await core.record(context);
  assert(recorded.ok);
  return token;
}

// 사람의 연결 결정 입구가 하는 일: 사람 credential로 create command를 보낸다.
function submitter(
  core: Core,
  user: string,
  seen: { revision?: string } = {},
) {
  return async (input: {
    id: string;
    label: string;
    scope: unknown;
    token_digest: string;
  }): Promise<Result<unknown>> => {
    const sent = await post(core, "coding_agent_connections/create", user, {
      input,
      idempotency_key: `create-${input.id}`,
      compare: {},
      prepared: [],
    });
    if (sent.status === 200) {
      seen.revision = (sent.body["connection"] as { revision: string })
        .revision;
    }
    return sent.status === 200
      ? ok(sent.body)
      : err({ code: "conflict", message: `create ${sent.status}` });
  };
}

async function connect(core: Core, user: string, keychain: FakeKeychain) {
  const seen: { revision?: string } = {};
  const result = await core.codingCredentials!.connect(
    { label: "claude", scope: { kind: "all", app: null } },
    submitter(core, user, seen),
  );
  assert(result.ok, result.ok ? "" : result.error.message);
  const { connection } = result.value;
  const token = decoder.decode(
    keychain.stored.get(codingCredentialRef(connection)!)!,
  );
  return { connection, token, revision: seen.revision! };
}

function status(core: Core, token: string): Promise<Reply> {
  return post(core, "platform/status", token, {});
}

function recorded(home: string, ref: string): string | undefined {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    return db.prepare("select state from credentials where credential_ref = ?")
      .get(ref)?.state as string | undefined;
  } finally {
    db.close();
  }
}

Deno.test("platform/identity#R5 platform/identity#R15 platform/secrets#R12: core 조립은 commit 뒤 인증하고 회수를 즉시 막고 재시작 뒤 복원하며 고아를 정리한다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-coding-credential-" });
  const keychain = createFakeKeychain();
  let core = await start(home, keychain, 41);
  try {
    const user = await loginUser(core);
    const first = await connect(core, user, keychain);
    const second = await connect(core, user, keychain);
    // commit 뒤 coding token은 인증되고 원장 credential 기록이 남는다. 모르는 token은 거절된다.
    assertEquals((await status(core, first.token)).status, 200);
    assertEquals((await status(core, second.token)).status, 200);
    assertEquals((await status(core, "x".repeat(43))).status, 401);
    assertEquals(recorded(home, `coding:${first.connection}`), "active");

    // 회수는 keychain 항목이 남아 있어도 다음 요청부터 거절된다. 다른 connection은 그대로다.
    const revision = first.revision;
    const input = { connection: first.connection, base_revision: revision };
    const binding = await confirmationBinding(connectionRevoke, input);
    assert(binding && core.confirmation);
    const issued = await core.confirmation({
      action: "issue",
      request: {
        type: "confirmation_handle_register",
        window_id: "win-revoke",
        target_ref: binding.target,
        content_hash: binding.content,
        allowed_decisions: [connectionRevoke.name],
        expires_at: new Date(Date.UTC(2024, 0, 1) + 600_000).toISOString(),
      },
    });
    assert(issued.ok, issued.ok ? "" : issued.error.message);
    const revoked = await post(core, "coding_agent_connections/revoke", user, {
      input,
      idempotency_key: "revoke-first",
      compare: { base_revision: revision },
      prepared: [],
      confirmation: (issued.value as { confirmation: string }).confirmation,
    });
    assertEquals(revoked.status, 200, JSON.stringify(revoked.body));
    assertEquals(
      keychain.stored.has(codingCredentialRef(first.connection)!),
      true,
    );
    assertEquals((await status(core, first.token)).status, 401);
    assertEquals((await status(core, second.token)).status, 200);

    // 중단 고아: commit되지 않은 준비가 keychain에만 남은 채 core가 멈춘다.
    const vault = createCodingCredentialKeychain({ keychain });
    const prepared = await vault.prepare(ORPHAN, "orphan-token-value");
    assert(prepared.ok);
    await core.shutdown();

    // 재시작: 새 epoch. active connection은 keychain token 그대로 복원되고 회수된 것은 되살아나지
    // 않으며 고아는 정리된다. 시작 단계 실패 log는 없다.
    core = await start(home, keychain, 42);
    assertEquals((await status(core, second.token)).status, 200);
    assertEquals((await status(core, first.token)).status, 401);
    assertEquals(keychain.stored.has(codingCredentialRef(ORPHAN)!), false);
    assertEquals(
      keychain.stored.has(codingCredentialRef(second.connection)!),
      true,
    );
    assertEquals(recorded(home, `coding:${second.connection}`), "active");
    assertFalse(await exists(`${home}/logs/coding-credential.jsonl`));
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("platform/identity#R5: keychain을 쓸 수 없어도 core는 서고 ledger의 active connection 인증은 복원된다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-coding-credential-" });
  const keychain = createFakeKeychain();
  let core = await start(home, keychain, 51);
  try {
    const user = await loginUser(core);
    const one = await connect(core, user, keychain);
    await core.shutdown();
    // 재시작 때 keychain이 잠겨 있다. 고아 정리는 건너뛰고 기동은 실패하지 않는다.
    keychain.setStatus("unavailable");
    core = await start(home, keychain, 52);
    assertEquals((await status(core, one.token)).status, 200);
    keychain.setStatus("available");
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("platform/identity#R15: codingKeychain이 없는 core는 coding credential 인증과 입구가 없다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-coding-credential-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ codingAgentConnectionDefinitions }],
    teamModules: [new URL("./coding-agent.ts", import.meta.url).href],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(61),
    testCredentials: true,
    superviseIo: false,
  });
  assert(started.ok);
  try {
    assertEquals(started.value.codingCredentials, undefined);
  } finally {
    await started.value.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
