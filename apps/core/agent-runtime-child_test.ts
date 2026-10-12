// lophn-agent/harness/run-loop: 제품 core가 agent runtime child를 띄우는 자리를 실제 core(임시
// LOPHN_HOME, 실제 ledger)와 실제 child process로 본다. core는 제품 기동과 같은 길로 child를 감독하고
// (platform/io만 같은 process 안의 실제 worker로 바꿔 끼운다), child는 `agentRuntimeLaunchSpec`이 정한
// 좁힌 권한으로만 뜬다. provider는 fake provider이고 실제 provider·사람 데이터 root·OS keychain은 열지
// 않는다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { mcpServersSetting } from "../../packages/contracts/lophn-agent/mod.ts";
import {
  type AuthenticatedContext,
  setSecret,
} from "../../packages/contracts/platform/mod.ts";
import { confirmationBinding } from "../../packages/platform/identity/mod.ts";
import {
  createFakeKeychain,
  type FakeKeychain,
} from "../../packages/platform/secrets/mod.ts";
import {
  type Spawned,
  spawnProcess,
  type SpawnRequest,
} from "../../packages/platform/responsiveness/mod.ts";
import { startFakeProvider } from "../../tools/fake-provider/mod.ts";
import { SOCKET_HOST } from "../../packages/contracts/apps/mod.ts";
import { RUNTIME_MACHINE_OPERATIONS } from "../agent-runtime/core-http.ts";
import { AGENT_RUNTIME_KIND } from "./agent-runtime.ts";
import { type Core, startCore } from "./core.ts";
import { createLedgerRegistration as documentsRegistration } from "./documents.ts";
import {
  createLedgerRegistration,
  lophnAgentDefinitions,
} from "./lophn-agent.ts";
import {
  call,
  command,
  inspect,
  type Server,
} from "./testing/approvals-fixture.ts";
import { inProcessIo } from "./testing/in-process-io.ts";

const PVD = "pvd_01arz3ndektsv4rrffq69g5fav";
const SES = "ses_01arz3ndektsv4rrffq69g5fav";
const SESSION_PLACE = "prj_01arz3ndektsv4rrffq69g5fav";
const USER_TOKEN = "e".repeat(43);
const USER_OPERATIONS = [
  "ListAssignments",
  "OpenSession",
  "ReadSession",
  "ReceiveMessage",
  "RegisterProvider",
  "ChangeModelDefaults",
  "ReadModelDefaults",
  "ReadRun",
  "SetSecret",
  "SettingsDefinitions",
  "ApplySettings",
  "project.create",
  "project.list",
];
const MODEL = "claude-sonnet-4-5";

// stderr는 감독이 읽는 그대로 곁에서 모은다. 시험이 그 안에 값이 없음을 본다.
type Child = {
  request: SpawnRequest;
  spawned: Spawned;
  stderr: Uint8Array[];
};

type World = {
  core: Core;
  server: Server;
  home: string;
  children: Child[];
  provider: ReturnType<typeof startFakeProvider>;
  close(): Promise<void>;
};

function answers(text: string) {
  return {
    id: `answer-${text.replace(/\W+/g, "-")}`,
    protocol: "messages" as const,
    reply: { text, usage: { input: 40, output: 9 }, stop: "end" as const },
  };
}

// 실제 child는 감독이 넘기는 argv·env 그대로 process로 뜬다. 그 밖(platform/io)은 같은 process 안의
// worker다: blob 준비는 그 worker가 한다.
async function openWorld(options: {
  home?: string;
  provider?: ReturnType<typeof startFakeProvider>;
  script?: string[];
  keychain?: FakeKeychain;
}): Promise<World> {
  const home = options.home ??
    await Deno.makeTempDir({ prefix: "lophn-agent-child-" });
  const provider = options.provider ?? startFakeProvider({
    script: { steps: (options.script ?? ["ok"]).map(answers) },
    nowMs: () => Date.now(),
    instant: true,
  });
  const io = inProcessIo({ root: home });
  const children: Child[] = [];
  const started = await startCore({
    lophnHome: home,
    port: 0,
    writerClock: "system",
    teams: [
      { lophnAgentDefinitions, createLedgerRegistration },
      { createLedgerRegistration: documentsRegistration },
    ],
    teamModules: [
      new URL("./lophn-agent.ts", import.meta.url).href,
      new URL("./documents.ts", import.meta.url).href,
    ],
    testCredentials: true,
    ...(options.keychain === undefined
      ? {}
      : { secretKeychain: options.keychain }),
    agentRuntime: { pollMs: 150 },
    spawn(request) {
      if (request.env["LOPHN_WORKER_KIND"] !== AGENT_RUNTIME_KIND) {
        return io.spawn(request);
      }
      const spawned = spawnProcess(request);
      const stderr: Uint8Array[] = [];
      const read = spawned.stderr.read.bind(spawned.stderr);
      spawned.stderr.read = async (buffer) => {
        const count = await read(buffer);
        if (count !== null) stderr.push(buffer.slice(0, count));
        return count;
      };
      children.push({ request, spawned, stderr });
      return spawned;
    },
  });
  assert(started.ok, started.ok ? "" : JSON.stringify(started.error));
  const core = started.value;
  const server: Server = {
    port: core.port,
    dataRoot: core.dataRoot,
    clock: { nowMs: () => Date.now() },
    confirmation: () =>
      Promise.resolve({ ok: false as const, error: { message: "none" } }),
  };
  const context: AuthenticatedContext = {
    principal: "user",
    actor: "user",
    scope: { operations: USER_OPERATIONS, targets: {} },
    conditions: {},
    credential_ref: `cred-user-${crypto.randomUUID()}`,
  } as AuthenticatedContext;
  assert((await core.acceptTestCredential?.(context, USER_TOKEN))?.ok);
  assert((await core.record(context)).ok);
  return {
    core,
    server,
    home,
    children,
    provider,
    async close() {
      await core.shutdown();
      // 이 시험이 띄운 child만 끝낸다. 남은 것이 있으면 정확한 process만 종료한다.
      for (const child of children) await child.spawned.terminate();
    },
  };
}

async function until(
  what: string,
  ready: () => boolean | Promise<boolean>,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out: ${what}`);
}

function alive(pid: number): boolean {
  try {
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch {
    return false;
  }
}

// provider와 기본 model을 사람이 등록한다. child는 새 목적지로 다시 뜨고 그 뒤에 요청이 간다.
async function chooseModel(world: World): Promise<void> {
  const { server, provider } = world;
  const registered = await call(
    server,
    "providers/register",
    USER_TOKEN,
    command({
      id: PVD,
      name: "fixture",
      definition: {
        key: "anthropic",
        display_name: "Anthropic",
        protocols: ["anthropic-messages"],
        auth_kinds: ["none"],
        models_endpoint: null,
        oauth: null,
        revision: "2026-01-01",
      },
      endpoint: provider.url,
      protocol: "anthropic-messages",
      credential: { kind: "none", preparation: null },
    }),
  );
  assertEquals(registered.status, 200, JSON.stringify(registered.body));
  const defaults = await call(
    server,
    "agent-model-defaults/read",
    USER_TOKEN,
    {},
  );
  assertEquals(defaults.status, 200, JSON.stringify(defaults.body));
  const seq = (defaults.body["defaults"] as { settings_seq: string })
    .settings_seq;
  const changed = await call(
    server,
    "agent-model-defaults/change",
    USER_TOKEN,
    command({
      lophn: { provider: PVD, model_name: MODEL, option_values: {} },
    }, { compare: { settings_seq: seq } }),
  );
  assertEquals(changed.status, 200, JSON.stringify(changed.body));
}

// 사람이 lophn에게 요청을 보낸다. 반환은 접수된 run이다.
async function ask(world: World, text: string, id: string): Promise<string> {
  const { server } = world;
  const listed = await call(server, "assignments/list", USER_TOKEN, {});
  const lophn = (listed.body["assignments"] as {
    id: string;
    role: string;
    revision: number;
  }[]).find((entry) => entry.role === "lophn");
  assert(lophn !== undefined, JSON.stringify(listed.body));
  const existing = await call(server, "sessions/read", USER_TOKEN, {
    session: SES,
  });
  if (existing.status !== 200) {
    // 세션은 쓸 수 있는 project 하나를 자리로 받는다.
    const place = await call(
      server,
      "projects/create",
      USER_TOKEN,
      command({
        id: SESSION_PLACE,
        name: "session-place",
        title: "session-place",
        purpose: "",
        folders: [],
        tracking: { enabled: false, patterns: [], use_gitignore: false },
      }),
    );
    assertEquals(place.status, 200, JSON.stringify(place.body));
    const opened = await call(
      server,
      "sessions/open",
      USER_TOKEN,
      command({
        id: SES,
        assignment: lophn.id,
        work_place: { kind: "project", id: SESSION_PLACE },
        opening_context: null,
      }, {
        compare: {
          assignment_revision: lophn.revision,
          assignment_state: "enabled",
        },
      }),
    );
    assertEquals(opened.status, 200, JSON.stringify(opened.body));
  }
  const session = await call(server, "sessions/read", USER_TOKEN, {
    session: SES,
  });
  const sent = await call(
    server,
    "messages/receive",
    USER_TOKEN,
    command({
      id,
      session: SES,
      content: { schema_version: 1, parts: [{ kind: "text", text }] },
      mode: "request",
    }, {
      compare: {
        session_state: "open",
        session_state_seq:
          (session.body as { session: { state_seq: string } }).session
            .state_seq,
        assignment_revision: lophn.revision,
        assignment_state: "enabled",
      },
    }),
  );
  assertEquals(sent.status, 200, JSON.stringify(sent.body));
  return (sent.body as { message: { run: string } }).message.run;
}

function runRow(world: World, run: string) {
  return inspect(
    world.server,
    "select state, outcome_kind, outcome_reason from runs where id = ?",
    [run],
  )[0];
}

function finished(world: World, run: string): boolean {
  return runRow(world, run)?.["state"] === "finished";
}

// `--allow-x=a,b` 인자들을 이름별 목록으로 푼다.
function permissions(args: readonly string[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const arg of args) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match !== null) found.set(match[1]!, match[2]!.split(","));
  }
  return found;
}

Deno.test("lophn-agent/harness/run-loop#R8: 제품 core가 띄운 runtime child가 사람의 요청을 받은 run을 model call과 답 기록으로 끝낸다", async () => {
  const world = await openWorld({ script: ["The projects are empty."] });
  try {
    await chooseModel(world);
    // 등록한 provider 목적지가 권한 목록에 들어가도록 child가 새 목록으로 다시 뜬다.
    await until(
      "runtime restarted for the provider",
      () => world.children.length >= 2,
    );
    const run = await ask(
      world,
      "What projects exist?",
      "msg_01arz3ndektsv4rrffq69g5fav",
    );
    await until("run finished", () => finished(world, run));

    const row = runRow(world, run)!;
    assertEquals(row["outcome_kind"], "completed", JSON.stringify(row));
    // model call 하나는 fake provider로 나갔고 완전 응답이 기록됐다.
    assertEquals(world.provider.requests().length, 1);
    assertEquals(
      inspect(
        world.server,
        "select count(*) as n from model_calls where run = ? and state = 'finished'",
        [run],
      )[0]!["n"],
      1,
    );
    // 답은 agent가 남긴 메시지 하나다.
    assertEquals(
      inspect(
        world.server,
        "select count(*) as n from messages where actor like 'agent:%'",
      )[0]!["n"],
      1,
    );
    // 기록이 가리키는 본문은 child가 감독 pipe로 먼저 저장한 blob이다.
    const refs = inspect(
      world.server,
      "select count(*) as n from blob_refs where owner_kind in ('run', 'model_call')",
    )[0]!["n"];
    assert(Number(refs) >= 5, `blob refs ${refs}`);
    // run의 agent credential은 core가 발급했다가 run이 끝나며 runtime이 끝냈다(감독 pipe 두 메시지).
    const agents = inspect(
      world.server,
      "select count(*) as n from credentials where json_extract(context, '$.actor') like 'agent:%'",
    )[0]!["n"];
    assertEquals(agents, 1);
  } finally {
    await world.provider.close();
    await world.close();
    await Deno.remove(world.home, { recursive: true });
  }
});

Deno.test("lophn-agent/harness/run-loop#R8: runtime child의 argv에는 -A가 없고 spec이 정한 좁힌 권한만 있으며 hello의 machine credential은 machine:agent-runtime에 RUNTIME_MACHINE_OPERATIONS다", async () => {
  const world = await openWorld({});
  try {
    await until("first child", () => world.children.length >= 1);
    await chooseModel(world);
    await until("restart with the provider", () => world.children.length >= 2);

    for (const child of world.children) {
      const args = child.request.args;
      assert(!args.includes("-A"));
      assert(!args.some((arg) => arg.startsWith("--allow-all")));
      assert(!args.some((arg) => arg.startsWith("--allow-ffi")));
      const granted = permissions(args);
      // 허락 이름은 spec이 정한 것뿐이다. 실행·시스템 정보 권한은 없다.
      assertEquals(
        [...granted.keys()].sort(),
        ["allow-env", "allow-net", "allow-read", "allow-write"],
      );
      assertEquals(granted.get("allow-read"), [world.core.dataRoot]);
      assertEquals(granted.get("allow-write"), [
        `${world.core.dataRoot}/derived/lophn-agent`,
      ]);
      // MCP stdio 자식의 최소 환경 네 이름이 더해진다(lophn-agent#T36).
      assertEquals(granted.get("allow-env"), [
        "LOPHN_HOME",
        "LOPHN_WORKER_KIND",
        "PATH",
        "HOME",
        "TEMP",
        "LC_ALL",
      ]);
      assertEquals(
        args.slice(0, 4),
        ["run", "--cached-only", "--frozen", "--no-prompt"],
      );
      assertEquals(
        args[args.length - 1],
        new URL("../agent-runtime/main.ts", import.meta.url).pathname,
      );
      // 환경은 이름을 정한 것만 간다.
      assertEquals(child.request.env["LOPHN_WORKER_KIND"], AGENT_RUNTIME_KIND);
      assertEquals(child.request.env["LOPHN_HOME"], world.core.dataRoot);
    }
    // 처음에는 core loopback뿐이고 provider를 등록하면 그 목적지가 더해진다.
    assertEquals(
      permissions(world.children[0]!.request.args).get("allow-net"),
      [`127.0.0.1:${world.core.port}`],
    );
    const providerPort = new URL(world.provider.url).port;
    assertEquals(
      permissions(world.children[1]!.request.args).get("allow-net"),
      [`127.0.0.1:${world.core.port}`, `127.0.0.1:${providerPort}`],
    );

    // hello의 machine credential: principal은 machine:agent-runtime, scope는 runtime이 부르는
    // machine route의 operation 목록이다.
    const rows = inspect(
      world.server,
      "select context from credentials where json_extract(context, '$.principal') = 'machine:agent-runtime'",
    );
    assertEquals(rows.length, 1);
    const context = JSON.parse(String(rows[0]!["context"])) as {
      actor: string;
      scope: { operations: string[] };
      conditions: { process: string };
    };
    assertEquals(context.actor, "machine");
    assertEquals(context.conditions.process, AGENT_RUNTIME_KIND);
    assertEquals(
      [...context.scope.operations].sort(),
      [...RUNTIME_MACHINE_OPERATIONS].sort(),
    );
  } finally {
    await world.provider.close();
    await world.close();
    await Deno.remove(world.home, { recursive: true });
  }
});

// allow-net에서 앱 direct socket 자리(가상 host와 unix 경로)를 뺀 목적지다.
function netHosts(args: readonly string[]): string[] | undefined {
  return permissions(args).get("allow-net")?.filter((entry) =>
    entry !== SOCKET_HOST && !entry.startsWith("unix:")
  );
}

// 사람이 MCP server 목록을 등록한다(settings/apply). revision은 매 호출 읽은 값이다.
async function registerMcpServers(
  world: World,
  servers: readonly unknown[],
  key: string,
): Promise<void> {
  const { server } = world;
  const definitions = await call(server, "settings/definitions", USER_TOKEN, {
    keys: [mcpServersSetting.key],
  });
  assertEquals(definitions.status, 200, JSON.stringify(definitions.body));
  const current = await call(server, "settings/get", USER_TOKEN, {
    keys: [mcpServersSetting.key],
  });
  const applied = await call(server, "settings/apply", USER_TOKEN, {
    input: {
      changes: [{
        layer: "common",
        key: mcpServersSetting.key,
        action: "set",
        value: servers,
      }],
    },
    idempotency_key: key,
    compare: {
      revision: (current.body as { revision?: number }).revision ?? 0,
      defaults_revision:
        (definitions.body as { defaults_revision: string }).defaults_revision,
    },
    prepared: [],
  });
  assertEquals(applied.status, 200, JSON.stringify(applied.body));
}

Deno.test("lophn-agent/extensions#R13 lophn-agent/extensions#R15 lophn-agent/harness/run-loop#R8: 등록한 MCP server가 있으면 child는 그 HTTP의 정확한 host:port만 net으로, stdio의 정확한 실행 경로만 run으로 더해 다시 뜨고 끄면 다시 좁아진다", async () => {
  // 이 시험이 연 localhost 가짜 MCP server다. 실제 외부 service는 쓰지 않는다.
  const fake = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    () => new Response("{}"),
  );
  const world = await openWorld({});
  try {
    await until("first child", () => world.children.length >= 1);
    const first = world.children[0]!.request.args;
    assertEquals(netHosts(first), [`127.0.0.1:${world.core.port}`]);
    assertEquals(permissions(first).get("allow-run"), undefined);

    const base = {
      revision: 1,
      call_timeout_ms: 60_000,
      classifications: {},
    };
    const servers = [
      {
        ...base,
        name: "remote",
        enabled: true,
        transport: "http",
        http: {
          url: `http://127.0.0.1:${fake.addr.port}/rpc`,
          headers: {},
          auth: { kind: "none" },
        },
      },
      {
        ...base,
        name: "notes",
        enabled: true,
        transport: "stdio",
        stdio: { executable: "/bin/sh", args: [], cwd: null, env: {} },
      },
      {
        ...base,
        name: "off",
        enabled: false,
        transport: "http",
        http: {
          url: "https://off.example.test/rpc",
          headers: {},
          auth: { kind: "none" },
        },
      },
    ];
    await registerMcpServers(world, servers, "mcp-register-1");
    await until(
      "restart with the MCP servers",
      () => world.children.length >= 2,
    );
    const second = world.children[1]!.request.args;
    assertEquals(netHosts(second), [
      `127.0.0.1:${world.core.port}`,
      `127.0.0.1:${fake.addr.port}`,
    ]);
    assertEquals(permissions(second).get("allow-run"), ["/bin/sh"]);

    await registerMcpServers(
      world,
      servers.map((entry) => ({ ...entry, enabled: false })),
      "mcp-register-2",
    );
    await until(
      "restart without the MCP servers",
      () => world.children.length >= 3,
    );
    const third = world.children[2]!.request.args;
    assertEquals(netHosts(third), [`127.0.0.1:${world.core.port}`]);
    assertEquals(permissions(third).get("allow-run"), undefined);
  } finally {
    await fake.shutdown();
    await world.close();
    await Deno.remove(world.home, { recursive: true });
  }
});

Deno.test("lophn-agent/harness/run-loop#R8: core를 멈추면 runtime child도 멈추고 같은 data root로 core를 다시 시작하면 child가 다시 떠서 요청을 처리한다", async () => {
  const provider = startFakeProvider({
    script: { steps: [answers("first"), answers("second")] },
    nowMs: () => Date.now(),
    instant: true,
  });
  const first = await openWorld({ provider });
  const home = first.home;
  let second: World | undefined;
  try {
    await chooseModel(first);
    await until("restart with the provider", () => first.children.length >= 2);
    const run = await ask(first, "one", "msg_01arz3ndektsv4rrffq69g5fav");
    await until("first run finished", () => finished(first, run));
    const pids = first.children.map((child) => child.spawned.pid);
    assert(pids.every((pid) => pid > 0));

    // core를 멈추면 감독이 child를 정상 정지한다. child process는 남지 않는다.
    await first.core.shutdown();
    for (const child of first.children) await child.spawned.exited;
    for (const pid of pids) assert(!alive(pid), `child ${pid} is still alive`);

    // 같은 data root로 core를 다시 시작하면 child도 다시 뜬다. 등록한 provider 목적지를 처음부터 쓴다.
    second = await openWorld({ home, provider });
    await until("child started again", () => second!.children.length >= 1);
    assert(
      permissions(second.children[0]!.request.args).get("allow-net")!.includes(
        `127.0.0.1:${new URL(provider.url).port}`,
      ),
    );
    const again = await ask(second, "two", "msg_01arz3ndektsv4rrffq69g5faw");
    await until("second run finished", () => finished(second!, again));
    assertEquals(runRow(second, again)!["outcome_kind"], "completed");
    assertEquals(provider.requests().length, 2);
  } finally {
    await second?.close();
    await first.close();
    await provider.close();
    await Deno.remove(home, { recursive: true });
  }
});

const SECRET = "violet-harbor-lantern-4821";
const PROJECT = "prj_01kq12a1pha000000000000000";

function listing(id: string) {
  return {
    id: `list-${id}`,
    protocol: "messages" as const,
    reply: {
      text: "I will look at the projects.",
      toolCalls: [{ id: `toolu_${id}`, name: "project.list", arguments: "{}" }],
      usage: { input: 20, output: 8 },
      stop: "tool_calls" as const,
    },
  };
}

// 알려진 secret 값을 core에 등록한다: 제품의 보호 입력이 끝난 상태(keychain에 값, ledger에 준비 증거)를
// 만들고 사람이 SetSecret을 확정한다. 응답 전에 core의 알려진 값 registry가 맞춰진다.
async function prepareSecret(
  world: World,
  keychain: FakeKeychain,
  name: string,
  value: string,
) {
  const stored = await keychain.store({
    name,
    purpose: "app_secret",
    owner: name,
    value: new TextEncoder().encode(value),
  });
  assert(stored.ok);
  const preparation = `prep-${crypto.randomUUID()}`;
  const db = new DatabaseSync(`${world.home}/lophn.db`);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare(
      "INSERT INTO secret_preparations (preparation, sealed_ref, purpose, owner) VALUES (?, ?, 'app_secret', ?)",
    ).run(preparation, stored.value, name);
  } finally {
    db.close();
  }
  return {
    name,
    preparation: {
      preparation,
      sealed_ref: stored.value,
      purpose: "app_secret",
      owner: name,
    },
  };
}

async function confirmSecret(
  world: World,
  input: Awaited<ReturnType<typeof prepareSecret>>,
) {
  const binding = await confirmationBinding(setSecret, input);
  assert(binding);
  const issued = await world.core.confirmation?.({
    action: "issue",
    request: {
      type: "confirmation_handle_register",
      window_id: `win-${crypto.randomUUID()}`,
      target_ref: binding.target,
      content_hash: binding.content,
      allowed_decisions: [setSecret.name],
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    },
  });
  assert(issued?.ok, JSON.stringify(issued));
  const confirmation = (issued.value as { confirmation: string }).confirmation;
  return await call(world.server, "secrets/set", USER_TOKEN, {
    input,
    idempotency_key: `set-${crypto.randomUUID()}`,
    compare: { sealed_ref: null, revision: null },
    prepared: [],
    confirmation,
  });
}

async function createProject(world: World, folder: string) {
  const created = await call(
    world.server,
    "projects/create",
    USER_TOKEN,
    command({
      id: PROJECT,
      name: "alpha",
      title: `Notes about ${SECRET}`,
      purpose: `The passphrase is ${SECRET}.`,
      folders: [{ path: folder, description: `kept under ${SECRET}` }],
      tracking: { enabled: false, patterns: [], use_gitignore: false },
    }),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
}

async function blobText(world: World, hash: string): Promise<string> {
  const bytes = await Deno.readFile(
    `${world.core.dataRoot}/blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`,
  );
  return new TextDecoder().decode(bytes);
}

Deno.test("lophn-agent/harness/run-loop#R8: core의 알려진 secret 값은 tool 결과에 있어도 model provider로 가지 않고 저장한 model call 입력 blob에도 없다", async () => {
  const keychain = createFakeKeychain();
  const folder = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-agent-child-folder-" }),
  );
  const provider = startFakeProvider({
    script: {
      steps: [
        listing("1"),
        answers("first done"),
        listing("2"),
        answers("second done"),
      ],
    },
    nowMs: () => Date.now(),
    instant: true,
  });
  const world = await openWorld({ provider, keychain });
  try {
    await chooseModel(world);
    await until("restart", () => world.children.length >= 2);
    await createProject(world, folder);

    // 대조: core가 아직 모르는 값은 pattern에 걸리지 않아 runtime이 읽은 tool 결과에 그대로 있다.
    const before = await ask(world, "list", "msg_01arz3ndektsv4rrffq69g5fav");
    await until("first run finished", () => finished(world, before));
    assert(
      JSON.stringify(provider.requests()[1]!.body).includes(SECRET),
      "the control run should carry the raw value",
    );

    // 사람이 이 값을 secret으로 등록하면 core가 알려진 값으로 안다.
    const set = await confirmSecret(
      world,
      await prepareSecret(world, keychain, "passphrase", SECRET),
    );
    assertEquals(set.status, 200, JSON.stringify(set.body));
    // core가 project 읽기에서 지우지 않으므로 runtime이 받는 tool 결과에는 값이 있다.
    const read = await call(world.server, "projects/list", USER_TOKEN, {});
    assert(JSON.stringify(read.body).includes(SECRET));

    const after = await ask(
      world,
      "list again",
      "msg_01arz3ndektsv4rrffq69g5faw",
    );
    await until("second run finished", () => finished(world, after));
    assertEquals(runRow(world, after)!["outcome_kind"], "completed");
    const requests = provider.requests();
    assertEquals(requests.length, 4);
    // 두 번째 run의 요청(tool 결과를 실은 것)에 값이 없다.
    const sent = JSON.stringify(requests[3]!.body);
    assert(sent.includes("tool_result"));
    assert(!sent.includes(SECRET), "the known value was sent to the provider");
    assert(!JSON.stringify(requests[2]!.body).includes(SECRET));
    // 저장한 model call 입력 blob도 같은 안전화한 값이다.
    const stored = inspect(
      world.server,
      "select input from model_calls where run = ? order by attempt_order",
      [after],
    );
    assertEquals(stored.length, 2);
    for (const row of stored) {
      assert(!(await blobText(world, String(row["input"]))).includes(SECRET));
    }
    // 이 run의 모든 기록 blob에 값이 없다(근거·결과·model call·tool call).
    const refs = inspect(
      world.server,
      "select hash from blob_refs where owner_kind in ('run', 'model_call', 'tool_call') and owner_key in (select id from model_calls where run = ? union select id from tool_calls where run = ? union select ?)",
      [after, after, after],
    );
    assert(refs.length >= 5);
    for (const row of refs) {
      assert(!(await blobText(world, String(row["hash"]))).includes(SECRET));
    }
  } finally {
    await world.close();
    await provider.close();
    await Deno.remove(world.home, { recursive: true });
    await Deno.remove(folder, { recursive: true });
  }
});

Deno.test("lophn-agent/harness/run-loop#R8: core가 안전화를 끝낼 수 없으면 runtime은 그 글을 보내지 않는다", async () => {
  const keychain = createFakeKeychain();
  const provider = startFakeProvider({
    script: { steps: [answers("never sent")] },
    nowMs: () => Date.now(),
    instant: true,
  });
  const world = await openWorld({ provider, keychain });
  try {
    await chooseModel(world);
    await until("restart", () => world.children.length >= 2);
    // child를 끝내 감독이 다시 띄우는 동안(1초 뒤) 요청을 받고, core가 알려진 값을 다 알지 못하는
    // 상태로 만든다: 값을 keychain에서 읽을 수 없으면 registry가 준비되지 않음이다.
    assert(await world.children.at(-1)!.spawned.terminate());
    const run = await ask(world, "hello", "msg_01arz3ndektsv4rrffq69g5fav");
    const input = await prepareSecret(world, keychain, "passphrase", SECRET);
    keychain.setStatus("unavailable");
    const set = await confirmSecret(world, input);
    assertEquals(set.status, 200, JSON.stringify(set.body));

    // 감독이 다시 띄운 child는 run을 시작하려 하지만 core가 안전화를 끝내지 못해 기록 본문조차 만들지
    // 못한다. 글은 model provider로 나가지 않고 run은 시작되지 않은 채 남는다.
    await until("child restarted", () => world.children.length >= 3);
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    assertEquals(provider.requests().length, 0);
    assertEquals(runRow(world, run)!["state"], "accepted");

    // core가 알려진 값을 다시 다 알게 되면(keychain이 돌아옴) 같은 run이 안전화를 지나 끝난다.
    keychain.setStatus("available");
    await until("run finished", () => finished(world, run));
    assertEquals(runRow(world, run)!["outcome_kind"], "completed");
    assertEquals(provider.requests().length, 1);
  } finally {
    await world.close();
    await provider.close();
    await Deno.remove(world.home, { recursive: true });
  }
});

// ---- provider API key: 전송 직전 부착 ----

const API_KEY = "violet-harbor-credential-5d8e2f41-lantern";

type Wire = {
  protocol:
    | "anthropic-messages"
    | "openai-responses"
    | "openai-chat-completions";
  step: "messages" | "responses" | "chat_completions";
  definition: string;
  model: string;
  // API key가 실리는 header와 그 값의 모양.
  header: "x-api-key" | "authorization";
  sent(value: string): string;
};

const WIRES: Wire[] = [
  {
    protocol: "anthropic-messages",
    step: "messages",
    definition: "anthropic",
    model: "claude-sonnet-4-5",
    header: "x-api-key",
    sent: (value) => value,
  },
  {
    protocol: "openai-responses",
    step: "responses",
    definition: "openai",
    model: "gpt-5",
    header: "authorization",
    sent: (value) => `Bearer ${value}`,
  },
  {
    protocol: "openai-chat-completions",
    step: "chat_completions",
    definition: "openai",
    model: "gpt-5",
    header: "authorization",
    sent: (value) => `Bearer ${value}`,
  },
];

// key를 확인하는 provider. 올바른 key가 아닌 요청은 401이고 fake provider까지 가지 않는다.
// 받은 header 원문은 시험만 본다(제품 fake는 값 대신 종류만 남긴다).
function keyedProvider(
  upstream: ReturnType<typeof startFakeProvider>,
  header: string,
  expected: string,
) {
  const seen: string[] = [];
  let received = 0;
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request) => {
      received += 1;
      const value = request.headers.get(header);
      if (value !== null) seen.push(value);
      if (value !== expected) {
        return Response.json({ error: { type: "authentication_error" } }, {
          status: 401,
        });
      }
      const forwarded = new Headers(request.headers);
      forwarded.delete("host");
      const response = await fetch(
        upstream.url + new URL(request.url).pathname,
        {
          method: request.method,
          headers: forwarded,
          body: await request.text(),
        },
      );
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
    },
  );
  return {
    url: `http://127.0.0.1:${server.addr.port}`,
    seen,
    received: () => received,
    close: () => server.shutdown(),
  };
}

// 사람이 API key provider를 연결한다: 값은 keychain에 있고 ledger에는 준비 증거와 참조만 남는다.
async function chooseKeyedModel(
  world: World,
  keychain: FakeKeychain,
  wire: Wire,
  endpoint: string,
): Promise<void> {
  const { server } = world;
  const stored = await keychain.store({
    name: `${PVD}/main`,
    purpose: "provider_credential",
    owner: PVD,
    value: new TextEncoder().encode(API_KEY),
  });
  assert(stored.ok);
  const preparation = `prep-${crypto.randomUUID()}`;
  const db = new DatabaseSync(`${world.home}/lophn.db`);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare(
      "INSERT INTO secret_preparations (preparation, sealed_ref, purpose, owner) VALUES (?, ?, 'provider_credential', ?)",
    ).run(preparation, stored.value, PVD);
  } finally {
    db.close();
  }
  // Connect는 provider와 그 credential 하나를 함께 둔다.
  const registered = await call(
    server,
    "providers/register",
    USER_TOKEN,
    command({
      id: PVD,
      name: "fixture",
      definition: {
        key: wire.definition,
        display_name: wire.definition,
        protocols: [wire.protocol],
        auth_kinds: ["api_key"],
        models_endpoint: null,
        oauth: null,
        revision: "2026-01-01",
      },
      endpoint,
      protocol: wire.protocol,
      credential: {
        kind: "api_key",
        preparation: {
          preparation,
          sealed_ref: stored.value,
          purpose: "provider_credential",
          owner: PVD,
        },
      },
    }),
  );
  assertEquals(registered.status, 200, JSON.stringify(registered.body));
  const defaults = await call(
    server,
    "agent-model-defaults/read",
    USER_TOKEN,
    {},
  );
  const seq = (defaults.body["defaults"] as { settings_seq: string })
    .settings_seq;
  const changed = await call(
    server,
    "agent-model-defaults/change",
    USER_TOKEN,
    command({
      lophn: { provider: PVD, model_name: wire.model, option_values: {} },
    }, { compare: { settings_seq: seq } }),
  );
  assertEquals(changed.status, 200, JSON.stringify(changed.body));
}

// 값을 담은 파일이 data root(ledger·WAL·blob·log·파생)에 있는지.
async function filesWithValue(root: string, value: string): Promise<string[]> {
  const needle = new TextEncoder().encode(value);
  const found: string[] = [];
  async function walk(directory: string): Promise<void> {
    for await (const entry of Deno.readDir(directory)) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory) await walk(path);
      else if (entry.isFile) {
        const bytes = await Deno.readFile(path);
        if (contains(bytes, needle)) found.push(path);
      }
    }
  }
  await walk(root);
  return found;
}

function contains(bytes: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function stderrText(world: World): string {
  return world.children.map((child) =>
    child.stderr.map((chunk) => new TextDecoder().decode(chunk)).join("")
  ).join("");
}

async function keyedWorld(wire: Wire, script: string[]) {
  const keychain = createFakeKeychain();
  const upstream = startFakeProvider({
    script: {
      steps: script.map((text) => ({
        id: `answer-${text.replace(/\W+/g, "-")}`,
        protocol: wire.step,
        reply: { text, usage: { input: 40, output: 9 }, stop: "end" as const },
      })),
    },
    nowMs: () => Date.now(),
    instant: true,
  });
  const keyed = keyedProvider(upstream, wire.header, wire.sent(API_KEY));
  const world = await openWorld({ provider: upstream, keychain });
  await chooseKeyedModel(world, keychain, wire, keyed.url);
  // 등록한 provider 목적지가 권한 목록에 들어가도록 child가 새 목록으로 다시 뜬다.
  await until("restart with the provider", () => world.children.length >= 2);
  return {
    world,
    keychain,
    upstream,
    keyed,
    async close() {
      await world.close();
      await keyed.close();
      await upstream.close();
      await Deno.remove(world.home, { recursive: true });
    },
  };
}

for (const wire of WIRES) {
  Deno.test(`lophn-agent/harness/provider#R7 platform/secrets#R5: ${wire.protocol} API key provider의 run은 전송 직전에 붙은 key로 끝나고 key는 ledger·blob·log·stderr 어디에도 없다`, async () => {
    const opened = await keyedWorld(wire, ["The projects are empty."]);
    const { world } = opened;
    try {
      const run = await ask(
        world,
        "What projects exist?",
        "msg_01arz3ndektsv4rrffq69g5fav",
      );
      await until("run finished", () => finished(world, run));
      assertEquals(
        runRow(world, run)!["outcome_kind"],
        "completed",
        JSON.stringify(runRow(world, run)),
      );
      // provider가 받은 요청은 올바른 key 하나다. 그 key는 protocol이 정한 header로 갔다.
      assertEquals(opened.keyed.seen, [wire.sent(API_KEY)]);
      assertEquals(opened.keyed.received(), 1);
      assertEquals(opened.upstream.requests().length, 1);
      const request = opened.upstream.requests()[0]!;
      assert(request.headers.some((entry) => entry.name === wire.header));
      // key는 요청 본문(prompt)에도 없다.
      assert(!JSON.stringify(request.body).includes(API_KEY));
      const calls = inspect(
        world.server,
        "select state from model_calls where run = ?",
        [run],
      );
      assertEquals(calls.length, 1);
      assertEquals(calls[0]!["state"], "finished");
      // data root 전체(ledger·WAL·blob·log·파생)와 child stderr에 key가 없다.
      assertEquals(await filesWithValue(world.core.dataRoot, API_KEY), []);
      assert(!stderrText(world).includes(API_KEY));
    } finally {
      await opened.close();
    }
  });
}

Deno.test("lophn-agent/harness/provider#R4 platform/secrets#R8: keychain이 잠기면 run은 configuration_unavailable로 끝나고 provider로 요청이 나가지 않는다", async () => {
  const opened = await keyedWorld(WIRES[0]!, ["never sent"]);
  const { world, keychain } = opened;
  try {
    // 알려진 값은 core 메모리에 이미 있다. 값을 읽는 keychain이 잠겨 값을 건넬 수 없다.
    keychain.setStatus("unavailable");
    const run = await ask(world, "hello", "msg_01arz3ndektsv4rrffq69g5fav");
    await until("run finished", () => finished(world, run));
    const row = runRow(world, run)!;
    assertEquals(row["outcome_kind"], "failed", JSON.stringify(row));
    assertEquals(row["outcome_reason"], "configuration_unavailable");
    // 요청은 어디로도 나가지 않았다: provider(wrapper)도 fake도 받은 것이 없다.
    assertEquals(opened.keyed.received(), 0);
    assertEquals(opened.upstream.requests().length, 0);
    assertEquals(await filesWithValue(world.core.dataRoot, API_KEY), []);
    assert(!stderrText(world).includes(API_KEY));
  } finally {
    await opened.close();
  }
});
