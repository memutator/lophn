// lophn-agent/harness/run-loop: 제품 core가 agent runtime child를 띄우는 자리를 실제 core(임시
// LOPHN_HOME, 실제 ledger)와 실제 child process로 본다. core는 제품 기동과 같은 길로 child를 감독하고
// (platform/io만 같은 process 안의 실제 worker로 바꿔 끼운다), child는 `agentRuntimeLaunchSpec`이 정한
// 좁힌 권한으로만 뜬다. provider는 fake provider이고 실제 provider·사람 데이터 root·OS keychain은 열지
// 않는다.
import { assert, assertEquals } from "@std/assert";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import {
  type Spawned,
  spawnProcess,
  type SpawnRequest,
} from "../../packages/platform/responsiveness/mod.ts";
import { startFakeProvider } from "../../tools/fake-provider/mod.ts";
import { RUNTIME_MACHINE_OPERATIONS } from "../agent-runtime/core-http.ts";
import { AGENT_RUNTIME_KIND } from "./agent-runtime.ts";
import { type Core, startCore } from "./core.ts";
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
];
const MODEL = "claude-sonnet-4-5";

type Child = { request: SpawnRequest; spawned: Spawned };

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
    teams: [{ lophnAgentDefinitions, createLedgerRegistration }],
    teamModules: [new URL("./lophn-agent.ts", import.meta.url).href],
    testCredentials: true,
    agentRuntime: { pollMs: 150 },
    spawn(request) {
      if (request.env["LOPHN_WORKER_KIND"] !== AGENT_RUNTIME_KIND) {
        return io.spawn(request);
      }
      const spawned = spawnProcess(request);
      children.push({ request, spawned });
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
      judgment: {
        provider: PVD,
        credentials: [],
        model_name: MODEL,
        reasoning_level: "provider_default",
        options: {},
      },
      organizing: null,
      settings_seq: seq,
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
    const opened = await call(
      server,
      "sessions/open",
      USER_TOKEN,
      command({
        id: SES,
        assignment: lophn.id,
        role: "lophn",
        work_place: { kind: "global", id: null },
        continued_from: null,
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
      assertEquals(granted.get("allow-env"), [
        "LOPHN_HOME",
        "LOPHN_WORKER_KIND",
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
