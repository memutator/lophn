// agent가 앱 command를 쓰는 connection(apps/runtime#R32, apps/permissions#R28). 실제 core(임시
// LOPHN_HOME)의 grant와 현재 선언을 읽고, 서명한 connection을 실제 앱 자식 프로세스가 검증한다.
// agent credential의 AgentAppScope(scope.agent)는 platform registry가 인증한 context에만 실리고
// 시험 credential 기록에는 담을 수 없으므로, 같은 인증 context를 connector에 직접 넣는다.
import { assert, assertEquals } from "@std/assert";
import type { AuthenticatedContext } from "../../protocol/platform/mod.ts";
import type {
  AgentAppScope,
  AgentRole,
} from "../../protocol/lophn-agent/mod.ts";
import { declare, direct, grant, openWorld, type World } from "./world_test.ts";

const ASSIGNMENT = "asg_01arz3ndektsv4rrffq69g5fav";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const TOOL = "tcl_01arz3ndektsv4rrffq69g5fav";

async function withWorld(run: (world: World) => Promise<void>) {
  const world = await openWorld({ approvals: true });
  try {
    await world.allow();
    await declare(world, [
      "usage.undo",
      "usage.read",
      "usage.save",
      "usage.admin",
      "slow",
      "fail",
    ]);
    await run(world);
  } finally {
    await world.close();
  }
}

type Entry = AgentAppScope["apps"][number];

function entry(app: string, role: AgentRole): Entry {
  // 역할마다 역할이 허용한 command만이다(lophn-agent가 계산한 AgentAppScope의 모양).
  if (role === "operator") {
    return {
      app,
      commands: ["usage.read"],
      effects: ["read"],
      revert_required: false,
      confirm_allowed: false,
    };
  }
  if (role === "app_engineer") {
    return {
      app,
      commands: ["usage.read", "usage.save", "usage.undo"],
      effects: ["read", "write"],
      revert_required: true,
      confirm_allowed: true,
    };
  }
  return {
    app,
    commands: ["usage.read", "usage.save", "usage.admin"],
    effects: ["read", "write"],
    revert_required: false,
    confirm_allowed: true,
  };
}

// 인증된 agent context. credential 기록은 시험 credential이고 scope.agent는 인증이 준 것이다.
async function agent(
  world: World,
  role: AgentRole,
  apps: Entry[],
): Promise<AuthenticatedContext> {
  const login = await world.login("agent", ["app.connect"], {
    targets: { assignment: ASSIGNMENT, run: RUN },
    conditions: { assignment: ASSIGNMENT, run: RUN },
  });
  return {
    ...login.context,
    scope: {
      ...login.context.scope,
      agent: { role, assignment: ASSIGNMENT, apps },
    },
  } as AuthenticatedContext;
}

function request(world: World, overrides: Record<string, unknown> = {}) {
  return {
    app: world.app,
    mode: "live" as const,
    // 화면 key는 contract가 하나 이상을 요구한다. agent connection은 화면 범위를 받지 않는다.
    screens: ["usage"],
    screen_sizes: {},
    commands: ["usage.read", "usage.save", "usage.admin", "usage.undo", "slow"],
    caller: { kind: "agent" as const, run: RUN, tool_call: TOOL },
    ...overrides,
  };
}

function connect(
  world: World,
  ctx: AuthenticatedContext,
  input: ReturnType<typeof request>,
) {
  return world.harness.appsControl.connector.connect(ctx, input);
}

Deno.test("apps/runtime#R32 apps/permissions#R28: 열린 앱이라도 agent.commands grant가 없으면 tool 연결을 거절한다", async () => {
  await withWorld(async (world) => {
    await world.start();
    const ctx = await agent(world, "lophn", [entry(world.app, "lophn")]);
    // 사람은 같은 앱에 연결한다. 앱이 열려 있다는 사실이 agent 허락은 아니다.
    const connected = await connect(world, ctx, request(world));
    assert(!connected.ok);
    assertEquals(connected.error.code, "forbidden");
    // app.call·fs 같은 다른 종류의 grant도 agent 허락을 대신하지 않는다.
    const other = await grant(world, {
      kind: "net.fetch",
      host: "api.example.com",
      port: 443,
    });
    assertEquals(other.status, 200, JSON.stringify(other.body));
    const still = await connect(world, ctx, request(world));
    assert(!still.ok);
    assertEquals(still.error.code, "forbidden");
  });
});

Deno.test("apps/runtime#R32 apps/permissions#R28: grant 뒤에도 AgentAppScope 밖 command는 connection에 들어가지 않고 앱이 거절한다", async () => {
  await withWorld(async (world) => {
    const child = await world.start();
    const opened = await grant(world, {
      kind: "agent.commands",
      commands: ["usage.read", "usage.save", "usage.undo"],
    });
    assertEquals(opened.status, 200, JSON.stringify(opened.body));
    const ctx = await agent(world, "lophn", [entry(world.app, "lophn")]);
    const connected = await connect(world, ctx, request(world));
    assert(connected.ok, connected.ok ? "" : connected.error.message);
    // grant(read·save·undo) ∩ 역할 범위(read·save·admin) ∩ 요청 = read·save.
    // admin은 grant가 없고 undo는 역할 범위 밖이며 slow는 둘 다 없다.
    assertEquals(connected.value.connection.commands, [
      "usage.read",
      "usage.save",
    ]);
    // agent connection은 화면을 받지 않고 호출자는 인증된 run과 tool call이다.
    assertEquals(connected.value.connection.screens, []);
    assertEquals(connected.value.connection.caller, {
      kind: "agent",
      run: RUN,
      tool_call: TOOL,
    });
    assertEquals(connected.value.connection.actor, ctx.actor);
    const authorization = JSON.stringify({
      payload: connected.value.connection,
      signature: connected.value.signature,
    });
    const invoke = (command: string) =>
      direct(child.endpoint, "POST", "/_lophn/commands/invoke", authorization, {
        request_key: crypto.randomUUID(),
        release: child.release,
        command,
      });
    assertEquals((await invoke("usage.read")).status, 200);
    assertEquals((await invoke("usage.save")).status, 200);
    // connection에 없는 command는 앱이 로컬에서 거절한다.
    assertEquals((await invoke("usage.admin")).status, 403);
    assertEquals((await invoke("usage.undo")).status, 403);
  });
});

Deno.test("apps/runtime#R32 apps/permissions#R28: lophn·App Engineer·Operator는 같은 grant에서 각자 허용된 command만 받는다", async () => {
  await withWorld(async (world) => {
    const child = await world.start();
    const opened = await grant(world, {
      kind: "agent.commands",
      commands: ["usage.admin", "usage.read", "usage.save", "usage.undo"],
    });
    assertEquals(opened.status, 200, JSON.stringify(opened.body));
    const expected: Record<AgentRole, string[] | null> = {
      lophn: ["usage.admin", "usage.read", "usage.save"],
      app_engineer: ["usage.read", "usage.save", "usage.undo"],
      operator: ["usage.read"],
      // Context Engineer는 앱 command 실행이 없다. 범위에 앱이 없으면 없는 앱과 같다.
      context_engineer: null,
    };
    for (
      const [role, commands] of Object.entries(expected) as [
        AgentRole,
        string[] | null,
      ][]
    ) {
      const ctx = await agent(
        world,
        role,
        commands === null ? [] : [entry(world.app, role)],
      );
      const connected = await connect(world, ctx, request(world));
      if (commands === null) {
        assert(!connected.ok);
        assertEquals(connected.error.code, "not_found");
        continue;
      }
      assert(connected.ok, connected.ok ? "" : connected.error.message);
      assertEquals(connected.value.connection.commands, commands, role);
      // Operator의 connection으로 쓰기 command를 보내면 앱이 거절한다.
      if (role === "operator") {
        const refused = await direct(
          child.endpoint,
          "POST",
          "/_lophn/commands/invoke",
          JSON.stringify({
            payload: connected.value.connection,
            signature: connected.value.signature,
          }),
          {
            request_key: crypto.randomUUID(),
            release: child.release,
            command: "usage.save",
          },
        );
        assertEquals(refused.status, 403);
      }
    }
  });
});

Deno.test("apps/runtime#R32: agent 호출자는 인증된 run에 묶이고 본문의 다른 run·mode는 거절한다", async () => {
  await withWorld(async (world) => {
    await world.start({ mode: "preview" });
    await world.start();
    const opened = await grant(world, {
      kind: "agent.commands",
      commands: ["usage.read"],
    });
    assertEquals(opened.status, 200, JSON.stringify(opened.body));
    const ctx = await agent(world, "lophn", [entry(world.app, "lophn")]);
    // 다른 run을 주장한 caller.
    const forged = await connect(
      world,
      ctx,
      request(world, {
        caller: {
          kind: "agent",
          run: "run_01arz3ndektsv4rrffq69g5faw",
          tool_call: TOOL,
        },
      }),
    );
    assert(!forged.ok);
    assertEquals(forged.error.code, "forbidden");
    // caller가 없거나 app caller인 요청은 tool call을 알 수 없다.
    const missing = await connect(
      world,
      ctx,
      request(world, { caller: undefined }),
    );
    assert(!missing.ok);
    assertEquals(missing.error.code, "invalid_input");
    // agent는 운영 앱만 부른다. preview는 agent 허락의 범위가 아니다.
    const preview = await connect(
      world,
      ctx,
      request(world, {
        mode: "preview",
        preview_nonce: world.state.preview!.processNonce,
      }),
    );
    assert(!preview.ok);
    assertEquals(preview.error.code, "forbidden");
    const authorized = await connect(world, ctx, request(world));
    assert(authorized.ok, authorized.ok ? "" : authorized.error.message);
  });
});

Deno.test("apps/runtime#R32: 범위 밖 앱은 없는 앱과 같은 응답이다", async () => {
  await withWorld(async (world) => {
    await world.start();
    const opened = await grant(world, {
      kind: "agent.commands",
      commands: ["usage.read"],
    });
    assertEquals(opened.status, 200, JSON.stringify(opened.body));
    const other = "app_01arz3ndektsv4rrffq69g5faw";
    const ctx = await agent(world, "lophn", [entry(other, "lophn")]);
    const outside = await connect(world, ctx, request(world));
    const absent = await connect(world, ctx, request(world, { app: other }));
    assert(!outside.ok && !absent.ok);
    assertEquals(outside.error, absent.error);
    assertEquals(outside.error.code, "not_found");
  });
});
