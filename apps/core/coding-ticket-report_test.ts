// coding-agent#T25 끝에서 끝까지: 실제 coding credential(fake keychain)·실제 core(임시 LOPHN_HOME)로
// MCP `lophn_ticket report`와 CLI `ticket report`가 summary를 upload_summary로 올린 뒤 준비 참조로
// 보고해 ticket이 reported가 되고, 취소·만료 뒤 보고는 거절이며, coding credential의 ticket 생성·
// 취소는 거절이다. 사람의 실제 keychain·데이터 root는 열지 않는다(keychain은 fake, 데이터 root는
// temp dir).
import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { err, ok, type Result, sha256Hex } from "../../packages/base/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import { createTicketTool } from "../../packages/coding-agent/mcp-server/tools/ticket.ts";
import { resolveRoute } from "../../packages/coding-agent/mcp-server/registry.ts";
import {
  codingCredentialRef,
  createFakeKeychain,
  type FakeKeychain,
} from "../../packages/core/secrets/mod.ts";
import {
  openWorld,
  type World,
} from "../../packages/core/apps/runtime/world_test.ts";
import { cliMain } from "../cli/main.ts";
import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import { ticketDefinitions } from "./tickets.ts";

const VER = "ver_01arz3ndektsv4rrffq69g5fav";
const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
const decoder = new TextDecoder();
const SUMMARY =
  "변경: leaf redaction\n수행한 확인: deno task test\n미실행 확인: 없음\n한계: 없음\n";

type Reply = { status: number; body: Record<string, unknown> };
type Connected = { connection: string; token: string };

async function post(
  world: World,
  path: string,
  token: string,
  input: unknown,
  compare: unknown = {},
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
      }),
    },
  );
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

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
  user: string;
  connect(label: string): Promise<Connected>;
};

async function withWorld(run: (opened: Opened) => Promise<void>) {
  const keychain: FakeKeychain = createFakeKeychain();
  const world = await openWorld({
    approvals: true,
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
    const user = (await world.login("user", [
      "CreateCodingAgentConnection",
      "CreateTicket",
      "MakeTicketReady",
      "CancelTicket",
    ])).token;
    await run({
      world,
      user,
      async connect(label) {
        const connected = await world.harness.codingCredentials!.connect(
          { label, scope: { kind: "app", app: world.app } },
          async (submission): Promise<Result<unknown>> => {
            const sent = await post(
              world,
              "coding_agent_connections/create",
              user,
              submission,
            );
            return sent.status === 200
              ? ok(sent.body)
              : err({ code: "conflict", message: `${sent.status}` });
          },
        );
        assert(connected.ok, connected.ok ? "" : connected.error.message);
        const { connection } = connected.value;
        return {
          connection,
          token: decoder.decode(
            keychain.stored.get(codingCredentialRef(connection)!)!,
          ),
        };
      },
    });
  } finally {
    await world.close();
  }
}

const createInput = (app: string) => ({
  app,
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

async function readyTicket(
  world: World,
  user: string,
): Promise<string> {
  const created = await post(
    world,
    "tickets/create",
    user,
    createInput(world.app),
  );
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

async function revisionOf(
  world: World,
  token: string,
  ticket: string,
): Promise<string> {
  const shown = await read(world, "tickets/show", token, { ticket });
  assertEquals(shown.status, 200, JSON.stringify(shown.body));
  return String((shown.body["ticket"] as { revision: string }).revision);
}

// 이 claim으로 준비된 release 행이다(releases 조립은 apps 몫이라 시험이 직접 심는다).
function seedRelease(
  world: World,
  ticket: string,
  claim: string,
  number: number,
): string {
  const id = `rel_01arz3ndektsv4rrffq69g5fa${number}`;
  const db = new DatabaseSync(`${world.harness.dataRoot}/lophn.db`);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare(
      `INSERT INTO releases (id, app, number, code_commit, bundle_hash, blueprint_hash,
         data_schema, data_changes, ticket_source, created_by, created_at, status,
         blueprint, declarations)
       VALUES (?, ?, ?, ?, ?, ?, 0, '[]', ?, 'coding_agent', ?, 'prepared', '{}', '{}')`,
    ).run(
      id,
      world.app,
      number,
      "a".repeat(40),
      "b".repeat(64),
      "c".repeat(64),
      JSON.stringify({ ticket, claim_seq: claim }),
      new Date().toISOString(),
    );
  } finally {
    db.close();
  }
  return id;
}

function ticketRow(world: World, ticket: string) {
  const db = new DatabaseSync(`${world.harness.dataRoot}/lophn.db`, {
    readOnly: true,
  });
  try {
    return {
      state: db.prepare("SELECT state FROM tickets WHERE id = ?").get(ticket)
        ?.state as string | undefined,
      refs: db.prepare(
        `SELECT hash FROM blob_refs WHERE owner_kind = 'ticket' AND owner_key = ? AND field = 'summary'`,
      ).all(ticket) as { hash: string }[],
      count: (db.prepare("SELECT count(*) AS n FROM tickets").get() as {
        n: number;
      }).n,
    };
  } finally {
    db.close();
  }
}

type ToolReply = {
  isError?: true;
  data: Record<string, unknown>;
};

function mcpTool(world: World, who: Connected) {
  const tool = createTicketTool({
    client: createCoreClient({
      baseUrl: `http://127.0.0.1:${world.harness.port}`,
      connection: who.connection as never,
      provider: () =>
        Promise.resolve({ ok: true, value: { token: who.token } }),
    }),
    now: () => new Date().toISOString(),
    idempotencyKey: () => `mcp-${crypto.randomUUID()}`,
  });
  return async (input: Record<string, unknown>): Promise<ToolReply> => {
    const resolved = resolveRoute("lophn_ticket", String(input.op));
    assert(resolved);
    return await tool("lophn_ticket", resolved.route, input) as ToolReply;
  };
}

async function cli(
  world: World,
  who: Connected | undefined,
  args: string[],
  input: unknown,
): Promise<{ exit: number; text: string }> {
  const lines: string[] = [];
  const sink = () =>
    new WritableStream<Uint8Array>({
      write(chunk) {
        lines.push(decoder.decode(chunk));
      },
    });
  const exit = await cliMain([
    ...args,
    "--input",
    JSON.stringify(input),
    ...(who === undefined ? [] : ["--connection", who.connection]),
    "--daemon-url",
    `http://127.0.0.1:${world.harness.port}`,
    "--json",
  ], {
    env: {
      get: (name) => name === "LOPHN_HOME" ? world.harness.dataRoot : undefined,
    },
    provider: () =>
      Promise.resolve({ ok: true, value: { token: who?.token ?? "" } }),
    stdout: sink(),
    stderr: sink(),
    home: world.harness.dataRoot,
    installRoot: world.harness.dataRoot,
  });
  return { exit, text: lines.join("") };
}

// claim까지 한 ticket이다. 현재 revision과 claim_seq, 이 claim으로 준비된 release를 돌려준다.
async function claimed(
  world: World,
  user: string,
  who: Connected,
  number: number,
) {
  const ticket = await readyTicket(world, user);
  const mcp = mcpTool(world, who);
  const base = await revisionOf(world, who.token, ticket);
  const claim = await mcp({ op: "claim", ticket, base_revision: base });
  assertEquals(claim.isError, undefined, JSON.stringify(claim.data));
  const claimSeq = String(claim.data["claim_seq"]);
  const release = seedRelease(world, ticket, claimSeq, number);
  return {
    ticket,
    claimSeq,
    release,
    mcp,
    revision: () => revisionOf(world, who.token, ticket),
  };
}

Deno.test("coding-agent/mcp-server#R28 coding-agent/cli#R36: MCP report와 CLI report는 summary를 upload_summary로 올린 뒤 준비 참조로 보고해 ticket이 reported가 된다", async () => {
  await withWorld(async ({ world, user, connect }) => {
    const who = await connect("claude");
    const hash = await sha256Hex(new TextEncoder().encode(SUMMARY));

    // MCP: completion seq 없이 release·summary만 낸다.
    const viaMcp = await claimed(world, user, who, 1);
    const reportedByMcp = await viaMcp.mcp({
      op: "report",
      ticket: viaMcp.ticket,
      base_revision: await viaMcp.revision(),
      claim_seq: viaMcp.claimSeq,
      release: viaMcp.release,
      summary: SUMMARY,
    });
    assertEquals(
      reportedByMcp.isError,
      undefined,
      JSON.stringify(reportedByMcp.data),
    );
    const mcpData = reportedByMcp.data as Record<
      string,
      Record<string, unknown>
    >;
    assertEquals(mcpData.report, { accepted: true, state: "reported" });
    assertEquals(mcpData.completion_claim.summary_hash, hash);
    // 보고만으로 확인됨이 되지 않는다. 확인은 아직이고 activation·문제 확인은 조건이 없다.
    assertEquals(mcpData.check.state, "pending");
    assertEquals(mcpData.activation.required, false);
    const mcpRow = ticketRow(world, viaMcp.ticket);
    assertEquals(mcpRow.state, "reported");
    assertEquals(mcpRow.refs.map((ref) => ref.hash), [hash]);

    // CLI: 같은 입력 모양과 같은 흐름이다.
    const viaCli = await claimed(world, user, who, 2);
    const reportedByCli = await cli(world, who, ["ticket", "report"], {
      ticket: viaCli.ticket,
      base_revision: await viaCli.revision(),
      claim_seq: viaCli.claimSeq,
      release: viaCli.release,
      summary: SUMMARY,
    });
    assertEquals(reportedByCli.exit, 0, reportedByCli.text);
    assert(reportedByCli.text.includes('"accepted":true'), reportedByCli.text);
    const cliRow = ticketRow(world, viaCli.ticket);
    assertEquals(cliRow.state, "reported");
    assertEquals(cliRow.refs.map((ref) => ref.hash), [hash]);
  });
});

Deno.test("coding-agent/mcp-server#R27 coding-agent/cli#R36: 취소·만료 뒤 보고는 거절이고 통로가 갱신하지 않는다", async () => {
  await withWorld(async ({ world, user, connect }) => {
    const who = await connect("claude");

    // 사람이 취소한 뒤: MCP·CLI 보고가 모두 거절이고 ticket은 취소된 채다.
    const cancelledTicket = await claimed(world, user, who, 3);
    const cancelRevision = await cancelledTicket.revision();
    const cancelled = await post(world, "tickets/cancel", user, {
      ticket: cancelledTicket.ticket,
      base_revision: cancelRevision,
      reason: "더 이상 필요 없다",
    }, { base_revision: cancelRevision });
    assertEquals(cancelled.status, 200, JSON.stringify(cancelled.body));
    const afterCancel = {
      ticket: cancelledTicket.ticket,
      base_revision: await cancelledTicket.revision(),
      claim_seq: cancelledTicket.claimSeq,
      release: cancelledTicket.release,
      summary: SUMMARY,
    };
    const mcpRefused = await cancelledTicket.mcp({
      op: "report",
      ...afterCancel,
    });
    assertEquals(mcpRefused.isError, true);
    assertEquals(
      (mcpRefused.data["report"] as { accepted: boolean }).accepted,
      false,
    );
    const cliRefused = await cli(world, who, ["ticket", "report"], afterCancel);
    assertNotEquals(cliRefused.exit, 0);
    assert(cliRefused.text.includes('"accepted":false'), cliRefused.text);
    const cancelledRow = ticketRow(world, cancelledTicket.ticket);
    assertEquals(cancelledRow.state, "cancelled");
    assertEquals(cancelledRow.refs, []);

    // 만료 뒤: claim 기한(1시간)이 지나 core의 정리가 claim을 풀면 보고는 거절이다. 통로가 갱신하지
    // 않아 ticket은 열린 채다.
    const lapsed = await claimed(world, user, who, 4);
    const lapsedRevision = await lapsed.revision();
    world.harness.clock.advance(3_600_000);
    await world.harness.sweepTicketClaims();
    const expired = await lapsed.mcp({
      op: "report",
      ticket: lapsed.ticket,
      base_revision: lapsedRevision,
      claim_seq: lapsed.claimSeq,
      release: lapsed.release,
      summary: SUMMARY,
    });
    assertEquals(expired.isError, true, JSON.stringify(expired.data));
    assertEquals(expired.data["code"], "conflict");
    assertEquals(ticketRow(world, lapsed.ticket).state, "open");
  });
});

Deno.test("coding-agent/cli#R37: coding credential은 ticket 생성·취소가 거절이고 사람의 CLI는 아무것도 바꾸지 않고 결정 화면 링크로 넘긴다", async () => {
  await withWorld(async ({ world, user, connect }) => {
    const who = await connect("claude");
    const mine = await claimed(world, user, who, 5);
    const before = ticketRow(world, mine.ticket);

    // core: coding token은 ticket 생성·취소 route가 상한 밖이다.
    const created = await post(
      world,
      "tickets/create",
      who.token,
      createInput(world.app),
    );
    assertEquals(created.status, 403, JSON.stringify(created.body));
    const revision = await mine.revision();
    const cancelled = await post(world, "tickets/cancel", who.token, {
      ticket: mine.ticket,
      base_revision: revision,
      reason: "취소해 본다",
    }, { base_revision: revision });
    assertEquals(cancelled.status, 403, JSON.stringify(cancelled.body));

    // CLI: 연결 참조로 시작하면 실행 전 거절이다(core에 닿지 않는다).
    const createRefused = await cli(
      world,
      who,
      ["ticket", "create"],
      createInput(world.app),
    );
    assertNotEquals(createRefused.exit, 0);
    assert(createRefused.text.includes("forbidden"), createRefused.text);
    const cancelRefused = await cli(world, who, ["ticket", "cancel"], {
      ticket: mine.ticket,
      base_revision: revision,
      reason: "취소해 본다",
    });
    assertNotEquals(cancelRefused.exit, 0);
    assert(cancelRefused.text.includes("forbidden"), cancelRefused.text);
    // 같은 필수 입력 검사: 취소 사유가 없으면 사람의 CLI도 실행 전 거절이다.
    const noReason = await cli(world, undefined, ["ticket", "cancel"], {
      ticket: mine.ticket,
      base_revision: revision,
    });
    assertNotEquals(noReason.exit, 0);
    assert(noReason.text.includes("invalid_input"), noReason.text);

    // 사람의 CLI: 사람 credential을 읽지 않으므로 아무것도 만들거나 취소하지 않고 링크만 낸다.
    const guided = await cli(world, undefined, ["ticket", "cancel"], {
      ticket: mine.ticket,
      base_revision: revision,
      reason: "더 이상 필요 없다",
    });
    assert(
      guided.text.includes(`lophn://things-to-confirm/${mine.ticket}`),
      guided.text,
    );
    assert(guided.text.includes('"applied":false'), guided.text);
    const after = ticketRow(world, mine.ticket);
    assertEquals(after.state, before.state);
    assertEquals(after.count, before.count);
  });
});
