// app_engineer 역할의 tool 선택과 담당 앱 command 범위(roles/app-engineer#R5, R6,
// R21). 목록은 AE 상한과 preset 교집합이고(appEngineerTools), 앱 command는
// blueprint 정의와 AgentAppScope의 교집합이다(computeAgentAppScope). 실제
// core·provider·사람 데이터 root는 부르지 않는다.
import { assert, assertEquals } from "@std/assert";
import { err, type LophnError, ok, type Result } from "../../../../base/mod.ts";
import type {
  AppBlueprintCommand,
  Invocation,
} from "../../../../protocol/apps/mod.ts";
import type { AgentRole } from "../../../../protocol/lophn-agent/mod.ts";
import { computeAgentAppScope } from "../../run-loop/mod.ts";
import {
  type AppBlueprintView,
  type AppGrant,
  type AppInvokeCall,
  type AppInvokeOutcome,
  type AppTool,
  buildAppTools,
  createAppToolHandlers,
  executeTool,
  listTools,
  revertCounterpart,
  type RunCredential,
} from "../../tools/mod.ts";
import { BUILTIN_TOOLS, DOCUMENT_WRITE_TOOL_NAMES } from "../../tools/mod.ts";
import {
  type AppJudgmentPorts,
  type CallFacts,
  createAppBinding,
  judge,
} from "../../tool-judgment/mod.ts";
import { APP_COMMAND_EXPOSURE, ROLE_CAPS } from "../../agents/mod.ts";
import { appEngineerOffers, appEngineerTools } from "./mod.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const OTHER_APP = "app_01h455vb4pex5v6nkc6gd5fdw2";
const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const GRANT = "grt_01h455vb4pex5v6nkc6gd5fdw1";
const ASSIGNMENT = "asg_01h455vb4pex5v6nkc6gd5fdw1";
const RUN = "run_01h455vb4pex5v6nkc6gd5fdw1";
const CALL = "tcl_01h455vb4pex5v6nkc6gd5fdw1";
const INVOCATION = "inv_01h455vb4pex5v6nkc6gd5fdw1";

// --- 앱 command fixture(harness/tools/app_tools_test.ts와 같은 모양) ------------

function command(
  key: string,
  effect: AppBlueprintCommand["effect"],
  over: Partial<AppBlueprintCommand> = {},
): AppBlueprintCommand {
  return {
    key,
    label: `${key} label`,
    description: `${key} does one thing`,
    effect,
    confirm: false,
    input: null,
    revert: { supported: false },
    ...over,
  };
}

const LIMIT_INPUT = {
  type: "object",
  description: "which items",
  properties: {
    limit: { type: "integer", minimum: 1, description: "how many" },
  },
  required: ["limit"],
  additionalProperties: false,
} as const;

const COMMANDS: AppBlueprintCommand[] = [
  command("read_items", "read", { input: LIMIT_INPUT as never }),
  command("audit", "read", { confirm: true }),
  command("add_item", "write", {
    revert: { supported: true, command: "undo_add" },
    input: LIMIT_INPUT as never,
  }),
  command("undo_add", "write"),
  command("add_confirmed", "write", {
    confirm: true,
    revert: { supported: true, command: "undo_add" },
  }),
  command("drop_item", "write"),
  command("sync_remote", "external"),
  command("purge", "write", { confirm: true }),
];

function view(
  over: Partial<AppBlueprintView> = {},
  commands = COMMANDS,
): AppBlueprintView {
  return {
    app: APP,
    name: "Usage",
    release: RELEASE,
    blueprint_hash: "a".repeat(64),
    commands,
    ...over,
  };
}

const ALL_KEYS = COMMANDS.map((entry) => entry.key);

function grants(commands: readonly string[] = ALL_KEYS) {
  const list: AppGrant[] = [{ grant: GRANT, commands, basis_seq: "1" }];
  return new Map<string, readonly AppGrant[]>([[APP, list]]);
}

function offerOf(blueprint: AppBlueprintView, granted: readonly string[]) {
  return {
    app: blueprint.app,
    commands: blueprint.commands.map((entry) => ({
      key: entry.key,
      effect: entry.effect,
      confirm: entry.confirm,
      revert_supported: revertCounterpart(blueprint.commands, entry) !== null,
    })),
    granted,
  };
}

async function toolsFor(
  role: AgentRole,
  options: {
    blueprint?: AppBlueprintView;
    granted?: readonly string[];
    work?: { kind: "all" | "project" | "app"; id: string | null };
  } = {},
): Promise<readonly AppTool[]> {
  const blueprint = options.blueprint ?? view();
  const granted = options.granted ?? ALL_KEYS;
  const scope = computeAgentAppScope({
    role,
    assignment: ASSIGNMENT,
    work: options.work ??
      (role === "app_engineer"
        ? { kind: "app", id: APP }
        : { kind: "all", id: null }),
    read_apps: role === "operator" ? [APP] : [],
    read_commands: [],
    offers: [offerOf(blueprint, granted)],
  });
  assert(scope.ok, scope.ok ? "" : scope.error.message);
  return await buildAppTools({
    scope: scope.value,
    views: [blueprint],
    grants: grants(granted),
  });
}

function keysOf(tools: readonly AppTool[]): string[] {
  return tools.map((tool) => tool.command).sort();
}

function fixturePorts() {
  const invoked: AppInvokeCall[] = [];
  const state: { outcome: Result<AppInvokeOutcome> } = {
    outcome: ok({
      kind: "result",
      result: { items: [1, 2] },
      invocation: INVOCATION,
      revert: null,
      source: { coverage: "complete", freshness: "fresh", continuation: null },
    }),
  };
  const ports = {
    invoke(call: AppInvokeCall) {
      invoked.push(call);
      return Promise.resolve(state.outcome);
    },
    status(_call: unknown) {
      return Promise.resolve(
        err<LophnError>({ code: "unavailable", message: "no status" }),
      );
    },
    call() {
      return Promise.resolve(
        ok({ invocations: [] as Invocation[], next_cursor: null } as never),
      );
    },
  };
  return { ports, invoked, state };
}

function credential(): RunCredential {
  return {
    run: RUN,
    targets: new Set([APP]),
    operations: new Set(["app.connect"]),
    call: CALL,
  };
}

// --- AE 목록 ---------------------------------------------------------------

function listedForAE(): readonly { name: string }[] {
  const cap = ROLE_CAPS.get("app_engineer");
  assert(cap !== undefined);
  return appEngineerTools(cap.tools);
}

Deno.test("lophn-agent/roles/app-engineer#R5: AE 목록은 담당 범위 조회·검사와 document 저장, 시각, 질문·handoff로 한정된다", () => {
  const cap = ROLE_CAPS.get("app_engineer");
  assert(cap !== undefined);
  const listed = listedForAE();
  assert(listed.length > 0);
  // 목록 자체는 상한과 preset 선택의 교집합이다(R5). 상한을 그대로 preset
  // 선택으로 주면 상한 안의 내장 tool만 남는다(아직 정의가 없는 이름은 제외).
  assertEquals(
    listTools(
      { builtin: BUILTIN_TOOLS, app: [], external: [] },
      { presetTools: cap.tools, roleTools: cap.tools },
    ),
    appEngineerTools(cap.tools),
  );
  // 담당 범위의 조회·검사 읽기가 있다(R5).
  for (
    const name of [
      "project.read",
      "app.read",
      "app.blueprint",
      "app.commands",
      "app.releases",
      "app.health",
      "app.invocations",
      "problem.list",
      "problem.read",
      "report.read",
      "snapshot.read",
      "verification.read",
      "repair.read",
      "assignment.read",
      "run.read_result",
      "handoff.read_status",
      "handoff.read_result",
      "document.list",
      "document.outline",
      "document.search",
      "format.list",
      "format.validate",
      "question.submit",
      "question.read_decision",
      "approval.read_decision",
      "visual.show",
      "visual.read",
      "visual.prepare_document",
      "document.create",
      "document.save_version",
      "handoff.submit",
    ]
  ) {
    assert(
      listed.some((tool) => tool.name === name),
      `app_engineer lists ${name}`,
    );
  }
});

Deno.test("lophn-agent/roles/app-engineer#R5: 맡지 않는 일 blueprint 수정·문서 이동 컨텍스트 편집은 상한 어디에도 없다", () => {
  const cap = ROLE_CAPS.get("app_engineer")!;
  const listed = listedForAE();
  const listedNames = new Set(listed.map((tool) => tool.name));
  for (
    const absent of [
      // blueprint 원본 수정과 그 사본은 App Engineer tool이 아니다(R5, R12).
      "app.blueprint.revise",
      "app.blueprint.update",
      // 문서 이동·이름 변경·삭제·보관은 documents 사람 경로다.
      "document.move",
      "document.rename",
      "document.delete",
      "document.archive",
      // assignment 변경과 승인 적용은 assignments 몫이다.
      "assignment.create",
      "assignment.pause",
      "assignment.resume",
      "assignment.withdraw",
      "assignment.change_preset",
      "approval.apply_assignment",
      // ticket 수정·공개·취소·claim·연장·release 연결은 coding-agent 작업 경로다.
      "ticket.update",
      "ticket.close",
      "ticket.cancel",
      "ticket.claim",
      "ticket.report",
      "ticket.start",
      "ticket.link_release",
      // claim·연장·coding 요청 직접 실행도 없다.
      "task.claim",
      "task.start",
      "task.complete",
    ]
  ) {
    assert(!cap.tools.includes(absent), `${absent} in role cap`);
    assertEquals(
      listedNames.has(absent),
      false,
      `${absent} in the listed set`,
    );
  }
});

Deno.test("lophn-agent/roles/app-engineer#R5: 상한의 해석 참조 선택은 정의가 서면 목록에 오른다(T50)", () => {
  const cap = ROLE_CAPS.get("app_engineer")!;
  const listed = listedForAE();
  // problem.set_interpretation의 정의는 T50이 뒀다.
  for (const name of ["problem.set_interpretation"]) {
    assert(cap.tools.includes(name), `${name} is in the AE cap`);
    assert(
      listed.some((tool) => tool.name === name),
      `app_engineer lists ${name}`,
    );
  }
  // ticket 읽기·생성·전환은 정의가 있어 목록에 오른다.
  for (
    const name of [
      "ticket.list",
      "ticket.read",
      "ticket.create",
      "ticket.make_ready",
    ]
  ) {
    assert(cap.tools.includes(name), `${name} is in the AE cap`);
    assert(listed.some((tool) => tool.name === name), `${name} is listed`);
  }
  // 상한 밖 이름은 제공하지 않는다(fail closed).
  assertEquals(appEngineerOffers("subagent"), false);
  assertEquals(appEngineerOffers("shell"), false);
});

Deno.test("lophn-agent/roles/app-engineer#R6: AE 기본 preset 선택이 고정되지 않으면 목록은 빈다", () => {
  assertEquals(appEngineerTools(null), []);
  assertEquals(appEngineerTools([]), []);
});

Deno.test("lophn-agent/roles/app-engineer#R6: 되돌릴 수 있는 설계 문서 저장은 approval을 묻지 않는다", () => {
  // 요청 범위 문서 저장 tool은 되돌릴 수 있고 idempotent이며(confirm 선언이
  // 없어 approval request를 기다리지 않는다) 묶음 이름은 document.create·
  // document.save_version뿐이다(R6).
  const writeNames = [...DOCUMENT_WRITE_TOOL_NAMES];
  assertEquals(writeNames.sort(), ["document.create", "document.save_version"]);
  const builtin = BUILTIN_TOOLS.filter((tool) =>
    writeNames.includes(tool.name)
  );
  assertEquals(builtin.length, 2);
  for (const tool of builtin) {
    assertEquals(tool.effect, "write", tool.name);
    assertEquals(tool.reversible, true, tool.name);
    assertEquals(tool.idempotent, true, tool.name);
    // 저장은 매번 approval request를 묻지 않는다(R6).
    assertEquals(tool.confirm, false, tool.name);
    const listed = listedForAE().some((entry) => entry.name === tool.name);
    assert(listed, `app_engineer lists ${tool.name}`);
  }
});

Deno.test("lophn-agent/roles/app-engineer#R21: 앱 command 노출은 담당 앱의 허락된 read와 실제 되돌리기 지원 write만이다", async () => {
  // external·복원 불가 write·선언만 지원인 write는 없다(R21).
  assertEquals(keysOf(await toolsFor("app_engineer")), [
    "add_confirmed",
    "add_item",
    "audit",
    "read_items",
  ]);
  // external 선언의 sync_remote와 복원 불가 drop_item·undo_add, confirm인
  // purge는 제공되지 않는다(R21).
  const tools = await toolsFor("app_engineer");
  for (const key of ["sync_remote", "drop_item", "undo_add", "purge"]) {
    assertEquals(
      tools.some((tool) => tool.command === key),
      false,
      `app_engineer must not offer ${key}`,
    );
  }
  // 담당 앱이 아니면 아무것도 제공하지 않는다(R21).
  assertEquals(
    keysOf(
      await toolsFor("app_engineer", { work: { kind: "app", id: OTHER_APP } }),
    ),
    [],
  );
  assertEquals(
    keysOf(await toolsFor("app_engineer", { granted: [] })),
    [],
  );
  // 허락된 read만으로 좁혀도 같다(R21).
  assertEquals(
    keysOf(
      await toolsFor("app_engineer", { granted: ["read_items", "purge"] }),
    ),
    ["read_items"],
  );
});

Deno.test("lophn-agent/roles/app-engineer#R21: 앱 command 실행은 AgentAppScope(assigned_app)로만 발급되고 노출 상한은 APP_COMMAND_EXPOSURE가 둔다", () => {
  // 담당 앱 하나의 read와 되돌리기를 지원하는 write다(R21).
  const ae = APP_COMMAND_EXPOSURE.get("app_engineer");
  assert(ae !== undefined);
  assertEquals(ae.effects, ["read", "write"]);
  assertEquals(ae.undo_write_only, true);
  assertEquals(ae.execution, "assigned_app");
  assertEquals(ae.ask, true);
  // external은 노출 상한 밖이다(R21).
  assert(ae.effects.includes("external") === false);
});

Deno.test("lophn-agent/roles/app-engineer#R21: AE에게 제공된 command의 판정은 read와 되돌리기 검증된 write는 allow이고 confirm은 approval이다", async () => {
  const world = view();
  const tools = await toolsFor("app_engineer");
  const ports: AppJudgmentPorts = {
    current: () =>
      Promise.resolve(
        ok({
          view: world,
          grants: [{ grant: GRANT, commands: ALL_KEYS, basis_seq: "1" }],
        }),
      ),
    nonce: () => Promise.resolve(ok("n".repeat(32))),
  };
  async function judged(key: string, input: unknown = {}) {
    const tool = tools.find((entry) => entry.command === key);
    assert(tool !== undefined, `${key} is offered to app_engineer`);
    const resolved = await createAppBinding(tool, ports).resolve(input, {
      run: RUN,
      toolCall: CALL,
    });
    assert(resolved.ok, key);
    const facts: CallFacts = {
      identity: true,
      assignment: "active",
      run: "active",
      origin: "human_request",
      listed: true,
      roleAllows: true,
      connection: "n/a",
      inputValid: true,
      effect: tool.definition.effect,
      confirm: tool.definition.confirm,
      refused: false,
      targets: resolved.value.targets.map((target) => ({
        id: target.id,
        inScope: true,
        reversibility: target.reversibility,
      })),
    };
    return { judgment: judge(facts), action: resolved.value };
  }
  // 허락된 read와 되돌리기 검증된 write는 묻지 않는다.
  assertEquals(
    (await judged("read_items", { limit: 1 })).judgment.decision,
    "allow",
  );
  assertEquals(
    (await judged("add_item", { limit: 1 })).judgment.decision,
    "allow",
  );
  // confirm은 effect보다 먼저 approval이다. read도, 되돌릴 수 있는 write도 같다.
  for (const key of ["audit", "add_confirmed"]) {
    const { judgment, action } = await judged(key);
    assertEquals(judgment.decision, "ask", key);
    assertEquals(judgment.code, "confirm_required", key);
    // approval request의 동작이 접수 command라 사전 질문과 앱의 confirm이 approval 하나다.
    assertEquals(action.operation, "invocation.accept_confirm", key);
  }
  // 복원 불가 write·external·confirm 복원 불가 write는 제공 자체가 없다.
  for (const key of ["drop_item", "undo_add", "sync_remote", "purge"]) {
    assertEquals(tools.some((tool) => tool.command === key), false, key);
  }
});

Deno.test("lophn-agent/roles/app-engineer#R21: 노출된 앱 command은 앱 통로 하나만 쓰고 실행은 Source와 secret 값에 닿지 않는다", async () => {
  const tools = await toolsFor("app_engineer");
  for (const tool of tools) {
    assertEquals(tool.definition.contract, "app.connect");
    assertEquals(tool.definition.origin, "app");
    const schema = JSON.stringify(tool.definition.inputSchema);
    for (const word of ["source_path", "secret", "token"]) {
      assertEquals(schema.includes(word), false, word);
    }
  }
});

Deno.test("lophn-agent/roles/app-engineer#R21: 범위 밖 command의 호출은 없는 command와 같은 결과다", async () => {
  const fixture = fixturePorts();
  const tools = await toolsFor("app_engineer");
  const handlers = createAppToolHandlers(tools, fixture.ports as never);
  const listed = tools.map((tool) => tool.definition);
  // AgentAppScope가 고르지 않은 command(drop_item)의 정의는 목록에 없다.
  // 그 이름의 호출은 없는 이름과 같은 결과다(R21).
  assertEquals(
    listed.some((entry) => entry.description === "drop_item does one thing"),
    false,
    "drop_item definition must not be listed",
  );
  const absent = await executeTool(
    { listed, handlers, credential: credential() },
    "app_00000000_nothing_000000",
    {},
  );
  const outOfScope = await executeTool(
    { listed, handlers, credential: credential() },
    "app_00000000_drop_item_00000",
    {},
  );
  assertEquals(outOfScope.outcome, absent.outcome);
  assertEquals(outOfScope.executed, false);
  assertEquals(fixture.invoked.length, 0);
});

Deno.test("lophn-agent/roles/app-engineer#R21: 제공된 read command의 호출은 담당 앱에 그 입력을 그대로 보낸다", async () => {
  const fixture = fixturePorts();
  const tools = await toolsFor("app_engineer");
  const handlers = createAppToolHandlers(tools, fixture.ports as never);
  const read = tools.find((tool) => tool.command === "read_items")!;
  const outcome = await executeTool(
    {
      listed: tools.map((tool) => tool.definition),
      handlers,
      credential: credential(),
    },
    read.definition.name,
    { limit: 2 },
  );
  assertEquals(outcome.outcome.kind, "success");
  assertEquals(fixture.invoked.length, 1);
  assertEquals(fixture.invoked[0]?.app, APP);
  assertEquals(fixture.invoked[0]?.command, "read_items");
  assertEquals(fixture.invoked[0]?.input, { limit: 2 });
});
