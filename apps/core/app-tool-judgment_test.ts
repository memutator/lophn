// lophn-agent/harness/tool-judgment#R10, R11과 harness/tools#R17: 앱 command tool의 판정과 approval 흐름을
// 실제 core(임시 LOPHN_HOME, 실제 ledger와 approval command)에서 본다. 앱 쪽은 blueprint·허락을 읽는
// 통로의 대역이다(실제 앱 자식과의 호출은 apps/agent-runtime/app_toolkit_test.ts). 사람 데이터 root와 실제
// provider는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { err, fingerprint, ok } from "../../packages/base/mod.ts";
import { approvalBindingHash } from "../../packages/protocol/platform/mod.ts";
import type { AppBlueprintCommand } from "../../packages/protocol/apps/mod.ts";
import type { ApprovalRequest } from "../../packages/protocol/platform/mod.ts";
import {
  type AppBlueprintView,
  type AppTool,
  buildAppTools,
  revertCounterpart,
} from "../../packages/lophn-agent/harness/tools/mod.ts";
import {
  type AppJudgmentPorts,
  createAppBinding,
} from "../../packages/lophn-agent/harness/tool-judgment/mod.ts";
import { computeAgentAppScope } from "../../packages/lophn-agent/harness/run-loop/mod.ts";
import { codeOf, decide as humanDecide } from "./testing/approvals-fixture.ts";
import {
  APPROVALS,
  count,
  inspect,
  kit,
  openWorld,
  requested,
  RUN_A,
  USER_TOKEN,
  USES,
  type World,
} from "./testing/tool-judgment-world.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const OTHER_APP = "app_01h455vb4pex5v6nkc6gd5fdw2";
const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const NEXT_RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw2";
const GRANT = "grt_01h455vb4pex5v6nkc6gd5fdw1";
const NONCE = "n".repeat(32);

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
  command("read_items", "read"),
  command("audit", "read", { confirm: true }),
  command("add_item", "write", {
    revert: { supported: true, command: "undo_add" },
  }),
  command("undo_add", "write"),
  command("drop_item", "write"),
  command("sync_remote", "external"),
  command("purge", "write", { confirm: true }),
];

type Fixture = {
  view: AppBlueprintView;
  granted: string[];
  nonce: string;
  asked: number;
};

function fixture(): Fixture {
  return {
    view: {
      app: APP,
      name: "Usage",
      release: RELEASE,
      blueprint_hash: "a".repeat(64),
      commands: COMMANDS,
    },
    granted: COMMANDS.map((entry) => entry.key),
    nonce: NONCE,
    asked: 0,
  };
}

function portsOf(state: Fixture): AppJudgmentPorts {
  return {
    current: () =>
      Promise.resolve(
        ok({
          view: state.view,
          grants: [{
            grant: GRANT,
            commands: state.granted,
            basis_seq: "0",
          }],
        }),
      ),
    nonce: () => {
      state.asked += 1;
      return Promise.resolve(ok(state.nonce));
    },
  };
}

async function toolsOf(state: Fixture): Promise<readonly AppTool[]> {
  const scope = computeAgentAppScope({
    role: "lophn",
    assignment: "asg_01h455vb4pex5v6nkc6gd5fdw1",
    work: { kind: "all", id: null },
    read_apps: [],
    read_commands: [],
    offers: [{
      app: APP,
      commands: state.view.commands.map((entry) => ({
        key: entry.key,
        effect: entry.effect,
        confirm: entry.confirm,
        revert_supported:
          revertCounterpart(state.view.commands, entry) !== null,
      })),
      granted: state.granted,
    }],
  });
  assert(scope.ok);
  return await buildAppTools({
    scope: scope.value,
    views: [state.view],
    grants: new Map([[
      APP,
      [{ grant: GRANT, commands: state.granted, basis_seq: "0" }],
    ]]),
  });
}

async function harnessOf(
  world: World,
  state: Fixture,
  targets: readonly string[] = [APP],
) {
  const tools = await toolsOf(state);
  const ports = portsOf(state);
  const entries = tools.map((tool) => ({
    tool,
    definition: tool.definition,
    binding: createAppBinding(tool, ports),
  }));
  const harness = kit(
    world,
    "a",
    entries,
    {
      credential: {
        run: RUN_A,
        targets: new Set(targets),
        operations: new Set(["app.connect"]),
      },
    },
  );
  const byKey = new Map(entries.map((entry) => [entry.tool.command, entry]));
  return {
    harness,
    async ask(key: string, input: unknown = {}) {
      const entry = byKey.get(key)!;
      const request = await requested(world, RUN_A, entry.definition, input);
      const decided = await harness.judgment.decide(request);
      assert(decided.ok, decided.ok ? "" : JSON.stringify(decided.error));
      return {
        request: { ...request, stateSeq: decided.value.stateSeq },
        decided: decided.value,
      };
    },
  };
}

function stateOf(world: World, toolCall: string) {
  return inspect(
    world.server,
    "select state, started_at, outcome, decision from tool_calls where id = ?",
    [toolCall],
  )[0];
}

async function approvalOf(world: World, id: string): Promise<ApprovalRequest> {
  const read = await world.read("approvals/get", USER_TOKEN, { approval: id });
  assertEquals(read.status, 200, JSON.stringify(read.body));
  return read.body["request"] as ApprovalRequest;
}

async function grant(world: World, id: string) {
  const reply = await humanDecide(
    world.server,
    USER_TOKEN,
    await approvalOf(world, id),
    "grant",
  );
  assertEquals(reply.status, 200, JSON.stringify(reply.body));
}

Deno.test("lophn-agent/harness/tool-judgment#R10: 읽기는 allow, 되돌리기가 검증된 write는 allow로 approval 없이 진입하고 나머지 write와 external은 ask다", async () => {
  const world = await openWorld();
  try {
    const state = fixture();
    const { harness, ask } = await harnessOf(world, state);

    for (const key of ["read_items", "add_item"]) {
      const { request, decided } = await ask(key);
      assertEquals(decided.decision.decision, "allow", key);
      assertEquals(decided.decision.approval, null);
      const admitted = await harness.judgment.admit(request, decided.decision);
      assert(admitted.ok);
      assertEquals(admitted.value, { kind: "enter", approval: null });
    }
    // 선행 기록: 쓰기가 허용되어도 진입 기록(start)이 있어야 호출한다. 판정 기록은 이미 ledger에 있다.
    assertEquals(count(world.server, APPROVALS), 0);

    for (const key of ["drop_item", "sync_remote"]) {
      const { request, decided } = await ask(key);
      assertEquals(decided.decision.decision, "ask", key);
      assert(decided.decision.approval !== null);
      assertEquals(decided.decision.effect, "irreversible");
      const row = stateOf(world, request.toolCall);
      assertEquals(row["state"], "requested");
      assertEquals(row["started_at"], null);
      const waiting = await harness.judgment.admit(request, decided.decision);
      assert(waiting.ok);
      assertEquals(waiting.value.kind, "waiting");
    }
    assertEquals(count(world.server, APPROVALS), 2);
    assertEquals(state.asked, 0);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/tool-judgment#R10: confirm은 effect보다 먼저 ask이고 허락 전에는 진입하지 못하며 approval 하나가 사전 질문과 앱의 confirm을 겸한다", async () => {
  const world = await openWorld();
  try {
    const state = fixture();
    const { harness, ask } = await harnessOf(world, state);

    // confirm read도 allow가 아니라 ask다. 진입 기록도 호출도 없다.
    const { request, decided } = await ask("audit");
    assertEquals(decided.decision.decision, "ask");
    assertEquals(decided.decision.effect, "read");
    const approvalId = decided.decision.approval;
    assert(approvalId !== null);
    assertEquals(count(world.server, APPROVALS), 1);

    // approval의 동작은 접수 command 자체다: platform이 정확한 앱·release·command·입력·호출 주체로 검사한다.
    const stored = await approvalOf(world, approvalId);
    assertEquals(stored.requester, `agent:${world.lophn.id}`);
    assertEquals(stored.action.concern, "apps/invocations");
    assertEquals(stored.action.command, "invocation.accept_confirm");
    assertEquals(stored.action.targets, [APP, RELEASE]);
    const accept = (stored.action.input as {
      value: Record<string, unknown>;
    }).value;
    assertEquals(accept["approval"], approvalId);
    assertEquals(accept["command"], "audit");
    assertEquals(accept["process_nonce"], NONCE);
    assertEquals(accept["caller"], {
      kind: "agent",
      run: RUN_A,
      tool_call: request.toolCall,
    });

    // 같은 call을 다시 판정(재시도·복구)해도 approval은 하나다.
    await harness.judgment.decide({ ...request, stateSeq: "0" });
    assertEquals(count(world.server, APPROVALS), 1);

    // 앱의 confirm이 같은 호출의 approval을 새로 만들려 하면 platform이 이미 있는 approval을 알려 준다.
    const otherId = "apr_01h455vb4pex5v6nkc6gd5fdw9";
    const value = { ...accept, approval: otherId };
    const base = {
      concern: stored.action.concern,
      command: stored.action.command,
      caller: stored.action.caller,
      targets: stored.action.targets,
      input: { kind: "inline" as const, value },
      input_hash: await fingerprint(value),
      comparison: stored.action.comparison,
    };
    const action = {
      ...base,
      binding_hash: await approvalBindingHash({ ...base, binding_hash: "0" }),
    };
    const duplicate = await world.post(
      "approvals/create",
      world.runs.a.token,
      {
        id: otherId,
        requester: stored.requester,
        run: RUN_A,
        reason: "the app asks again",
        effect: {
          changes: "runs audit",
          external: null,
          reversible: false,
          reversibility: "none",
        },
        action,
        expires_at: stored.expires_at,
      },
    );
    assertEquals(codeOf(duplicate), "conflict", JSON.stringify(duplicate.body));
    assertEquals(
      (duplicate.body["error"] as { details: { approval: string } }).details
        .approval,
      approvalId,
    );
    assertEquals(count(world.server, APPROVALS), 1);

    // 사람이 허락하기 전에는 진입할 수 없다. 허락 뒤에야 같은 정의·입력·release·process면 진입한다.
    const before = await harness.judgment.admit(request, decided.decision);
    assert(before.ok);
    assertEquals(before.value, { kind: "waiting", approval: approvalId });
    assertEquals(stateOf(world, request.toolCall)["started_at"], null);
    await grant(world, approvalId);
    const after = await harness.judgment.admit(request, decided.decision);
    assert(after.ok);
    assertEquals(after.value, { kind: "enter", approval: approvalId });
    assertEquals(count(world.server, USES), 0);

    // 앱 process가 다시 뜨면(nonce가 달라진다) 옛 허락으로 진입하지 않는다.
    state.nonce = "m".repeat(32);
    const restarted = await harness.judgment.admit(request, decided.decision);
    assert(restarted.ok);
    assertEquals(restarted.value, { kind: "changed" });
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/tools#R17: approval 대기 중 release가 바뀌거나 허락이 회수되면 옛 call은 진입 0개이고 새 정의는 다음 run에서 생긴다", async () => {
  const world = await openWorld();
  try {
    for (const change of ["release", "revoked", "contract"] as const) {
      const state = fixture();
      const { harness, ask } = await harnessOf(world, state);
      const { request, decided } = await ask("drop_item");
      assertEquals(decided.decision.decision, "ask");
      const approvalId = decided.decision.approval!;
      await grant(world, approvalId);
      const ready = await harness.judgment.admit(request, decided.decision);
      assert(ready.ok);
      assertEquals(ready.value.kind, "enter");

      // 허락이 난 뒤 진입 전에 앱이 바뀐다.
      if (change === "release") {
        state.view = { ...state.view, release: NEXT_RELEASE };
      } else if (change === "revoked") {
        state.granted = state.granted.filter((key) => key !== "drop_item");
      } else {
        state.view = {
          ...state.view,
          commands: state.view.commands.map((entry) =>
            entry.key === "drop_item"
              ? { ...entry, description: "now deletes more" }
              : entry
          ),
        };
      }
      const stale = await harness.judgment.admit(request, decided.decision);
      assert(stale.ok);
      assertEquals(stale.value.kind, "denied", change);
      // 진입을 기록하지 않았다: 호출 0개.
      assertEquals(stateOf(world, request.toolCall)["started_at"], null);

      // 다음 run은 지금 선언·허락으로 정의를 새로 만든다. 회수한 command는 없고 바뀐 정의는 다른 revision이다.
      const next = await toolsOf(state);
      const names = next.map((tool) => tool.command);
      if (change === "revoked") {
        assertEquals(names.includes("drop_item"), false);
      } else {
        const old = (await toolsOf(fixture())).find((tool) =>
          tool.command === "drop_item"
        )!;
        const fresh = next.find((tool) => tool.command === "drop_item")!;
        assert(fresh.definition.revision !== old.definition.revision);
      }
    }
    assertEquals(count(world.server, USES), 0);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/tool-judgment#R10: 범위 밖 앱의 call은 approval도 호출도 없이 deny이고 없는 앱과 같은 판정이다", async () => {
  const world = await openWorld();
  try {
    const state = fixture();
    const { harness, ask } = await harnessOf(world, state, [OTHER_APP]);
    const { decided, request } = await ask("read_items");
    assertEquals(decided.decision.decision, "deny");
    assertEquals(decided.decision.approval, null);
    assertEquals(count(world.server, APPROVALS), 0);
    const row = stateOf(world, request.toolCall);
    assertEquals(row["state"], "finished");
    assertEquals(JSON.parse(String(row["outcome"])).kind, "not_executed");

    // 앱 정의를 읽지 못하는(없는) 앱도 같은 deny와 같은 이유다.
    const missing = fixture();
    const tool = (await toolsOf(missing)).find((entry) =>
      entry.command === "read_items"
    )!;
    const gone = createAppBinding(tool, {
      current: () => Promise.resolve(err({ code: "not_found", message: "x" })),
      nonce: () => Promise.resolve(ok(NONCE)),
    });
    const entry = {
      tool,
      definition: tool.definition,
      binding: gone,
    };
    const lost = kit(world, "a", [entry], {
      credential: {
        run: RUN_A,
        targets: new Set([APP]),
        operations: new Set(["app.connect"]),
      },
    });
    const call = await requested(world, RUN_A, tool.definition, {});
    const missed = await lost.judgment.decide(call);
    assert(missed.ok);
    assertEquals(missed.value.decision.decision, "deny");
    assertEquals(missed.value.decision.reason, decided.decision.reason);
    assertEquals(count(world.server, APPROVALS), 0);
    assert(harness !== undefined);
  } finally {
    await world.dispose();
  }
});
