// lophn-agent/harness/tools#R18, tool-judgment#R12, roles/lophn#R23: 앱이 선언한 현재 화면 context의 상세
// 조회와 힌트·주석 되쓰기. 매 turn 요약은 2 KiB, 상세는 선언한 read command, 되쓰기는 선언한 write command·
// 허락·자리·현재 화면 revision 안에서만 열리고 나머지는 approval 없이 deny다. 앱 쪽은 fixture blueprint와 앱
// 통로 대역으로 본다.
import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../../base/mod.ts";
import type { AppBlueprintCommand } from "../../../contracts/apps/mod.ts";
import { computeAgentAppScope } from "../run-loop/mod.ts";
import { buildTurnContext } from "../prompt-assemble/mod.ts";
import {
  type AppBlueprintView,
  type AppContextPorts,
  type AppGrant,
  type AppInvokeCall,
  type AppInvokeOutcome,
  appScreenContextTool,
  buildAppContextTools,
  createAppContextToolHandlers,
  executeTool,
  listTools,
  revertCounterpart,
  type RunCredential,
} from "../tools/mod.ts";
import { lophnTools } from "../../roles/lophn/mod.ts";
import {
  type AppContextJudgmentPorts,
  type CallFacts,
  createAnnotateBinding,
  createScreenContextBinding,
  judge,
  type ToolBinding,
} from "./mod.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const GRANT = "grt_01h455vb4pex5v6nkc6gd5fdw1";
const ASSIGNMENT = "asg_01h455vb4pex5v6nkc6gd5fdw1";
const RUN = "run_01h455vb4pex5v6nkc6gd5fdw1";
const CALL = "tcl_01h455vb4pex5v6nkc6gd5fdw1";
const INVOCATION = "inv_01h455vb4pex5v6nkc6gd5fdw1";
const SESSION = "view-session-1";
const REVISION = "rev-7";

const READ_INPUT = {
  type: "object",
  properties: {
    screen: { type: "string" },
    view_session: { type: "string" },
    detail: { type: "boolean" },
  },
  required: ["screen", "view_session"],
  additionalProperties: false,
} as const;
const WRITE_INPUT = {
  type: "object",
  properties: {
    screen: { type: "string" },
    view_session: { type: "string" },
    expected_revision: { type: "string" },
    target: { type: "string" },
    text: { type: "string" },
  },
  required: ["screen", "view_session", "expected_revision", "target", "text"],
  additionalProperties: false,
} as const;

function command(
  key: string,
  effect: AppBlueprintCommand["effect"],
  over: Partial<AppBlueprintCommand> = {},
): AppBlueprintCommand {
  return {
    key,
    label: key,
    description: `${key} does one thing`,
    effect,
    confirm: false,
    input: null,
    revert: { supported: false },
    ...over,
  };
}

const COMMANDS: AppBlueprintCommand[] = [
  command("read_screen", "read", { input: READ_INPUT as never }),
  command("write_hint", "write", {
    input: WRITE_INPUT as never,
    revert: { supported: true, command: "undo_hint" },
  }),
  command("undo_hint", "write"),
  command("write_note", "write", { input: WRITE_INPUT as never }),
  command("write_confirmed", "write", {
    input: WRITE_INPUT as never,
    confirm: true,
  }),
  command("read_other", "read", { input: READ_INPUT as never }),
  command("wrong_shape", "write", { input: null }),
];

const BLUEPRINT = (
  commands = COMMANDS,
  agentContext?: AppBlueprintView["agent_context"],
): AppBlueprintView => ({
  app: APP,
  name: "Coding test",
  release: RELEASE,
  blueprint_hash: "a".repeat(64),
  commands,
  screens: [{ key: "code", sizes: ["full", "panel"] }],
  agent_context: agentContext ?? [{
    screen: "code",
    read_command: "read_screen",
    annotation_targets: [
      { key: "hint", label: "Hint", write_command: "write_hint" },
      { key: "note", label: "Note", write_command: "write_note" },
      {
        key: "confirmed",
        label: "Confirmed",
        write_command: "write_confirmed",
      },
      { key: "ghost", label: "Ghost", write_command: "missing" },
      { key: "wrong", label: "Wrong shape", write_command: "wrong_shape" },
    ],
  }],
});

function scopeOf(granted: readonly string[]) {
  const scope = computeAgentAppScope({
    role: "lophn",
    assignment: ASSIGNMENT,
    work: { kind: "all", id: null },
    read_apps: [],
    read_commands: [],
    offers: [{
      app: APP,
      commands: COMMANDS.map((entry) => ({
        key: entry.key,
        effect: entry.effect,
        confirm: entry.confirm,
        revert_supported: revertCounterpart(COMMANDS, entry) !== null,
      })),
      granted,
    }],
  });
  assert(scope.ok);
  return scope.value;
}

const ALL = COMMANDS.map((entry) => entry.key);
const ctx = (over: Record<string, unknown> = {}) => ({
  app: APP,
  release: RELEASE,
  screen: "code",
  view_session: SESSION,
  revision: REVISION,
  summary: "Editing two_sum.py, attempt 3 failed on the empty list.",
  data: { code: "def two_sum(nums): ...", attempts: [1, 2, 3] },
  redacted: ["/token"],
  ...over,
});

type World = {
  view: AppBlueprintView;
  grants: AppGrant[];
  revision: string | null;
  screen: Record<string, unknown> | null;
  invoked: AppInvokeCall[];
  outcome: AppInvokeOutcome;
};

function worldOf(): World {
  return {
    view: BLUEPRINT(),
    grants: [{ grant: GRANT, commands: ALL, basis_seq: "1" }],
    revision: REVISION,
    screen: ctx(),
    invoked: [],
    outcome: { kind: "unknown" },
  };
}

function ports(world: World): AppContextPorts & AppContextJudgmentPorts {
  return {
    current: () =>
      Promise.resolve(ok({ view: world.view, grants: world.grants })),
    currentRevision: () => Promise.resolve(ok(world.revision)),
    invoke(call) {
      world.invoked.push(call);
      if (call.command === "read_screen") {
        return Promise.resolve(ok({
          kind: "result",
          result: world.screen,
          invocation: INVOCATION,
          revert: null,
          source: null,
        }));
      }
      return Promise.resolve(ok(world.outcome));
    },
    status: () => Promise.resolve(err({ code: "unavailable", message: "x" })),
  };
}

const credential: RunCredential = {
  run: RUN,
  targets: new Set([APP]),
  operations: new Set(),
  call: CALL,
};

const READ_ARGS = { app: APP, screen: "code", view_session: SESSION };
const WRITE_ARGS = {
  ...READ_ARGS,
  expected_revision: REVISION,
  target: "hint",
  text: "Try the empty list first.",
};

// ---- 매 turn 요약 (tools R18) ----

Deno.test("lophn-agent/harness/tools#R18: turn마다 초점 앱 요약은 2 KiB까지 싣고 넘으면 싣지 않으며 상세는 자동으로 붙지 않는다", async () => {
  const deps = { redact: (text: string) => text };
  const view = (summary: string) => ({
    collected_at: "2026-10-06T01:02:03Z",
    timezone: "Asia/Seoul",
    view: {
      availability: "current" as const,
      observed_at: "2026-10-06T01:02:00Z",
      generation: 1,
      summary,
    },
    tabs: [{
      kind: "app_panel" as const,
      key: "tab-1",
      selected: true,
      app: APP,
      surface: "code",
    }] as never,
  });
  const exact = "가".repeat(682) + "ab"; // 2048 bytes
  assertEquals(new TextEncoder().encode(exact).byteLength, 2048);
  const fits = await buildTurnContext(deps, view(exact));
  assertEquals(fits.basis.app_summary, { included: true, bytes: 2048 });
  assert(fits.text!.includes(exact));
  const over = await buildTurnContext(deps, view(exact + "c"));
  assertEquals(over.basis.app_summary, { included: false, bytes: 0 });
  assert(over.basis.unavailable.includes("app_summary_over_limit"));
  // 상세는 앱 read tool로 읽는다고 알리고 상세 본문은 싣지 않는다.
  assert(over.text!.includes("상세는 앱 read tool로 읽는다"));
  assert(!over.text!.includes("가가가"));
  // 요약을 안전화하지 못하면 원문 대신 생략 사실이다.
  const failed = await buildTurnContext(
    { redact: () => null },
    view("secret summary"),
  );
  assertEquals(failed.basis.app_summary.included, false);
  assert(!failed.text!.includes("secret summary"));
});

// ---- 상세 조회 (tools R18) ----

Deno.test("lophn-agent/harness/tools#R18: 상세 조회는 선언한 read command를 그대로 부르고 요약만 받은 호출에는 자료가 없다", async () => {
  const world = worldOf();
  const handlers = createAppContextToolHandlers(scopeOf(ALL), ports(world));
  const handler = handlers.get("app.screen_context")!;
  const summary = await handler(READ_ARGS, credential);
  assert(summary.ok);
  const content = summary.value.content as Record<string, unknown>;
  assertEquals(content["availability"], "current");
  assertEquals(content["revision"], REVISION);
  assertEquals(content["summary"], ctx().summary);
  assertEquals("data" in content, false);
  // 앱에는 선언한 command 하나만, 선언한 입력 그대로 갔다(별도 DOM·입력 통로 없음).
  assertEquals(world.invoked.length, 1);
  assertEquals(world.invoked[0]!.command, "read_screen");
  assertEquals(world.invoked[0]!.input, {
    screen: "code",
    view_session: SESSION,
    detail: false,
  });
  assertEquals(world.invoked[0]!.release, RELEASE);

  const detail = await handler({ ...READ_ARGS, detail: true }, credential);
  assert(detail.ok);
  assertEquals(
    (detail.value.content as Record<string, unknown>)["data"],
    ctx().data,
  );
  assertEquals(world.invoked[1]!.input, {
    screen: "code",
    view_session: SESSION,
    detail: true,
  });
});

Deno.test("lophn-agent/harness/tools#R18: 선언하지 않은 화면과 허락 없는 read command는 앱을 부르지 않고 없는 것과 같은 답이다", async () => {
  const world = worldOf();
  const handler = createAppContextToolHandlers(scopeOf(ALL), ports(world)).get(
    "app.screen_context",
  )!;
  const undeclared = await handler(
    { ...READ_ARGS, screen: "secret" },
    credential,
  );
  assert(!undeclared.ok);
  assertEquals(undeclared.error.code, "not_found");
  world.grants = [{ grant: GRANT, commands: ["write_hint"], basis_seq: "1" }];
  const revoked = await handler(READ_ARGS, credential);
  assert(!revoked.ok);
  assertEquals(revoked.error, undeclared.error);
  assertEquals(world.invoked.length, 0);
});

Deno.test("lophn-agent/harness/tools#R18: 앱이 다른 화면·view session·release의 상태를 돌려주면 지금 화면으로 넘기지 않는다", async () => {
  for (
    const stale of [
      ctx({ view_session: "view-session-2" }),
      ctx({ screen: "history" }),
      ctx({ release: "rel_01h455vb4pex5v6nkc6gd5fdw2" }),
      null,
    ]
  ) {
    const world = worldOf();
    world.screen = stale;
    const handler = createAppContextToolHandlers(scopeOf(ALL), ports(world))
      .get("app.screen_context")!;
    const read = await handler(READ_ARGS, credential);
    assert(read.ok);
    const content = read.value.content as Record<string, unknown>;
    assertEquals(content["availability"], "unavailable");
    assertEquals("summary" in content, false);
  }
});

Deno.test("lophn-agent/harness/tools#R18: 되쓰기는 선언한 write command와 자리로 정확한 입력만 보내고 선언 밖 자리는 앱을 부르지 않는다", async () => {
  const world = worldOf();
  world.outcome = {
    kind: "result",
    result: { applied: true },
    invocation: INVOCATION,
    revert: null,
    source: null,
  };
  const handler = createAppContextToolHandlers(scopeOf(ALL), ports(world)).get(
    "app.annotate",
  )!;
  const written = await handler(WRITE_ARGS, credential);
  assert(written.ok);
  assertEquals(written.value.status, "success");
  assertEquals(world.invoked.length, 1);
  assertEquals(world.invoked[0]!.command, "write_hint");
  assertEquals(world.invoked[0]!.input, {
    screen: "code",
    view_session: SESSION,
    expected_revision: REVISION,
    target: "hint",
    text: "Try the empty list first.",
  });
  // 선언하지 않은 자리·화면, 입력 모양이 맞지 않는 command, 사람 확인 command는 호출이 없다.
  for (
    const args of [
      { ...WRITE_ARGS, target: "title" },
      { ...WRITE_ARGS, screen: "history" },
      { ...WRITE_ARGS, target: "ghost" },
      { ...WRITE_ARGS, target: "wrong" },
      { ...WRITE_ARGS, target: "confirmed" },
    ]
  ) {
    const refused = await handler(args, credential);
    assert(!refused.ok, JSON.stringify(args));
    assertEquals(refused.error.code, "not_found");
  }
  assertEquals(world.invoked.length, 1);
  // 응답을 잃으면 적용됐다고 하지 않고 자동으로 반복하지 않는다.
  world.outcome = { kind: "unknown" };
  const lost = await handler(WRITE_ARGS, { ...credential, call: "tcl_2" });
  assert(lost.ok);
  assertEquals(lost.value.status, "uncertain");
  assertEquals(world.invoked.length, 2);
});

Deno.test("lophn-agent/harness/tools#R18: 실행기는 입력이 정의의 schema와 다르면 앱 통로를 부르기 전에 거절한다", async () => {
  const world = worldOf();
  const scope = scopeOf(ALL);
  const listed = listTools(
    {
      builtin: [],
      app: buildAppContextTools({
        scope,
        views: [world.view],
        grants: new Map([[APP, world.grants]]),
      }),
      external: [],
    },
    { presetTools: [], roleTools: [] },
  );
  assertEquals(listed.map((tool) => tool.name), [
    "app.screen_context",
    "app.annotate",
  ]);
  const outcome = await executeTool(
    {
      listed,
      handlers: createAppContextToolHandlers(scope, ports(world)),
      credential,
    },
    "app.screen_context",
    { ...READ_ARGS, extra: true },
  );
  assertEquals(outcome.executed, false);
  assertEquals(world.invoked.length, 0);
});

// ---- 정의 목록 (roles/lophn R23) ----

Deno.test("lophn-agent/roles/lophn#R23: 사람이 허락한 command의 화면 context만 정의가 되고 허락이 없으면 목록에 없다", () => {
  const names = (granted: readonly string[]) =>
    buildAppContextTools({
      scope: scopeOf(granted),
      views: [BLUEPRINT()],
      grants: new Map([[
        APP,
        granted.length === 0 ? [] : [{
          grant: GRANT,
          commands: [...granted],
          basis_seq: "1",
        }],
      ]]),
    }).map((tool) => tool.name);
  assertEquals(names(ALL), ["app.screen_context", "app.annotate"]);
  // 읽기만 허락하면 되쓰기 정의는 없다.
  assertEquals(names(["read_screen"]), ["app.screen_context"]);
  // 쓰기만 허락하면 조회 정의는 없다.
  assertEquals(names(["write_hint", "undo_hint"]), ["app.annotate"]);
  // 허락이 하나도 없으면 아무것도 없다.
  assertEquals(names([]), []);
  // 선언하지 않은 앱 화면은 허락이 있어도 없다.
  assertEquals(
    buildAppContextTools({
      scope: scopeOf(ALL),
      views: [{ ...BLUEPRINT(), agent_context: [] }],
      grants: new Map([[APP, [{
        grant: GRANT,
        commands: ALL,
        basis_seq: "1",
      }]]]),
    }).map((tool) => tool.name),
    [],
  );
  // 두 정의는 내장 tool이 아니라 앱 통로의 정의라 역할 선택 목록(lophn tool 목록)에 따로 더해지지 않는다.
  assertEquals(
    lophnTools(["app.screen_context", "app.annotate"]).map((tool) => tool.name),
    [],
  );
});

// ---- 되쓰기 판정 (tool-judgment R12) ----

type Judged = {
  decision: string;
  code: string;
  effect: string | null;
  resolved: boolean;
};

async function judged(
  binding: ToolBinding,
  effect: "read" | "write",
  input: unknown,
  confirm = false,
): Promise<Judged> {
  const resolved = await binding.resolve(input, {
    run: RUN,
    toolCall: CALL,
  });
  const facts: CallFacts = {
    identity: true,
    assignment: "active",
    run: "active",
    origin: "human_request",
    listed: resolved.ok,
    roleAllows: true,
    connection: "n/a",
    inputValid: true,
    effect,
    confirm,
    refused: false,
    targets: resolved.ok
      ? resolved.value.targets.map((target) => ({
        id: target.id,
        inScope: true,
        reversibility: target.reversibility,
        declared: false,
      }))
      : [],
  };
  const judgment = judge(facts);
  return {
    decision: judgment.decision,
    code: judgment.code,
    effect: judgment.effect,
    resolved: resolved.ok,
  };
}

Deno.test("lophn-agent/harness/tool-judgment#R12: 되돌릴 수 있는 주석은 묻지 않고 바로 쓰고 되돌릴 수 없는 주석은 묻는다", async () => {
  const world = worldOf();
  const binding = createAnnotateBinding(scopeOf(ALL), ports(world));
  const reversible = await judged(binding, "write", WRITE_ARGS);
  assertEquals(reversible.decision, "allow");
  assertEquals(reversible.effect, "reversible_write");
  // 대응 command(undo_hint)가 없는 write command의 자리는 되돌릴 수 없어 묻는다.
  const note = await judged(binding, "write", {
    ...WRITE_ARGS,
    target: "note",
  });
  assertEquals(note.decision, "ask");
  assertEquals(note.code, "not_reversible");
});

Deno.test("lophn-agent/harness/tool-judgment#R12: 선언 밖 write command·허락·자리·현재 화면 기준이 맞지 않으면 approval 없이 deny다", async () => {
  const deny = async (
    mutate: (world: World) => void,
    args: Record<string, unknown> = WRITE_ARGS,
    scope = scopeOf(ALL),
  ) => {
    const world = worldOf();
    mutate(world);
    const result = await judged(
      createAnnotateBinding(scope, ports(world)),
      "write",
      args,
    );
    assertEquals(result.decision, "deny");
    assertEquals(result.resolved, false);
  };
  // 낡은 화면: 조회한 뒤 사람이 코드를 바꿨다.
  await deny((world) => (world.revision = "rev-8"));
  // 화면이 닫혔다(view session을 더는 알 수 없다).
  await deny((world) => (world.revision = null));
  // 선언하지 않은 화면과 자리, 선언한 자리가 가리키는 command가 없거나 입력 모양이 다르다.
  await deny(() => {}, { ...WRITE_ARGS, screen: "history" });
  await deny(() => {}, { ...WRITE_ARGS, target: "title" });
  await deny(() => {}, { ...WRITE_ARGS, target: "ghost" });
  await deny(() => {}, { ...WRITE_ARGS, target: "wrong" });
  // 현재 허락을 거뒀다.
  await deny((world) =>
    world.grants = [{
      grant: GRANT,
      commands: ALL.filter((key) => key !== "write_hint"),
      basis_seq: "1",
    }]
  );
  await deny((world) => world.grants = []);
  // 앱의 release가 바뀌어 선언이 달라졌다.
  await deny((world) =>
    world.view = BLUEPRINT(COMMANDS, [{
      screen: "code",
      read_command: "read_screen",
      annotation_targets: [],
    }])
  );
  // 사람 확인을 요구하는 write command는 이 통로가 열지 않는다(앱 command tool의 사람 확인 갈래).
  await deny(() => {}, { ...WRITE_ARGS, target: "confirmed" });
  // 이 역할의 scope가 write를 열지 않았다.
  await deny(() => {}, WRITE_ARGS, scopeOf(["read_screen"]));
  // 읽지 못한 앱은 없는 앱과 같다.
  const unreadable = createAnnotateBinding(scopeOf(ALL), {
    current: () => Promise.resolve(err({ code: "not_found", message: "x" })),
    currentRevision: () => Promise.resolve(ok(REVISION)),
  });
  assert(
    !(await unreadable.resolve(WRITE_ARGS, { run: RUN, toolCall: CALL })).ok,
  );
});

Deno.test("lophn-agent/harness/tool-judgment#R12: 같은 현재 화면 기준은 판정 비교 근거에 남고 다른 revision은 다른 근거다", async () => {
  const world = worldOf();
  const binding = createAnnotateBinding(scopeOf(ALL), ports(world));
  const call = { run: RUN, toolCall: CALL };
  const first = await binding.resolve(WRITE_ARGS, call);
  const again = await binding.resolve(WRITE_ARGS, call);
  assert(first.ok && again.ok);
  assertEquals(first.value.comparison, again.value.comparison);
  assertEquals(first.value.comparison["revision"], REVISION);
  assertEquals(first.value.comparison["target"], "hint");
  assertEquals(first.value.operation, "app.command");
  // 사람이 화면을 바꾸면 같은 입력은 풀리지 않아 옛 허락·옛 판정으로 진입하지 못한다.
  world.revision = "rev-8";
  assert(!(await binding.resolve(WRITE_ARGS, call)).ok);
});

Deno.test("lophn-agent/harness/tool-judgment#R12: 화면 조회는 선언한 read command와 현재 허락 안에서만 allow이고 그 밖은 deny다", async () => {
  const world = worldOf();
  const binding = createScreenContextBinding(scopeOf(ALL), ports(world));
  const read = await judged(binding, "read", READ_ARGS);
  assertEquals(read.decision, "allow");
  assertEquals(read.effect, "read");
  // 선언하지 않은 화면.
  assertEquals(
    (await judged(binding, "read", { ...READ_ARGS, screen: "history" }))
      .decision,
    "deny",
  );
  // 허락을 거둔 read command.
  world.grants = [{ grant: GRANT, commands: ["write_hint"], basis_seq: "1" }];
  assertEquals((await judged(binding, "read", READ_ARGS)).decision, "deny");
  // 정의의 입력 schema는 detail에 default를 채우지 않는다.
  assertEquals(appScreenContextTool.input.safeParse(READ_ARGS).success, true);
});
