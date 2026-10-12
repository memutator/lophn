// 연결 회수(coding-agent#T40)를 실제 core(임시 LOPHN_HOME)와 실제 coding credential 발급·인증, fake
// keychain으로 본다. 회수는 confirmation window의 근거가 있어야만 되고, 회수 직후 그 credential의 MCP·CLI·
// 앱 direct 요청이 claim 정리 전에도 거절되며, 정리 뒤 ticket은 다시 열리고 과거 결과는 남는다.
// 사람의 실제 keychain·데이터 root는 열지 않는다(keychain은 fake, 데이터 root는 temp dir).
import { DatabaseSync } from "node:sqlite";
import {
  assert,
  assertEquals,
  assertFalse,
  assertNotEquals,
} from "@std/assert";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import { createTicketTool } from "../../packages/coding-agent/mcp-server/tools/ticket.ts";
import { resolveRoute } from "../../packages/coding-agent/mcp-server/registry.ts";
import { connectionRevoke } from "../../packages/protocol/coding-agent/mod.ts";
import { confirmationBinding } from "../../packages/core/server/identity/mod.ts";
import {
  codingCredentialRef,
  createFakeKeychain,
  type FakeKeychain,
} from "../../packages/core/secrets/mod.ts";
import {
  authorizationOf,
  direct,
  openWorld,
  type World,
} from "../../packages/core/apps/runtime/world_test.ts";
import { call } from "./testing/approvals-fixture.ts";
import { cliMain } from "../../packages/coding-agent/cli/main.ts";
import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import { ticketDefinitions } from "./tickets.ts";

const VER = "ver_01arz3ndektsv4rrffq69g5fav";
const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
const decoder = new TextDecoder();

type Reply = { status: number; body: Record<string, unknown> };

async function post(
  world: World,
  path: string,
  token: string,
  input: unknown,
  compare: unknown = {},
  confirmation?: string,
): Promise<Reply> {
  const response = await fetch(
    `http://127.0.0.1:${world.harness.port}/v1/${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        input,
        idempotency_key: `k-${crypto.randomUUID()}`,
        compare,
        prepared: [],
        ...(confirmation === undefined ? {} : { confirmation }),
      }),
    },
  );
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

// read route는 envelope 없이 입력만 받는다.
async function read(
  world: World,
  path: string,
  token: string,
  input: unknown,
): Promise<Reply> {
  const response = await fetch(
    `http://127.0.0.1:${world.harness.port}/v1/${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    },
  );
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

type Opened = {
  world: World;
  keychain: FakeKeychain;
  user: string;
  // 사람이 고른 이름·범위로 실제 credential을 발급받은 연결과 그 token.
  connect(label: string): Promise<Connected>;
};

type Connected = { connection: string; token: string; revision: string };

async function withWorld(run: (opened: Opened) => Promise<void>) {
  const keychain = createFakeKeychain();
  const world = await openWorld({
    extend: {
      teams: [{ codingAgentConnectionDefinitions }, { ticketDefinitions }],
      teamModules: [
        new URL("./coding-agent.ts", import.meta.url).href,
        new URL("./tickets.ts", import.meta.url).href,
        new URL("./ticket-claim-ports_test.ts", import.meta.url).href,
      ],
      coding: { keychain, loaders: [] },
    },
  });
  try {
    await world.harness.codingCredentialsReady;
    await world.allow();
    const user = (await world.login("user", [
      "CreateCodingAgentConnection",
      "RevokeCodingAgentConnection",
      "CreateTicket",
      "MakeTicketReady",
    ])).token;
    await run({
      world,
      keychain,
      user,
      async connect(label) {
        const seen: { revision?: string } = {};
        const connected = await world.harness.codingCredentials!.connect(
          { label, scope: { kind: "all", app: null } },
          async (submission): Promise<Result<unknown>> => {
            const sent = await post(
              world,
              "coding_agent_connections/create",
              user,
              submission,
            );
            if (sent.status !== 200) {
              return err({ code: "conflict", message: `${sent.status}` });
            }
            seen.revision = (sent.body["connection"] as { revision: string })
              .revision;
            return ok(sent.body);
          },
        );
        assert(connected.ok, connected.ok ? "" : connected.error.message);
        const { connection } = connected.value;
        const token = decoder.decode(
          keychain.stored.get(codingCredentialRef(connection)!)!,
        );
        return { connection, token, revision: seen.revision! };
      },
    });
  } finally {
    await world.close();
  }
}

function stateOf(world: World, connection: string): string | undefined {
  const db = new DatabaseSync(`${world.harness.dataRoot}/lophn.db`, {
    readOnly: true,
  });
  try {
    return db.prepare(
      "SELECT state FROM coding_agent_connections WHERE id = ?",
    ).get(connection)?.state as string | undefined;
  } finally {
    db.close();
  }
}

// 확인 창이 사람 결정을 받아 만든 handle이다. 표시한 대상·판(binding)만 묶는다.
async function window(
  world: World,
  windowId: string,
  target: { connection: string; base_revision: string },
): Promise<string> {
  const binding = await confirmationBinding(connectionRevoke, target);
  assert(binding);
  const issued = await world.harness.confirmation({
    action: "issue",
    request: {
      type: "confirmation_handle_register",
      window_id: windowId,
      target_ref: binding.target,
      content_hash: binding.content,
      allowed_decisions: [connectionRevoke.name],
      expires_at: new Date(world.harness.clock.nowMs() + 600_000).toISOString(),
    },
  });
  assert(issued.ok, issued.ok ? "" : JSON.stringify(issued.error));
  return (issued.value as { confirmation: string }).confirmation;
}

function revoke(
  world: World,
  user: string,
  target: { connection: string; base_revision: string },
  confirmation?: string,
): Promise<Reply> {
  return post(
    world,
    "coding_agent_connections/revoke",
    user,
    target,
    { base_revision: target.base_revision },
    confirmation,
  );
}

async function active(world: World, who: Connected): Promise<boolean> {
  const status = await read(world, "platform/status", who.token, {});
  return status.status === 200 && stateOf(world, who.connection) === "active";
}

Deno.test("coding-agent/connection#R2: 회수는 그 연결에 묶인 confirmation window 근거로만 되고 다른 연결·낡은 판·닫힌 창·침묵은 아무것도 바꾸지 않는다", async () => {
  await withWorld(async ({ world, user, connect }) => {
    const a = await connect("claude");
    const b = await connect("codex");
    const target = { connection: a.connection, base_revision: a.revision };

    // 근거 없이는 사람 credential이어도 회수하지 못한다.
    assertNotEquals((await revoke(world, user, target)).status, 200);

    // 다른 연결의 결정으로는 이 연결을 회수하지 못하고 그 다른 연결도 회수되지 않는다.
    const forB = await window(world, "win-b", {
      connection: b.connection,
      base_revision: b.revision,
    });
    assertNotEquals((await revoke(world, user, target, forB)).status, 200);

    // 낡은 판의 결정으로는 회수하지 못한다(연결은 같고 base_revision이 다르다).
    const stale = await window(world, "win-stale", {
      connection: a.connection,
      base_revision: "1",
    });
    assertNotEquals((await revoke(world, user, target, stale)).status, 200);

    // 창을 닫으면 그 창의 결정 근거는 쓸 수 없다.
    const closing = await window(world, "win-closed", target);
    const closed = await world.harness.confirmation({
      action: "close-window",
      windowId: "win-closed",
    });
    assert(closed.ok);
    assertNotEquals((await revoke(world, user, target, closing)).status, 200);

    // 여기까지 침묵·거절뿐이다. 두 연결 모두 그대로 active다.
    assert(await active(world, a));
    assert(await active(world, b));

    // 이 연결에 묶인 정확한 결정만 회수한다. 다른 연결은 그대로다.
    const exact = await window(world, "win-exact", target);
    const done = await revoke(world, user, target, exact);
    assertEquals(done.status, 200, JSON.stringify(done.body));
    assertEquals(stateOf(world, a.connection), "revoked");
    assertFalse(await active(world, a));
    assert(await active(world, b));

    // 쓴 근거는 다시 쓰지 못한다.
    assertNotEquals((await revoke(world, user, target, exact)).status, 200);
  });
});

async function readyTicket(world: World, user: string): Promise<string> {
  const created = await post(world, "tickets/create", user, {
    app: world.app,
    kind: "implementation",
    title: "fix leaf redaction",
    what: "redact leaf before snapshot",
    why: "snapshot shows the raw leaf",
    references: [],
    adoption_questions: [],
    conditions: [],
    inspect: ["src/leaf.ts"],
    preserve: ["docs/leaf.md"],
    problems: [],
    readiness: "needs_confirmation",
    needs: ["confirm the redaction"],
  });
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const ticket = String(created.body["ticket"]);
  const revision = String(created.body["revision"]);
  const ready = await post(world, "tickets/make_ready", user, {
    ticket,
    base_revision: revision,
    references: [{
      kind: "version",
      target: VER,
      address: {
        place: "project",
        document: "leaf-redaction",
        section: null,
        version: 1,
      },
      section: null,
    }],
    adoption_questions: [QUESTION],
    conditions: [
      { kind: "app_test" },
      {
        kind: "test_command",
        executable: "deno",
        argv: ["task", "test"],
        cwd: ".",
        timeout_ms: 60_000,
        expected_exit_code: 0,
      },
    ],
    inspect: ["src/leaf.ts"],
    preserve: ["docs/leaf.md"],
  }, { base_revision: revision });
  assertEquals(ready.status, 200, JSON.stringify(ready.body));
  return ticket;
}

function claimRows(world: World, ticket: string) {
  const db = new DatabaseSync(`${world.harness.dataRoot}/lophn.db`, {
    readOnly: true,
  });
  try {
    return {
      state: db.prepare("SELECT state FROM tickets WHERE id = ?").get(ticket)
        ?.state as string | undefined,
      claims: db.prepare("SELECT ticket FROM ticket_claims WHERE ticket = ?")
        .all(ticket).length,
      completions: db.prepare(
        "SELECT COUNT(*) AS n FROM ticket_completions WHERE ticket = ?",
      ).get(ticket)?.n as number,
      released: (db.prepare(
        "SELECT payload FROM events WHERE type = 'TicketClaimReleased'",
      ).all() as { payload: string }[]).map((row) =>
        JSON.parse(row.payload).reason as string
      ),
    };
  } finally {
    db.close();
  }
}

function seedCompletion(world: World, ticket: string, claimSeq: string) {
  const db = new DatabaseSync(`${world.harness.dataRoot}/lophn.db`);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare(
      `INSERT INTO ticket_completions
       (ticket, seq, claim_seq, release, summary_hash, outputs, fix_records, verifications)
       VALUES (?, '4', ?, 'rel_01arz3ndektsv4rrffq69g5fav', ?, '[]', '[]', '[]')`,
    ).run(ticket, claimSeq, "b".repeat(64));
  } finally {
    db.close();
  }
}

// ticket claim 쓰기는 연결 표의 현재 상태를 transaction마다 다시 읽는다(tickets#R13). 이 시험은 인증이
// 아니라 그 handler의 검사를 보려고, 같은 연결의 principal을 가진 시험 credential로 claim한다(실제 token은
// 회수 직후 인증에서 먼저 거절된다). 연결 상태는 위의 실제 회수가 정한다. 실제 token의 claim은
// coding-ceiling_test.ts가 본다.
async function claimant(world: World, connection: string): Promise<string> {
  const issued = await world.harness.credential({
    actor: "coding_agent",
    principal: `coding_agent:${connection}`,
    scope: {
      operations: [
        "ClaimTicket",
        "RenewTicketClaim",
        "ReleaseTicketClaim",
        "ShowTicket",
      ],
      targets: {},
    },
    conditions: {},
  });
  assert(issued.ok, issued.ok ? "" : JSON.stringify(issued.error));
  return issued.value.token;
}

Deno.test("coding-agent/connection#R8: 회수 직후 그 credential의 MCP·CLI·앱 direct 요청이 거절되고 닫을 통로를 바로 닫으며 다른 연결은 그대로다", async () => {
  await withWorld(async ({ world, user, connect }) => {
    const child = await world.start();
    const a = await connect("claude");
    const b = await connect("codex");
    const ticket = await readyTicket(world, user);

    const baseUrl = `http://127.0.0.1:${world.harness.port}`;
    const mcpFor = (who: Connected) => {
      const tool = createTicketTool({
        client: createCoreClient({
          baseUrl,
          connection: who.connection,
          provider: () =>
            Promise.resolve({ ok: true, value: { token: who.token } }),
        }),
        now: () => new Date().toISOString(),
        idempotencyKey: () => `mcp-${crypto.randomUUID()}`,
      });
      const route = resolveRoute("lophn_ticket", "show");
      assert(route);
      return async () => {
        const result = await tool("lophn_ticket", route.route, {
          op: "show",
          ticket,
        });
        return (result.data as { code?: string }).code;
      };
    };
    const cliFor = (who: Connected) => async () => {
      const lines: string[] = [];
      const exit = await cliMain([
        "ticket",
        "show",
        "--input",
        JSON.stringify({ ticket }),
        "--connection",
        who.connection,
        "--daemon-url",
        baseUrl,
        "--json",
      ], {
        env: {
          get: (name) =>
            name === "LOPHN_HOME" ? world.harness.dataRoot : undefined,
        },
        provider: () =>
          Promise.resolve({ ok: true, value: { token: who.token } }),
        stdout: new WritableStream<Uint8Array>({
          write(chunk) {
            lines.push(decoder.decode(chunk));
          },
        }),
        stderr: new WritableStream<Uint8Array>(),
        home: world.harness.dataRoot,
        installRoot: world.harness.dataRoot,
      });
      return { exit, text: lines.join("") };
    };
    const mcpA = mcpFor(a);
    const cliA = cliFor(a);
    const connectBody = {
      app: world.app,
      mode: "live",
      screens: ["usage"],
      screen_sizes: { usage: ["full"] },
      commands: ["usage.read"],
    };
    const held = await call(
      world.harness,
      "apps/connect",
      a.token,
      connectBody,
    );
    assertEquals(held.status, 200, JSON.stringify(held.body));
    const invoke = () =>
      direct(
        child.endpoint,
        "POST",
        "/_lophn/commands/invoke",
        authorizationOf(held),
        {
          request_key: `k-${crypto.randomUUID()}`,
          release: child.release,
          command: "usage.read",
        },
      );

    // 회수 전: 같은 credential의 MCP·CLI 읽기와 앱 direct 호출이 닿는다.
    assertEquals(await mcpA(), undefined);
    assertEquals((await cliA()).exit, 0);
    assertEquals((await invoke()).status, 200);
    // 살아 있는 연결의 통로는 닫지 않는다.
    await world.harness.appsControl.sweep();
    assertEquals(world.state.restarts, []);

    // 사람이 confirmation window에서 결정한다. 응답 직후다.
    const target = { connection: a.connection, base_revision: a.revision };
    const decided = await revoke(
      world,
      user,
      target,
      await window(world, "win-revoke", target),
    );
    assertEquals(decided.status, 200, JSON.stringify(decided.body));

    // 앱 통로: 그 credential이 연 프로세스 통로를 닫도록 이미 요청했고 새 연결도 받지 못한다.
    assertEquals(world.state.restarts, [{
      app: world.app,
      nonce: child.nonce,
    }]);
    assertEquals(
      (await call(world.harness, "apps/connect", a.token, connectBody)).status,
      401,
    );
    // MCP: 같은 client가 같은 token으로 보내도 인증에서 거절이다.
    assertEquals(await mcpA(), "unauthorized");
    // CLI: 같은 이유로 실패한다.
    const refused = await cliA();
    assertNotEquals(refused.exit, 0);
    assert(refused.text.includes("unauthorized"), refused.text);
    // 어떤 요청이든 회수 credential은 인증에서 거절이다.
    assertEquals(
      (await read(world, "platform/status", a.token, {})).status,
      401,
    );
    // 다른 연결은 그대로다.
    assert(await active(world, b));
    assertEquals(await mcpFor(b)(), undefined);
    assertEquals(world.state.restarts.length, 1);
  });
});

Deno.test("coding-agent/connection#R8 coding-agent/tickets#R13 coding-agent/tickets#R14: 회수 직후 claim 쓰기는 정리 전에도 거절이고 정리 뒤 ticket은 열리며 과거 결과는 남는다", async () => {
  await withWorld(async ({ world, user, connect }) => {
    const a = await connect("claude");
    const b = await connect("codex");
    const agentA = await claimant(world, a.connection);
    const agentB = await claimant(world, b.connection);
    const ticket = await readyTicket(world, user);
    const first = await read(world, "tickets/show", agentA, { ticket });
    const shown = first.body["ticket"] as { revision: string };
    const claimed = await post(world, "tickets/claim", agentA, {
      ticket,
      base_revision: shown.revision,
    }, { base_revision: shown.revision });
    assertEquals(claimed.status, 200, JSON.stringify(claimed.body));
    const claimSeq = String(claimed.body["claim_seq"]);
    seedCompletion(world, ticket, claimSeq);

    const target = { connection: a.connection, base_revision: a.revision };
    const decided = await revoke(
      world,
      user,
      target,
      await window(world, "win-ticket", target),
    );
    assertEquals(decided.status, 200, JSON.stringify(decided.body));

    // 응답 직후다. claim 정리(sweep)는 아직 돌지 않았고 claim 행이 남아 있다.
    assertEquals(claimRows(world, ticket).claims, 1);
    const current = (
      (await read(world, "tickets/show", agentB, { ticket })).body[
        "ticket"
      ] as { revision: string }
    ).revision;
    for (const route of ["renew_claim", "release_claim"]) {
      const sent = await post(world, `tickets/${route}`, agentA, {
        ticket,
        claim_seq: claimSeq,
        base_revision: current,
      }, { base_revision: current });
      assertEquals(sent.status, 401, `${route} ${JSON.stringify(sent.body)}`);
    }
    // 기한은 남아 있어도 claim은 아직 이 ticket을 쥐고 있어 다른 연결이 가져가지 못한다.
    const early = await post(world, "tickets/claim", agentB, {
      ticket,
      base_revision: current,
    }, { base_revision: current });
    assertNotEquals(early.status, 200);
    assertEquals(claimRows(world, ticket).state, "claimed");

    // 정리: ticket은 다시 열리고 과거 완료 결과는 남으며 이유는 연결 회수다.
    await world.harness.sweepTicketClaims();
    const after = claimRows(world, ticket);
    assertEquals(after.state, "open");
    assertEquals(after.claims, 0);
    assertEquals(after.completions, 1);
    assert(after.released.includes("connection_revoked"));
    const reopened = await read(world, "tickets/show", agentB, { ticket });
    const fresh = reopened.body["ticket"] as { revision: string };
    const taken = await post(world, "tickets/claim", agentB, {
      ticket,
      base_revision: fresh.revision,
    }, { base_revision: fresh.revision });
    assertEquals(taken.status, 200, JSON.stringify(taken.body));
    assertEquals(claimRows(world, ticket).completions, 1);
  });
});

Deno.test("coding-agent/cli#R7 coding-agent/connection#R2 coding-agent/connection#R18: CLI connection revoke는 결정 화면 링크와 기다린다는 사실만 출력하고 연결은 그대로이며 멈췄다고 말하지 않는다", async () => {
  await withWorld(async ({ world, connect }) => {
    const a = await connect("claude");
    const baseUrl = `http://127.0.0.1:${world.harness.port}`;
    for (const env of [{}, { LOPHN_CONNECTION: a.connection }]) {
      const lines: string[] = [];
      const exit = await cliMain([
        "connection",
        "revoke",
        "--connection",
        a.connection,
        "--base-revision",
        a.revision,
        "--daemon-url",
        baseUrl,
        "--json",
      ], {
        env: {
          get: (name) =>
            name === "LOPHN_HOME"
              ? world.harness.dataRoot
              : (env as Record<string, string>)[name],
        },
        provider: () =>
          Promise.resolve({ ok: true, value: { token: a.token } }),
        stdout: new WritableStream<Uint8Array>({
          write(chunk) {
            lines.push(decoder.decode(chunk));
          },
        }),
        stderr: new WritableStream<Uint8Array>(),
        home: world.harness.dataRoot,
        installRoot: world.harness.dataRoot,
      });
      assertNotEquals(exit, 0);
      const text = lines.join("");
      assert(text.includes(`lophn://things-to-confirm/${a.connection}`), text);
      assert(text.includes('"waiting":true'), text);
      assert(text.includes('"revoked":false'), text);
      assertFalse(text.includes(a.token));
      for (const claim of ["종료했", "중단했", "멈췄", "강제로 멈춘다"]) {
        assertFalse(text.includes(claim), claim);
      }
      // 읽기만 했고 연결에는 아무 일도 없다.
      assert(await active(world, a));
    }
  });
});
