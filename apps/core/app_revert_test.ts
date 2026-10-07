// lophn-agent#T48 앱 revert를 실제 core(temp LOPHN_HOME)와 실제 todo fixture 앱(fixtures/apps/todo)에서
// 본다. 앱은 fixture를 temp 폴더에 풀어 deno 자식으로 command 하나씩 부르는 것이고(앱 DB는 temp 폴더),
// run의 앱 write 두 개는 그 앱이 돌려준 실제 되돌림 근거(`result.revert`)를 ToolCall 기록에 싣는다.
// revert는 사람 자격으로 preview·확인 handle·RevertRun을 같은 core의 HTTP route로 부르고, 앱 단계는
// machine runtime 역할의 runAppSteps가 revert_todo를 원래 호출 역순으로 직접 부른다. model provider와
// 사람 데이터 root는 열지 않는다. 문서 복원과 순수 분류는 apps/core/revert_test.ts,
// packages/lophn-agent/revert/revert_test.ts가 본다.
import { assert, assertEquals } from "@std/assert";
import {
  err,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../packages/base/mod.ts";
import { revertRun } from "../../packages/contracts/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import {
  devImportMap,
  readTemplateDirectory,
} from "../../packages/apps/sdk/mod.ts";
import {
  deno,
  installedHome,
  removeTree,
} from "../../packages/apps/sdk/testing/mod.ts";
import { confirmationBinding } from "../../packages/platform/identity/mod.ts";
import {
  type AppStepCall,
  type AppStepPorts,
  buildRevertInput,
  type RevertGroup,
  runAppSteps,
} from "../../packages/lophn-agent/revert/mod.ts";
import { type Core, startCore } from "./core.ts";
import { lophnAgentDefinitions } from "./lophn-agent.ts";
import {
  call,
  command,
  count,
  type Reply,
  type Server,
} from "./testing/approvals-fixture.ts";

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const FIXTURE = new URL("../../fixtures/apps/todo/", import.meta.url).pathname;
const MACHINE_TOKEN = "m".repeat(43);
const USER_TOKEN = "u".repeat(43);
const BASIS = "b".repeat(64);
const FINAL = "d".repeat(64);
const INPUT = "1".repeat(64);
const OUTPUT = "2".repeat(64);
const LIMITS = { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 };
const APP = id("app", 1);
const REL = id("rel", 1);

const MACHINE_OPERATIONS = [
  "ListAssignments",
  "AcceptRun",
  "StartRun",
  "FinishRun",
  "ReadRun",
  "RecordToolRequest",
  "DecideToolCall",
  "StartToolCall",
  "FinishToolCall",
  "ReadToolCall",
  "ListReverts",
  "CheckpointRevert",
  "FinishRevert",
];
const USER_OPERATIONS = [
  "PreviewRevert",
  "ListReverts",
  "RevertRun",
  "ListEvents",
  "RevertStarted",
  "RevertApplied",
  "RevertBlocked",
  "RevertFinished",
];

type Assignment = { id: string; role: string; revision: number };

// 앱 폴더를 temp로 풀어 개발용 import map을 둔 fixture 앱과, command 하나씩 부르는 진입 파일이다.
// 진입 파일은 앱 runtime entrypoint가 하는 일(invocation 문맥 안에서 handler를 부르고 거절 code를 돌려줌)만
// 하고 업무 규칙은 fixture의 handler가 한다.
const DRIVER = `
import { CommandRejection, runWith } from "@lophn/cap-schedule";
import { openStore } from "@lophn/cap-store";
import {
  addTodoHandler,
  listTodosHandler,
  revertTodoHandler,
} from "./src/commands.ts";
import { defaults } from "./src/deps.ts";

const [name, data, invocation, text] = Deno.args;
const deps = {
  ...defaults,
  openStore: () => openStore({ host: { mode: "test", dataPath: data } }),
  now: () => "2026-02-01T00:00:00.000Z",
};
const handlers = {
  add_todo: addTodoHandler,
  revert_todo: revertTodoHandler,
  list_todos: listTodosHandler,
};
let out;
try {
  const value = await runWith(
    { app: "app_a", release: "rel_a", mode: "live", invocation },
    () => handlers[name](deps)(JSON.parse(text)),
  );
  out = { ok: true, result: value.result ?? value, revert: value.revert ?? null };
} catch (error) {
  out = { ok: false, code: error instanceof CommandRejection ? error.code : "internal" };
}
console.log(JSON.stringify(out));
`;

type Fixture = {
  parent: string;
  app: string;
  dispose(): Promise<void>;
};

async function openFixture(): Promise<Fixture> {
  const installed = await installedHome(["@lophn/cap-fs"]);
  const parent = await Deno.makeTempDir({ prefix: "lophn-app-revert-" });
  const app = `${parent}/app`;
  const config = JSON.parse(
    await Deno.readTextFile(`${FIXTURE}/deno.json.tmpl`),
  ) as { imports: Record<string, string> };
  const files = await readTemplateDirectory(FIXTURE, { stripSuffix: true });
  assert(files.ok, files.ok ? "" : files.error.message);
  for (const file of files.value) {
    const target = `${app}/${file.path}`;
    await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
      recursive: true,
    });
    await Deno.writeFile(target, file.bytes);
  }
  await Deno.mkdir(`${app}/.lophn`);
  await Deno.writeTextFile(
    `${app}/.lophn/import-map.json`,
    JSON.stringify(devImportMap(config.imports, installed.sdkRoot, app)),
  );
  await Deno.writeTextFile(`${app}/driver.ts`, DRIVER);
  await Deno.mkdir(`${parent}/data`);
  return {
    parent,
    app,
    async dispose() {
      await removeTree(parent);
      await installed.dispose();
    },
  };
}

type AppReply =
  | { ok: true; result: unknown; revert: Record<string, string> | null }
  | { ok: false; code: string };

// fixture 앱의 command 하나를 부른다. 앱 DB는 temp 폴더에 남아 다음 호출이 이어 받는다.
async function callApp(
  fixture: Fixture,
  name: string,
  invocation: string,
  input: unknown,
): Promise<AppReply> {
  const out = await deno(fixture.app, [
    "run",
    "--no-prompt",
    "--import-map=.lophn/import-map.json",
    "--frozen-lockfile",
    "--cached-only",
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "driver.ts",
    name,
    `${fixture.parent}/data`,
    invocation,
    JSON.stringify(input),
  ]);
  assertEquals(out.code, 0, out.stderr);
  return JSON.parse(out.stdout.trim().split("\n").at(-1)!) as AppReply;
}

async function titlesOf(fixture: Fixture): Promise<string[]> {
  const read = await callApp(fixture, "list_todos", id("inv", 99), {});
  assert(read.ok);
  return (read.result as { rows: { title: string }[] }).rows.map((row) =>
    row.title
  ).sort();
}

type World = {
  core: Core;
  server: Server;
  clock: ReturnType<typeof manualClock>;
  fixture: Fixture;
  lophn: Assignment;
  dispose(): Promise<void>;
};

async function accept(
  core: Core,
  credential: AuthenticatedContext,
  token: string,
) {
  const accepted = await core.acceptTestCredential?.(credential, token);
  assert(accepted?.ok);
  const recorded = await core.record(credential);
  assert(recorded.ok);
}

async function open(): Promise<World> {
  const home = await Deno.makeTempDir({ prefix: "lophn-app-revert-core-" });
  const clock = manualClock(Date.UTC(2024, 0, 1));
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ lophnAgentDefinitions }],
    teamModules: [new URL("./lophn-agent.ts", import.meta.url).href],
    clock,
    random: seededRandom(48),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  const server: Server = {
    port: core.port,
    dataRoot: core.dataRoot,
    clock,
    confirmation: (body) =>
      core.confirmation?.(body) ??
        Promise.resolve({ ok: false as const, error: { message: "없다" } }),
  };
  await accept(core, {
    principal: "machine",
    actor: "machine",
    scope: { operations: MACHINE_OPERATIONS, targets: {} },
    conditions: {},
    credential_ref: "cred-machine",
  }, MACHINE_TOKEN);
  await accept(core, {
    principal: "user",
    actor: "user",
    scope: { operations: USER_OPERATIONS, targets: {} },
    conditions: {},
    credential_ref: "cred-user",
  }, USER_TOKEN);
  const listed = await call(server, "assignments/list", MACHINE_TOKEN, {});
  assertEquals(listed.status, 200, JSON.stringify(listed.body));
  const lophn = (listed.body["assignments"] as Assignment[]).find((entry) =>
    entry.role === "lophn"
  );
  assert(lophn !== undefined);
  const fixture = await openFixture();
  return {
    core,
    server,
    clock,
    fixture,
    lophn,
    async dispose() {
      await core.shutdown();
      await Deno.remove(home, { recursive: true });
      await fixture.dispose();
    },
  };
}

// run에 묶인 command는 요청 봉투에 그 run을 싣는다(ledger event가 run에 묶인다).
function machine(
  world: World,
  path: string,
  input: unknown,
  compare: unknown,
  run?: string,
) {
  return call(world.server, path, MACHINE_TOKEN, {
    ...command(input, { compare }),
    ...(run === undefined ? {} : { run }),
  });
}

async function okOf(reply: Promise<Reply>): Promise<Record<string, unknown>> {
  const done = await reply;
  assertEquals(done.status, 200, JSON.stringify(done.body));
  return done.body;
}

async function stateSeq(
  world: World,
  path: string,
  input: unknown,
  key: string,
) {
  const reply = await okOf(call(world.server, path, MACHINE_TOKEN, input));
  return (reply[key] as { state_seq: string }).state_seq;
}

// 접수한 run을 시작한다.
async function startRun(world: World, run: string, message: number) {
  await okOf(machine(world, "runs/accept", {
    id: run,
    assignment: world.lophn.id,
    session: null,
    source: { kind: "message", message: id("msg", message) },
    continued_from: null,
    start_after: null,
  }, { assignment_revision: world.lophn.revision }));
  await okOf(machine(world, "runs/start", {
    run,
    basis: BASIS,
    limits: LIMITS,
    scope: { role: "lophn", assignment: world.lophn.id, apps: [] },
  }, { state_seq: await stateSeq(world, "runs/read", { run }, "run") }));
}

async function finishRun(world: World, run: string) {
  await okOf(machine(world, "runs/finish", {
    run,
    outcome: { kind: "completed", reason: "answer_completed" },
    result: FINAL,
  }, { state_seq: await stateSeq(world, "runs/read", { run }, "run") }));
}

const NOW = new Date(Date.UTC(2024, 0, 1)).toISOString();

type Write = { toolCall: string; invocation: string; receipt: string };

// run의 앱 write 하나. 요청·판정·시작을 ledger에 남기고, 시작과 마침 사이에 fixture 앱을 실제로 불러 돌려받은
// 되돌림 근거를 ToolCall result.content.revert로 싣는다(T44).
async function appWrite(
  world: World,
  run: string,
  n: number,
  title: string,
): Promise<Write> {
  const toolCall = id("tcl", n);
  const invocation = id("inv", n);
  await okOf(machine(
    world,
    "tool-calls/request",
    {
      id: toolCall,
      run,
      model_call: id("mcl", n),
      response_key: `call-${n}`,
      response_order: 0,
      tool: "add_todo",
      definition_revision: "1",
      effect: "write",
      confirm: false,
      extension: null,
      input: INPUT,
      retry_of: null,
      attempt: 0,
      app_command: {
        app: APP,
        release: REL,
        command: "add_todo",
        blueprint_hash: INPUT,
        definition_hash: OUTPUT,
        permission_basis: {
          grant: id("grt", 1),
          scope: "todos",
          basis_seq: "0",
        },
        context_binding: null,
        revert_command: "revert_todo",
      },
    },
    { run_state_seq: "0", model_call_finished_seq: "0" },
    run,
  ));
  await okOf(machine(
    world,
    "tool-calls/decide",
    {
      tool_call: toolCall,
      decision: {
        decision: "allow",
        reason: "scope allows it",
        effect: "reversible_write",
        assignment_revision: world.lophn.revision,
        preset_revision: 1,
        contract_revision: "1",
        comparison_basis: null,
        approval: null,
      },
    },
    { state_seq: "0" },
    run,
  ));
  await okOf(machine(world, "tool-calls/start", {
    tool_call: toolCall,
    started_at: NOW,
    approval: null,
  }, {
    state_seq: "1",
    run_state_seq: await stateSeq(world, "runs/read", { run }, "run"),
    assignment_revision: world.lophn.revision,
  }, run));
  const written = await callApp(world.fixture, "add_todo", invocation, {
    title,
  });
  assert(written.ok && written.revert !== null, JSON.stringify(written));
  await okOf(machine(world, "tool-calls/finish", {
    tool_call: toolCall,
    outcome: { kind: "success", code: "ok" },
    output: OUTPUT,
    result: {
      status: "success",
      summary: "command add_todo of todo finished",
      content: { invocation, revert: written.revert },
      complete: true,
      source: null,
      continuation: null,
      pending: [],
    },
    finished_at: NOW,
    duration_ms: 1,
  }, {
    state_seq: "2",
  }, run));
  return { toolCall, invocation, receipt: written.revert["receipt"]! };
}

type Preview = { groups: RevertGroup[]; binding_hash: string };

async function preview(world: World, run: string): Promise<Preview> {
  const reply = await call(world.server, "reverts/preview", USER_TOKEN, {
    run,
  });
  assertEquals(reply.status, 200, JSON.stringify(reply.body));
  return reply.body as unknown as Preview;
}

let issued = 0;

// 사람이 본 판으로 RevertRun을 요청한다. 확인 handle은 이 입력에 묶인다.
async function apply(
  world: World,
  run: string,
  revert: string,
  shown: Preview,
  previewHash = shown.binding_hash,
): Promise<Reply> {
  const items = await buildRevertInput(
    shown.groups,
    () => Promise.resolve(ok(null)),
  );
  assert(items.ok);
  const input = {
    id: revert,
    run,
    allow_partial: false,
    preview_hash: previewHash,
    groups: items.value,
  };
  const binding = await confirmationBinding(revertRun, input);
  assert(binding !== undefined);
  issued += 1;
  const handle = await world.server.confirmation({
    action: "issue",
    request: {
      type: "confirmation_handle_register",
      window_id: `win-${issued}`,
      target_ref: binding.target,
      content_hash: binding.content,
      allowed_decisions: [revertRun.name],
      expires_at: new Date(Date.UTC(2024, 0, 1) + 600_000).toISOString(),
    },
  });
  assert(handle.ok, handle.ok ? "" : handle.error.message);
  return await call(
    world.server,
    "reverts/apply",
    USER_TOKEN,
    command(input, {
      compare: { preview_hash: previewHash },
      confirmation: (handle.value as { confirmation: string }).confirmation,
    }),
  );
}

type Stored = {
  id: string;
  outcome: string;
  result_seq: string | null;
  changes: {
    ordinal: number;
    owner: string;
    result: string;
    reason: string | null;
    app_revert: { step_key: string; invocation: string } | null;
  }[];
};

async function stored(
  world: World,
  run: string,
  revert?: string,
): Promise<Stored> {
  const reply = await okOf(
    call(world.server, "reverts/list", USER_TOKEN, { run }),
  );
  const found = (reply["reverts"] as Stored[]).find((entry) =>
    revert === undefined || entry.id === revert
  );
  assert(found !== undefined);
  return found;
}

function core(reply: Reply): Result<unknown> {
  return reply.status === 200
    ? ok(reply.body)
    : err({ code: "conflict", message: JSON.stringify(reply.body) });
}

// machine runtime의 port다. 앱 호출은 실제 fixture 앱이 하고, 기록은 core의 CheckpointRevert와
// FinishRevert다. `lose`·`drop`은 응답 유실·전달 실패를 만드는 시험 입력이다.
function portsOf(
  world: World,
  run: string,
  options: {
    lose?: string;
    drop?: string;
    called: string[];
  },
): AppStepPorts {
  return {
    stored: async (revert) => {
      const found = await stored(world, run, revert);
      return ok({
        outcome: found.outcome,
        steps: found.changes.filter((change) => change.app_revert !== null)
          .map((change) => ({
            binding: change.app_revert as never,
            result: change.result,
          })),
      });
    },
    call: async (binding): Promise<AppStepCall> => {
      options.called.push(binding.invocation);
      // 전달하지 못한 호출은 앱이 아무것도 하지 않았다.
      if (options.drop === binding.invocation) return "failure";
      const reverted = await callApp(
        world.fixture,
        binding.revert_command,
        id("inv", 90 + options.called.length),
        {
          invocation: binding.invocation,
          receipt: binding.receipt,
          expected_revision: binding.expected_revision,
        },
      );
      // 앱은 되돌렸으나 응답이 돌아오지 않았다.
      if (options.lose === binding.invocation) return "uncertain";
      if (reverted.ok) return "restored";
      return reverted.code === "conflict" ? "conflict" : "failure";
    },
    checkpoint: async (input) =>
      core(await machine(world, "reverts/checkpoint", input, {})),
    finish: async (input) =>
      core(await machine(world, "reverts/finish", input, {})),
  };
}

const RUN_1 = id("run", 1);
const RUN_2 = id("run", 2);
const RUN_3 = id("run", 3);
const RUN_4 = id("run", 4);
const RUN_5 = id("run", 5);
const RVT = (n: number) => id("rvt", n);

function appRows(found: Stored) {
  return found.changes.filter((change) => change.owner === "apps/invocations")
    .filter((change) => change.app_revert !== null);
}

Deno.test("lophn-agent/revert#R10: 저장한 invocation·receipt·현재 revision으로 앱의 revert command를 원래 호출 역순으로 한 번씩 직접 부르고 실제 복원 결과를 run revert에 남긴다", async () => {
  const world = await open();
  try {
    await startRun(world, RUN_1, 1);
    const first = await appWrite(world, RUN_1, 1, "A");
    const second = await appWrite(world, RUN_1, 2, "B");
    await finishRun(world, RUN_1);
    assertEquals(await titlesOf(world.fixture), ["A", "B"]);
    // 되돌림 근거는 앱이 돌려준 실제 값이다: 변경 번호 receipt와 변경 직후 revision.
    assertEquals([first.receipt, second.receipt], ["change:1", "change:2"]);
    // preview의 앱 묶음은 호출마다 하나이고 원래 호출 순서대로다.
    const shown = await preview(world, RUN_1);
    const steps = shown.groups.filter((group) => group.app_revert !== null);
    assertEquals(
      steps.map((group) => [group.capability, group.app_revert!.invocation]),
      [["reversible", first.invocation], ["reversible", second.invocation]],
    );
    assertEquals(steps.map((group) => group.app_revert!.expected_revision), [
      "1",
      "2",
    ]);
    assertEquals(
      steps.map((group) => group.app_revert!.revert_command),
      ["revert_todo", "revert_todo"],
    );
    // 사람의 요청은 applying으로 먼저 저장될 뿐 앱 호출은 하지 않는다(R11).
    const started = await okOf(apply(world, RUN_1, RVT(1), shown));
    assertEquals(started["outcome"], "applying");
    assertEquals(started["result_seq"], null);
    assertEquals(await titlesOf(world.fixture), ["A", "B"]);
    // 같은 요청을 다시 보내도 새로 시작하지 않는다(R8).
    const again = await okOf(apply(world, RUN_1, RVT(1), shown));
    assertEquals(again["replayed"], true);
    // runtime이 원래 호출 역순으로 한 번씩 부른다.
    const called: string[] = [];
    const ran = await runAppSteps(portsOf(world, RUN_1, { called }), RVT(1));
    assert(ran.ok, ran.ok ? "" : JSON.stringify(ran.error));
    assertEquals(called, [second.invocation, first.invocation]);
    assertEquals(ran.value.stopped_at, null);
    // 앱의 실제 업무 상태가 되돌아갔다.
    assertEquals(await titlesOf(world.fixture), []);
    // run revert는 실제 복원 결과를 앱 묶음마다 남기고 전체를 applied로 확정한다.
    const done = await stored(world, RUN_1);
    assertEquals(done.outcome, "applied");
    assert(done.result_seq !== null);
    assertEquals(
      appRows(done).map((
        row,
      ) => [row.app_revert!.invocation, row.result, row.reason]),
      [[first.invocation, "restored", null], [
        second.invocation,
        "restored",
        null,
      ]],
    );
    // 문서 같은 다른 owner의 묶음과 섞이지 않는다: 복원한 묶음은 앱 owner의 것뿐이다.
    assertEquals(
      done.changes.filter((row) => row.result === "restored").map((row) =>
        row.owner
      ),
      ["apps/invocations", "apps/invocations"],
    );
    // 끝난 revert에 다시 돌려도 앱을 부르지 않는다: 단계가 이미 기록돼 있고 끝내기는 거절된다.
    const rerun: string[] = [];
    const twice = await runAppSteps(
      portsOf(world, RUN_1, { called: rerun }),
      RVT(1),
    );
    assert(!twice.ok);
    assertEquals(rerun, []);
    assertEquals(
      count(
        world.server,
        "select count(*) as n from events where type = 'RevertApplied'",
      ),
      1,
    );
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/revert#R10: 중단 뒤 이어 받으면 step_key로 이미 기록한 단계는 다시 부르지 않고 같은 단계의 반복 기록은 한 번만 받는다", async () => {
  const world = await open();
  try {
    await startRun(world, RUN_5, 5);
    const first = await appWrite(world, RUN_5, 41, "A");
    const second = await appWrite(world, RUN_5, 42, "B");
    await finishRun(world, RUN_5);
    await okOf(apply(world, RUN_5, RVT(6), await preview(world, RUN_5)));
    // 첫 호출(마지막 write)만 하고 기록까지 남긴 채 runtime이 죽었다.
    const early: string[] = [];
    const ports = portsOf(world, RUN_5, { called: early });
    const read = await ports.stored(RVT(6));
    assert(read.ok);
    const last = read.value.steps[1]!.binding;
    assertEquals(last.invocation, second.invocation);
    assertEquals(await ports.call(last), "restored");
    const noted = {
      revert: RVT(6),
      step_key: last.step_key,
      invocation: last.invocation,
      result: "restored" as const,
    };
    const checkpoint = await ports.checkpoint(noted);
    assert(
      checkpoint.ok && (checkpoint.value as { recorded: boolean }).recorded,
    );
    // 같은 단계의 같은 기록은 받아 두지만 새로 남기지 않는다(R8).
    const repeated = await ports.checkpoint(noted);
    assert(
      repeated.ok && !(repeated.value as { recorded: boolean }).recorded,
    );
    assertEquals(await titlesOf(world.fixture), ["A"]);
    // 이어 받은 runtime은 남은 단계만 부른다.
    const resumed: string[] = [];
    const ran = await runAppSteps(
      portsOf(world, RUN_5, { called: resumed }),
      RVT(6),
    );
    assert(ran.ok, ran.ok ? "" : JSON.stringify(ran.error));
    assertEquals(resumed, [first.invocation]);
    assertEquals(await titlesOf(world.fixture), []);
    assertEquals((await stored(world, RUN_5, RVT(6))).outcome, "applied");
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/revert#R11: 첫 앱 복원이 성공한 뒤 둘째가 전달되지 않으면 첫째는 실제 복원, 둘째는 실패로 남고 전체를 applied로 덮지 않는다", async () => {
  const world = await open();
  try {
    await startRun(world, RUN_2, 2);
    const first = await appWrite(world, RUN_2, 11, "A");
    const second = await appWrite(world, RUN_2, 12, "B");
    const third = await appWrite(world, RUN_2, 13, "C");
    await finishRun(world, RUN_2);
    assertEquals(await titlesOf(world.fixture), ["A", "B", "C"]);
    const shown = await preview(world, RUN_2);
    await okOf(apply(world, RUN_2, RVT(2), shown));
    // 역순 C, B, A. B 호출이 앱에 닿지 못한다.
    const called: string[] = [];
    const ran = await runAppSteps(
      portsOf(world, RUN_2, { called, drop: second.invocation }),
      RVT(2),
    );
    assert(ran.ok, ran.ok ? "" : JSON.stringify(ran.error));
    assertEquals(called, [third.invocation, second.invocation]);
    assertEquals(ran.value.stopped_at, `${RVT(2)}:${second.invocation}`);
    // 실제 앱 상태: C만 되돌았고 B와 A는 그대로다(미시작).
    assertEquals(await titlesOf(world.fixture), ["A", "B"]);
    const done = await stored(world, RUN_2);
    assertEquals(done.outcome, "partial");
    assertEquals(
      appRows(done).map((
        row,
      ) => [row.app_revert!.invocation, row.result, row.reason]),
      [
        [first.invocation, "unchanged", "app_not_started"],
        [second.invocation, "failure", "app_failed"],
        [third.invocation, "restored", null],
      ],
    );
    // 이미 확정한 revert는 다시 돌려도 앱을 부르지 않는다(R8).
    const rerun: string[] = [];
    const twice = await runAppSteps(
      portsOf(world, RUN_2, { called: rerun }),
      RVT(2),
    );
    assert(!twice.ok);
    assertEquals(rerun, []);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/revert#R11: 앱은 되돌렸으나 응답을 잃은 단계는 uncertain으로, 시작하지 않은 단계는 미시작으로 구별해 남기고 실제 앱 상태와 ledger를 한 transaction으로 주장하지 않는다", async () => {
  const world = await open();
  try {
    await startRun(world, RUN_3, 3);
    const first = await appWrite(world, RUN_3, 21, "A");
    const second = await appWrite(world, RUN_3, 22, "B");
    await finishRun(world, RUN_3);
    const shown = await preview(world, RUN_3);
    await okOf(apply(world, RUN_3, RVT(3), shown));
    const called: string[] = [];
    const ran = await runAppSteps(
      portsOf(world, RUN_3, { called, lose: second.invocation }),
      RVT(3),
    );
    assert(ran.ok, ran.ok ? "" : JSON.stringify(ran.error));
    // 앱은 B를 되돌렸지만 ledger는 그것을 모른다. 불명확으로 남고 A는 시작하지 않았다.
    assertEquals(await titlesOf(world.fixture), ["A"]);
    assertEquals(called, [second.invocation]);
    const done = await stored(world, RUN_3);
    assertEquals(done.outcome, "uncertain");
    assertEquals(
      appRows(done).map((
        row,
      ) => [row.app_revert!.invocation, row.result, row.reason]),
      [
        [first.invocation, "unchanged", "app_not_started"],
        [second.invocation, "uncertain", "app_uncertain"],
      ],
    );
    assertEquals(
      count(
        world.server,
        "select count(*) as n from events where type = 'RevertFinished'",
      ),
      1,
    );
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/revert#R11: 앱이 시작 뒤 later change로 거절하면 충돌로 남고, 시작 전 실패(오래된 preview)는 어떤 앱도 부르지 않고 blocked로 남는다", async () => {
  const world = await open();
  try {
    await startRun(world, RUN_4, 4);
    const first = await appWrite(world, RUN_4, 31, "A");
    const second = await appWrite(world, RUN_4, 32, "B");
    await finishRun(world, RUN_4);
    // 사람이 본 판과 다른 판으로 요청하면 시작 전에 막힌다: 어떤 단계도 시작하지 않는다.
    const shown = await preview(world, RUN_4);
    const stale = await okOf(
      apply(world, RUN_4, RVT(4), shown, "f".repeat(64)),
    );
    assertEquals(stale["outcome"], "blocked");
    const blocked = await stored(world, RUN_4);
    assertEquals(blocked.outcome, "blocked");
    assertEquals(
      appRows(blocked).map((row) => [row.result, row.reason]),
      [["unchanged", "stale_preview"], ["unchanged", "stale_preview"]],
    );
    assertEquals(await titlesOf(world.fixture), ["A", "B"]);
    // blocked revert는 단계가 저장돼 있어도 어떤 앱도 부르지 않는다.
    const none: string[] = [];
    const refused = await runAppSteps(
      portsOf(world, RUN_4, { called: none }),
      RVT(4),
    );
    assert(!refused.ok);
    assertEquals(none, []);
    // 새 시도: 그 사이 사람이 앱에서 다른 변경을 했다. revision이 바뀌어 앱이 거절한다(later change).
    const human = await callApp(world.fixture, "add_todo", id("inv", 80), {
      title: "C",
    });
    assert(human.ok);
    const fresh = await preview(world, RUN_4);
    await okOf(apply(world, RUN_4, RVT(5), fresh));
    const called: string[] = [];
    const ran = await runAppSteps(portsOf(world, RUN_4, { called }), RVT(5));
    assert(ran.ok, ran.ok ? "" : JSON.stringify(ran.error));
    assertEquals(called, [second.invocation]);
    assertEquals(await titlesOf(world.fixture), ["A", "B", "C"]);
    const latest = await stored(world, RUN_4, RVT(5));
    assertEquals(latest.outcome, "partial");
    assertEquals(
      appRows(latest).map((
        row,
      ) => [row.app_revert!.invocation, row.result, row.reason]),
      [
        [first.invocation, "unchanged", "app_not_started"],
        [second.invocation, "failure", "later_change"],
      ],
    );
  } finally {
    await world.dispose();
  }
});
