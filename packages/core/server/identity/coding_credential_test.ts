import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  createIdSource,
  err,
  type LogRecord,
  manualClock,
  ok,
  type Result,
  seededRandom,
  sha256Hex,
} from "../../../base/mod.ts";
import {
  type CodingAgentConnectionAuthResult,
  type ConnectionId,
  type ConnectionScope,
  LOPHN_CONNECTION,
} from "../../../protocol/coding-agent/mod.ts";
import {
  codingCredentialRef,
  createCodingCredentialKeychain,
  createFakeKeychain,
  createLinuxSecretServiceAdapter,
  type FakeKeychain,
  type KeychainAdapter,
} from "../../secrets/mod.ts";
import {
  type CodingConnectionSubmission,
  type CodingCredentialVault,
  codingTuiEnvironment,
  createCodingCredentialAuthority,
  CredentialRegistry,
  memoryPendingPreparations,
  type PendingPreparations,
  type ProtectedChannel,
  serveCredentialDelivery,
} from "./mod.ts";
import { POLICIES } from "./fixtures_test.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const LOADER = "lophn-mcp-loader";
const ALL: ConnectionScope = { kind: "all", app: null };
const decoder = new TextDecoder();

// connection 소유 module의 표를 대신하는 메모리 기록이다. 인증 port와 create command의 모양만 같다.
function connections() {
  const rows = new Map<string, CodingAgentConnectionAuthResult>();
  return {
    rows,
    auth: (principal: string) => Promise.resolve(rows.get(principal)),
    commit(input: CodingConnectionSubmission): Result<unknown> {
      rows.set(`coding_agent:${input.id}`, {
        connection: input.id,
        state: "active",
        scope: input.scope,
        token_digest: input.token_digest,
        revision: "1",
      });
      return ok({ connection: input.id });
    },
    revoke(connection: string) {
      const row = rows.get(`coding_agent:${connection}`)!;
      rows.set(`coding_agent:${connection}`, { ...row, state: "revoked" });
    },
  };
}

function fixture(
  options: {
    keychain?: KeychainAdapter;
    vault?: CodingCredentialVault;
    pending?: PendingPreparations;
    rows?: ReturnType<typeof connections>;
    seed?: number;
  } = {},
) {
  const clock = manualClock(Date.UTC(2024, 0, 1));
  const random = seededRandom(options.seed ?? 11);
  const keychain = options.keychain ?? createFakeKeychain();
  const rows = options.rows ?? connections();
  const pending = options.pending ?? memoryPendingPreparations();
  const logs: LogRecord[] = [];
  const logger = {
    log: () => {},
    debug: () => {},
    info: () => {},
    warn(event: { component: string; event: string }) {
      logs.push(event as LogRecord);
    },
    error: () => {},
    flush: () => Promise.resolve(),
  };
  const authority = createCodingCredentialAuthority({
    random,
    ids: createIdSource({ clock, random }),
    vault: options.vault ?? createCodingCredentialKeychain({ keychain }),
    auth: rows.auth,
    loaders: [LOADER],
    pending,
    logger,
  });
  const registry = new CredentialRegistry({
    epoch: "core-one",
    clock,
    random,
    operations: POLICIES,
    external: authority,
  });
  return { authority, registry, keychain, rows, pending, logs, random };
}

function value<T>(result: Result<T, unknown>): T {
  assert(result.ok, "expected ok");
  return result.value;
}

function code(result: Result<unknown>): string {
  assertFalse(result.ok);
  return result.error.code;
}

// fake keychain에 준비된 token 하나를 읽는다. 시험만 원문을 본다.
function storedToken(keychain: FakeKeychain, connection: string): string {
  const ref = codingCredentialRef(connection)!;
  return decoder.decode(keychain.stored.get(ref)!);
}

type Fixture = ReturnType<typeof fixture>;

async function connect(
  f: Fixture,
  scope: ConnectionScope = ALL,
): Promise<{ connection: ConnectionId; token: string }> {
  const submitted: CodingConnectionSubmission[] = [];
  const result = await f.authority.connect(
    { label: "claude", scope },
    (input) => {
      submitted.push(input);
      return Promise.resolve(f.rows.commit(input));
    },
  );
  const { connection } = value(result);
  return {
    connection,
    token: storedToken(f.keychain as FakeKeychain, connection),
  };
}

function child(
  connection: ConnectionId,
  generation = "gen-1",
  scope: ConnectionScope = ALL,
) {
  return {
    process_generation: generation,
    loader_identity: LOADER,
    connection,
    scope,
  };
}

function request(
  connection: string,
  generation = "gen-1",
  loader = LOADER,
  extra: Record<string, unknown> = {},
) {
  return {
    connection,
    process_generation: generation,
    loader_identity: loader,
    purpose: "mcp_cli_loader",
    ...extra,
  };
}

function recordingChannel() {
  const sent: { child: unknown; token: string }[] = [];
  const channel: ProtectedChannel = {
    send(target, token) {
      sent.push({ child: target, token: decoder.decode(token) });
      return Promise.resolve(ok(undefined));
    },
  };
  return { channel, sent };
}

Deno.test("platform/identity#R5: 연결 결정 뒤 token을 keychain에 준비하고 digest만 제출하며 commit 뒤에 인증된다", async () => {
  const f = fixture();
  const submissions: CodingConnectionSubmission[] = [];
  const result = await f.authority.connect(
    { label: "claude", scope: { kind: "app", app: APP } },
    (input) => {
      submissions.push(input);
      return Promise.resolve(f.rows.commit(input));
    },
  );
  const { connection } = value(result);
  const token = storedToken(f.keychain as FakeKeychain, connection);
  assertEquals(token.length, 43);
  // 제출 값은 sha256 digest뿐이고 원문 token field가 없다.
  assertEquals(submissions.length, 1);
  assertEquals(submissions[0].token_digest, await sha256Hex(token));
  assertEquals(Object.keys(submissions[0]).sort(), [
    "id",
    "label",
    "scope",
    "token_digest",
  ]);
  assertFalse(JSON.stringify(submissions).includes(token));
  // 결과·log에도 원문이 없다.
  assertEquals(Object.keys(value(result)), ["connection"]);
  assertFalse(JSON.stringify(result).includes(token));
  assertFalse(JSON.stringify(f.logs).includes(token));
  // commit 뒤 같은 token이 coding_agent actor로 인증되고 앱 범위가 고정된다.
  const context = value(await f.registry.authenticate(token));
  assertEquals(context.actor, `coding_agent:${connection}`);
  assertEquals(context.principal, `coding_agent:${connection}`);
  assertEquals(context.scope.operations, ["identity/current"]);
  assertEquals(context.scope.targets, { app: APP });
  assertEquals(context.conditions, { app: APP });
  assertFalse(JSON.stringify(context).includes(token));
});

Deno.test("platform/identity#R5: digest 자체나 모양이 틀린 값은 Bearer로 받지 않는다", async () => {
  const f = fixture();
  const { token } = await connect(f);
  assertEquals(
    code(await f.registry.authenticate(await sha256Hex(token))),
    "unauthorized",
  );
  assertEquals(
    code(await f.registry.authenticate(token.slice(1) + "A")),
    "unauthorized",
  );
});

Deno.test("platform/identity#R5: keychain 잠김·보관 실패는 연결을 만들지 않고 command도 부르지 않는다", async () => {
  const keychain = createFakeKeychain({ status: "unavailable" });
  const f = fixture({ keychain });
  let submitted = 0;
  const result = await f.authority.connect(
    { label: "claude", scope: ALL },
    (input) => {
      submitted++;
      return Promise.resolve(f.rows.commit(input));
    },
  );
  assertEquals(code(result), "unavailable");
  assertEquals(submitted, 0);
  assertEquals(f.rows.rows.size, 0);
  assertEquals(keychain.stored.size, 0);
  // 보관했는지 확인하지 못한 준비는 기록에 남고, keychain이 돌아온 뒤 recover가 정리한다.
  assertEquals((await f.pending.list()).length, 1);
  keychain.setStatus("available");
  assertEquals(await f.authority.recover(), {
    kept: 0,
    discarded: 1,
    retry: 0,
  });
  assertEquals(keychain.stored.size, 0);
  assertEquals(await f.pending.list(), []);
});

Deno.test("platform/identity#R5 platform/secrets#R12: commit 실패의 준비 token은 정리되고 인증에 쓰이지 않는다", async () => {
  const keychain = createFakeKeychain();
  const f = fixture({ keychain });
  let prepared = "";
  const result = await f.authority.connect(
    { label: "claude", scope: ALL },
    (input) => {
      prepared = storedToken(keychain, input.id);
      return Promise.resolve(
        err({ code: "conflict", message: "token digest already exists" }),
      );
    },
  );
  assertEquals(code(result), "conflict");
  assertEquals(keychain.stored.size, 0);
  assertEquals(await f.pending.list(), []);
  assertEquals(code(await f.registry.authenticate(prepared)), "unauthorized");
});

Deno.test("platform/secrets#R12: command가 던져도 중단되어도 준비 token을 정리한다", async () => {
  const keychain = createFakeKeychain();
  const f = fixture({ keychain });
  const thrown = await f.authority.connect(
    { label: "claude", scope: ALL },
    () => Promise.reject(new Error("worker lost")),
  );
  assertFalse(thrown.ok);
  assertEquals(keychain.stored.size, 0);
  const controller = new AbortController();
  controller.abort();
  let called = 0;
  const aborted = await f.authority.connect(
    { label: "claude", scope: ALL },
    (input) => {
      called++;
      return Promise.resolve(f.rows.commit(input));
    },
    controller.signal,
  );
  assertEquals(code(aborted), "unavailable");
  assertEquals(called, 0);
  assertEquals(keychain.stored.size, 0);
  assertEquals(await f.pending.list(), []);
});

Deno.test("platform/secrets#R12: 응답을 잃은 실패는 commit 여부를 소유 기록으로 확인해 정리하거나 남긴다", async () => {
  // commit은 됐지만 응답이 유실됐다. token을 지우면 안 된다.
  const committed = fixture();
  const kept = await committed.authority.connect(
    { label: "claude", scope: ALL },
    (input) => {
      committed.rows.commit(input);
      return Promise.resolve(err({ code: "unavailable", message: "lost" }));
    },
  );
  const { connection } = value(kept);
  assertEquals(
    value(
      await committed.registry.authenticate(
        storedToken(committed.keychain as FakeKeychain, connection),
      ),
    ).actor,
    `coding_agent:${connection}`,
  );
  assertEquals(await committed.pending.list(), []);

  // 확인도 못 한 경우는 지우지 않고 기록에 남긴다. 알 수 없는 것을 지우거나 성공으로 두지 않는다.
  const rows = connections();
  let broken = true;
  const flaky = {
    ...rows,
    auth: (principal: string) =>
      broken
        ? Promise.reject(new Error("ledger unreadable"))
        : rows.auth(principal),
  };
  const unknown = fixture({ rows: flaky as ReturnType<typeof connections> });
  const result = await unknown.authority.connect(
    { label: "claude", scope: ALL },
    () => Promise.resolve(err({ code: "unavailable", message: "lost" })),
  );
  assertFalse(result.ok);
  assertEquals((await unknown.pending.list()).length, 1);
  assertEquals((unknown.keychain as FakeKeychain).stored.size, 1);
  // 읽을 수 있게 된 뒤 recover가 commit되지 않은 준비를 정리한다.
  broken = false;
  assertEquals(await unknown.authority.recover(), {
    kept: 0,
    discarded: 1,
    retry: 0,
  });
  assertEquals((unknown.keychain as FakeKeychain).stored.size, 0);
  assertEquals(await unknown.pending.list(), []);
});

Deno.test("platform/secrets#R12: 중단된 고아는 recover가 정리하고 commit된 credential은 살린다", async () => {
  const pending = memoryPendingPreparations();
  const f = fixture({ pending });
  // 하나는 commit된 연결, 하나는 commit 전에 core가 멈춘 준비다.
  const live = await connect(f);
  await pending.add(live.connection);
  const orphan = "cac_01arz3ndektsv4rrffq69g5fax";
  const vault = createCodingCredentialKeychain({ keychain: f.keychain });
  value(await vault.prepare(orphan, "orphan-token-value"));
  await pending.add(orphan);
  // commit 전의 준비는 인증에 쓰이지 않는다.
  assertEquals(
    code(await f.registry.authenticate("orphan-token-value")),
    "unauthorized",
  );
  assertEquals(await f.authority.recover(), {
    kept: 1,
    discarded: 1,
    retry: 0,
  });
  assertEquals(
    (f.keychain as FakeKeychain).stored.has(codingCredentialRef(orphan)!),
    false,
  );
  assertEquals(
    (f.keychain as FakeKeychain).stored.has(
      codingCredentialRef(live.connection)!,
    ),
    true,
  );
  assertEquals(await pending.list(), []);
});

Deno.test("platform/secrets#R12: keychain 정리가 늦어도 회수는 모든 새 요청에서 즉시 적용된다", async () => {
  const keychain = createFakeKeychain();
  keychain.holdRemovals(true);
  const f = fixture({ keychain });
  const { connection, token } = await connect(f);
  value(await f.registry.authenticate(token));
  f.rows.revoke(connection);
  // keychain 삭제를 아직 확인하지 못해도(보류) 다음 요청부터 거절된다.
  assertEquals(
    code(
      await createCodingCredentialKeychain({ keychain }).discard(connection),
    ),
    "unavailable",
  );
  assertEquals(keychain.stored.size, 1);
  assertEquals(code(await f.registry.authenticate(token)), "unauthorized");
  // 거절은 없는 자격과 같다.
  assertEquals(
    code(await f.registry.authenticate("x".repeat(43))),
    "unauthorized",
  );
});

Deno.test("platform/identity#R5: 재시작 뒤 같은 active connection의 keychain token을 그대로 쓰고 회수된 것은 되살리지 않는다", async () => {
  const first = fixture();
  const active = await connect(first);
  const revoked = await connect(first);
  first.rows.revoke(revoked.connection);
  // 새 core epoch: 색인은 비어 있고 keychain·소유 기록만 남아 있다.
  const second = fixture({
    keychain: first.keychain,
    rows: first.rows,
    seed: 99,
  });
  assertEquals(
    code(await second.registry.authenticate(active.token)),
    "unauthorized",
  );
  assertEquals(
    await second.authority.restore([active.connection, revoked.connection]),
    1,
  );
  assertEquals(
    value(await second.registry.authenticate(active.token)).principal,
    `coding_agent:${active.connection}`,
  );
  assertEquals(
    code(await second.registry.authenticate(revoked.token)),
    "unauthorized",
  );
});

Deno.test("platform/secrets#R12: coding credential은 자기 용도·위치에서만 준비하고 읽는다", async () => {
  const keychain = createFakeKeychain();
  const vault = createCodingCredentialKeychain({ keychain });
  // 다른 용도의 참조 모양은 이 이름 공간에 없다.
  assertEquals(codingCredentialRef("app_secret"), undefined);
  assertEquals(codingCredentialRef(APP), undefined);
  assertEquals(code(await vault.prepare("API_KEY", "value")), "invalid_input");
  // 앱 secret으로 준비한 값은 connection 위치로 읽히지 않는다.
  value(
    await keychain.store({
      name: "API_KEY",
      purpose: "app_secret",
      owner: "API_KEY",
      value: new TextEncoder().encode("app-secret-value"),
    }),
  );
  const connection = "cac_01arz3ndektsv4rrffq69g5fav";
  const read = await vault.read(connection);
  assertFalse(read.ok);
  assertEquals(read.error, "not_found");
  // 이미 준비된 위치는 덮지 않는다.
  value(await vault.prepare(connection, "first"));
  assertEquals(code(await vault.prepare(connection, "second")), "conflict");
  assertEquals(value(await vault.read(connection)), "first");
});

Deno.test("platform/identity#R15: 등록된 지정 child에만 현재 connection token을 보호 통로로 전달한다", async () => {
  const f = fixture();
  const { connection, token } = await connect(f);
  value(f.authority.registerChild(child(connection)));
  const { channel, sent } = recordingChannel();
  value(await f.authority.deliver(request(connection), channel));
  assertEquals(sent, [{
    child: { process_generation: "gen-1", loader_identity: LOADER },
    token,
  }]);
  // helper의 stdout에만 token이 있고 응답 schema는 token 하나다.
  const served = await serveCredentialDelivery(
    f.authority,
    new TextEncoder().encode(JSON.stringify(request(connection))),
  );
  assert(served.ok);
  assertEquals(JSON.parse(decoder.decode(served.stdout)), { token });
  assertFalse(JSON.stringify(f.logs).includes(token));
});

Deno.test("platform/identity#R15: 임의 connection·미등록 generation·다른 loader·잘못된 모양은 모두 같은 답으로 거절한다", async () => {
  const f = fixture();
  const mine = await connect(f);
  const other = await connect(f);
  value(f.authority.registerChild(child(mine.connection)));
  const { channel, sent } = recordingChannel();
  const attempts = [
    // 다른 connection 참조
    request(other.connection),
    // 등록하지 않은 process generation
    request(mine.connection, "gen-2"),
    // 다른 loader identity
    request(mine.connection, "gen-1", "shell-renderer"),
    // 존재하지 않는 connection
    request("cac_01arz3ndektsv4rrffq69g5fax"),
    // token을 요청에 실으려는 시도와 알 수 없는 purpose
    request(mine.connection, "gen-1", LOADER, { token: mine.token }),
    { ...request(mine.connection), purpose: "tui" },
    "not an object",
    null,
  ];
  for (const attempt of attempts) {
    const denied = await f.authority.deliver(attempt, channel);
    assertFalse(denied.ok);
    assertEquals(denied.error, "not_found");
  }
  assertEquals(sent, []);
  // 목록 밖 loader identity는 child로 등록되지도 않는다.
  assertEquals(
    code(
      f.authority.registerChild({
        ...child(mine.connection, "gen-3"),
        loader_identity: "shell-renderer",
      }),
    ),
    "forbidden",
  );
});

Deno.test("platform/identity#R15: 회수·다른 scope·끝난 process generation에서는 전달하지 않는다", async () => {
  const f = fixture();
  const { connection } = await connect(f);
  const { channel, sent } = recordingChannel();
  // 등록한 scope와 현재 connection scope가 다르면 거절한다.
  value(
    f.authority.registerChild(
      child(connection, "gen-scope", { kind: "app", app: APP }),
    ),
  );
  assertEquals(
    (await f.authority.deliver(request(connection, "gen-scope"), channel)).ok,
    false,
  );
  // 끝난 generation은 되살아나지 않는다.
  value(f.authority.registerChild(child(connection, "gen-end")));
  value(await f.authority.deliver(request(connection, "gen-end"), channel));
  f.authority.endChild("gen-end");
  assertEquals(
    (await f.authority.deliver(request(connection, "gen-end"), channel)).ok,
    false,
  );
  // 회수는 child 등록이 남아 있어도 다음 전달부터 막는다.
  value(f.authority.registerChild(child(connection, "gen-live")));
  value(await f.authority.deliver(request(connection, "gen-live"), channel));
  f.rows.revoke(connection);
  assertEquals(
    (await f.authority.deliver(request(connection, "gen-live"), channel)).ok,
    false,
  );
  assertEquals(sent.length, 2);
});

Deno.test("platform/identity#R15: keychain 잠김·없음·누락·시간 초과는 이유가 다른 unavailable이고 평문 fallback이 없다", async () => {
  const base = fixture();
  const { connection } = await connect(base);
  const reasons: Record<string, string> = {};
  async function reason(keychain: KeychainAdapter, timeoutMs?: number) {
    const f = fixture({
      keychain,
      rows: base.rows,
      vault: createCodingCredentialKeychain({ keychain, timeoutMs }),
    });
    value(f.authority.registerChild(child(connection)));
    const { channel, sent } = recordingChannel();
    const failed = await f.authority.deliver(request(connection), channel);
    assertFalse(failed.ok);
    assertEquals(sent, []);
    return failed.error;
  }
  const fake = base.keychain as FakeKeychain;
  // Secret Service 없음
  reasons.none = await reason(createFakeKeychain({ status: "unavailable" }));
  // 항목 누락
  reasons.missing = await reason(createFakeKeychain());
  // 잠김: adapter가 이유를 알려 주는 경우
  reasons.locked = await reason({
    ...fake,
    load: () =>
      Promise.resolve(
        err({
          code: "unavailable" as const,
          message: "locked",
          details: { reason: "locked" },
        }),
      ),
  });
  // 응답 없음
  reasons.slow = await reason({
    ...fake,
    load: () => new Promise(() => {}),
  }, 20);
  assertEquals(reasons, {
    none: "no_secret_service",
    missing: "not_found",
    locked: "locked",
    slow: "timeout",
  });
  // keychain 값이 commit된 digest와 다르면 쓰지 않는다.
  const tampered = createFakeKeychain();
  const tamperedFixture = fixture({ keychain: tampered });
  const mine = await connect(tamperedFixture);
  tampered.stored.get(codingCredentialRef(mine.connection)!)!.fill(65);
  value(tamperedFixture.authority.registerChild(child(mine.connection)));
  const { channel, sent } = recordingChannel();
  const denied = await tamperedFixture.authority.deliver(
    request(mine.connection),
    channel,
  );
  assertFalse(denied.ok);
  assertEquals(denied.error, "not_found");
  assertEquals(sent, []);
  // helper는 실패를 이유만 담은 body로 낸다.
  const served = await serveCredentialDelivery(
    tamperedFixture.authority,
    new TextEncoder().encode(JSON.stringify(request(mine.connection))),
  );
  assertFalse(served.ok);
  assertEquals(served.body, { reason: "not_found" });
});

Deno.test("platform/identity#R15: lophn이 띄운 coding TUI에는 connection 참조만 가고 token 전달 길은 따로 없다", async () => {
  const f = fixture();
  const { connection, token } = await connect(f);
  const env = value(codingTuiEnvironment(connection));
  assertEquals(env, { [LOPHN_CONNECTION]: connection });
  assertFalse(JSON.stringify(env).includes(token));
  assertEquals(code(codingTuiEnvironment("--connection")), "invalid_input");
  // TUI process generation은 loader child가 아니라서 어떤 모양으로도 token을 받지 못한다.
  const { channel, sent } = recordingChannel();
  for (const purpose of ["mcp_cli_loader", "tui", "coding_tui"]) {
    const denied = await f.authority.deliver(
      { ...request(connection, "tui-generation"), purpose },
      channel,
    );
    assertFalse(denied.ok);
  }
  assertEquals(sent, []);
  // 그 아래 MCP·CLI child는 loader로 받는다.
  value(f.authority.registerChild(child(connection, "mcp-under-tui")));
  value(
    await f.authority.deliver(request(connection, "mcp-under-tui"), channel),
  );
  assertEquals(sent.length, 1);
});

Deno.test("platform/secrets#R12: 기록 없이 남은 고아도 고정 위치 목록으로 찾아 commit된 connection이 없는 것만 지운다", async () => {
  const f = fixture();
  const live = await connect(f);
  const orphan = "cac_01arz3ndektsv4rrffq69g5fax";
  const vault = createCodingCredentialKeychain({ keychain: f.keychain });
  value(await vault.prepare(orphan, "orphan-token-value"));
  // 앱 secret으로 둔 다른 용도의 항목은 목록에 들지 않아 지워지지 않는다.
  const other = value(
    await f.keychain.store({
      name: "API_KEY",
      purpose: "app_secret",
      owner: "API_KEY",
      value: new TextEncoder().encode("app-secret-value"),
    }),
  );
  assertEquals(await f.pending.list(), []);
  assertEquals(await f.authority.recover(), {
    kept: 1,
    discarded: 1,
    retry: 0,
  });
  const stored = (f.keychain as FakeKeychain).stored;
  assertFalse(stored.has(codingCredentialRef(orphan)!));
  assert(stored.has(codingCredentialRef(live.connection)!));
  assert(stored.has(other));
  // 목록을 만들 수 없는 keychain에서는 아무것도 지우지 않는다.
  const blind = fixture({
    keychain: { ...createFakeKeychain(), listRefs: undefined },
  });
  assertEquals(await blind.authority.recover(), {
    kept: 0,
    discarded: 0,
    retry: 0,
  });
});

Deno.test("platform/secrets#R12: 준비 중인 connection은 고아 정리가 건드리지 않는다", async () => {
  const f = fixture();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  let seen = "";
  const connecting = f.authority.connect(
    { label: "claude", scope: ALL },
    async (input) => {
      seen = input.id;
      // commit 직전에 고아 정리가 돈다.
      await gate;
      return f.rows.commit(input);
    },
  );
  while (seen === "") await new Promise((resolve) => setTimeout(resolve, 1));
  assertEquals(await f.authority.recover(), {
    kept: 0,
    discarded: 0,
    retry: 0,
  });
  assert((f.keychain as FakeKeychain).stored.has(codingCredentialRef(seen)!));
  release();
  assertEquals(value(await connecting).connection, seen);
  const token = storedToken(f.keychain as FakeKeychain, seen);
  assertEquals(
    value(await f.registry.authenticate(token)).principal,
    `coding_agent:${seen}`,
  );
});

Deno.test("platform/secrets#R12: Linux adapter의 고정 위치 목록은 용도와 prefix가 맞는 참조만 내고 값은 내지 않는다", async () => {
  const calls: string[][] = [];
  const secret = new TextEncoder().encode(
    [
      "[/org/freedesktop/secrets/collection/login/1]",
      "label = lophn secret a",
      "secret = secret-value-one",
      "attribute.lophn_ref = coding-agent/cac_01arz3ndektsv4rrffq69g5fav",
      "",
      "[/org/freedesktop/secrets/collection/login/2]",
      "label = lophn secret b",
      "secret = secret-value-two",
      "attribute.lophn_ref = other/ref",
      "",
    ].join("\n"),
  );
  const adapter = createLinuxSecretServiceAdapter({
    runner: {
      run(args) {
        calls.push([...args]);
        return Promise.resolve(ok({ code: 0, stdout: secret }));
      },
    },
    randomRef: () => "ref",
  });
  const listed = value(
    await adapter.listRefs!("coding_connection_credential", "coding-agent/"),
  );
  assertEquals(listed, ["coding-agent/cac_01arz3ndektsv4rrffq69g5fav"]);
  assertEquals(calls, [[
    "search",
    "--all",
    "lophn_purpose",
    "coding_connection_credential",
  ]]);
  assertFalse(JSON.stringify(listed).includes("secret-value"));
  const missing = createLinuxSecretServiceAdapter({
    runner: {
      run: () => Promise.resolve(err({ code: "unavailable", message: "없음" })),
    },
    randomRef: () => "ref",
  });
  assertEquals(
    code(
      await missing.listRefs!("coding_connection_credential", "coding-agent/"),
    ),
    "unavailable",
  );
});
