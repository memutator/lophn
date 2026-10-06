// 화면 context와 agent 주석을 실제 core(임시 LOPHN_HOME)의 grant·agent connection과 실제 앱 자식
// 프로세스로 본다(apps/agent-context#R6, apps/sdk#R39). 앱 자식은 SDK의 registerScreenContext·
// registerAnnotationTarget을 쓰는 temp 폴더의 실제 프로세스다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import type { AuthenticatedContext } from "../../contracts/platform/mod.ts";
import { grantRevoke } from "../../contracts/apps/mod.ts";
import type { AgentAppScope } from "../../contracts/lophn-agent/mod.ts";
import {
  call,
  command,
  inspect,
} from "../../../apps/core/testing/approvals-fixture.ts";
import { confirmationFor } from "../../../apps/core/testing/confirmation-fixture.ts";
import {
  authorizationOf,
  control,
  declare,
  direct,
  grant,
  openWorld,
  type World,
} from "../../apps/runtime/world_test.ts";

const ASSIGNMENT = "asg_01arz3ndektsv4rrffq69g5fav";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const TOOL = "tcl_01arz3ndektsv4rrffq69g5fav";
const NOTE = "private-note-9f3c";
const COMMANDS = ["ctx.hint", "ctx.read"];

const READ_INPUT = {
  type: "object",
  properties: {
    screen: { type: "string" },
    view_session: { type: "string" },
    detail: { type: "boolean", default: false },
  },
  required: ["screen", "view_session"],
  additionalProperties: false,
};
const HINT_INPUT = {
  type: "object",
  properties: {
    screen: { type: "string" },
    view_session: { type: "string" },
    expected_revision: { type: "string" },
    target: { type: "string" },
    text: { type: "string", maxLength: 500 },
  },
  required: ["screen", "view_session", "expected_revision", "target", "text"],
  additionalProperties: false,
};

function declared(
  key: string,
  effect: "read" | "write",
  input: Record<string, unknown>,
) {
  return {
    key,
    label: key,
    description: `${key} purpose`,
    effect,
    confirm: false,
    input,
    revert: { supported: false },
  };
}

function blueprint(): Record<string, unknown> {
  return {
    name: "Editor",
    description: "Shares the current code with the agent",
    screens: [{
      key: "usage",
      label: "Usage",
      path: "/usage",
      sizes: ["full", "panel"],
    }],
    commands: [
      declared("ctx.hint", "write", HINT_INPUT),
      declared("ctx.read", "read", READ_INPUT),
    ],
    automatic_tasks: [],
    permissions: [],
    problem_codes: [],
    documents: [],
    agent_context: [{
      screen: "usage",
      read_command: "ctx.read",
      sensitive_paths: ["/data/note"],
      annotation_targets: [
        { key: "hint", label: "Hint", write_command: "ctx.hint" },
      ],
    }],
    app_connections: [],
    sdk_dependencies: [],
  };
}

async function withWorld(run: (world: World) => Promise<void>) {
  const world = await openWorld({ approvals: true });
  try {
    await world.allow();
    await declare(world, COMMANDS);
    await run(world);
  } finally {
    await world.close();
  }
}

async function startApp(world: World) {
  const child = await world.start({
    fixture: {
      blueprint: blueprint(),
      child: new URL("./testing/screen-context-child.ts", import.meta.url)
        .href,
      commands: COMMANDS,
      screens: { usage: ["full", "panel"] },
    },
  });
  // 사람이 화면을 연다: 사람 connection으로 두 view session을 만든다.
  const person = await call(world.harness, "apps/connect", world.user.token, {
    app: world.app,
    mode: "live",
    screens: ["usage"],
    screen_sizes: { usage: ["full", "panel"] },
    commands: [],
  });
  assertEquals(person.status, 200, JSON.stringify(person.body));
  for (const [view, size] of [["view-a", "full"], ["view-b", "panel"]]) {
    const shown = await direct(
      child.endpoint,
      "GET",
      `/screens/usage/app.js?size=${size}&view_session=${view}`,
      authorizationOf(person),
    );
    assertEquals(shown.status, 200, JSON.stringify(shown.body));
  }
  return child;
}

async function agent(world: World): Promise<AuthenticatedContext> {
  const login = await world.login("agent", ["app.connect"], {
    targets: { assignment: ASSIGNMENT, run: RUN },
    conditions: { assignment: ASSIGNMENT, run: RUN },
  });
  const entry: AgentAppScope["apps"][number] = {
    app: world.app,
    commands: COMMANDS,
    effects: ["read", "write"],
    revert_required: false,
    confirm_allowed: true,
  };
  return {
    ...login.context,
    scope: {
      ...login.context.scope,
      agent: { role: "lophn", assignment: ASSIGNMENT, apps: [entry] },
    },
  } as AuthenticatedContext;
}

function connect(world: World, ctx: AuthenticatedContext) {
  return world.harness.appsControl.connector.connect(ctx, {
    app: world.app,
    mode: "live" as const,
    screens: ["usage"],
    screen_sizes: {},
    commands: COMMANDS,
    caller: { kind: "agent" as const, run: RUN, tool_call: TOOL },
  });
}

type Context = {
  view_session: string;
  revision: string;
  summary: string;
  data?: Record<string, unknown> | null;
  redacted: string[];
};

function invoker(
  endpoint: string,
  authorization: string,
  release: string | null,
) {
  let sequence = 0;
  return async (commandKey: string, input: unknown) => {
    sequence += 1;
    return await direct(
      endpoint,
      "POST",
      "/_lophn/commands/invoke",
      authorization,
      {
        request_key: `agent-${sequence}-${crypto.randomUUID()}`,
        release,
        command: commandKey,
        input,
      },
    );
  };
}

function grantsSeq(world: World): string {
  const rows = inspect(
    world.harness,
    `SELECT COALESCE(MAX(e.seq), 0) AS n FROM events e
     JOIN grants g ON g.id = e.subject
     WHERE g.app = ? AND e.type IN ('GrantCreated', 'GrantRevoked')`,
    [world.app],
  );
  return String(rows[0]["n"]);
}

Deno.test("apps/agent-context#R6 apps/sdk#R39: the agent reads and annotates open screens only while the agent.commands grant stands", async () => {
  await withWorld(async (world) => {
    const child = await startApp(world);
    const ctx = await agent(world);

    // 화면이 열려 있어도 agent.commands grant가 없으면 조회·되쓰기 통로 자체가 열리지 않는다.
    const closed = await connect(world, ctx);
    assert(!closed.ok);
    assertEquals(closed.error.code, "forbidden");

    const opened = await grant(world, {
      kind: "agent.commands",
      commands: COMMANDS,
    });
    assertEquals(opened.status, 200, JSON.stringify(opened.body));
    const connected = await connect(world, ctx);
    assert(connected.ok, connected.ok ? "" : connected.error.message);
    assertEquals(connected.value.connection.commands, COMMANDS);
    const invoke = invoker(
      child.endpoint,
      JSON.stringify({
        payload: connected.value.connection,
        signature: connected.value.signature,
      }),
      child.release,
    );

    // 두 view session은 각자 상태와 revision을 돌려준다. 민감한 칸은 상세에도 없다.
    const readView = async (view: string, detail = false) => {
      const outcome = await invoke("ctx.read", {
        screen: "usage",
        view_session: view,
        detail,
      });
      assertEquals(outcome.status, 200, JSON.stringify(outcome.body));
      return (outcome.body as { result: { result: Context } }).result.result;
    };
    const first = await readView("view-a", true);
    assertEquals(first.revision, "r1");
    assertEquals(first.summary, "code of view-a; 0 hints");
    assertEquals(first.data, { code: "code of view-a", hints: [] });
    assertEquals(first.redacted, ["/data/note"]);
    assert(!JSON.stringify(first).includes(NOTE));
    assertEquals((await readView("view-b")).summary, "code of view-b; 0 hints");

    // 조회한 revision으로 주석을 쓰면 새 revision이 되고 옛 revision은 conflict다.
    const hint = (revision: string, text: string) =>
      invoke("ctx.hint", {
        screen: "usage",
        view_session: "view-a",
        expected_revision: revision,
        target: "hint",
        text,
      });
    const applied = await hint(first.revision, "try a retry");
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    assertEquals(
      (applied.body as { result: { result: { revision: string } } }).result
        .result.revision,
      "r2",
    );
    const stale = await hint(first.revision, "again");
    assertEquals(stale.status, 409);
    assertEquals(
      (stale.body as { error: { code: string } }).error.code,
      "conflict",
    );
    const after = await readView("view-a", true);
    assertEquals(after.data?.hints, ["try a retry"]);
    // 열지 않은 session은 닫힌 view와 같은 답이다.
    const ghost = await invoke("ctx.read", {
      screen: "usage",
      view_session: "view-none",
    });
    assertEquals(ghost.status, 503);

    // grant를 거두면(사람의 확인을 거친 회수) 열린 화면이어도 새 조회·되쓰기 연결이 거절된다.
    const input = {
      grant: String(
        inspect(
          world.harness,
          "SELECT id FROM grants WHERE app = ? AND status = 'active'",
          [world.app],
        )[0]["id"],
      ),
      process_nonce: null,
      termination_confirmed: null,
    };
    const revoker = await world.login("user", ["grant.revoke"]);
    const revoked = await call(
      world.harness,
      "grants/revoke",
      revoker.token,
      command(input, {
        compare: { grants_seq: grantsSeq(world) },
        confirmation: await confirmationFor(world.harness, grantRevoke, input),
      }),
    );
    assertEquals(revoked.status, 200, JSON.stringify(revoked.body));
    const refused = await connect(world, ctx);
    assert(!refused.ok);
    assertEquals(refused.error.code, "forbidden");
    // 사람의 화면 상태는 그대로이고 앱은 계속 응답한다.
    await control(world, child, "/_lophn/control/probe", {
      process_nonce: child.nonce,
    });
  });
});
