// lophn-agent/harness/tool-judgment#R10, R11: 앱 command의 판정은 active release blueprint의 효과·confirm·
// 되돌리기 선언과 대응 command, 지금의 허락에서 나온다. 판정표(`judge`)에 소유 계약의 사실을 넣는 연결
// (`createAppBinding`)을 본다. approval 생성·허락·한 번 진입의 실제 ledger 흐름은
// apps/core/app-tool-judgment_test.ts가 본다.
import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../../base/mod.ts";
import {
  type AppBlueprintCommand,
  canonicalInputHash,
} from "../../../contracts/apps/mod.ts";
import { computeAgentAppScope } from "../run-loop/mod.ts";
import {
  type AppBlueprintView,
  type AppTool,
  buildAppTools,
  revertCounterpart,
} from "../tools/mod.ts";
import {
  type AppJudgmentPorts,
  type CallFacts,
  createAppBinding,
  judge,
  type ResolvedAction,
} from "./mod.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const GRANT = "grt_01h455vb4pex5v6nkc6gd5fdw1";
const ASSIGNMENT = "asg_01h455vb4pex5v6nkc6gd5fdw1";
const RUN = "run_01h455vb4pex5v6nkc6gd5fdw1";
const CALL = "tcl_01h455vb4pex5v6nkc6gd5fdw1";

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

const AMOUNT = {
  type: "object",
  properties: { amount: { type: "integer", minimum: 1 } },
  required: ["amount"],
  additionalProperties: false,
} as const;

const COMMANDS: AppBlueprintCommand[] = [
  command("read_items", "read"),
  command("audit", "read", { confirm: true }),
  command("add_item", "write", {
    revert: { supported: true, command: "undo_add" },
    input: AMOUNT as never,
  }),
  command("undo_add", "write"),
  command("drop_item", "write"),
  command("ghost_revert", "write", {
    revert: { supported: true, command: "missing" },
  }),
  command("rename_item", "write", {
    description: "Renames an item. You can undo this any time.",
  }),
  command("sync_remote", "external"),
  command("purge", "write", { confirm: true }),
  command("sync_confirmed", "external", { confirm: true }),
  command("add_confirmed", "write", {
    confirm: true,
    revert: { supported: true, command: "undo_add" },
  }),
];

const blueprint = (
  commands = COMMANDS,
  release = RELEASE,
): AppBlueprintView => ({
  app: APP,
  name: "Usage",
  release,
  blueprint_hash: "a".repeat(64),
  commands,
});

async function toolOf(key: string): Promise<AppTool> {
  const view = blueprint();
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
      granted: COMMANDS.map((entry) => entry.key),
    }],
  });
  assert(scope.ok);
  const tools = await buildAppTools({
    scope: scope.value,
    views: [view],
    grants: new Map([[APP, [{
      grant: GRANT,
      commands: COMMANDS.map((entry) => entry.key),
      basis_seq: "0",
    }]]]),
  });
  return tools.find((tool) => tool.command === key)!;
}

type World = {
  view: AppBlueprintView;
  grants: { grant: string; commands: string[]; basis_seq: string }[];
  nonce: ReturnType<typeof ok<string>> | ReturnType<typeof err>;
};

function ports(world: World): AppJudgmentPorts {
  return {
    current: () =>
      Promise.resolve(
        ok({ view: world.view, grants: world.grants }),
      ),
    nonce: () => Promise.resolve(world.nonce as never),
  };
}

function worldOf(): World {
  return {
    view: blueprint(),
    grants: [{
      grant: GRANT,
      commands: COMMANDS.map((entry) => entry.key),
      basis_seq: "0",
    }],
    nonce: ok("n".repeat(32)),
  };
}

const CALLREF = { run: RUN, toolCall: CALL };

// 판정 입력은 소유 계약에서 읽은 사실이다. 읽지 못하면 효과를 모른다(gather와 같은 규칙).
async function judged(key: string, world = worldOf(), input: unknown = {}) {
  const tool = await toolOf(key);
  const binding = createAppBinding(tool, ports(world));
  const resolved = await binding.resolve(input, CALLREF);
  const facts: CallFacts = {
    identity: true,
    assignment: "active",
    run: "active",
    origin: "human_request",
    listed: resolved.ok,
    roleAllows: true,
    connection: "n/a",
    inputValid: true,
    effect: tool.definition.effect,
    confirm: tool.definition.confirm,
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
  return { judgment: judge(facts), resolved };
}

Deno.test("lophn-agent/harness/tool-judgment#R10: confirm 선언은 effect보다 먼저 ask이고 read도 approval 전에는 호출되지 않는다", async () => {
  for (
    const key of [
      "audit",
      "purge",
      "sync_confirmed",
      // 되돌릴 수 있는 write여도 confirm이면 묻는다.
      "add_confirmed",
    ]
  ) {
    const { judgment } = await judged(key);
    assertEquals(judgment.decision, "ask", key);
    assertEquals(judgment.code, "confirm_required", key);
  }
  // confirm read의 효과는 read이고 그래도 allow가 아니다.
  assertEquals((await judged("audit")).judgment.effect, "read");
});

Deno.test("lophn-agent/harness/tool-judgment#R10: confirm 아닌 read는 allow, 되돌리기가 검증된 write는 allow, 나머지 write와 external은 ask다", async () => {
  assertEquals((await judged("read_items")).judgment.decision, "allow");
  const reversible = await judged("add_item", worldOf(), { amount: 1 });
  assertEquals(reversible.judgment.decision, "allow");
  assertEquals(reversible.judgment.effect, "reversible_write");
  for (const key of ["drop_item", "rename_item", "ghost_revert"]) {
    const { judgment } = await judged(key);
    assertEquals(judgment.decision, "ask", key);
    assertEquals(judgment.code, "not_reversible", key);
  }
  const external = await judged("sync_remote");
  assertEquals(external.judgment.decision, "ask");
  assertEquals(external.judgment.code, "external_effect");
  // 되돌리기 대응 command 자체도 지원 선언이 없는 write라 묻는다.
  assertEquals((await judged("undo_add")).judgment.decision, "ask");
});

Deno.test("lophn-agent/harness/tool-judgment#R11: 되돌리기 지원은 선언과 대응 command의 검증으로만 정하고 model의 주장이나 undo 문구로 allow가 되지 않는다", async () => {
  // 설명이 되돌릴 수 있다고 말해도 선언이 없다.
  const prose = await judged("rename_item");
  assertEquals(prose.judgment.decision, "ask");
  // 선언이 지원을 말해도 대응 command가 같은 blueprint에 없으면 지원이 아니다.
  assertEquals((await judged("ghost_revert")).judgment.decision, "ask");
  // 대응 command가 write로 있을 때만 allow이고 판정 근거는 그 대응 command를 남긴다.
  const verified = await judged("add_item", worldOf(), { amount: 2 });
  assertEquals(verified.judgment.decision, "allow");
  assert(verified.resolved.ok);
  assertEquals(
    verified.resolved.value.reversibility,
    "The app declares undo_add to revert it.",
  );
  assertEquals(verified.resolved.value.targets[0].reversibility, "reversible");

  // 지금 blueprint에서 대응 command가 사라지면 정의가 만들어진 때의 지원 선언을 쓰지 않는다.
  const world = worldOf();
  world.view = blueprint(COMMANDS.filter((entry) => entry.key !== "undo_add"));
  const dropped = await judged("add_item", world, { amount: 2 });
  assert(!dropped.resolved.ok);
  assertEquals(dropped.judgment.decision, "deny");
});

Deno.test("lophn-agent/harness/tool-judgment#R10: release·command 계약이 바뀌었거나 허락이 회수됐거나 앱을 읽지 못하면 ask가 아니라 deny다", async () => {
  const replaced = worldOf();
  replaced.view = blueprint(COMMANDS, "rel_01h455vb4pex5v6nkc6gd5fdw2");
  const changed = worldOf();
  changed.view = blueprint(
    COMMANDS.map((entry) =>
      entry.key === "read_items" ? { ...entry, description: "changed" } : entry
    ),
  );
  const revoked = worldOf();
  revoked.grants = [{
    grant: GRANT,
    commands: COMMANDS.map((entry) => entry.key).filter((key) =>
      key !== "read_items"
    ),
    basis_seq: "0",
  }];
  const gone = worldOf();
  gone.grants = [];
  for (const world of [replaced, changed, revoked, gone]) {
    // 읽기 command도 ask가 아니라 deny다. 한 번 승인으로 열지 않는다.
    const { judgment, resolved } = await judged("read_items", world);
    assert(!resolved.ok);
    assertEquals(judgment.decision, "deny");
  }
  // 앱을 읽지 못한 것은 없는 앱과 같은 deny다.
  const tool = await toolOf("read_items");
  const unreadable = createAppBinding(tool, {
    current: () => Promise.resolve(err({ code: "not_found", message: "x" })),
    nonce: () => Promise.resolve(ok("n")),
  });
  assert(!(await unreadable.resolve({}, CALLREF)).ok);
});

Deno.test("lophn-agent/harness/tool-judgment#R10: confirm command의 approval 동작은 접수 command 자체라 사전 질문과 앱의 confirm이 approval 하나를 쓴다", async () => {
  const { resolved } = await judged("add_confirmed");
  assert(resolved.ok);
  const action: ResolvedAction = resolved.value;
  assertEquals(action.concern, "apps/invocations");
  assertEquals(action.operation, "invocation.accept_confirm");
  const accept = action.confirm!;
  assertEquals(accept.app, APP);
  assertEquals(accept.release, RELEASE);
  assertEquals(accept.command, "add_confirmed");
  // 접수는 인증된 run·ToolCall이 호출자이고 정확한 입력의 정규 hash와 지금 process에 묶인다.
  assertEquals(accept.caller, { kind: "agent", run: RUN, tool_call: CALL });
  assertEquals(accept.process_nonce, "n".repeat(32));
  const hashed = await canonicalInputHash(null, undefined);
  assert(hashed.ok);
  assertEquals(accept.input_hash, hashed.value);
  // 같은 호출을 다시 풀어도 같은 접수 입력이다(재시도·복구가 두 번째 approval을 만들지 않는다).
  const again = await judged("add_confirmed");
  assert(again.resolved.ok);
  assertEquals(again.resolved.value.confirm, accept);
  // confirm이 아닌 command는 접수 입력이 없다.
  const plain = await judged("add_item", worldOf(), { amount: 1 });
  assert(plain.resolved.ok);
  assertEquals(plain.resolved.value.confirm, undefined);
  // process nonce를 알 수 없으면(앱이 떠 있지 않음) 열지 않는다.
  const world = worldOf();
  world.nonce = err({ code: "unavailable", message: "down" });
  const down = await judged("add_confirmed", world);
  assert(!down.resolved.ok);
  assertEquals(down.judgment.decision, "deny");
});

Deno.test("lophn-agent/harness/tool-judgment#R10: ticket 취소처럼 되돌릴 수 있는 lophn 안쪽 변경은 앱 command 규칙과 무관하게 묻지 않는다", () => {
  // ticket 취소 tool은 ticket 작업(T49)이 정한다. 소유 계약이 되돌릴 수 있다고 하면 사람 요청에서는 allow이고
  // ask 대상이 아니다.
  const facts: CallFacts = {
    identity: true,
    assignment: "active",
    run: "active",
    origin: "human_request",
    listed: true,
    roleAllows: true,
    connection: "n/a",
    inputValid: true,
    effect: "write",
    confirm: false,
    refused: false,
    targets: [{
      id: "tkt_01h455vb4pex5v6nkc6gd5fdw1",
      inScope: true,
      reversibility: "reversible",
      declared: false,
    }],
  };
  assertEquals(judge(facts).decision, "allow");
});
