// coding-agent#T47. app-broken 6–7과 verify-app-repair 2의 coding agent 단계,
// 그리고 범위 밖·회수된 연결의 수리 요청 거절. 수리 script는 stdio JSON-RPC로
// 테스트 bridge를 부르고, bridge는 실제 core tool을 부른다. 제품 MCP·실제
// keychain·실제 model은 띄우지 않는다. release 행만 sqlite로 심는다.
// ticket_source는 준비 내용이라 INSERT 때만 넣고 UPDATE하지 않는다.
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../../packages/base/mod.ts";
import { createCoreClient } from "../../../packages/coding-agent/connection/client/core.ts";
import { UNREADABLE_MESSAGE } from "../../../packages/coding-agent/connection/unreadable.ts";
import { resolveRoute } from "../../../packages/coding-agent/mcp-server/registry.ts";
import { createProblemTool } from "../../../packages/coding-agent/mcp-server/tools/problem.ts";
import { createTicketTool } from "../../../packages/coding-agent/mcp-server/tools/ticket.ts";
import {
  connectionRevoke,
  REPAIR_CONTEXT_BYTES,
  REPAIR_CONTEXT_LINES,
  REPAIR_CONTEXT_SUMMARY_MAX_CHARS,
  SECTION_KINDS,
} from "../../../packages/protocol/coding-agent/mod.ts";
import { confirmationBinding } from "../../../packages/platform/identity/mod.ts";
import {
  codingCredentialRef,
  createFakeKeychain,
  type FakeKeychain,
} from "../../../packages/platform/secrets/mod.ts";
import {
  openWorld,
  type World,
} from "../../../packages/apps/runtime/world_test.ts";
import { codingAgentConnectionDefinitions } from "../../../apps/core/coding-agent.ts";
import {
  problemsReportDefinitions,
  problemsTestDefinitions,
} from "../../../apps/core/problems.ts";
import { ticketDefinitions } from "../../../apps/core/tickets.ts";
import {
  REPAIR_STAGES,
  type RepairScriptResult,
  type RepairStage,
  runRepairScript,
} from "../../../tools/fake-coding-agent/repair.ts";

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BRIDGE = fileURLToPath(new URL("./mcp-bridge.ts", import.meta.url));
const VER = "ver_01arz3ndektsv4rrffq69g5fav";
const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
const ABSENT = "tkt_01arz3ndektsv4rrffq69g5fb9";
const REL_BEFORE = "rel_01arz3ndektsv4rrffq69g5fa1";
const REL_AFTER = "rel_01arz3ndektsv4rrffq69g5fa2";
const REL_OTHER = "rel_01arz3ndektsv4rrffq69g5fa3";
const BUNDLE_BEFORE = "a".repeat(64);
const BUNDLE_AFTER = "b".repeat(64);
const BUNDLE_OTHER = "c".repeat(64);
const TEST_HASH = "9".repeat(64);
const COMMIT = "a".repeat(40);
const OUTSIDE = "OUTSIDE_LEAF_MARKER";
const CHANGE =
  "변경: leaf redaction\n수행한 확인: reproduction을 요청했다\n한계: 돌지 않은 test는 없다\n";

type Reply = { status: number; body: Record<string, unknown> };
type Connected = { connection: string; token: string; revision: string };
type ToolReply = {
  isError?: true;
  summary: string;
  data: Record<string, unknown>;
};

const rpt = (n: number) =>
  `rpt_01arz3ndektsv4rrffq69g5f${String(n).padStart(2, "0")}`;
const snp = (n: number) =>
  `snp_01arz3ndektsv4rrffq69g5f${String(n).padStart(2, "0")}`;

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

const envelope = (
  input: unknown,
  compare: unknown = {},
  confirmation?: string,
) => ({
  input,
  idempotency_key: `k-${crypto.randomUUID()}`,
  compare,
  prepared: [] as string[],
  ...(confirmation === undefined ? {} : { confirmation }),
});

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
      bundle_hash: BUNDLE_BEFORE,
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
        bundle_hash: BUNDLE_BEFORE,
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
  otherApp: string;
  problemA: string;
  problemB: string;
  problemC: string;
  outsideProblem: string;
};

function openDb(world: World, readOnly: boolean): DatabaseSync {
  const db = new DatabaseSync(`${world.harness.dataRoot}/lophn.db`, {
    readOnly,
  });
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

function rows<T>(world: World, sql: string, ...params: string[]): T[] {
  const db = openDb(world, true);
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

function insertRelease(
  world: World,
  row: { id: string; number: number; bundle: string; source: string | null },
): void {
  const db = openDb(world, false);
  try {
    db.prepare(
      `INSERT INTO releases (id, app, number, code_commit, bundle_hash, blueprint_hash,
         data_schema, data_changes, ticket_source, created_by, created_at, status,
         blueprint, declarations)
       VALUES (?, ?, ?, ?, ?, ?, 0, '[]', ?, 'coding_agent', ?, 'prepared', '{}', '{}')`,
    ).run(
      row.id,
      world.app,
      row.number,
      COMMIT,
      row.bundle,
      "d".repeat(64),
      row.source,
      new Date().toISOString(),
    );
  } finally {
    db.close();
  }
}

function ticketState(world: World, ticket: string): string {
  return rows<{ state: string }>(
    world,
    "select state from tickets where id = ?",
    ticket,
  )[0].state;
}

function claimCount(world: World, ticket: string): number {
  return rows<{ n: number }>(
    world,
    "select count(*) as n from ticket_claims where ticket = ?",
    ticket,
  )[0].n;
}

function fixCount(world: World, problem: string): number {
  return rows<{ n: number }>(
    world,
    "select count(*) as n from events where type = 'ProblemFixRecorded' and subject = ?",
    problem,
  )[0].n;
}

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
        new URL("../../../apps/core/coding-agent.ts", import.meta.url).href,
        new URL("../../../apps/core/tickets.ts", import.meta.url).href,
        new URL("../../../apps/core/problems.ts", import.meta.url).href,
        new URL(
          "../../../apps/core/ticket-claim-ports_test.ts",
          import.meta.url,
        )
          .href,
        new URL(
          "../../../apps/core/repair-context-ports_test.ts",
          import.meta.url,
        ).href,
      ],
      coding: { keychain, loaders: [] },
    },
  });
  try {
    await world.harness.codingCredentialsReady;
    const user = (await world.login("user", [
      "CreateCodingAgentConnection",
      "RevokeCodingAgentConnection",
      "CreateTicket",
      "MakeTicketReady",
      "CancelTicket",
      "app.create",
    ])).token;
    const machine = await world.login("machine", ["RecordReport"]);
    const seen: { revision?: string } = {};
    const connected = await world.harness.codingCredentials!.connect(
      { label: "claude", scope: { kind: "app", app: world.app } },
      async (submission): Promise<Result<unknown>> => {
        const sent = await post(
          world,
          "coding_agent_connections/create",
          user,
          envelope(submission),
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
    const coding: Connected = {
      connection: connected.value.connection,
      token: decoder.decode(
        keychain.stored.get(codingCredentialRef(connected.value.connection)!)!,
      ),
      revision: seen.revision!,
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
          reportInput(machine.context.principal, app, n, logs, rpt(n)),
          { active_release: REL_BEFORE, problem_seq: null },
        ),
      );
      assertEquals(sent.status, 200, JSON.stringify(sent.body));
      return String(sent.body["problem"]);
    };
    const problemA = await record(world.app, 1);
    const problemB = await record(world.app, 2);
    const problemC = await record(world.app, 3);
    const outsideProblem = await record(otherApp, 40);
    insertRelease(world, {
      id: REL_BEFORE,
      number: 1,
      bundle: BUNDLE_BEFORE,
      source: null,
    });
    await run({
      world,
      user,
      coding,
      otherApp,
      problemA,
      problemB,
      problemC,
      outsideProblem,
    });
  } finally {
    await world.close();
  }
}

const repairInput = (
  app: string,
  problem: string,
  title: string,
) => ({
  app,
  kind: "repair",
  title,
  what: title,
  why: title,
  references: [],
  adoption_questions: [],
  conditions: [],
  inspect: ["src/leaf.ts"],
  preserve: ["docs/leaf.md"],
  problems: [problem],
  readiness: "needs_confirmation",
  needs: ["confirm the redaction"],
});

async function createTicket(
  opened: Opened,
  app: string,
  problem: string,
  title: string,
  ready: boolean,
): Promise<{ ticket: string; revision: string }> {
  const created = await post(
    opened.world,
    "tickets/create",
    opened.user,
    envelope(repairInput(app, problem, title)),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const ticket = String(created.body["ticket"]);
  const revision = String(created.body["revision"]);
  if (!ready) return { ticket, revision };
  const made = await post(
    opened.world,
    "tickets/make_ready",
    opened.user,
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
        { kind: "reproduction_test", problem, test_hash: TEST_HASH },
        { kind: "problems_closed" },
      ],
      inspect: ["src/leaf.ts"],
      preserve: ["docs/leaf.md"],
    }, { base_revision: revision }),
  );
  assertEquals(made.status, 200, JSON.stringify(made.body));
  const shown = await post(opened.world, "tickets/show", opened.coding.token, {
    ticket,
  });
  assertEquals(shown.status, 200, JSON.stringify(shown.body));
  return {
    ticket,
    revision: String((shown.body["ticket"] as { revision: string }).revision),
  };
}

function toolClient(world: World, who: Connected) {
  return createCoreClient({
    baseUrl: `http://127.0.0.1:${world.harness.port}`,
    connection: who.connection as never,
    provider: () => Promise.resolve(ok({ token: who.token })),
  });
}

function problemCalls(world: World, who: Connected) {
  const tool = createProblemTool({
    client: toolClient(world, who),
    now: () => new Date().toISOString(),
    idempotencyKey: () => `mcp-${crypto.randomUUID()}`,
    connection: who.connection,
    wait: { budget_ms: 0, interval_ms: 1 },
  });
  return async (input: Record<string, unknown>): Promise<ToolReply> => {
    const resolved = resolveRoute("lophn_problem", String(input.op));
    assert(resolved);
    return await tool("lophn_problem", resolved.route, input) as ToolReply;
  };
}

function ticketCalls(world: World, who: Connected) {
  const tool = createTicketTool({
    client: toolClient(world, who),
    now: () => new Date().toISOString(),
    idempotencyKey: () => `mcp-${crypto.randomUUID()}`,
  });
  return async (input: Record<string, unknown>): Promise<ToolReply> => {
    const resolved = resolveRoute("lophn_ticket", String(input.op));
    assert(resolved);
    return await tool("lophn_ticket", resolved.route, input) as ToolReply;
  };
}

async function runScript(
  opened: Opened,
  input: {
    ticket: string;
    base_revision: string;
    problem: string;
    release: string;
    bundle: string;
    reports: string[];
    request_key: string;
    after?: (
      stage: RepairStage,
      step: RepairScriptResult["steps"][number],
    ) => void | "stop" | Promise<void | "stop">;
  },
): Promise<RepairScriptResult> {
  const home = await Deno.makeTempDir({ prefix: "lophn-repair-home-" });
  try {
    const env: Record<string, string> = {
      PATH: Deno.env.get("PATH") ?? "",
      HOME: home,
      LOPHN_SHELL_HEADLESS: "1",
      LOPHN_TEST_TOKEN: opened.coding.token,
      LOPHN_TEST_DAEMON: `http://127.0.0.1:${opened.world.harness.port}`,
      LOPHN_TEST_CONNECTION: opened.coding.connection,
    };
    const denoDir = Deno.env.get("DENO_DIR");
    if (denoDir) env.DENO_DIR = denoDir;
    return await runRepairScript({
      command: Deno.execPath(),
      args: ["run", "-A", BRIDGE],
      cwd: ROOT,
      env,
      label: "lophn-repair-script",
      ticket: input.ticket,
      base_revision: input.base_revision,
      app: opened.world.app,
      problem: input.problem,
      before: REL_BEFORE,
      release: input.release,
      bundle_hash: input.bundle,
      reports: input.reports,
      basis_seq: "1",
      test: TEST_HASH,
      summary: CHANGE,
      commit: COMMIT,
      request_key: input.request_key,
      release_request_key: `release-${input.request_key}`,
      after: input.after,
    });
  } finally {
    await Deno.remove(home, { recursive: true });
  }
}

function step(result: RepairScriptResult, stage: string) {
  const found = result.steps.find((item) => item.stage === stage);
  assert(found, stage);
  return found;
}

function summaryChars(problems: {
  id: string;
  status: string;
  symptom: string;
  next_action: string;
}[]): number {
  return problems.reduce(
    (sum, item) =>
      sum +
      Array.from(
        `${item.id} ${item.status}\n${item.symptom}\n${item.next_action}`,
      )
        .length,
    0,
  );
}

// 같은 kind는 머리·문제별로 이어질 수 있다. 순서는 SECTION_KINDS에서 뒤로만 간다.
function sectionOrder(kinds: string[]): boolean {
  let cursor = -1;
  for (const kind of kinds) {
    const at = SECTION_KINDS.indexOf(kind as (typeof SECTION_KINDS)[number]);
    if (at < 0 || at < cursor) return false;
    cursor = at;
  }
  return true;
}

async function revoke(opened: Opened): Promise<void> {
  const target = {
    connection: opened.coding.connection,
    base_revision: opened.coding.revision,
  };
  const binding = await confirmationBinding(connectionRevoke, target);
  assert(binding);
  const issued = await opened.world.harness.confirmation({
    action: "issue",
    request: {
      type: "confirmation_handle_register",
      window_id: "win-repair",
      target_ref: binding.target,
      content_hash: binding.content,
      allowed_decisions: [connectionRevoke.name],
      expires_at: new Date(opened.world.harness.clock.nowMs() + 600_000)
        .toISOString(),
    },
  });
  assert(issued.ok, issued.ok ? "" : JSON.stringify(issued.error));
  const sent = await post(
    opened.world,
    "coding_agent_connections/revoke",
    opened.user,
    envelope(
      target,
      { base_revision: target.base_revision },
      (issued.value as { confirmation: string }).confirmation,
    ),
  );
  assertEquals(sent.status, 200, JSON.stringify(sent.body));
}

function assertNotClosed(world: World, problem: string): void {
  const row = rows<{ status: string; closure: string | null }>(
    world,
    "select status, closure from problems where id = ?",
    problem,
  )[0];
  assert(row.status !== "closed", row.status);
  assertEquals(row.closure, null);
}

Deno.test(
  "coding-agent/repair-context#R3 coding-agent/repair-context#R11 coding-agent/tickets#R11 coding-agent/tickets#R15 coding-agent/connection#R5 coding-agent/connection#R8: 수리 script는 app-broken·verify-app-repair의 coding agent 단계를 가고 범위 밖·회수된 연결의 수리 요청은 거절한다",
  async () => {
    await withWorld(async (opened) => {
      const { world, coding } = opened;
      const problems = problemCalls(world, coding);
      const tickets = ticketCalls(world, coding);

      // connection#R5. 범위 밖 수리 요청은 준비 전에도 없는 ticket과 같다.
      const foreign = await createTicket(
        opened,
        opened.otherApp,
        opened.outsideProblem,
        OUTSIDE,
        false,
      );
      const absentClaim = await tickets({
        op: "claim",
        ticket: ABSENT,
        base_revision: "1",
      });
      const absentSummary = await problems({
        op: "summary",
        selector: { ticket: ABSENT },
      });
      const outside = await runScript(opened, {
        ticket: foreign.ticket,
        base_revision: foreign.revision,
        problem: opened.outsideProblem,
        release: REL_AFTER,
        bundle: BUNDLE_AFTER,
        reports: [rpt(40)],
        request_key: "repro-outside",
      });
      assertEquals(outside.stages, ["claim", "summary", "bundle", "more"]);
      assertEquals(outside.halted_before, "reproduction");
      assertEquals(outside.claim_seq, null);
      assertEquals(step(outside, "claim").isError, true);
      assertEquals(step(outside, "claim").code, "not_found");
      assertEquals(step(outside, "claim").summary, absentClaim.summary);
      assertEquals(step(outside, "claim").data, absentClaim.data);
      assertEquals(step(outside, "claim").summary, UNREADABLE_MESSAGE);
      assertEquals(step(outside, "summary").summary, absentSummary.summary);
      assertEquals(step(outside, "summary").data, absentSummary.data);
      for (const stage of ["claim", "summary", "bundle", "more"] as const) {
        assertEquals(step(outside, stage).isError, true);
        assertEquals(step(outside, stage).code, "not_found");
      }
      const outsideText = JSON.stringify(outside.steps);
      assert(!outsideText.includes(OUTSIDE), outsideText);
      assert(!outsideText.includes("boom 40"), outsideText);
      assertEquals(claimCount(world, foreign.ticket), 0);
      assertEquals(fixCount(world, opened.outsideProblem), 0);
      assertNotClosed(world, opened.outsideProblem);

      // 읽기는 claim을 만들지 않는다(tickets#R11).
      const happyTicket = await createTicket(
        opened,
        world.app,
        opened.problemA,
        "fix leaf redaction",
        true,
      );
      assertEquals(claimCount(world, happyTicket.ticket), 0);
      const preClaim = await problems({
        op: "summary",
        selector: { ticket: happyTicket.ticket },
      });
      assertEquals(preClaim.isError, undefined, preClaim.summary);
      assertEquals(claimCount(world, happyTicket.ticket), 0);

      // app-broken 6–7, verify-app-repair 2. release 준비는 id를 주지 않아
      // report가 받는 release는 claim 뒤에 심은 같은 ticket_source 행이다.
      const happy = await runScript(opened, {
        ticket: happyTicket.ticket,
        base_revision: happyTicket.revision,
        problem: opened.problemA,
        release: REL_AFTER,
        bundle: BUNDLE_AFTER,
        reports: [rpt(1)],
        request_key: "repro-happy",
        after: (stage, traced) => {
          if (stage === "claim") {
            insertRelease(world, {
              id: REL_AFTER,
              number: 2,
              bundle: BUNDLE_AFTER,
              source: JSON.stringify({
                ticket: happyTicket.ticket,
                claim_seq: traced.data.claim_seq,
              }),
            });
            assertEquals(claimCount(world, happyTicket.ticket), 1);
          }
          if (stage === "more") {
            assertEquals(claimCount(world, happyTicket.ticket), 1);
          }
        },
      });
      assertEquals(happy.stages, [...REPAIR_STAGES]);
      assertEquals(happy.halted_before, null);
      assertEquals(step(happy, "claim").isError, false);
      assert(typeof happy.claim_seq === "string");
      const summary = step(happy, "summary");
      assertEquals(summary.isError, false, JSON.stringify(summary.data));
      const summaryProblems = (summary.data.summary as {
        problems: {
          id: string;
          status: string;
          symptom: string;
          next_action: string;
          seq: string;
        }[];
      }).problems;
      assertEquals(summaryProblems.length * 2 <= 10, true);
      assert(
        summaryChars(summaryProblems) <= REPAIR_CONTEXT_SUMMARY_MAX_CHARS,
      );
      assertEquals(summaryProblems[0].id, opened.problemA);
      const bundle = step(happy, "bundle");
      assertEquals(bundle.isError, false, JSON.stringify(bundle.data));
      const context = bundle.data.context as {
        bytes: number;
        lines: number;
        sections: {
          kind: string;
          more: { problem: string; kind: string; source: string }[] | null;
        }[];
      };
      assert(context.bytes <= REPAIR_CONTEXT_BYTES);
      assert(context.lines <= REPAIR_CONTEXT_LINES);
      const kinds = context.sections.map((section) => section.kind);
      assertEquals(sectionOrder(kinds), true, kinds.join(","));
      assertEquals(kinds.at(-1), "return_method");
      const moreRef = context.sections.flatMap((section) =>
        section.more ?? []
      )[0];
      const more = step(happy, "more");
      if (moreRef) {
        assertEquals(more.input.problem, moreRef.problem);
        assertEquals(more.input.kind, moreRef.kind);
        assertEquals(more.input.source, moreRef.source);
      } else {
        assertEquals(more.input.kind, "log");
        assertEquals(more.input.source, `problem:${opened.problemA}`);
      }
      const reproduction = step(happy, "reproduction");
      assertEquals(reproduction.input.ticket, null);
      assertEquals(reproduction.input.kind, "reproduction");
      assertEquals(reproduction.input.ticket_source, {
        ticket: happyTicket.ticket,
        claim_seq: happy.claim_seq,
      });
      assert(reproduction.data.state !== "pass");
      assert(reproduction.data.real_test !== true);
      const recorded = step(happy, "record_fix");
      assertEquals(recorded.isError, false, JSON.stringify(recorded.data));
      assertEquals(recorded.input.fix, {
        before: REL_BEFORE,
        after: REL_AFTER,
        verification: [],
        ticket: happyTicket.ticket,
        claim_seq: happy.claim_seq,
      });
      assertEquals(recorded.input.summary, CHANGE);
      assertEquals(happy.fix_seq, recorded.data.seq);
      const prepared = step(happy, "release_prepare");
      assertEquals(prepared.tool, "lophn_app");
      assertEquals(prepared.input.ticket_source, {
        ticket: happyTicket.ticket,
        claim_seq: happy.claim_seq,
      });
      const report = step(happy, "report");
      assertEquals(report.isError, false, JSON.stringify(report.data));
      assertEquals(report.input.release, REL_AFTER);
      assertEquals(report.input.fix_records, [happy.fix_seq]);
      assertEquals(report.input.verifications, undefined);
      assertEquals(report.input.claim_seq, happy.claim_seq);
      assertEquals(happy.report_state, "reported");
      assert(typeof happy.completion_seq === "string");
      assertEquals(ticketState(world, happyTicket.ticket), "reported");
      assertEquals(claimCount(world, happyTicket.ticket), 0);
      assertEquals(fixCount(world, opened.problemA), 1);
      assertNotClosed(world, opened.problemA);
      assertEquals(
        rows<{ ticket_source: string }>(
          world,
          "select ticket_source from releases where id = ?",
          REL_AFTER,
        )[0].ticket_source,
        JSON.stringify({
          ticket: happyTicket.ticket,
          claim_seq: happy.claim_seq,
        }),
      );
      const fixes = rows<{ payload: string }>(
        world,
        "select payload from events where type = 'ProblemFixRecorded'",
      );
      assert(
        fixes.every((event) => JSON.parse(event.payload).ticket !== null),
      );

      // tickets#R15. 다른 claim_seq로 준비된 release는 report가 거절한다.
      const mismatchTicket = await createTicket(
        opened,
        world.app,
        opened.problemB,
        "fix other leaf",
        true,
      );
      insertRelease(world, {
        id: REL_OTHER,
        number: 3,
        bundle: BUNDLE_OTHER,
        source: JSON.stringify({
          ticket: mismatchTicket.ticket,
          claim_seq: "999999",
        }),
      });
      const mismatch = await runScript(opened, {
        ticket: mismatchTicket.ticket,
        base_revision: mismatchTicket.revision,
        problem: opened.problemB,
        release: REL_OTHER,
        bundle: BUNDLE_OTHER,
        reports: [rpt(2)],
        request_key: "repro-mismatch",
      });
      assertEquals(mismatch.stages, [...REPAIR_STAGES]);
      assertEquals(step(mismatch, "record_fix").isError, false);
      const mismatchReport = step(mismatch, "report");
      assertEquals(mismatchReport.isError, true, mismatchReport.summary ?? "");
      assertEquals(mismatchReport.code, "conflict");
      assertEquals(mismatch.report_state, null);
      assertEquals(ticketState(world, mismatchTicket.ticket), "claimed");
      assertEquals(claimCount(world, mismatchTicket.ticket), 1);
      assertNotClosed(world, opened.problemB);

      // connection#R8. 회수 직후 새 쓰기는 거절이고 claim 정리는 sweep다.
      const revokedTicket = await createTicket(
        opened,
        world.app,
        opened.problemC,
        "fix third leaf",
        true,
      );
      const revoked = await runScript(opened, {
        ticket: revokedTicket.ticket,
        base_revision: revokedTicket.revision,
        problem: opened.problemC,
        release: REL_AFTER,
        bundle: BUNDLE_AFTER,
        reports: [rpt(3)],
        request_key: "repro-revoked",
        after: async (stage) => {
          if (stage !== "more") return;
          await revoke(opened);
          await world.harness.sweepTicketClaims();
        },
      });
      assertEquals(revoked.stages, [...REPAIR_STAGES]);
      assertEquals(step(revoked, "claim").isError, false);
      assertEquals(step(revoked, "summary").isError, false);
      const moreIndex = revoked.steps.findIndex((item) =>
        item.stage === "more"
      );
      for (const traced of revoked.steps.slice(moreIndex + 1)) {
        assertEquals(traced.isError, true, `${traced.stage} ${traced.summary}`);
        // reproduction은 claim 읽기가 실패하면 unauthorized도 conflict로 접는다.
        if (traced.stage === "reproduction") {
          assert(traced.data.state !== "pass");
          assert(traced.data.real_test !== true);
          assert(
            traced.code === "conflict" || traced.code === "unauthorized",
            traced.code ?? "",
          );
          continue;
        }
        assertEquals(traced.code, "unauthorized", traced.stage);
      }
      assertEquals(ticketState(world, revokedTicket.ticket), "open");
      assertEquals(claimCount(world, revokedTicket.ticket), 0);
      assertEquals(fixCount(world, opened.problemC), 0);
      assertNotClosed(world, opened.problemC);
      const released = rows<{ payload: string }>(
        world,
        "select payload from events where type = 'TicketClaimReleased' and subject = ?",
        revokedTicket.ticket,
      );
      assert(
        released.some((event) =>
          JSON.parse(event.payload).reason === "connection_revoked"
        ),
      );
    });
  },
);
