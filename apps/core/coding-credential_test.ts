// flow connect-coding-agent의 credential 단계: 인증 경계가 token을 발급해 keychain에 준비하고
// 실제 connection command(임시 SQLite·writer Worker)에는 digest만 제출한다. 회수·재시작·보호 전달은
// 같은 ledger 기록으로 확인한다. OS keychain은 fake adapter다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  createIdSource,
  err,
  manualClock,
  ok,
  type Result,
  seededRandom,
  sha256Hex,
} from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/protocol/server/mod.ts";
import {
  type CodingAgentConnectionAuthPort,
  type CodingAgentConnectionAuthResult,
} from "../../packages/protocol/coding-agent/mod.ts";
import {
  createCodingCredentialAuthority,
  CredentialRegistry,
  serveCredentialDelivery,
} from "../../packages/core/server/identity/mod.ts";
import {
  codingCredentialRef,
  createCodingCredentialKeychain,
  createFakeKeychain,
} from "../../packages/core/secrets/mod.ts";
import {
  type CommandEnvelope,
  createLedgerHarness,
  type LedgerHarness,
} from "./testing/ledger.ts";

const registration = new URL(
  "../../packages/coding-agent/connection/harness-registration_test.ts",
  import.meta.url,
);
const CONFIRMATION = "A".repeat(43);
const LOADER = "lophn-mcp-loader";

function user(operations: string[], ref: string): AuthenticatedContext {
  return {
    principal: "user-1",
    actor: "user",
    scope: { operations, targets: {} },
    conditions: {},
    credential_ref: ref,
  };
}

const creator = user(["CreateCodingAgentConnection"], "cred-create");
const operator = user([
  "RevokeCodingAgentConnection",
  "coding_agent_connections.revoke_with_evidence",
  "coding_agent_connections.read_auth",
  "ListCodingAgentConnections",
  "ShowCodingAgentConnection",
], "cred-operator");
const agent: AuthenticatedContext = {
  principal: "coding_agent:cac_01arz3ndektsv4rrffq69g5fav",
  actor: "coding_agent:cac_01arz3ndektsv4rrffq69g5fav",
  scope: { operations: ["CreateCodingAgentConnection"], targets: {} },
  conditions: {},
  credential_ref: "cred-agent",
};

function envelope(
  command: string,
  key: string,
  input: unknown,
  compare: unknown = {},
): CommandEnvelope {
  return { command, input, compare, idempotency_key: key, prepared: [] };
}

function value<T>(result: Result<T, unknown>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

// platform 인증이 매 요청 부르는 port다. 실제 ledger의 read 연결로 principal의 현재 상태를 읽는다.
function authPort(harness: LedgerHarness): CodingAgentConnectionAuthPort {
  return async (principal) => {
    const read = await harness.command(
      operator,
      envelope(
        "coding_agent_connections.read_auth",
        `auth-${crypto.randomUUID()}`,
        { principal },
      ),
    );
    if (!read.ok) throw new Error("ledger unreadable");
    const auth = read.value.result as {
      found: boolean;
      state: "active" | "revoked";
      token_digest: string;
    };
    if (!auth.found) return undefined;
    const shown = await harness.read(
      { resource: "coding_agent_connections", method: "show" },
      operator,
      { connection: principal.slice("coding_agent:".length) },
    );
    const connection = value(shown) as {
      connection: { id: string; scope: unknown; revision: string };
    };
    return {
      connection: connection.connection.id,
      state: auth.state,
      scope: connection.connection.scope,
      token_digest: auth.token_digest,
      revision: connection.connection.revision,
    } as CodingAgentConnectionAuthResult;
  };
}

async function open() {
  const harness = value(
    await createLedgerHarness({
      registrationModules: [registration],
      credentials: [creator, operator, agent],
    }),
  );
  const clock = manualClock(Date.UTC(2024, 0, 1));
  const random = seededRandom(21);
  const keychain = createFakeKeychain();
  function authority(seed = 21) {
    const next = seededRandom(seed);
    return createCodingCredentialAuthority({
      random: next,
      ids: createIdSource({ clock, random: next }),
      vault: createCodingCredentialKeychain({ keychain }),
      auth: authPort(harness),
      loaders: [LOADER],
    });
  }
  function registryFor(external: ReturnType<typeof authority>) {
    return new CredentialRegistry({
      epoch: "core-one",
      clock,
      random,
      operations: [{
        name: "ListCodingAgentConnections",
        actors: ["user", "coding_agent"],
        kind: "read",
      }],
      external,
    });
  }
  return { harness, keychain, authority, registryFor };
}

// 사람의 연결 결정 뒤 user credential로 connection command를 부른다.
function submitAs(harness: LedgerHarness, actor: AuthenticatedContext) {
  return async (
    input: {
      id: string;
      label: string;
      scope: unknown;
      token_digest: string;
    },
  ): Promise<Result<unknown>> => {
    const sent = await harness.command(
      actor,
      envelope("CreateCodingAgentConnection", `create-${input.id}`, input),
    );
    return sent.ok ? ok(sent.value.result) : err(sent.error);
  };
}

Deno.test("platform/identity#R5 platform/secrets#R12: 연결 결정 뒤 발급·준비·digest 제출·commit 확인이 이어지고 원문은 ledger와 읽기에 없다", async () => {
  const { harness, keychain, authority, registryFor } = await open();
  try {
    const issuer = authority();
    const registry = registryFor(issuer);
    const { connection } = value(
      await issuer.connect(
        { label: "claude", scope: { kind: "all", app: null } },
        submitAs(harness, creator),
      ),
    );
    const token = new TextDecoder().decode(
      keychain.stored.get(codingCredentialRef(connection)!)!,
    );
    // ledger에는 검증 digest만 있고 list·show 읽기와 command 결과에는 어느 값도 없다.
    const stored = value(
      await harness.command(
        operator,
        envelope("coding_agent_connections.read_auth", "digest-check", {
          principal: `coding_agent:${connection}`,
        }),
      ),
    ).result as { state: string; token_digest: string };
    assertEquals(stored.state, "active");
    assertEquals(stored.token_digest, await sha256Hex(token));
    const listed = JSON.stringify(
      value(
        await harness.read(
          { resource: "coding_agent_connections", method: "list" },
          operator,
          {},
        ),
      ),
    );
    assertFalse(listed.includes(token));
    assertFalse(listed.includes(stored.token_digest));
    // commit 뒤 같은 token이 coding_agent로 인증된다.
    const context = value(await registry.authenticate(token));
    assertEquals(context.actor, `coding_agent:${connection}`);
    assertEquals(context.scope.targets, {});
  } finally {
    await harness.close();
  }
});

Deno.test("platform/identity#R5 platform/secrets#R12: command 거절로 commit되지 않으면 준비 token을 정리하고 연결은 없다", async () => {
  const { harness, keychain, authority, registryFor } = await open();
  try {
    const issuer = authority();
    // coding_agent actor는 연결을 만들 수 없다. 거절된 준비는 쓸 수 없고 정리된다.
    const refused = await issuer.connect(
      { label: "claude", scope: { kind: "all", app: null } },
      submitAs(harness, agent),
    );
    assertFalse(refused.ok);
    assertEquals(keychain.stored.size, 0);
    const listed = value(
      await harness.read(
        { resource: "coding_agent_connections", method: "list" },
        operator,
        {},
      ),
    ) as { connections: unknown[] };
    assertEquals(listed.connections, []);
    // 같은 ledger에 앱 하나 scope의 없는 앱 연결도 commit되지 않아 token이 남지 않는다.
    const missingApp = await issuer.connect(
      {
        label: "claude",
        scope: { kind: "app", app: "app_01arz3ndektsv4rrffq69g5fav" },
      },
      submitAs(harness, creator),
    );
    assertFalse(missingApp.ok);
    assertEquals(keychain.stored.size, 0);
    assertEquals(registryFor(issuer) instanceof CredentialRegistry, true);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/identity#R5 platform/identity#R15: 회수는 keychain 정리와 무관하게 즉시 적용되고 재시작 뒤 같은 active connection을 쓴다", async () => {
  const { harness, keychain, authority, registryFor } = await open();
  try {
    const issuer = authority();
    const registry = registryFor(issuer);
    const first = value(
      await issuer.connect(
        { label: "one", scope: { kind: "all", app: null } },
        submitAs(harness, creator),
      ),
    );
    const second = value(
      await issuer.connect(
        { label: "two", scope: { kind: "all", app: null } },
        submitAs(harness, creator),
      ),
    );
    const tokenOf = (connection: string) =>
      new TextDecoder().decode(
        keychain.stored.get(codingCredentialRef(connection)!)!,
      );
    const [one, two] = [tokenOf(first.connection), tokenOf(second.connection)];
    value(await registry.authenticate(one));
    // 재시작: 새 core epoch의 인증은 ledger의 active connection으로 색인을 다시 채운다.
    const restarted = authority(77);
    const afterRestart = registryFor(restarted);
    assertFalse((await afterRestart.authenticate(one)).ok);
    assertEquals(
      await restarted.restore([first.connection, second.connection]),
      2,
    );
    value(await afterRestart.authenticate(one));
    value(await afterRestart.authenticate(two));
    // 보호 전달은 등록된 child에만, 현재 connection이 active일 때만 token을 stdout에 준다.
    value(restarted.registerChild({
      process_generation: "gen-1",
      loader_identity: LOADER,
      connection: first.connection,
      scope: { kind: "all", app: null },
    }));
    const delivery = new TextEncoder().encode(JSON.stringify({
      connection: first.connection,
      process_generation: "gen-1",
      loader_identity: LOADER,
      purpose: "mcp_cli_loader",
    }));
    const served = await serveCredentialDelivery(restarted, delivery);
    assert(served.ok);
    assertEquals(JSON.parse(new TextDecoder().decode(served.stdout)), {
      token: one,
    });
    // 첫 연결만 회수한다. keychain 항목은 그대로지만 다음 요청과 전달부터 거절된다.
    const shown = value(
      await harness.read(
        { resource: "coding_agent_connections", method: "show" },
        operator,
        { connection: first.connection },
      ),
    ) as { connection: { revision: string } };
    const revision = shown.connection.revision;
    value(
      await harness.command(
        operator,
        envelope(
          "coding_agent_connections.revoke_with_evidence",
          "revoke-first",
          {
            connection: first.connection,
            base_revision: revision,
            confirmation: CONFIRMATION,
          },
          { base_revision: revision },
        ),
      ),
    );
    assertEquals(
      keychain.stored.has(codingCredentialRef(first.connection)!),
      true,
    );
    assertFalse((await afterRestart.authenticate(one)).ok);
    assertFalse((await registry.authenticate(one)).ok);
    const denied = await serveCredentialDelivery(restarted, delivery);
    assertFalse(denied.ok);
    assertEquals(denied.body, { reason: "not_found" });
    // 다른 연결은 영향이 없다.
    value(await afterRestart.authenticate(two));
  } finally {
    await harness.close();
  }
});
