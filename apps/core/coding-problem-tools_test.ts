// coding-agent#T44 끝에서 끝까지: 실제 core(임시 LOPHN_HOME)와 앱 하나 범위의 실제 coding connection
// (fake keychain)으로 MCP `lophn_problem`과 CLI `problem …`을 시험한다. 문제는 실제 record-report로 만들고
// repair ticket은 실제 create·make_ready·claim으로 만든다. 사람의 실제 keychain·데이터 root는 열지 않는다
// (keychain은 fake, 데이터 root는 temp dir). release 행만 sqlite로 심는다(release 조립은 apps 몫이다).
import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { err, ok, type Result, sha256Hex } from "../../packages/base/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import { createProblemTool } from "../../packages/coding-agent/mcp-server/tools/problem.ts";
import { createTicketTool } from "../../packages/coding-agent/mcp-server/tools/ticket.ts";
import { resolveRoute } from "../../packages/coding-agent/mcp-server/registry.ts";
import { MCP_PROBLEM_TOOLS } from "../../packages/contracts/coding-agent/mod.ts";
import { objectPathFor } from "../../packages/platform/blob-store/mod.ts";
import {
  codingCredentialRef,
  createFakeKeychain,
  type FakeKeychain,
} from "../../packages/platform/secrets/mod.ts";
import {
  openWorld,
  type World,
} from "../../packages/apps/runtime/world_test.ts";
import { cliMain } from "../cli/main.ts";
import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import {
  problemsReportDefinitions,
  problemsTestDefinitions,
} from "./problems.ts";
import { ticketDefinitions } from "./tickets.ts";

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const VER = "ver_01arz3ndektsv4rrffq69g5fav";
const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
const REL_BEFORE = "rel_01arz3ndektsv4rrffq69g5fa1";
const REL_AFTER = "rel_01arz3ndektsv4rrffq69g5fa2";
const AFTER_BUNDLE = "b".repeat(64);
const SUMMARY =
  "변경: leaf redaction\n수행한 확인: deno task test\n한계: 없음\n";

type Reply = { status: number; body: Record<string, unknown> };
type Connected = { connection: string; token: string };
type ToolReply = {
  isError?: true;
  summary: string;
  data: Record<string, unknown>;
  next: string[];
};

async function post(
  world: World,
  path: string,
  token: string,
  body: unknown,
): Promise<Reply> {
  const response = await fetch(
    `http://127.0.0.1:${world.harness.port}/v1/${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  );
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

const envelope = (input: unknown, compare: unknown = {}) => ({
  input,
  idempotency_key: `k-${crypto.randomUUID()}`,
  compare,
  prepared: [],
});

const rpt = (n: number) =>
  `rpt_01arz3ndektsv4rrffq69g5f${String(n).padStart(2, "0")}`;
const snp = (n: number) =>
  `snp_01arz3ndektsv4rrffq69g5f${String(n).padStart(2, "0")}`;

type Prepared = {
  preparation: string;
  principal: string;
  purpose: string;
  hash: string;
  size_bytes: number;
};

async function prepare(
  world: World,
  principal: string,
  purpose: string,
  text: string,
): Promise<Prepared> {
  const prepared = await world.harness.prepareBlob({
    principal,
    purpose,
    bytes: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    }),
  });
  assert(prepared.ok, prepared.ok ? "" : prepared.error.message);
  return prepared.value as Prepared;
}

// log가 붙은 exception 보고 하나다. 같은 앱의 같은 group key라 한 문제로 묶인다.
function reportInput(
  principal: string,
  app: string,
  n: number,
  logs: Prepared,
  discriminator: string,
) {
  const at = new Date(Date.now() - 600_000 + n * 1000).toISOString();
  return {
    report: {
      id: rpt(n),
      app,
      mode: "live",
      diagnostic_scope: null,
      release: REL_BEFORE,
      release_missing_reason: null,
      bundle_hash: "a".repeat(64),
      source: "exception",
      code: "_exception",
      text: null,
      details: null,
      snapshot: snp(n),
      observed_at: at,
      principal,
      content_hash: String(n).padStart(2, "0").repeat(32),
    },
    snapshot: {
      id: snp(n),
      captured_at: at,
      invocation: {
        id: "inv_01arz3ndektsv4rrffq69g5fav",
        binding: "sdk_context",
        record_missing_reason: null,
      },
      invocation_missing_reason: null,
      error: {
        name: "TypeError",
        message: `boom ${n}`,
        message_missing_reason: null,
        frames: [{ path: "src/leaf.ts", function: null, line: 1, column: 1 }],
        source_missing_reason: null,
        stack: null,
        stack_missing_reason: { reason: "stack unavailable" },
        truncation_notes: [],
      },
      error_missing_reason: null,
      logs: {
        blob: logs.hash,
        line_count: 3,
        truncated: false,
        scope: "process",
        from_at: null,
        to_at: null,
        collected_at: at,
      },
      logs_missing_reason: null,
      screen: null,
      screen_missing_reason: { reason: "not collected" },
    },
    group_key: { kind: "exception", code: "_exception", discriminator },
    existing_problem: null,
    blobs: [{
      hash: logs.hash,
      size_bytes: logs.size_bytes,
      purpose: logs.purpose,
      source: { kind: "prepared", blob: logs },
    }],
    origin: {
      context: {
        authentication: {
          principal,
          actor: "machine",
          scope: { operations: ["RecordReport"], targets: {} },
          conditions: {},
          credential_ref: `cred-${n}`,
        },
        app,
        mode: "live",
        diagnostic_scope: null,
        release: REL_BEFORE,
        release_missing_reason: null,
        bundle_hash: "a".repeat(64),
        binding: "sdk",
        origin: "process_observer",
      },
      report_id: rpt(n),
      content_hash: String(n).padStart(2, "0").repeat(32),
    },
  };
}

type Opened = {
  world: World;
  user: string;
  coding: Connected;
  // 이 앱 하나 범위가 아닌 다른 앱의 문제다(범위 밖 대상).
  outsideProblem: string;
  problem: string;
  outsideSnapshot: string;
  connect(label: string): Promise<Connected>;
};

async function withWorld(run: (opened: Opened) => Promise<void>) {
  const keychain: FakeKeychain = createFakeKeychain();
  const world = await openWorld({
    approvals: true,
    extend: {
      teams: [
        { codingAgentConnectionDefinitions },
        { ticketDefinitions },
        { problemsTestDefinitions },
        { problemsReportDefinitions },
      ],
      teamModules: [
        new URL("./coding-agent.ts", import.meta.url).href,
        new URL("./tickets.ts", import.meta.url).href,
        new URL("./problems.ts", import.meta.url).href,
        new URL("./ticket-claim-ports_test.ts", import.meta.url).href,
        new URL("./repair-context-ports_test.ts", import.meta.url).href,
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
      "app.create",
    ])).token;
    const machine = await world.login("machine", ["RecordReport"]);
    const connect = async (label: string): Promise<Connected> => {
      const connected = await world.harness.codingCredentials!.connect(
        { label, scope: { kind: "app", app: world.app } },
        async (submission): Promise<Result<unknown>> => {
          const sent = await post(
            world,
            "coding_agent_connections/create",
            user,
            envelope(submission),
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
    };
    const made = await post(
      world,
      "apps/create",
      user,
      envelope({ slug: "other", name: "Other", description: "other app" }),
    );
    assertEquals(made.status, 200, JSON.stringify(made.body));
    const otherApp = String(made.body["id"]);
    const record = async (
      app: string,
      n: number,
      discriminator: string,
    ): Promise<string> => {
      const logs = await prepare(
        world,
        machine.context.principal,
        "snapshot_logs",
        `line 1 ${n}\nline 2\nline 3\n`,
      );
      const sent = await post(
        world,
        "problems/record-report",
        machine.token,
        envelope(
          reportInput(machine.context.principal, app, n, logs, discriminator),
          { active_release: REL_BEFORE, problem_seq: null },
        ),
      );
      assertEquals(sent.status, 200, JSON.stringify(sent.body));
      return String(sent.body["problem"]);
    };
    const problem = await record(world.app, 1, rpt(1));
    const outsideProblem = await record(otherApp, 40, rpt(40));
    assertNotEquals(problem, outsideProblem);
    seedReleases(world);
    await run({
      world,
      user,
      coding: await connect("claude"),
      problem,
      outsideProblem,
      outsideSnapshot: snp(40),
      connect,
    });
  } finally {
    await world.close();
  }
}

// 고친 release 두 개다(준비된 release 조립은 apps 몫이라 시험이 직접 심는다).
function seedReleases(world: World): void {
  const db = new DatabaseSync(`${world.harness.dataRoot}/lophn.db`);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const insert = db.prepare(
      `INSERT INTO releases (id, app, number, code_commit, bundle_hash, blueprint_hash,
         data_schema, data_changes, ticket_source, created_by, created_at, status,
         blueprint, declarations)
       VALUES (?, ?, ?, ?, ?, ?, 0, '[]', NULL, 'coding_agent', ?, 'prepared', '{}', '{}')`,
    );
    const at = new Date().toISOString();
    insert.run(
      REL_BEFORE,
      world.app,
      1,
      "a".repeat(40),
      "a".repeat(64),
      "c".repeat(64),
      at,
    );
    insert.run(
      REL_AFTER,
      world.app,
      2,
      "a".repeat(40),
      AFTER_BUNDLE,
      "c".repeat(64),
      at,
    );
  } finally {
    db.close();
  }
}

function rows<T>(world: World, sql: string, ...params: string[]): T[] {
  const db = new DatabaseSync(`${world.harness.dataRoot}/lophn.db`, {
    readOnly: true,
  });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

function fixCounts(world: World, problem: string) {
  return {
    events: rows<{ n: number }>(
      world,
      "select count(*) as n from events where type = 'ProblemFixRecorded' and subject = ?",
      problem,
    )[0].n,
    refs: rows<{ n: number }>(
      world,
      "select count(*) as n from blob_refs where owner_kind = 'problem_fix' and owner_key = ? and field = 'summary'",
      problem,
    )[0].n,
  };
}

function claimRows(world: World) {
  return rows<Record<string, unknown>>(
    world,
    "select ticket, connection, claim_seq, expires_at from ticket_claims order by ticket",
  );
}

const createRepair = (app: string, problem: string) => ({
  app,
  kind: "repair",
  title: "fix leaf redaction",
  what: "redact leaf before snapshot",
  why: "snapshot shows the raw leaf",
  references: [],
  adoption_questions: [],
  conditions: [],
  inspect: ["src/leaf.ts"],
  preserve: ["docs/leaf.md"],
  problems: [problem],
  readiness: "needs_confirmation",
  needs: ["confirm the redaction"],
});

async function readTicketRevision(
  world: World,
  token: string,
  ticket: string,
): Promise<string> {
  const shown = await post(world, "tickets/show", token, { ticket });
  assertEquals(shown.status, 200, JSON.stringify(shown.body));
  return String((shown.body["ticket"] as { revision: string }).revision);
}

function ticketTool(world: World, who: Connected) {
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
  return async (input: Record<string, unknown>) => {
    const resolved = resolveRoute("lophn_ticket", String(input.op));
    assert(resolved);
    return await tool("lophn_ticket", resolved.route, input) as unknown as {
      isError?: true;
      data: Record<string, unknown>;
    };
  };
}

// 지정 repair ticket을 사람이 만들고 준비한 뒤 이 연결이 claim한다.
async function claimedRepair(
  opened: Opened,
): Promise<{ ticket: string; claimSeq: string }> {
  const { world, user, coding, problem } = opened;
  const created = await post(
    world,
    "tickets/create",
    user,
    envelope(createRepair(world.app, problem)),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const ticket = String(created.body["ticket"]);
  const revision = String(created.body["revision"]);
  const ready = await post(
    world,
    "tickets/make_ready",
    user,
    envelope({
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
      conditions: [{ kind: "app_test" }],
      inspect: ["src/leaf.ts"],
      preserve: ["docs/leaf.md"],
    }, { base_revision: revision }),
  );
  assertEquals(ready.status, 200, JSON.stringify(ready.body));
  const tickets = ticketTool(world, coding);
  const claim = await tickets({
    op: "claim",
    ticket,
    base_revision: await readTicketRevision(world, coding.token, ticket),
  });
  assertEquals(claim.isError, undefined, JSON.stringify(claim.data));
  return { ticket, claimSeq: String(claim.data["claim_seq"]) };
}

function mcp(world: World, who: Connected) {
  const tool = createProblemTool({
    client: createCoreClient({
      baseUrl: `http://127.0.0.1:${world.harness.port}`,
      connection: who.connection as never,
      provider: () =>
        Promise.resolve({ ok: true, value: { token: who.token } }),
    }),
    now: () => new Date().toISOString(),
    idempotencyKey: () => `mcp-problem-${crypto.randomUUID()}`,
    connection: who.connection,
    wait: { budget_ms: 0, interval_ms: 1 },
  });
  const schema = MCP_PROBLEM_TOOLS[0].input;
  return async (input: Record<string, unknown>): Promise<ToolReply> => {
    // server가 tool 입력을 먼저 검사한다(R6). 같은 검사를 거쳐 보낸다.
    const parsed = schema.parse(input);
    const resolved = resolveRoute("lophn_problem", String(input.op));
    assert(resolved);
    return await tool(
      "lophn_problem",
      resolved.route,
      parsed,
    ) as unknown as ToolReply;
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

const fixOf = (
  problem: string,
  problemSeq: string,
  ticket: string,
  claimSeq: string,
  extra: Record<string, unknown> = {},
) => ({
  problem,
  problem_seq: problemSeq,
  fix: {
    before: REL_BEFORE,
    after: REL_AFTER,
    verification: [],
    ticket,
    claim_seq: claimSeq,
  },
  summary: SUMMARY,
  ...extra,
});

async function problemSeq(
  call: (input: Record<string, unknown>) => Promise<ToolReply>,
  problem: string,
): Promise<string> {
  const shown = await call({ op: "show", problem });
  assertEquals(shown.isError, undefined, shown.summary);
  return String((shown.data["problem"] as { seq: string }).seq);
}

Deno.test("coding-agent/mcp-server#R24 coding-agent/cli#R33: MCP·CLI 문제 읽기는 처리 대상을 가르고 claim을 만들거나 갱신하지 않는다", async () => {
  await withWorld(async (opened) => {
    const { world, coding, problem } = opened;
    const claimed = await claimedRepair(opened);
    const before = claimRows(world);
    assertEquals(before.length, 1);
    const call = mcp(world, coding);

    const listed = await call({ op: "list", app: world.app });
    assertEquals(listed.isError, undefined, listed.summary);
    const list = listed.data["problems"] as {
      id: string;
      handler: string;
    }[];
    // 범위 밖 앱의 문제는 이 연결의 목록에 없다.
    assertEquals(list.map((row) => row.id), [problem]);
    // 선언의 fixer가 user가 아니므로 coding agent 처리 대상이다.
    assertEquals(list[0].handler, "coding_agent");
    const human = await call({ op: "list", app: world.app, handler: "user" });
    assertEquals((human.data["problems"] as unknown[]).length, 0);
    const agent = await call({
      op: "list",
      app: world.app,
      handler: "coding_agent",
    });
    assertEquals((agent.data["problems"] as unknown[]).length, 1);

    assertEquals((await call({ op: "show", problem })).isError, undefined);
    const fixes = await call({ op: "fix_records", problem });
    assertEquals(fixes.isError, undefined, fixes.summary);
    assertEquals(fixes.data["fixes"], []);
    const summary = await call({
      op: "summary",
      selector: { ticket: claimed.ticket },
    });
    assertEquals(summary.isError, undefined, summary.summary);

    // CLI도 같은 읽기이고 같은 결과다.
    const viaCli = await cli(world, coding, ["problem", "list"], {
      app: world.app,
      handler: "coding_agent",
    });
    assertEquals(viaCli.exit, 0, viaCli.text);
    assert(viaCli.text.includes(problem), viaCli.text);
    const shownByCli = await cli(world, coding, ["problem", "show"], {
      problem,
    });
    assertEquals(shownByCli.exit, 0, shownByCli.text);

    // 어떤 읽기도 claim을 만들거나 갱신하지 않는다.
    assertEquals(claimRows(world), before);
    // 범위 밖 문제는 없는 문제와 같은 답이다.
    const absent = await call({
      op: "show",
      problem: "prb_01arz3ndektsv4rrffq69g5fb9",
    });
    const outside = await call({ op: "show", problem: opened.outsideProblem });
    assertEquals(outside.isError, true);
    assertEquals(outside.summary, absent.summary);
    assertEquals(outside.data, absent.data);
  });
});

Deno.test("coding-agent/mcp-server#R25 coding-agent/cli#R34: record_fix는 summary를 저장한 blob의 준비 증거로 기록하고 현재 claim이 없으면 거절한다", async () => {
  await withWorld(async (opened) => {
    const { world, coding, problem } = opened;
    const claimed = await claimedRepair(opened);
    const call = mcp(world, coding);
    const hash = await sha256Hex(encoder.encode(SUMMARY));
    assertEquals(fixCounts(world, problem), { events: 0, refs: 0 });

    // 현재 claim이 아니면 거절이고 event·blob 참조가 남지 않는다: 다른 claim_seq.
    const seq = await problemSeq(call, problem);
    const wrongClaim = await call({
      op: "record_fix",
      ...fixOf(problem, seq, claimed.ticket, "9999"),
    });
    assertEquals(wrongClaim.isError, true, wrongClaim.summary);
    assertEquals(wrongClaim.data["code"], "conflict");
    assertEquals(wrongClaim.data["recorded"], false);
    assertEquals(fixCounts(world, problem), { events: 0, refs: 0 });

    // 현재 claim 아래 MCP 기록이다.
    const recorded = await call({
      op: "record_fix",
      ...fixOf(problem, seq, claimed.ticket, claimed.claimSeq),
    });
    assertEquals(recorded.isError, undefined, recorded.summary);
    assertEquals(recorded.data["recorded"], true);
    assertEquals(
      (recorded.data["fix"] as { summary_hash: string }).summary_hash,
      hash,
    );
    assertEquals(fixCounts(world, problem), { events: 1, refs: 1 });
    // 기록이 가리키는 바이트가 실제로 저장되어 있다(저장하지 않은 blob의 hash를 만들지 않는다).
    const stored = await Deno.readFile(
      objectPathFor(world.harness.dataRoot, hash),
    );
    assertEquals(decoder.decode(stored), SUMMARY);
    const listed = await call({ op: "fix_records", problem });
    const fixes = listed.data["fixes"] as {
      fix: { summary: string; ticket: string; claim_seq: string };
    }[];
    assertEquals(fixes.length, 1);
    assertEquals(fixes[0].fix.summary, hash);
    assertEquals(fixes[0].fix.ticket, claimed.ticket);
    assertEquals(fixes[0].fix.claim_seq, claimed.claimSeq);
    // 기록은 문제를 닫지 않는다.
    const shown = await call({ op: "show", problem });
    assertEquals(
      (shown.data["problem"] as { status: string }).status,
      "fixing",
    );

    // CLI도 같은 흐름이다: 새 문제 seq로 같은 claim 아래 한 번 더 기록한다.
    const next = await problemSeq(call, problem);
    const viaCli = await cli(
      world,
      coding,
      ["problem", "record-fix"],
      fixOf(problem, next, claimed.ticket, claimed.claimSeq, {
        summary: "다음 기록\n",
      }),
    );
    assertEquals(viaCli.exit, 0, viaCli.text);
    assertEquals(fixCounts(world, problem), { events: 2, refs: 2 });

    // 반납한 claim으로는 기록하지 못한다. 통로가 claim을 갱신하지도 않는다.
    const tickets = ticketTool(world, coding);
    const released = await tickets({
      op: "release",
      ticket: claimed.ticket,
      base_revision: await readTicketRevision(
        world,
        coding.token,
        claimed.ticket,
      ),
      claim_seq: claimed.claimSeq,
    });
    assertEquals(released.isError, undefined, JSON.stringify(released.data));
    assertEquals(claimRows(world), []);
    const afterRelease = await call({
      op: "record_fix",
      ...fixOf(
        problem,
        await problemSeq(call, problem),
        claimed.ticket,
        claimed.claimSeq,
      ),
    });
    assertEquals(afterRelease.isError, true);
    assertEquals(afterRelease.data["code"], "conflict");
    assertEquals(fixCounts(world, problem), { events: 2, refs: 2 });
    assertEquals(claimRows(world), []);
  });
});

Deno.test("coding-agent/mcp-server#R25 coding-agent/cli#R26 coding-agent/cli#R34: reproduction test는 지정 ticket의 현재 claim이 있어야 하고 요청이 돌 수 없으면 성공으로 읽히지 않는다", async () => {
  await withWorld(async (opened) => {
    const { world, coding, problem } = opened;
    const claimed = await claimedRepair(opened);
    const call = mcp(world, coding);
    const request = (key: string, claimSeq: string, kind = "reproduction") => ({
      op: "test",
      ticket_source: { ticket: claimed.ticket, claim_seq: claimSeq },
      request_key: key,
      kind,
      app: world.app,
      target: { bundle_hash: AFTER_BUNDLE, release: REL_AFTER },
      problem,
      basis_seq: "1",
      reports: [rpt(1)],
      before: REL_BEFORE,
      after: REL_AFTER,
      ticket: null,
      test: "9".repeat(64),
    });

    // 현재 claim이 아니면 runner에 닿기 전에 거절이다.
    const stale = await call(request("repro-stale", "9999"));
    assertEquals(stale.isError, true, stale.summary);
    assertEquals(stale.data["code"], "conflict");
    // reproduction이 아닌 종류는 이 tool의 몫이 아니다(app test로 요청한다).
    const wrongKind = await call({
      ...request("repro-kind", claimed.claimSeq, "app_test"),
      problem: null,
      basis_seq: null,
      reports: [],
      before: null,
      after: null,
      target: { bundle_hash: AFTER_BUNDLE, release: null },
    });
    assertEquals(wrongKind.isError, true);
    assertEquals(wrongKind.data["code"], "invalid_input");

    // 현재 claim 아래 요청이다. runner가 아직 이어지지 않았으므로 실제 pass가 될 수 없고, 성공 pass로
    // 읽히지 않는다(미실행·접수 대기·판정 불가·거절 중 하나).
    const sent = await call(request("repro-1", claimed.claimSeq));
    const state = (sent.data as { state?: string }).state;
    assert(
      sent.isError === true || state === "accepted" || state === "running",
      JSON.stringify(sent),
    );
    assertNotEquals(state, "pass");
    assertNotEquals((sent.data as { real_test?: boolean }).real_test, true);

    // CLI `app test --kind reproduction`도 같은 요청과 같은 결과 읽기다: pass로 끝나지 않는다.
    const viaCli = await cli(world, coding, ["app", "test"], {
      app: world.app,
      kind: "reproduction",
      request_key: "repro-cli-1",
      target: { bundle_hash: AFTER_BUNDLE, release: REL_AFTER },
      problem,
      basis_seq: "1",
      reports: [rpt(1)],
      before: REL_BEFORE,
      after: REL_AFTER,
      ticket: null,
      test: "9".repeat(64),
    });
    assert(!viaCli.text.includes('"state":"pass"'), viaCli.text);
    // 시험 결과를 입력으로 받는 경로는 없다: test result 입력 field는 tool 입력이 거절한다.
    assertEquals(
      MCP_PROBLEM_TOOLS[0].input.safeParse({
        ...request("repro-forged", claimed.claimSeq),
        result: "pass",
      }).success,
      false,
    );
  });
});

Deno.test("coding-agent/cli#R33: attachment open은 이 연결 범위의 허용 첨부 참조만 내고 범위 밖은 없는 것과 같다", async () => {
  await withWorld(async (opened) => {
    const { world, coding, problem } = opened;
    const absentSnapshot = "snp_01arz3ndektsv4rrffq69g5fb9";
    const inScope = await cli(
      world,
      coding,
      ["problem", "attachment", "open"],
      {
        problem,
        snapshot: snp(1),
        item: "logs",
      },
    );
    assertEquals(inScope.exit, 0, inScope.text);
    const body = JSON.parse(inScope.text) as {
      data: {
        attachments: {
          kind: string;
          size_bytes: number;
          open: Record<string, unknown>;
        }[];
        content_delivered: boolean;
      };
    };
    assertEquals(body.data.content_delivered, false);
    assertEquals(body.data.attachments.length, 1);
    assertEquals(body.data.attachments[0].kind, "log");
    assertEquals(body.data.attachments[0].open["kind"], "report_attachment");
    // 운영 경로·저장 위치·hash를 내지 않는다.
    const logHash = rows<{ hash: string }>(
      world,
      "select hash from blob_refs where owner_kind = 'report' and owner_key = ? and field = 'snapshot_logs'",
      rpt(1),
    )[0].hash;
    assert(!inScope.text.includes(world.harness.dataRoot), inScope.text);
    assert(!inScope.text.includes(logHash), inScope.text);
    assert(!inScope.text.includes("objects"), inScope.text);

    // 범위 밖 앱의 문제·snapshot, 문제와 맞지 않는 snapshot, 없는 snapshot은 모두 같은 답이다.
    const absent = await cli(world, coding, ["problem", "attachment", "open"], {
      problem,
      snapshot: absentSnapshot,
    });
    assertNotEquals(absent.exit, 0);
    const outsideProblem = await cli(
      world,
      coding,
      ["problem", "attachment", "open"],
      { problem: opened.outsideProblem, snapshot: opened.outsideSnapshot },
    );
    const crossed = await cli(
      world,
      coding,
      ["problem", "attachment", "open"],
      { problem, snapshot: opened.outsideSnapshot },
    );
    assertEquals(outsideProblem.exit, absent.exit);
    assertEquals(outsideProblem.text, absent.text);
    assertEquals(crossed.text, absent.text);
    // snapshot item이 첨부가 아닌 증거(invocation)도 없는 것과 같다.
    const notAttachment = await cli(
      world,
      coding,
      ["problem", "attachment", "open"],
      { problem, snapshot: snp(1), item: "invocation" },
    );
    assertEquals(notAttachment.text, absent.text);
  });
});

Deno.test("coding-agent/cli#R7 coding-agent/cli#R35: coding credential는 사람 전용 문제 command가 거절이고 사람의 CLI도 접수·닫음 없이 결정 화면 링크만 낸다", async () => {
  await withWorld(async (opened) => {
    const { world, coding, problem } = opened;
    const reports = () =>
      rows<{ n: number }>(world, "select count(*) as n from reports")[0].n;
    const statusOf = () =>
      rows<{ status: string }>(
        world,
        "select status from problems where id = ?",
        problem,
      )[0].status;
    const before = { reports: reports(), status: statusOf() };
    const inputs: [string, Record<string, unknown>][] = [
      ["report", { app: world.app, symptom: "save 버튼이 동작하지 않는다" }],
      ["request-repair", { problem }],
      ["confirm", { problem, evidence: "재현 절차가 통과했다" }],
      ["dismiss", { problem, reason: "이미 고쳐졌다", false_alarm: true }],
    ];
    for (const [name, input] of inputs) {
      // coding credential(연결 참조)은 실행 전 거절이다. core에 닿지 않는다.
      const refused = await cli(world, coding, ["problem", name], input);
      assertNotEquals(refused.exit, 0, name);
      assert(refused.text.includes("forbidden"), refused.text);
      // 사람의 CLI는 접수하지 않는다: 결정 화면 링크와 대기 사실만 나온다.
      const guided = await cli(world, undefined, ["problem", name], input);
      assertNotEquals(guided.exit, 0, name);
      assert(guided.text.includes("lophn://things-to-confirm/"), guided.text);
      for (const fact of ["applied", "agent_started", "problem_closed"]) {
        assert(guided.text.includes(`"${fact}":false`), guided.text);
      }
    }
    // 사람 확인은 대기 사실이다. 테스트 통과나 닫힘이 아니다.
    const confirm = await cli(world, undefined, ["problem", "confirm"], {
      problem,
      evidence: "재현 절차가 통과했다",
    });
    assert(confirm.text.includes('"human_confirmation":"pending"'));
    // 어느 호출도 보고·문제 상태를 바꾸지 않았다(feedback 접수 없음, 닫힘 없음).
    assertEquals({ reports: reports(), status: statusOf() }, before);
    assertEquals(
      rows<{ n: number }>(
        world,
        "select count(*) as n from events where type in ('ProblemClosed', 'ProblemConfirmationRecorded')",
      )[0].n,
      0,
    );
  });
});
