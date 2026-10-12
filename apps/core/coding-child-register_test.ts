// 신뢰 감독(shell main)의 TUI 아래 MCP·CLI child 등록 입구(platform#T34 후속, platform/identity#R15,
// coding-agent/connection#R17). 임시 LOPHN_HOME·fake keychain으로 core를 띄우고 실제 helper 처리 코드와 core의
// 소유자 전용 socket을 거쳐, 등록된 child만 token을 받고 등록하지 않았거나 다른 connection·TUI 아래 process는
// 거절되며 endChild·endConnection·회수가 전달을 바로 멈추는지 본다. 사람의 실제 keychain·데이터 root는 열지 않는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import { createHelperCredentialProvider } from "../../packages/coding-agent/connection/credential/helper.ts";
import type { AuthenticatedContext } from "../../packages/protocol/server/mod.ts";
import { serveCredentialSocket } from "../../packages/core/install-and-update/mod.ts";
import {
  codingCredentialRef,
  createFakeKeychain,
  type FakeKeychain,
} from "../../packages/core/secrets/mod.ts";
import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import { withRevocationSweep } from "./coding-credential.ts";
import { type Core, startCore } from "./core.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";

const decoder = new TextDecoder();
const HELPER_MAIN = new URL(
  "../../packages/core/install-and-update/credential-helper-main.ts",
  import.meta.url,
).pathname;

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

async function withCore(
  run: (input: {
    core: Core;
    home: string;
    helper: string;
    keychain: FakeKeychain;
    user: string;
    connect(label: string): Promise<{ connection: string; token: string }>;
    provider(generation: string): ReturnType<
      typeof createHelperCredentialProvider
    >;
  }) => Promise<void>,
): Promise<void> {
  const home = await Deno.makeTempDir({ prefix: "lophn-child-register-" });
  await Deno.mkdir(`${home}/run`, { recursive: true, mode: 0o700 });
  // helper: 실제 helper 처리 코드를 부르는 sh wrapper다. 이 경로가 loader identity다.
  const helper = `${home}/lophn-credential`;
  await Deno.writeTextFile(
    helper,
    `#!/bin/sh\nexec "${Deno.execPath()}" run --no-prompt --allow-net --allow-read --allow-write --allow-env=LOPHN_HOME,HOME "${HELPER_MAIN}"\n`,
  );
  await Deno.chmod(helper, 0o755);
  const keychain = createFakeKeychain();
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ codingAgentConnectionDefinitions }],
    teamModules: [new URL("./coding-agent.ts", import.meta.url).href],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(91),
    testCredentials: true,
    superviseIo: false,
    codingKeychain: keychain,
    codingLoaders: [helper],
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
  });
  const core = started.value;
  await core.codingCredentialsReady;
  guard.keep();
  const socket = await serveCredentialSocket({
    dataRoot: core.dataRoot,
    authority: core.codingCredentials!.authority,
  });
  assert(socket.ok);
  const previousHome = Deno.env.get("LOPHN_HOME");
  Deno.env.set("LOPHN_HOME", home);
  try {
    // shell main의 자기 credential이다(사람 token).
    const user = "S".repeat(43);
    const context: AuthenticatedContext = {
      principal: "user",
      actor: "user",
      scope: {
        operations: [
          "ConnectCodingAgent",
          "CreateCodingAgentConnection",
          "RegisterCodingAgentChild",
          "EndCodingAgentChild",
          "EndCodingAgentConnectionChildren",
        ],
        targets: {},
      },
      conditions: {},
      credential_ref: `cred-user-${core.epoch}`,
    };
    assert(core.acceptTestCredential);
    assert((await core.acceptTestCredential(context, user)).ok);
    assert((await core.record(context)).ok);
    await run({
      core,
      home,
      helper,
      keychain,
      user,
      async connect(label) {
        const made = await post(
          core,
          "coding_agent_connections/connect",
          user,
          { label, scope: { kind: "all", app: null } },
        );
        assertEquals(made.status, 200, JSON.stringify(made.body));
        const connection = made.body["connection"] as string;
        const stored = keychain.stored.get(codingCredentialRef(connection)!);
        assert(stored !== undefined);
        return { connection, token: decoder.decode(stored) };
      },
      // token 캐시가 없는 새 child process다. 인자가 그 process의 generation이다.
      provider: (generation) =>
        createHelperCredentialProvider({
          helper,
          generation: () => generation,
          // 등록되지 않은 process의 거절을 기다리지 않고 본다(재시도는 helper_test가 본다).
          retry: { intervalMs: 1, boundMs: 0 },
        }),
    });
  } finally {
    if (previousHome === undefined) Deno.env.delete("LOPHN_HOME");
    else Deno.env.set("LOPHN_HOME", previousHome);
    if (socket.ok) await socket.value.close();
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
}

Deno.test("platform/identity#R15 coding-agent/connection#R17: 신뢰 감독이 등록한 child만 helper를 거쳐 token을 받고 등록하지 않았거나 다른 connection·TUI 아래 process는 거절된다", async () => {
  await withCore(async ({ core, helper, user, connect, provider }) => {
    const a = await connect("claude");
    const b = await connect("codex");
    const register = (connection: string, generation: string) =>
      post(core, "coding_agent_connections/register_child", user, {
        connection,
        process_generation: generation,
        loader_identity: helper,
      });

    // 등록 전에는 같은 process도 범위 밖과 같은 not_found다.
    const before = await provider("1001.5")(a.connection as never);
    assertFalse(before.ok);
    assertEquals(before.error, "not_found");

    // TUI A 아래 child(1001.5)를 connection A로 등록한다. 응답에는 scope·token이 없다.
    const registered = await register(a.connection, "1001.5");
    assertEquals(registered.status, 200, JSON.stringify(registered.body));
    assertEquals(registered.body, { registered: true });
    const got = await provider("1001.5")(a.connection as never);
    assert(got.ok, got.ok ? "" : got.error);
    assertEquals(got.value.token, a.token);

    // 같은 child가 다른 connection의 token은 받지 못한다.
    const other = await provider("1001.5")(b.connection as never);
    assertFalse(other.ok);
    assertEquals(other.error, "not_found");
    // 다른 TUI 아래(등록하지 않은) process는 같은 connection이어도 거절된다. pid가 같아도 시작 tick이 다르면 다르다.
    for (const generation of ["2002.9", "1001.6", "1001"]) {
      const stranger = await provider(generation)(a.connection as never);
      assertFalse(stranger.ok, generation);
      assertEquals(stranger.error, "not_found");
    }
    // 다른 connection으로 같은 generation을 다시 등록하면 그 connection 것으로 바뀐다(지정 child 하나는 한 connection).
    const moved = await register(b.connection, "1001.5");
    assertEquals(moved.status, 200);
    assertFalse((await provider("1001.5")(a.connection as never)).ok);
    assert((await provider("1001.5")(b.connection as never)).ok);
  });
});

Deno.test("platform/identity#R15: endChild와 endConnection은 새 전달을 바로 멈추고 회수된 connection 참조도 등록되지 않는다", async () => {
  await withCore(async ({ core, helper, user, connect, provider }) => {
    const a = await connect("claude");
    const b = await connect("codex");
    const call = (method: string, body: unknown) =>
      post(core, `coding_agent_connections/${method}`, user, body);
    const register = (connection: string, generation: string) =>
      call("register_child", {
        connection,
        process_generation: generation,
        loader_identity: helper,
      });

    for (const generation of ["11.1", "12.1", "13.1"]) {
      assertEquals((await register(a.connection, generation)).status, 200);
    }
    assertEquals((await register(b.connection, "21.1")).status, 200);

    // endChild: 그 child만 멈춘다.
    const endedOne = await call("end_child", { process_generation: "11.1" });
    assertEquals(endedOne.status, 200, JSON.stringify(endedOne.body));
    assertFalse((await provider("11.1")(a.connection as never)).ok);
    assert((await provider("12.1")(a.connection as never)).ok);

    // endConnection: 그 connection 아래 남은 child가 모두 멈추고 다른 connection은 그대로다.
    const endedAll = await call("end_connection", { connection: a.connection });
    assertEquals(endedAll.status, 200);
    assertEquals(endedAll.body, { ended: 2 });
    for (const generation of ["12.1", "13.1"]) {
      const after = await provider(generation)(a.connection as never);
      assertFalse(after.ok, generation);
      assertEquals(after.error, "not_found");
    }
    assert((await provider("21.1")(b.connection as never)).ok);

    // 없는 connection 참조·loader 목록 밖 identity는 등록되지 않는다.
    const missing = await register("cac_01arz3ndektsv4rrffq69g5fax", "31.1");
    assertEquals(missing.status, 403, JSON.stringify(missing.body));
    const badLoader = await call("register_child", {
      connection: b.connection,
      process_generation: "32.1",
      loader_identity: "/tmp/not-installed-loader",
    });
    assertEquals(badLoader.status, 403);
    assertFalse((await provider("32.1")(b.connection as never)).ok);
    // 모양이 틀린 입력은 invalid_input이다(scope·token 같은 추가 필드 포함).
    const extra = await call("register_child", {
      connection: b.connection,
      process_generation: "33.1",
      loader_identity: helper,
      scope: { kind: "all", app: null },
    });
    assertEquals(extra.status, 400);
  });
});

Deno.test("platform/identity#R15: coding_agent credential은 child 등록·해제 입구에 닿지 못한다(403)", async () => {
  await withCore(async ({ core, helper, user, connect, provider }) => {
    const a = await connect("claude");
    // 사람 credential로 child 하나를 등록해 둔다.
    assertEquals(
      (await post(core, "coding_agent_connections/register_child", user, {
        connection: a.connection,
        process_generation: "41.1",
        loader_identity: helper,
      })).status,
      200,
    );
    // connection의 coding_agent credential(token)로는 등록·해제·정리 모두 403이고 상태를 바꾸지 못한다.
    const calls: [string, unknown][] = [
      ["register_child", {
        connection: a.connection,
        process_generation: "42.1",
        loader_identity: helper,
      }],
      ["end_child", { process_generation: "41.1" }],
      ["end_connection", { connection: a.connection }],
    ];
    for (const [method, body] of calls) {
      const denied = await post(
        core,
        `coding_agent_connections/${method}`,
        a.token,
        body,
      );
      assertEquals(
        denied.status,
        403,
        `${method} ${JSON.stringify(denied.body)}`,
      );
    }
    assertFalse((await provider("42.1")(a.connection as never)).ok);
    assert((await provider("41.1")(a.connection as never)).ok);
  });
});

Deno.test("platform/identity#R15: connection 회수가 commit되면 그 connection 아래 등록된 child를 바로 닫는다", async () => {
  const closed: string[] = [];
  const writer = withRevocationSweep(
    {
      command: () => Promise.resolve({ ok: true, value: {} }),
    } as never,
    () => Promise.resolve(),
    (connection) => closed.push(connection),
  );
  const revoke = await writer.command({} as never, {
    command: "RevokeCodingAgentConnection",
    input: { connection: "cac_01arz3ndektsv4rrffq69g5fax", base_revision: "1" },
  } as never);
  assert(revoke.ok);
  const other = await writer.command({} as never, {
    command: "CreateCodingAgentConnection",
    input: { connection: "cac_01arz3ndektsv4rrffq69g5fay" },
  } as never);
  assert(other.ok);
  assertEquals(closed, ["cac_01arz3ndektsv4rrffq69g5fax"]);
});
