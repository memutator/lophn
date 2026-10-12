// 사람의 연결 결정 흐름 통합 시험이다(coding-agent#T36, connection#R2·R12·R17, mcp-server#R36).
// shell main이 부를 순서 그대로다: 사람 선택(이름·범위) → core의 신뢰 경계가 token을 발급해 fake keychain에
// 보관 → core create(hash만, 확인 창 없음) → 선택 target 설치 → doctor. 그리고 등록된 child가 production
// provider로 helper `lophn-credential`(실제 helper 처리 코드)과 core의 소유자 전용 socket을 거쳐 token을
// 한 번 받는 양성 경로를 본다. HOME·project·LOPHN_HOME은 모두 temp dir이고 keychain은 fake이며 사람의 실제
// keychain·harness 설정·데이터 root는 열지 않는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import { err, ok } from "../../packages/base/mod.ts";
import type { Result } from "../../packages/base/mod.ts";
import {
  type ConnectionId,
  connectionIdSchema,
} from "../../packages/protocol/coding-agent/mod.ts";
import type { AuthenticatedContext } from "../../packages/protocol/platform/mod.ts";
import {
  connectAndInstall,
  type ConnectFlowPorts,
} from "../../packages/coding-agent/cli/commands/connection.ts";
import { doctorOf } from "../../packages/coding-agent/cli/commands/doctor.ts";
import {
  createHelperCredentialProvider,
  currentProcessGeneration,
} from "../../packages/coding-agent/connection/credential/helper.ts";
import {
  filePort,
  installSelected,
  stdioMcpProbe,
  storeOf,
} from "../../packages/coding-agent/harnesses/mod.ts";
import {
  EXPECTED_TOOLS,
  fixture,
  fixtureLaunch,
  NOW,
  targetOf,
} from "../../packages/coding-agent/harnesses/testing/mod.ts";
import { serveCredentialSocket } from "../../packages/core/install-and-update/mod.ts";
import {
  codingCredentialRef,
  createFakeKeychain,
} from "../../packages/core/secrets/mod.ts";
import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import { type Core, startCore } from "./core.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";

const decoder = new TextDecoder();
const HELPER_MAIN = new URL(
  "../../packages/core/install-and-update/credential-helper-main.ts",
  import.meta.url,
).pathname;

async function post(
  core: Core,
  path: string,
  token: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
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

async function allFileText(dir: string): Promise<string> {
  const parts: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) parts.push(await allFileText(path));
    else if (entry.isFile) parts.push(await Deno.readTextFile(path));
  }
  return parts.join("\n");
}

Deno.test("coding-agent/connection#R2 coding-agent/connection#R17 coding-agent/mcp-server#R36: 사람 선택 → 발급·보관 → create → 설치 → doctor가 이어지고 등록된 child만 helper·socket을 거쳐 token을 한 번 받는다", async () => {
  const fx = await fixture();
  const home = `${fx.base}/h`;
  await Deno.mkdir(`${home}/run`, { recursive: true, mode: 0o700 });
  // helper: 실제 helper 처리 코드를 부르는 sh wrapper다. 이 경로가 loader identity다.
  const helper = `${fx.base}/lophn-credential`;
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
    random: seededRandom(81),
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
    const user = "U".repeat(43);
    const context: AuthenticatedContext = {
      principal: "user",
      actor: "user",
      scope: {
        operations: [
          "ConnectCodingAgent",
          "CreateCodingAgentConnection",
          "ShowCodingAgentConnection",
          "ListCodingAgentConnections",
        ],
        targets: {},
      },
      conditions: {},
      credential_ref: `cred-user-${core.epoch}`,
    };
    assert(core.acceptTestCredential);
    assert((await core.acceptTestCredential(context, user)).ok);
    assert((await core.record(context)).ok);

    const generation = await currentProcessGeneration();
    const provider = createHelperCredentialProvider({ helper });
    const target = targetOf("claude", "user", fx);
    const roots = { home: fx.home, env: fx.env, cwd: fx.project };
    const ports: ConnectFlowPorts = {
      // 사람 선택(이름·범위) 뒤 core의 신뢰 경계가 발급·보관하고 create를 제출한다.
      async connect(input): Promise<Result<{ connection: ConnectionId }>> {
        const made = await post(
          core,
          "coding_agent_connections/connect",
          user,
          input,
        );
        const id = connectionIdSchema.safeParse(made.body["connection"]);
        return made.status === 200 && id.success
          ? ok({ connection: id.data })
          : err({ code: "unavailable", message: `connect ${made.status}` });
      },
      install: (connection, chosen) =>
        installSelected({
          target: chosen,
          connection,
          launch: fixtureLaunch("ok", [], { LOPHN_CONNECTION: connection }),
          version: null,
          roots,
          operationId: "op-flow",
          now: NOW,
        }, { files: filePort(), store: storeOf(fx.lophn) }),
      doctor: (connection, chosen) =>
        doctorOf({
          target: chosen,
          connection,
          roots,
          denoExecutable: Deno.execPath(),
          now: NOW,
          expectedTools: EXPECTED_TOOLS,
        }, {
          files: filePort(),
          mcp: stdioMcpProbe({
            timeout_ms: 8_000,
            ambient: (name) =>
              ({
                PATH: "/usr/bin:/bin",
                HOME: fx.home,
                DENO_DIR: `${fx.base}/deno`,
              })[name],
          }),
          store: storeOf(fx.lophn),
          daemon: {
            status: () =>
              Promise.resolve(ok({ state: "running", metadata: "present" })),
          },
          connections: {
            async read(id) {
              const shown = await post(
                core,
                "coding_agent_connections/show",
                user,
                { connection: id },
              );
              const state = (shown.body["connection"] as
                | { state?: "active" | "revoked" }
                | undefined)?.state;
              return state === undefined
                ? err({ code: "unavailable", message: "show" })
                : ok({ state });
            },
          },
          credential: {
            async available(id) {
              const received = await provider(id as ConnectionId);
              return received.ok ? "available" : received.error;
            },
          },
        }),
    };

    // 등록 전이라 child는 token을 받지 못한다(범위 밖과 같은 not_found).
    const flow = await connectAndInstall({
      label: "claude code",
      scope: { kind: "all", app: null },
      target,
    }, ports);
    assert(flow.ok, flow.ok ? "" : JSON.stringify(flow.error));
    const { connection } = flow.value;
    assertEquals(flow.value.install.status, "complete");
    assert(flow.value.doctor !== null);
    assertEquals(flow.value.doctor.auth.credential, "not_found");
    // 연결 이름은 사람이 고른 값이고 keychain 항목은 connection의 고정 위치다.
    const stored = keychain.stored.get(codingCredentialRef(connection)!);
    assert(stored !== undefined);
    const token = decoder.decode(stored);

    // 신뢰 감독이 이 process generation을 지정 child로 등록하면 helper가 token을 전달한다.
    const registered = core.codingCredentials!.authority.registerChild({
      process_generation: generation,
      loader_identity: helper,
      connection,
      scope: { kind: "all", app: null },
    });
    assert(registered.ok);
    const delivered = await provider(connection);
    assert(delivered.ok, delivered.ok ? "" : delivered.error);
    assertEquals(delivered.value.token, token);
    assertEquals((await post(core, "platform/status", token, {})).status, 200);
    const again = await ports.doctor(connection, target);
    assert(again.ok);
    assertEquals(again.value.auth.credential, "available");

    // 다른 process generation·등록하지 않은 child는 같은 not_found다.
    const stranger = await createHelperCredentialProvider({
      helper,
      generation: () => "99999.1",
    })(connection);
    assertFalse(stranger.ok);
    assertEquals(stranger.error, "not_found");
    // child 종료·connection 정리 뒤에는 새 process가 받지 못한다.
    core.codingCredentials!.authority.endChild(generation);
    const afterEnd = await createHelperCredentialProvider({ helper })(
      connection,
    );
    assertFalse(afterEnd.ok);
    assertEquals(afterEnd.error, "not_found");

    // token 원문은 설치된 설정·receipt·skill·lophn home 어디에도 없다. connection 참조만 있다.
    for (const dir of [fx.home, fx.project, fx.lophn]) {
      const text = await allFileText(dir);
      assertFalse(text.includes(token), dir);
    }
    assert(
      (await Deno.readTextFile(`${fx.home}/.claude.json`)).includes(connection),
    );
  } finally {
    if (previousHome === undefined) Deno.env.delete("LOPHN_HOME");
    else Deno.env.set("LOPHN_HOME", previousHome);
    if (socket.ok) await socket.value.close();
    await core.shutdown();
    await fx.dispose();
  }
});

Deno.test("coding-agent/connection#R2: core의 보관 준비가 실패하면 connection이 없고 설치·doctor를 시작하지 않는다", async () => {
  const fx = await fixture();
  const home = `${fx.base}/h`;
  const keychain = createFakeKeychain();
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ codingAgentConnectionDefinitions }],
    teamModules: [new URL("./coding-agent.ts", import.meta.url).href],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(82),
    testCredentials: true,
    superviseIo: false,
    codingKeychain: keychain,
    codingLoaders: ["/opt/lophn/lophn-credential"],
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
  });
  const core = started.value;
  await core.codingCredentialsReady;
  guard.keep();
  try {
    const user = "V".repeat(43);
    const context: AuthenticatedContext = {
      principal: "user",
      actor: "user",
      scope: {
        operations: [
          "ConnectCodingAgent",
          "CreateCodingAgentConnection",
          "ListCodingAgentConnections",
        ],
        targets: {},
      },
      conditions: {},
      credential_ref: `cred-user-${core.epoch}`,
    };
    assert(core.acceptTestCredential);
    assert((await core.acceptTestCredential(context, user)).ok);
    assert((await core.record(context)).ok);
    keychain.setStatus("unavailable");
    const calls: string[] = [];
    const flow = await connectAndInstall({
      label: "claude",
      scope: { kind: "all", app: null },
      target: targetOf("claude", "user", fx),
    }, {
      async connect(input) {
        calls.push("connect");
        const made = await post(
          core,
          "coding_agent_connections/connect",
          user,
          input,
        );
        return made.status === 200
          ? ok({ connection: made.body["connection"] as ConnectionId })
          : err({ code: "unavailable", message: `connect ${made.status}` });
      },
      install: () => {
        calls.push("install");
        return Promise.reject(new Error("설치하면 안 된다"));
      },
      doctor: () => {
        calls.push("doctor");
        return Promise.reject(new Error("doctor하면 안 된다"));
      },
    });
    assertFalse(flow.ok);
    assertEquals(calls, ["connect"]);
    keychain.setStatus("available");
    const listed = await post(core, "coding_agent_connections/list", user, {});
    assertEquals((listed.body["connections"] as unknown[]).length, 0);
    assertEquals(keychain.stored.size, 0);
  } finally {
    await core.shutdown();
    await fx.dispose();
  }
});
