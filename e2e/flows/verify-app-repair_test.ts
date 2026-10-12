// problems#T24 flow verify-app-repair 1단계만(docs/flows/verify-app-repair.md 1).
// 실제 headless shell과 실제 core에서 app-detail Issues를 본다. 수리 기록은 fake coding agent
// 수리 script(coding-agent#T47, #487)를 record_fix까지만 호출해 만든다. release 준비·완료 보고·
// activation·닫힘은 2–7단계라 여기서 하지 않는다. 사람 데이터 root(~/.lophn)는 열지 않는다.
// HOME·LOPHN_HOME은 임시 폴더이고, shell은 LOPHN_SHELL_HEADLESS=1(openFlowShell)로만 띄운다.
// 2단계 테스트는 이 파일의 두 번째 Deno.test다. 1단계 본문은 바꾸지 않는다.
// 3단계 테스트는 이 파일의 세 번째 Deno.test다. 1·2단계 본문은 바꾸지 않는다.
// 4단계 테스트는 이 파일의 네 번째 Deno.test다. 1–3단계 본문은 바꾸지 않는다.
// 5단계 테스트는 이 파일의 다섯 번째 Deno.test다. 1–4단계 본문은 바꾸지 않는다.
// 6단계 테스트는 이 파일의 여섯 번째 Deno.test다. 1–5단계 본문은 바꾸지 않는다.
// 7단계 테스트는 이 파일의 일곱 번째 Deno.test다. 1–6단계 본문은 바꾸지 않는다.
//
// 화면이 가진 것: 진행·실제 담당·필요한 사람 조치(없으면 그 줄을 만들지 않는다), 고쳤다는 주장과
// 실제 테스트 상태. 당시 release·summary 본문·작성자는 화면 글에 없고 list-fixes와 그 event·
// 저장된 summary blob으로만 읽는다. 없는 필드를 화면에 지어내지 않는다.
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { assert, assertEquals, assertNotEquals } from "@std/assert";

import { err, ok, type Result, sha256Hex } from "../../packages/base/mod.ts";
import type { FrozenTest } from "../../packages/protocol/problems/mod.ts";
import { declarationsOfBlueprint } from "../../packages/apps/releases/mod.ts";
import { migrateAppDatabase } from "../../packages/apps/data/worker/migrate.ts";
import { prepareFromSource } from "../../packages/apps/releases/prepare/from-source.ts";
import { installedHome } from "../../packages/apps/sdk/testing/mod.ts";
import {
  type MadeFixture,
  madeFixture,
} from "../../apps/core/testing/problems-app-test.ts";
import { BROKEN_SCENARIO } from "../../apps/core/testing/problems-reproduction.ts";
import {
  canonicalHash,
  canonicalJson,
} from "../../packages/problems/tests/canonical.ts";
import {
  APP_TEST_TIMEOUT_MS,
  deriveAppTest,
  reproductionFrozen,
} from "../../packages/problems/tests/mod.ts";
import { SECTION_KINDS } from "../../packages/protocol/coding-agent/mod.ts";
import { objectPathFor } from "../../packages/platform/blob-store/model.ts";
import {
  codingCredentialRef,
  createFakeKeychain,
  type FakeKeychain,
} from "../../packages/platform/secrets/mod.ts";
import {
  type CoreHarness,
  createCoreHarness,
} from "../../apps/core/testing/core.ts";
import { startCore } from "../../apps/core/core.ts";
import { createLedgerRegistration as createDocumentsRegistration } from "../../apps/core/documents.ts";
import { createLedgerRegistration as createAppsRegistration } from "../../apps/core/apps.ts";
import { codingAgentConnectionDefinitions } from "../../apps/core/coding-agent.ts";
import {
  createLedgerRegistration as createProblemsRegistration,
  problemsReportDefinitions,
  problemsTestDefinitions,
} from "../../apps/core/problems.ts";
import {
  createLedgerRegistration as createLophnAgentRegistration,
  lophnAgentDefinitions,
} from "../../apps/core/lophn-agent.ts";
import { ticketDefinitions } from "../../apps/core/tickets.ts";
import { createCoreRegistration as createTicketPortsRegistration } from "../../apps/core/ticket-ports.ts";
import {
  type RepairScriptResult,
  type RepairStage,
  type RepairStepRecord,
  runRepairScript,
} from "../../tools/fake-coding-agent/repair.ts";
import {
  descendantPids,
  e2eEnabled,
  processAlive,
  signalPids,
} from "../harness.ts";
import {
  delay,
  type FlowShell,
  mustCall,
  openFlowShell,
} from "../flow-support.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BRIDGE = fileURLToPath(
  new URL("../coding-agent/repair-steps/mcp-bridge.ts", import.meta.url),
);
const VER = "ver_01arz3ndektsv4rrffq69g5fav";
const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
const REL_BEFORE = "rel_01arz3ndektsv4rrffq69g5fa1";
const REL_AFTER = "rel_01arz3ndektsv4rrffq69g5fa2";
const REL_NOW = "rel_01arz3ndektsv4rrffq69g5fa3";
const BUNDLE_BEFORE = "a".repeat(64);
const BUNDLE_AFTER = "b".repeat(64);
const BUNDLE_NOW = "c".repeat(64);
const REL_PAST = "rel_01arz3ndektsv4rrffq69g5fa4";
const REL_STILL = "rel_01arz3ndektsv4rrffq69g5fa5";
const REL_OTHER = "rel_01arz3ndektsv4rrffq69g5fa6";
const BUNDLE_PAST = "e".repeat(64);
const PAST_SUMMARY = [
  "변경: 예전 leaf",
  "수행한 확인: 없음",
  "미실행 확인: 당시 테스트는 없다",
  "",
].join("\n");
const TEST_HASH = "9".repeat(64);
const COMMIT = "a".repeat(40);
// fixtures/apps/broken의 data schema다(migrations 0-1, 1-3).
const BROKEN_DATA_SCHEMA = 3;
const SUMMARY = [
  "변경: leaf redaction",
  "수행한 확인: 없음",
  "미실행 확인: reproduction 통과 결과는 없다",
  "한계: 돌리지 않은 테스트는 통과가 아니다",
  "",
].join("\n");
const CURRENT_MARKER = "CURRENT_RELEASE_MARKER";
const IMPACT = "Something went wrong in this app.";
const OWNER = "A coding agent is working on this.";
const CLAIM =
  "A fix was reported. This is the agent's word, not a confirmation.";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

type Reply = { status: number; body: Record<string, unknown> };
type Connected = { connection: string; token: string; revision: string };
type Prepared = {
  preparation: string;
  principal: string;
  purpose: string;
  hash: string;
  size_bytes: number;
};
type FixView = {
  before: string;
  after: string;
  summary: string;
  verification: string[];
  ticket: string;
  claim_seq: string;
};
type Held = {
  problem: string;
  report: string;
  ticket: string;
  fix: FixView;
  actor: string;
  at: string;
  snapshotId: string;
  capturedAt: string;
  release: string;
  errorMessage: string;
  logHash: string;
  logBytes: Uint8Array;
  summaryBytes: Uint8Array;
};

const rpt = (n: number) =>
  `rpt_01arz3ndektsv4rrffq69g5f${String(n).padStart(2, "0")}`;
const snp = (n: number) =>
  `snp_01arz3ndektsv4rrffq69g5f${String(n).padStart(2, "0")}`;

function envelope(input: unknown, compare: unknown = {}) {
  return {
    input,
    idempotency_key: `k-${crypto.randomUUID()}`,
    compare,
    prepared: [] as string[],
  };
}

type Ledger = {
  harness: CoreHarness;
  app: string;
  close(): Promise<void>;
};

async function post(
  world: Ledger,
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

async function prepareBlob(
  world: Ledger,
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
  bundle: string = BUNDLE_BEFORE,
) {
  const at = new Date(Date.now() - 600_000).toISOString();
  return {
    report: {
      id: rpt(n),
      app,
      mode: "live",
      diagnostic_scope: null,
      release: REL_BEFORE,
      release_missing_reason: null,
      bundle_hash: bundle,
      source: "exception",
      code: "_exception",
      text: null,
      details: null,
      snapshot: snp(n),
      observed_at: at,
      principal,
      content_hash: "01".repeat(32),
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
        message: "boom 1",
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
    group_key: { kind: "exception", code: "_exception", discriminator: rpt(n) },
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
          credential_ref: "cred-1",
        },
        app,
        mode: "live",
        diagnostic_scope: null,
        release: REL_BEFORE,
        release_missing_reason: null,
        bundle_hash: bundle,
        binding: "sdk",
        origin: "process_observer",
      },
      report_id: rpt(n),
      content_hash: "01".repeat(32),
    },
  };
}

// 앱이 선언한 code의 보고 모양이다. 같은 code의 앱 보고는 같은 묶기 key로 한 문제에 모인다.
function declaredReport(input: ReturnType<typeof reportInput>) {
  return {
    ...input,
    report: { ...input.report, source: "app", code: "fixture_broken" },
    snapshot: {
      ...input.snapshot,
      error: null,
      error_missing_reason: { reason: "no error" },
    },
    group_key: {
      kind: "declared",
      code: "fixture_broken",
      discriminator: null,
    },
    origin: {
      ...input.origin,
      context: {
        ...input.origin.context,
        origin: "app",
        authentication: {
          ...input.origin.context.authentication,
          actor: `app:${input.report.app}`,
        },
      },
    },
  };
}

function openDb(path: string, readOnly: boolean): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly });
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

type SealedContent = { blueprint: string; blueprintHash: string };

// 봉인 bundle 안 blueprint.json의 byte와 그 hash다(release 준비가 ledger에 두는 사본과 같다).
async function sealedContent(
  root: string,
  app: string,
  bundle: string,
): Promise<SealedContent> {
  const bytes = await Deno.readFile(
    `${root}/apps/${app}/bundles/${bundle}/blueprint.json`,
  );
  return {
    blueprint: decoder.decode(bytes),
    blueprintHash: await sha256Hex(bytes),
  };
}

function insertRelease(
  world: Ledger,
  row: {
    id: string;
    number: number;
    bundle: string;
    source: string | null;
    by: string;
    // 봉인 bundle의 실제 blueprint다. 없으면 빈 blueprint 자리표시자(5단계 전 단계의 기본)다.
    content?: SealedContent;
  },
): void {
  const db = openDb(`${world.harness.dataRoot}/lophn.db`, false);
  try {
    const declarations = row.content === undefined ? "{}" : JSON.stringify(
      declarationsOfBlueprint(row.id, JSON.parse(row.content.blueprint)),
    );
    db.prepare(
      `INSERT INTO releases (id, app, number, code_commit, bundle_hash, blueprint_hash,
         data_schema, data_changes, ticket_source, created_by, created_at, status,
         blueprint, declarations)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, 'prepared', ?, ?)`,
    ).run(
      row.id,
      world.app,
      row.number,
      COMMIT,
      row.bundle,
      row.content?.blueprintHash ?? "d".repeat(64),
      row.content === undefined ? 0 : BROKEN_DATA_SCHEMA,
      row.source,
      row.by,
      new Date().toISOString(),
      row.content?.blueprint ?? "{}",
      declarations,
    );
  } finally {
    db.close();
  }
}

// Version의 test 참조는 실제로 기록된 검증만 단다. 그 묶음을 대상으로 돌아가지 않은
// 검증이나 존재하지 않는 검증 id는 넣지 않는다.
function linkReleaseTest(
  world: Ledger,
  release: string,
  verification: string,
): void {
  const db = openDb(`${world.harness.dataRoot}/lophn.db`, false);
  try {
    db.prepare(
      "INSERT INTO release_tests (release, verification) VALUES (?, ?)",
    ).run(release, verification);
  } finally {
    db.close();
  }
}

type Opened = {
  world: Ledger;
  user: string;
  coding: Connected;
  problem: string;
};

type SnapshotRead = {
  id: string;
  captured_at: string;
  error: { message: string };
  logs: { blob: string };
};

async function openLedger(options?: {
  beforeBundle?: (app: string, dataRoot: string) => Promise<string>;
  // 이전 release 행에 봉인 bundle의 실제 blueprint를 둔다(activation을 실제로 돌리는 5단계).
  sealedContent?: boolean;
  // 첫 보고를 앱이 선언한 code(fixture_broken)의 보고로 접수한다(닫힌 뒤 재발을 앱의 실제 보고로 받는 7단계).
  declared?: boolean;
}): Promise<Opened> {
  // 제품 shell이 여는 schema와 같은 단계만 적용한다. world_test의 fixture·permission
  // 단계는 설치본과 hash가 달라 제품 core가 그 ledger를 거절한다.
  const keychain: FakeKeychain = createFakeKeychain();
  const started = await createCoreHarness({
    nowMs: Date.now(),
    io: true,
    teams: [
      { createLedgerRegistration: createDocumentsRegistration },
      { createLedgerRegistration: createAppsRegistration },
      { problemsTestDefinitions },
      { problemsReportDefinitions },
      { createLedgerRegistration: createProblemsRegistration },
      { codingAgentConnectionDefinitions },
      { lophnAgentDefinitions },
      { createLedgerRegistration: createLophnAgentRegistration },
      { ticketDefinitions },
      { createCoreRegistration: createTicketPortsRegistration },
    ],
    teamModules: [
      new URL("../../apps/core/documents.ts", import.meta.url).href,
      new URL("../../apps/core/apps.ts", import.meta.url).href,
      new URL("../../apps/core/problems.ts", import.meta.url).href,
      new URL("../../apps/core/coding-agent.ts", import.meta.url).href,
      new URL("../../apps/core/lophn-agent.ts", import.meta.url).href,
      new URL("../../apps/core/tickets.ts", import.meta.url).href,
      // ticket-ports와 같은 port key를 같이 올리면 writer registry가 닫힌다.
      // 이 둘은 schema 단계가 없고, 제품 shell은 자기 ticket-ports로 읽기만 한다.
      new URL("../../apps/core/ticket-claim-ports_test.ts", import.meta.url)
        .href,
      new URL("../../apps/core/repair-context-ports_test.ts", import.meta.url)
        .href,
    ],
    coding: { keychain, loaders: [] },
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const harness = started.value;
  const login = async (
    actor: "user" | "machine",
    principal: string,
    operations: string[],
  ) => {
    const issued = await harness.credential({
      actor,
      principal,
      scope: { operations, targets: {} },
      conditions: {},
    });
    assert(issued.ok, issued.ok ? "" : issued.error.message);
    return issued.value;
  };
  const userCred = await login("user", "user-repair", [
    "app.create",
    "CreateCodingAgentConnection",
    "CreateTicket",
    "MakeTicketReady",
    "GetProblem",
    "ListProblems",
    "ListProblemFixes",
    "GetReport",
    "ListReports",
  ]);
  const machine = await login("machine", "machine-report", ["RecordReport"]);
  const created = await post(
    { harness, app: "", close: () => harness.close() },
    "apps/create",
    userCred.token,
    envelope({ slug: "usage", name: "Usage", description: "usage app" }),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const world: Ledger = {
    harness,
    app: String(created.body["id"]),
    close: () => harness.close(),
  };
  const user = userCred.token;
  await world.harness.codingCredentialsReady;
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
  let beforeBundle = BUNDLE_BEFORE;
  if (options?.beforeBundle) {
    try {
      beforeBundle = await options.beforeBundle(world.app, harness.dataRoot);
    } catch (error) {
      await widen(harness.dataRoot);
      await harness.close();
      throw error;
    }
  }
  insertRelease(world, {
    id: REL_BEFORE,
    number: 1,
    bundle: beforeBundle,
    source: null,
    by: "machine",
    content: options?.sealedContent === true
      ? await sealedContent(harness.dataRoot, world.app, beforeBundle)
      : undefined,
  });
  const logs = await prepareBlob(
    world,
    machine.context.principal,
    "snapshot_logs",
    "line 1 1\nline 2\nline 3\n",
  );
  const sent = await post(
    world,
    "problems/record-report",
    machine.token,
    envelope(
      options?.declared === true
        ? declaredReport(
          reportInput(
            machine.context.principal,
            world.app,
            1,
            logs,
            beforeBundle,
          ),
        )
        : reportInput(
          machine.context.principal,
          world.app,
          1,
          logs,
          beforeBundle,
        ),
      { active_release: REL_BEFORE, problem_seq: null },
    ),
  );
  assertEquals(sent.status, 200, JSON.stringify(sent.body));
  return {
    world,
    user,
    coding,
    problem: String(sent.body["problem"]),
  };
}

async function readyTicket(opened: Opened): Promise<{
  ticket: string;
  revision: string;
}> {
  const created = await post(
    opened.world,
    "tickets/create",
    opened.user,
    envelope({
      app: opened.world.app,
      kind: "repair",
      title: "fix leaf redaction",
      what: "redact the leaf",
      why: "the snapshot still shows it",
      references: [],
      adoption_questions: [],
      conditions: [],
      inspect: ["src/leaf.ts"],
      preserve: ["docs/leaf.md"],
      problems: [opened.problem],
      readiness: "needs_confirmation",
      needs: ["confirm the redaction"],
    }),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const ticket = String(created.body["ticket"]);
  const revision = String(created.body["revision"]);
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
        {
          kind: "reproduction_test",
          problem: opened.problem,
          test_hash: TEST_HASH,
        },
        { kind: "problems_closed" },
      ],
      inspect: ["src/leaf.ts"],
      preserve: ["docs/leaf.md"],
    }, { base_revision: revision }),
  );
  assertEquals(made.status, 200, JSON.stringify(made.body));
  const shown = await post(
    opened.world,
    "tickets/show",
    opened.coding.token,
    { ticket },
  );
  assertEquals(shown.status, 200, JSON.stringify(shown.body));
  return {
    ticket,
    revision: String((shown.body["ticket"] as { revision: string }).revision),
  };
}

async function waitWork(root: string, problem: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const db = openDb(`${root}/lophn.db`, true);
    try {
      const row = db.prepare("select status from problems where id = ?").get(
        problem,
      ) as { status: string } | undefined;
      if (row?.status === "fixing") return;
    } finally {
      db.close();
    }
    await delay(200);
  }
}

async function settleEvents(root: string, problem: string): Promise<void> {
  const deadline = Date.now() + 12_000;
  let last = "";
  let quiet = 0;
  while (Date.now() < deadline) {
    const db = openDb(`${root}/lophn.db`, true);
    let seq = "0";
    try {
      const row = db.prepare(
        "select cast(max(seq) as text) as seq from events where subject = ?",
      ).get(problem) as { seq: string | null };
      seq = row.seq ?? "0";
    } finally {
      db.close();
    }
    if (seq === last) quiet += 1;
    else quiet = 0;
    last = seq;
    if (quiet >= 5) return;
    await delay(200);
  }
}

async function runScript(
  opened: Opened,
  ticket: { ticket: string; revision: string },
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
      ticket: ticket.ticket,
      base_revision: ticket.revision,
      app: opened.world.app,
      problem: opened.problem,
      before: REL_BEFORE,
      release: REL_AFTER,
      bundle_hash: BUNDLE_AFTER,
      reports: [rpt(1)],
      basis_seq: "1",
      test: TEST_HASH,
      summary: SUMMARY,
      commit: COMMIT,
      request_key: "repro-stage1",
      release_request_key: "release-stage1",
      after: async (stage: RepairStage, traced) => {
        if (stage === "claim" && !traced.isError) {
          insertRelease(opened.world, {
            id: REL_AFTER,
            number: 2,
            bundle: BUNDLE_AFTER,
            source: JSON.stringify({
              ticket: ticket.ticket,
              claim_seq: traced.data.claim_seq,
            }),
            by: `coding_agent:${opened.coding.connection}`,
          });
          // problems.work가 claim 뒤에 status를 고친다. record_fix의 problem_seq보다 먼저 끝나게 둔다.
          await waitWork(opened.world.harness.dataRoot, opened.problem);
        }
        if (stage === "reproduction") {
          await settleEvents(opened.world.harness.dataRoot, opened.problem);
        }
        // 1단계는 고친 기록까지다. release 준비와 완료 보고는 하지 않는다.
        if (stage === "record_fix") return "stop";
      },
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

async function heldFrom(opened: Opened, ticket: string): Promise<Held> {
  const fixes = await post(opened.world, "problems/list-fixes", opened.user, {
    problem: opened.problem,
  });
  assertEquals(fixes.status, 200, JSON.stringify(fixes.body));
  const rows = fixes.body["fixes"] as { seq: string; fix: FixView }[];
  assertEquals(rows.length, 1);
  const fix = rows[0]!.fix;
  const report = await post(opened.world, "problems/get-report", opened.user, {
    report: rpt(1),
  });
  assertEquals(report.status, 200, JSON.stringify(report.body));
  const snapshot = report.body["snapshot"] as SnapshotRead;
  const reported = report.body["report"] as { release: string };
  const db = openDb(`${opened.world.harness.dataRoot}/lophn.db`, true);
  let event: { actor: string; at: string };
  try {
    event = db.prepare(
      `select actor, at from events
       where type = 'ProblemFixRecorded' and subject = ?`,
    ).get(opened.problem) as { actor: string; at: string };
  } finally {
    db.close();
  }
  assert(event, "ProblemFixRecorded가 없다");
  const logBytes = await Deno.readFile(
    objectPathFor(opened.world.harness.dataRoot, snapshot.logs.blob),
  );
  const summaryBytes = await Deno.readFile(
    objectPathFor(opened.world.harness.dataRoot, fix.summary),
  );
  return {
    problem: opened.problem,
    report: rpt(1),
    ticket,
    fix,
    actor: event.actor,
    at: event.at,
    snapshotId: snapshot.id,
    capturedAt: snapshot.captured_at,
    release: reported.release,
    errorMessage: snapshot.error.message,
    logHash: snapshot.logs.blob,
    logBytes,
    summaryBytes,
  };
}

async function copyHome(root: string): Promise<string> {
  // 실행 중인 harness의 파일 복사는 db·lock이 어긋난다. VACUUM INTO는 그 시점의
  // ledger snapshot이고, blob은 이미 저장한 바이트만 복사한다. run/은 제품 core가 새로 만든다.
  const home = await Deno.makeTempDir({ prefix: "lophn-e2e-verify-repair-" });
  await Deno.chmod(home, 0o700);
  const db = openDb(`${root}/lophn.db`, false);
  try {
    const dest = `${home}/lophn.db`.replaceAll("'", "''");
    db.exec(`VACUUM INTO '${dest}'`);
  } finally {
    db.close();
  }
  await Deno.chmod(`${home}/lophn.db`, 0o600);
  try {
    await Deno.stat(`${root}/blobs`);
    const copied = await new Deno.Command("cp", {
      args: ["-a", `${root}/blobs`, `${home}/blobs`],
    }).output();
    assert(copied.success, decoder.decode(copied.stderr));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return home;
}

async function waitFixing(flow: FlowShell, problem: string): Promise<void> {
  const deadline = Date.now() + 45_000;
  let last = "";
  for (;;) {
    const read = await mustCall(flow, {
      kind: "read",
      resource: "problems",
      method: "get",
      body: { problem },
    });
    const status = (read.problem as { status: string }).status;
    last = status;
    if (status === "fixing") return;
    assert(Date.now() < deadline, `문제가 fixing이 되지 않았다 (${last})`);
    await delay(500);
  }
}

async function openIssue(flow: FlowShell): Promise<void> {
  await flow.until(
    `document.querySelector('[data-app-bar="app-details"]') !== null`,
    "앱 막대",
  );
  await flow.click('[data-app-bar="app-details"]');
  await openIssuesTab(flow);
}

// 운영 패널이 이미 열려 있을 때 Issues 탭만 고른다.
async function openIssuesTab(flow: FlowShell): Promise<void> {
  await flow.until(
    `document.querySelector("[data-ops-panel]") !== null`,
    "운영 패널",
  );
  // Radix 탭은 mousedown으로 고른다. element.click()만으로는 패널이 안 바뀐다.
  const picked = await flow.evaluate(`(() => {
    const tab = document.querySelector('[role=tab][id$="trigger-issues"]');
    if (!tab) return false;
    tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1 }));
    tab.click();
    return true;
  })()`);
  assertEquals(picked, true, "Issues 탭이 없다");
  try {
    await flow.until(
      `document.querySelector('[role=tab][id$="trigger-issues"]')?.getAttribute("aria-selected") === "true" && document.querySelector("[data-issues-list] [data-issue-open]") !== null`,
      "Issues 목록",
    );
  } catch (error) {
    const detail = await flow.evaluate(`JSON.stringify({
      empty: document.querySelector("[data-issues-empty]")?.textContent ?? null,
      slot: document.querySelector("[data-slot-empty='issues']")?.textContent ?? null,
      tab: document.querySelector("[data-tab-body='issues']")?.innerText?.slice(0, 800) ?? null,
      ops: document.querySelector("[data-ops-panel]")?.innerText?.slice(0, 800) ?? null,
    })`);
    throw new Error(
      `${error instanceof Error ? error.message : error}\n${detail}`,
    );
  }
}

function screenText(flow: FlowShell, selector: string): Promise<string> {
  return flow.evaluate(
    `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`,
  ).then((value) => String(value));
}

/** 지금 자료만 바꾼다. prepared release 내용은 고칠 수 없으므로 새 release를 더하고, 앱 설명과 파일을 적는다. 당시 snapshot·수리 event·before/after는 건드리지 않는다. */
function writeCurrent(home: string, app: string): void {
  const db = openDb(`${home}/lophn.db`, false);
  try {
    db.prepare("update apps set description = ? where id = ?").run(
      CURRENT_MARKER,
      app,
    );
    db.prepare(
      `INSERT INTO releases (id, app, number, code_commit, bundle_hash, blueprint_hash,
         data_schema, data_changes, ticket_source, created_by, created_at, status,
         blueprint, declarations)
       VALUES (?, ?, 3, ?, ?, ?, 0, '[]', null, 'machine', ?, 'prepared', '{}', '{}')`,
    ).run(
      REL_NOW,
      app,
      COMMIT,
      BUNDLE_NOW,
      "d".repeat(64),
      new Date().toISOString(),
    );
  } finally {
    db.close();
  }
  Deno.writeTextFileSync(`${home}/current-material.txt`, `${CURRENT_MARKER}\n`);
}

Deno.test({
  name:
    "problems/grouping#R12 problems/repairs#R1 problems/repairs#R2 problems/tests#R5 problems/snapshots#R1 flow verify-app-repair 1: 진행·담당을 먼저 보고 고친 기록과 당시 snapshot을 현재 자료와 구별한다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const opened = await openLedger();
    let home: string | undefined;
    try {
      const ticket = await readyTicket(opened);
      const script = await runScript(opened, ticket);
      const recorded = step(script, "record_fix");
      assertEquals(
        recorded.isError,
        false,
        JSON.stringify({ halted: script.halted_before, recorded }),
      );
      assertEquals(script.halted_before, "release_prepare");
      const reproduction = step(script, "reproduction");
      assertNotEquals(reproduction.data.state, "pass");
      assertNotEquals(reproduction.data.real_test, true);
      const held = await heldFrom(opened, ticket.ticket);
      assertEquals(held.fix.before, REL_BEFORE);
      assertEquals(held.fix.after, REL_AFTER);
      assertEquals(held.fix.verification, []);
      assertEquals(held.fix.ticket, ticket.ticket);
      assertEquals(held.fix.claim_seq, script.claim_seq);
      assert(held.actor.startsWith("coding_agent:"), held.actor);
      assert(held.at.length > 0);
      assertEquals(decoder.decode(held.summaryBytes), SUMMARY);
      assertEquals(await sha256Hex(held.summaryBytes), held.fix.summary);
      assertEquals(decoder.decode(held.logBytes), "line 1 1\nline 2\nline 3\n");
      assertEquals(await sha256Hex(held.logBytes), held.logHash);
      assertEquals(held.release, REL_BEFORE);
      assertEquals(held.errorMessage, "boom 1");

      home = await copyHome(opened.world.harness.dataRoot);
      await opened.world.close();

      await t.step(
        "Issues는 진행과 실제 담당을 수리 주장·테스트보다 먼저 보인다",
        async () => {
          const flow = await openFlowShell({
            home,
            start: `app:${opened.world.app}`,
          });
          try {
            await waitFixing(flow, held.problem);
            const listed = await mustCall(flow, {
              kind: "read",
              resource: "problems",
              method: "list",
              body: { app: opened.world.app },
            });
            try {
              await openIssue(flow);
            } catch (error) {
              throw new Error(`${JSON.stringify(listed)}\n${error}`);
            }
            assertEquals(await flow.count("[data-issue-detail]"), 0);
            const row = await screenText(
              flow,
              "[data-issues-list] [data-issue='fixing']",
            );
            assert(row.includes(IMPACT), row);
            assert(row.includes("Being fixed"), row);
            assert(!row.includes("What you can do"), row);
            await flow.click("[data-issue-open]");
            await flow.until(
              `document.querySelector('[data-issue-detail="fixing"] [data-issue-now]') !== null`,
              "Issues 상세",
            );
            const order = await flow.evaluate(`(() => {
              const now = document.querySelector("[data-issue-now]");
              const checks = document.querySelector("[data-section=checks]");
              if (!now || !checks) return "missing";
              return (now.compareDocumentPosition(checks) & 4) ? "now-first" : "checks-first";
            })()`);
            assertEquals(order, "now-first");
            const now = await screenText(flow, "[data-issue-now]");
            assert(now.includes(OWNER), now);
            assert(now.includes("Being fixed"), now);
            assert(now.includes("In progress"), now);
            assert(!now.includes(CLAIM), now);
            assertEquals(await flow.count("[data-issue-needed]"), 0);
            const claim = await screenText(flow, "[data-check='claim']");
            const tests = await screenText(flow, "[data-check='tests']");
            assert(claim.includes(CLAIM), claim);
            assertEquals(
              await flow.evaluate(
                `document.querySelector("[data-check='claim']")?.getAttribute("data-claimed")`,
              ),
              "true",
            );
            const state = String(
              await flow.evaluate(
                `document.querySelector("[data-check='tests']")?.getAttribute("data-test-state")`,
              ),
            );
            assertNotEquals(state, "pass");
            assert(!tests.includes(CLAIM), tests);
            assertEquals(
              await flow.evaluate(
                `document.querySelector("[data-check='human']")?.getAttribute("data-checked")`,
              ),
              "false",
            );
            const human = await screenText(flow, "[data-check='human']");
            assert(human.includes("haven't checked this yourself"), human);
            assertEquals(await flow.count("[data-issue-details]"), 0);
            const visible = await screenText(flow, "[data-issue-detail]");
            for (
              const hidden of [
                "rel_",
                "prb_",
                "tkt_",
                "claim_seq",
                "coding_agent",
                "leaf redaction",
                "snapshot",
              ]
            ) {
              assert(!visible.toLowerCase().includes(hidden), hidden);
            }
            const read = await mustCall(flow, {
              kind: "read",
              resource: "problems",
              method: "list-fixes",
              body: { problem: held.problem },
            });
            const again = (read.fixes as { fix: FixView }[])[0]!.fix;
            assertEquals(again, held.fix);
          } finally {
            await flow.close();
          }
        },
      );

      await t.step(
        "당시 snapshot과 고친 기록은 지금 자료로 바뀌지 않는다",
        async () => {
          writeCurrent(home!, opened.world.app);
          const flow = await openFlowShell({
            home,
            start: `app:${opened.world.app}`,
          });
          try {
            await waitFixing(flow, held.problem);
            const read = await mustCall(flow, {
              kind: "read",
              resource: "problems",
              method: "get-report",
              body: { report: held.report },
            });
            const snapshot = read.snapshot as SnapshotRead;
            const reported = read.report as { release: string };
            assertEquals(snapshot.id, held.snapshotId);
            assertEquals(snapshot.captured_at, held.capturedAt);
            assertEquals(snapshot.error.message, held.errorMessage);
            assertEquals(snapshot.logs.blob, held.logHash);
            assertEquals(reported.release, REL_BEFORE);
            assertNotEquals(reported.release, REL_NOW);
            const fixes = await mustCall(flow, {
              kind: "read",
              resource: "problems",
              method: "list-fixes",
              body: { problem: held.problem },
            });
            assertEquals((fixes.fixes as { fix: FixView }[])[0]!.fix, held.fix);
            const problem = await mustCall(flow, {
              kind: "read",
              resource: "problems",
              method: "get",
              body: { problem: held.problem },
            });
            assertEquals(problem.last_release, REL_BEFORE);
            assertEquals(
              (problem.detail as { result: { tests: { state: string } } })
                .result.tests.state === "pass",
              false,
            );
            const logBytes = await Deno.readFile(
              objectPathFor(home!, held.logHash),
            );
            const summaryBytes = await Deno.readFile(
              objectPathFor(home!, held.fix.summary),
            );
            assertEquals(logBytes, held.logBytes);
            assertEquals(summaryBytes, held.summaryBytes);
            const db = openDb(`${home}/lophn.db`, true);
            try {
              const event = db.prepare(
                `select actor, at from events
                 where type = 'ProblemFixRecorded' and subject = ?`,
              ).get(held.problem) as { actor: string; at: string };
              assertEquals(event.actor, held.actor);
              assertEquals(event.at, held.at);
            } finally {
              db.close();
            }
            await openIssue(flow);
            await flow.click("[data-issue-open]");
            await flow.until(
              `document.querySelector('[data-issue-detail="fixing"]') !== null`,
              "Issues 상세",
            );
            const visible = await screenText(flow, "[data-issue-detail]");
            assert(!visible.includes(CURRENT_MARKER), visible);
            assert(
              (await screenText(flow, "[data-check='claim']")).includes(CLAIM),
            );
            assertNotEquals(
              await flow.evaluate(
                `document.querySelector("[data-check='tests']")?.getAttribute("data-test-state")`,
              ),
              "pass",
            );
          } finally {
            await flow.close();
          }
        },
      );
    } finally {
      await opened.world.close();
      if (home !== undefined) {
        await Deno.remove(home, { recursive: true });
      }
    }
  },
});

type StoredFix = {
  before: string;
  after: string;
  summary: string;
  verification: string[];
  ticket: string | null;
  claim_seq: string | null;
};

type ContextSection = {
  kind: string;
  content: string;
  more: { problem: string; kind: string; source: string }[] | null;
};

function sectionOrder(kinds: readonly string[]): boolean {
  let cursor = -1;
  for (const kind of kinds) {
    const at = SECTION_KINDS.indexOf(kind as (typeof SECTION_KINDS)[number]);
    if (at < 0 || at < cursor) return false;
    cursor = at;
  }
  return kinds.length > 0 && kinds.at(-1) === "return_method";
}

function sectionsOf(stepRecord: RepairStepRecord): ContextSection[] {
  const context = stepRecord.data.context as { sections?: ContextSection[] };
  return context.sections ?? [];
}

async function absentBlob(root: string, hash: string): Promise<void> {
  try {
    await Deno.stat(objectPathFor(root, hash));
    assert(false, `${hash.slice(0, 8)}가 blob으로 저장됐다`);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

// 과거 ticket 없는 고친 기록. summary hash는 방금 저장한 blob의 hash만 쓴다.
async function plantPastFix(opened: Opened): Promise<string> {
  insertRelease(opened.world, {
    id: REL_PAST,
    number: 2,
    bundle: BUNDLE_PAST,
    source: null,
    by: "machine",
  });
  const prepared = await prepareBlob(
    opened.world,
    "user-repair",
    "fix_summary",
    PAST_SUMMARY,
  );
  const db = openDb(`${opened.world.harness.dataRoot}/lophn.db`, false);
  try {
    db.prepare(
      `insert into events (type, subject, actor, payload, at)
       values ('ProblemFixRecorded', ?, 'machine', ?, ?)`,
    ).run(
      opened.problem,
      JSON.stringify({
        before: REL_BEFORE,
        after: REL_PAST,
        summary: prepared.hash,
        verification: [],
        ticket: null,
        claim_seq: null,
      }),
      new Date(Date.now() - 86_400_000).toISOString(),
    );
  } finally {
    db.close();
  }
  const bytes = await Deno.readFile(
    objectPathFor(opened.world.harness.dataRoot, prepared.hash),
  );
  assertEquals(decoder.decode(bytes), PAST_SUMMARY);
  assertEquals(await sha256Hex(bytes), prepared.hash);
  return prepared.hash;
}

async function runStageTwo(
  opened: Opened,
  ticket: { ticket: string; revision: string },
  options: { plantRelease: boolean; requestKey: string },
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
      ticket: ticket.ticket,
      base_revision: ticket.revision,
      app: opened.world.app,
      problem: opened.problem,
      before: REL_BEFORE,
      release: REL_AFTER,
      bundle_hash: BUNDLE_AFTER,
      reports: [rpt(1)],
      basis_seq: "1",
      test: TEST_HASH,
      summary: SUMMARY,
      commit: COMMIT,
      request_key: options.requestKey,
      release_request_key: `release-${options.requestKey}`,
      after: async (stage: RepairStage, traced) => {
        if (!options.plantRelease) return;
        if (stage === "claim" && !traced.isError) {
          insertRelease(opened.world, {
            id: REL_AFTER,
            number: 3,
            bundle: BUNDLE_AFTER,
            source: JSON.stringify({
              ticket: ticket.ticket,
              claim_seq: traced.data.claim_seq,
            }),
            by: `coding_agent:${opened.coding.connection}`,
          });
          await waitWork(opened.world.harness.dataRoot, opened.problem);
        }
        if (stage === "reproduction") {
          await settleEvents(opened.world.harness.dataRoot, opened.problem);
        }
      },
    });
  } finally {
    await Deno.remove(home, { recursive: true });
  }
}

function releaseSource(root: string, id: string): string | null {
  const db = openDb(`${root}/lophn.db`, true);
  try {
    const row = db.prepare(
      "select ticket_source from releases where id = ?",
    ).get(id) as { ticket_source: string | null } | undefined;
    assert(row, id);
    return row.ticket_source;
  } finally {
    db.close();
  }
}

Deno.test({
  name:
    "problems/repairs#R1 problems/repairs#R4 problems/repairs#R5 coding-agent/tickets#R11 apps/releases#R6 coding-agent/repair-context#R3 flow verify-app-repair 2: 자기 터미널 수리를 현재 MCP claim으로 제출하고 과거 null 출처는 보충하지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const opened = await openLedger();
    let home: string | undefined;
    try {
      const pastHash = await plantPastFix(opened);
      const ticket = await readyTicket(opened);
      const script = await runStageTwo(opened, ticket, {
        plantRelease: true,
        requestKey: "repro-stage2",
      });
      const claim = step(script, "claim");
      assertEquals(claim.isError, false, JSON.stringify(claim));
      assert(typeof script.claim_seq === "string", JSON.stringify(claim.data));
      const bundle = step(script, "bundle");
      assertEquals(bundle.isError, false, JSON.stringify(bundle.data));
      const sections = sectionsOf(bundle);
      const kinds = sections.map((section) => section.kind);
      assertEquals(sectionOrder(kinds), true, kinds.join(","));
      const past = sections.find((section) => section.kind === "past_repairs");
      assert(past, kinds.join(","));
      assert(
        past.content.includes(`${REL_BEFORE} -> ${REL_PAST}`),
        past.content,
      );
      assert(past.content.includes("verification 없음"), past.content);
      assert(!past.content.includes("ticket "), past.content);
      const logs = sections.find((section) => section.kind === "logs");
      assert(logs, kinds.join(","));
      assert(logs.content.includes("line 1"), logs.content);
      const reproductionSection = sections.find((section) =>
        section.kind === "reproduction"
      );
      assert(reproductionSection, kinds.join(","));
      assert(
        !reproductionSection.content.includes("reproduction pass"),
        reproductionSection.content,
      );
      const more = step(script, "more");
      const moreRef = sections.flatMap((section) => section.more ?? [])[0];
      if (moreRef) {
        assertEquals(more.input.problem, moreRef.problem);
        assertEquals(more.input.kind, moreRef.kind);
        assertEquals(more.input.source, moreRef.source);
      }
      const reproduction = step(script, "reproduction");
      assertEquals(reproduction.input.ticket, null);
      assertEquals(reproduction.input.test, TEST_HASH);
      assertEquals(reproduction.input.ticket_source, {
        ticket: ticket.ticket,
        claim_seq: script.claim_seq,
      });
      assertNotEquals(reproduction.data.state, "pass");
      assertNotEquals(reproduction.data.real_test, true);
      const recorded = step(script, "record_fix");
      assertEquals(recorded.isError, false, JSON.stringify(recorded));
      assertEquals(recorded.input.fix, {
        before: REL_BEFORE,
        after: REL_AFTER,
        verification: [],
        ticket: ticket.ticket,
        claim_seq: script.claim_seq,
      });
      assertEquals(recorded.input.summary, SUMMARY);
      const prepared = step(script, "release_prepare");
      assertEquals(prepared.input.ticket_source, {
        ticket: ticket.ticket,
        claim_seq: script.claim_seq,
      });
      assertEquals(prepared.isError, true, JSON.stringify(prepared.data));
      assertNotEquals(prepared.data.prepared_release, true);
      const report = step(script, "report");
      assertEquals(report.isError, false, JSON.stringify(report));
      assertEquals(report.input.verifications, undefined);
      assertEquals(report.input.release, REL_AFTER);
      assertEquals(report.input.claim_seq, script.claim_seq);
      assertEquals(report.input.fix_records, [script.fix_seq]);
      assertEquals(script.report_state, "reported");
      const root = opened.world.harness.dataRoot;
      assertEquals(releaseSource(root, REL_BEFORE), null);
      assertEquals(releaseSource(root, REL_PAST), null);
      assertEquals(
        releaseSource(root, REL_AFTER),
        JSON.stringify({
          ticket: ticket.ticket,
          claim_seq: script.claim_seq,
        }),
      );
      for (const hash of [BUNDLE_BEFORE, BUNDLE_PAST, BUNDLE_AFTER]) {
        await absentBlob(root, hash);
      }
      const fixes = await post(
        opened.world,
        "problems/list-fixes",
        opened.user,
        { problem: opened.problem },
      );
      assertEquals(fixes.status, 200, JSON.stringify(fixes.body));
      const rows = fixes.body["fixes"] as { seq: string; fix: StoredFix }[];
      assertEquals(rows.length, 2);
      const newest = rows[0]!.fix;
      const oldest = rows[1]!.fix;
      assertEquals(oldest.ticket, null);
      assertEquals(oldest.claim_seq, null);
      assertEquals(oldest.verification, []);
      assertEquals(oldest.before, REL_BEFORE);
      assertEquals(oldest.after, REL_PAST);
      assertEquals(oldest.summary, pastHash);
      assertEquals(newest.before, REL_BEFORE);
      assertEquals(newest.after, REL_AFTER);
      assertEquals(newest.verification, []);
      assertEquals(newest.ticket, ticket.ticket);
      assertEquals(newest.claim_seq, script.claim_seq);
      const summaryBytes = await Deno.readFile(
        objectPathFor(root, newest.summary),
      );
      assertEquals(decoder.decode(summaryBytes), SUMMARY);
      assertEquals(await sha256Hex(summaryBytes), newest.summary);
      const db = openDb(`${root}/lophn.db`, true);
      try {
        const events = db.prepare(
          `select actor from events
           where type = 'ProblemFixRecorded' and subject = ?
           order by seq desc`,
        ).all(opened.problem) as { actor: string }[];
        assertEquals(events.length, 2);
        assert(events[0]!.actor.startsWith("coding_agent:"), events[0]!.actor);
        assertEquals(events[1]!.actor, "machine");
        const status = db.prepare("select status from problems where id = ?")
          .get(opened.problem) as { status: string };
        assertNotEquals(status.status, "closed");
      } finally {
        db.close();
      }
      const again = await runStageTwo(opened, ticket, {
        plantRelease: false,
        requestKey: "repro-stage2-again",
      });
      assertEquals(step(again, "claim").isError, true);
      assertEquals(again.claim_seq, null);
      assertEquals(again.halted_before, "reproduction");
      assert(!again.stages.includes("record_fix"));
      assert(!again.stages.includes("release_prepare"));

      home = await copyHome(root);
      await opened.world.close();
      const flow = await openFlowShell({
        home,
        start: `app:${opened.world.app}`,
      });
      try {
        await openIssue(flow);
        await flow.click("[data-issue-open]");
        await flow.until(
          `document.querySelector("[data-issue-detail]") !== null`,
          "Issues 상세",
        );
        const shown = String(
          await flow.evaluate(
            `document.querySelector("[data-issue-detail]")?.getAttribute("data-issue-detail")`,
          ),
        );
        assertNotEquals(shown, "closed");
        assertEquals(await flow.count("[data-issue-closed]"), 0);
        assertNotEquals(
          await flow.evaluate(
            `document.querySelector("[data-check='tests']")?.getAttribute("data-test-state")`,
          ),
          "pass",
        );
        const tests = await screenText(flow, "[data-check='tests']");
        assert(!tests.includes("passed"), tests);
        assertEquals(
          await flow.evaluate(
            `document.querySelector("[data-check='human']")?.getAttribute("data-checked")`,
          ),
          "false",
        );
        const visible = await screenText(flow, "[data-issue-detail]");
        for (
          const hidden of [
            "claim_seq",
            "tkt_",
            "rel_",
            "cac_",
            "vrf_",
            "ticket claim is not current",
            "leaf redaction",
            "예전 leaf",
            "verification 없음",
            "coding_agent",
          ]
        ) {
          assert(!visible.toLowerCase().includes(hidden.toLowerCase()), hidden);
        }
        const read = await mustCall(flow, {
          kind: "read",
          resource: "problems",
          method: "list-fixes",
          body: { problem: opened.problem },
        });
        const listed = read.fixes as { fix: StoredFix }[];
        assertEquals(listed.length, 2);
        assertEquals(listed[1]!.fix.ticket, null);
        assertEquals(listed[1]!.fix.claim_seq, null);
        assertEquals(listed[1]!.fix.verification, []);
        assertEquals(listed[0]!.fix.verification, []);
        assertEquals(listed[0]!.fix.claim_seq, script.claim_seq);
        const problem = await mustCall(flow, {
          kind: "read",
          resource: "problems",
          method: "get",
          body: { problem: opened.problem },
        });
        assertNotEquals(
          (problem.problem as { status: string }).status,
          "closed",
        );
        assertEquals(problem.last_release, REL_BEFORE);
        assertEquals(
          (problem.detail as { result: { tests: { state: string } } }).result
            .tests.state === "pass",
          false,
        );
      } finally {
        await flow.close();
      }
    } finally {
      await opened.world.close();
      if (home !== undefined) {
        await Deno.remove(home, { recursive: true });
      }
    }
  },
});

const STAGE3_SUMMARY = [
  "변경: board B",
  "수행한 확인: 테스트 통과",
  "미실행 확인: 없음",
  "한계: 이 문장은 통과가 아니다",
  "",
].join("\n");
const CODE_TEXT = "problems/tests reproduction harness";
const ENV_TEXT = "problems/tests runner environment";
const PASS_REASON =
  "before가 원래 증상을 재현하고 after가 같은 기대를 충족하며 약화가 없다";
const STAGE3_TIMEOUT_MS = 120_000;

async function sealBoard(
  made: MadeFixture,
  mode: "A" | "B" | "C" | "D" | "E",
  app: string,
  dataRoot: string,
): Promise<{ hash: string; path: string }> {
  const file = `${made.dir}/src/board.ts`;
  const text = await Deno.readTextFile(file);
  const patched = text.replace(
    /export const MODE: BoardMode = "[A-E]";/,
    `export const MODE: BoardMode = "${mode}";`,
  );
  assert(patched.includes(`BoardMode = "${mode}";`), mode);
  await Deno.writeTextFile(file, patched);
  const commit = await made.commit(`board ${mode}`);
  const prepared = await prepareFromSource({
    dataRoot,
    app,
    sourceRoot: made.dir,
    commit,
    sdkRoot: `${made.home}/sdk`,
  });
  assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
  const hash = prepared.value.bundleHash;
  const path = prepared.value.copyPath;
  assertEquals(path, `${dataRoot}/apps/${app}/bundles/${hash}`);
  await absentBlob(dataRoot, hash);
  return { hash, path };
}

async function storeText(
  world: Ledger,
  text: string,
  expected: string,
): Promise<void> {
  const prepared = await prepareBlob(world, "user-repair", "frozen_test", text);
  const bytes = encoder.encode(text);
  assertEquals(prepared.hash, expected, text.slice(0, 40));
  assertEquals(prepared.size_bytes, bytes.byteLength);
  assertEquals(await sha256Hex(bytes), expected);
  const stored = await Deno.readFile(
    objectPathFor(world.harness.dataRoot, expected),
  );
  assertEquals(stored, bytes);
}

async function storeReproduction(world: Ledger): Promise<{
  testHash: string;
  environment: string;
}> {
  const fixed = reproductionFrozen(BROKEN_SCENARIO);
  const codeHash = await sha256Hex(CODE_TEXT);
  const environment = await sha256Hex(ENV_TEXT);
  await storeText(world, CODE_TEXT, codeHash);
  await storeText(
    world,
    canonicalJson({
      probe: BROKEN_SCENARIO.probe,
      adjacent: BROKEN_SCENARIO.adjacent.map(({ name, command, input }) => ({
        name,
        command,
        input,
      })),
    }),
    fixed.input,
  );
  await storeText(
    world,
    canonicalJson({
      expectation: BROKEN_SCENARIO.expectation,
      adjacent: BROKEN_SCENARIO.adjacent.map(({ name, holds }) => ({
        name,
        holds,
      })),
    }),
    fixed.expected,
  );
  await storeText(
    world,
    canonicalJson({
      problem_code: BROKEN_SCENARIO.problem_code,
      symptom: BROKEN_SCENARIO.symptom,
    }),
    fixed.symptom,
  );
  await storeText(world, ENV_TEXT, environment);
  const frozen: FrozenTest = {
    code: codeHash,
    input: fixed.input,
    expected: fixed.expected,
    method: {
      argv: ["test", "child_test.ts"],
      cwd: ".",
      timeout_ms: STAGE3_TIMEOUT_MS,
      expected_exit_code: 0,
      environment,
    },
    blueprint: null,
    sdk_dependencies: null,
    failure_paths: null,
    symptom: fixed.symptom,
  };
  const testHash = canonicalHash(frozen);
  await storeText(world, canonicalJson(frozen), testHash);
  assertNotEquals(testHash, codeHash);
  return { testHash, environment };
}

async function runStageThree(
  opened: Opened,
  ticket: { ticket: string; revision: string },
  // basis는 테스트 요청 때 읽은 문제 기준(seq)이다. 없으면 이전 단계의 "1"이다.
  hashes: {
    test: string;
    after: string;
    content?: SealedContent;
    basis?: string;
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
      ticket: ticket.ticket,
      base_revision: ticket.revision,
      app: opened.world.app,
      problem: opened.problem,
      before: REL_BEFORE,
      release: REL_AFTER,
      bundle_hash: hashes.after,
      reports: [rpt(1)],
      basis_seq: hashes.basis ?? "1",
      test: hashes.test,
      summary: STAGE3_SUMMARY,
      commit: COMMIT,
      request_key: "repro-stage3",
      release_request_key: "release-stage3",
      after: async (stage: RepairStage, traced) => {
        if (stage === "claim" && !traced.isError) {
          insertRelease(opened.world, {
            id: REL_AFTER,
            number: 2,
            bundle: hashes.after,
            source: JSON.stringify({
              ticket: ticket.ticket,
              claim_seq: traced.data.claim_seq,
            }),
            by: `coding_agent:${opened.coding.connection}`,
            content: hashes.content,
          });
          await waitWork(opened.world.harness.dataRoot, opened.problem);
        }
        if (stage === "reproduction") {
          await settleEvents(opened.world.harness.dataRoot, opened.problem);
        }
        if (stage === "record_fix") return "stop";
      },
    });
  } finally {
    await Deno.remove(home, { recursive: true });
  }
}

type RequestEnd = {
  phase: string;
  reason: string;
  result_ref: string | null;
};

async function waitRequestEnd(
  root: string,
  requestKey: string,
  limitMs: number,
): Promise<RequestEnd> {
  const deadline = Date.now() + limitMs;
  let last = "없음";
  while (Date.now() < deadline) {
    const db = openDb(`${root}/lophn.db`, true);
    try {
      const row = db.prepare(
        `select phase, reason, result_ref from test_requests
         where request_key = ? and phase in ('result_ref', 'preparation_failed', 'start_unknown')
         order by seq desc limit 1`,
      ).get(requestKey) as RequestEnd | undefined;
      if (row) return row;
      const running = db.prepare(
        `select phase, reason from test_requests
         where request_key = ? order by seq desc limit 1`,
      ).get(requestKey) as { phase: string; reason: string } | undefined;
      if (running) last = `${running.phase} ${running.reason}`;
    } finally {
      db.close();
    }
    await delay(1000);
  }
  throw new Error(`요청이 끝나지 않았다 (${requestKey}: ${last})`);
}

async function widen(directory: string): Promise<void> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(directory);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  // symlink 대상(deno 실행 파일)의 권한을 바꾸지 않는다.
  if (info.isSymlink) return;
  if (!info.isDirectory) {
    await Deno.chmod(directory, 0o644);
    return;
  }
  await Deno.chmod(directory, 0o755);
  for await (const entry of Deno.readDir(directory)) {
    await widen(`${directory}/${entry.name}`);
  }
}

async function filesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string) => {
    for await (const entry of Deno.readDir(current)) {
      const path = `${current}/${entry.name}`;
      if (entry.isDirectory) await walk(path);
      else found.push(path);
    }
  };
  try {
    await walk(dir);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return found;
}

Deno.test({
  name:
    "problems/tests#R1 problems/tests#R2 problems/tests#R4 problems/tests#R5 problems/tests#R10 problems/tests#R13 problems/tests#R15 flow verify-app-repair 3: runner가 이전 실패와 고친 통과만 기록한다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    let made: MadeFixture | undefined;
    let home: string | undefined;
    let opened: Opened | undefined;
    let beforeHash = "";
    try {
      opened = await openLedger({
        beforeBundle: async (app, dataRoot) => {
          made = await madeFixture("broken", await installedHome([]));
          const sealed = await sealBoard(made, "A", app, dataRoot);
          beforeHash = sealed.hash;
          return sealed.hash;
        },
      });
      const ticket = await readyTicket(opened);
      const stored = await storeReproduction(opened.world);
      assert(made, "봉인할 source가 없다");
      const after = await sealBoard(
        made,
        "B",
        opened.world.app,
        opened.world.harness.dataRoot,
      );
      assertNotEquals(after.hash, beforeHash);
      await made.dispose();
      made = undefined;
      await absentBlob(opened.world.harness.dataRoot, after.hash);
      await absentBlob(opened.world.harness.dataRoot, beforeHash);
      await absentBlob(opened.world.harness.dataRoot, TEST_HASH);

      const script = await runStageThree(opened, ticket, {
        test: stored.testHash,
        after: after.hash,
      });
      const recorded = step(script, "record_fix");
      assertEquals(
        recorded.isError,
        false,
        JSON.stringify({ halted: script.halted_before, recorded }),
      );
      assertEquals(script.halted_before, "release_prepare");
      const reproduction = step(script, "reproduction");
      assertEquals(
        reproduction.isError ?? false,
        false,
        JSON.stringify(reproduction.data),
      );
      assertNotEquals(reproduction.data.state, "pass");
      assertNotEquals(reproduction.data.real_test, true);
      const held = await heldFrom(opened, ticket.ticket);
      assertEquals(held.fix.verification, []);
      assertEquals(decoder.decode(held.summaryBytes), STAGE3_SUMMARY);
      assert(!decoder.decode(held.summaryBytes).includes(PASS_REASON));

      const root = opened.world.harness.dataRoot;
      const ended = await waitRequestEnd(root, "repro-stage3", 660_000);
      assertEquals(
        ended.phase,
        "result_ref",
        `${ended.phase} ${ended.reason}`,
      );
      assert(ended.result_ref?.startsWith("vrf_"), ended.result_ref ?? "");
      const db = openDb(`${root}/lophn.db`, true);
      let verification: {
        id: string;
        kind: string;
        result: string;
        test: string;
        reason: string;
        target_bundle_hash: string;
        before_release: string;
        after_release: string;
        observations: string;
      };
      let evidenceText = "";
      try {
        verification = db.prepare(
          `select id, kind, result, test, reason, target_bundle_hash,
                  before_release, after_release, observations
           from verifications where request_key = ?`,
        ).get("repro-stage3") as typeof verification;
        const evidence = db.prepare(
          `select evidence from test_evidence where request_key = ?`,
        ).get("repro-stage3") as { evidence: string };
        evidenceText = evidence.evidence;
        const fixes = db.prepare(
          `select count(*) as n from verifications where problem = ?`,
        ).get(opened.problem) as { n: number };
        assertEquals(fixes.n, 1);
      } finally {
        db.close();
      }
      assertEquals(verification.id, ended.result_ref);
      assertEquals(verification.kind, "reproduction");
      assertEquals(verification.result, "pass", verification.reason);
      assertEquals(verification.test, stored.testHash);
      assertEquals(verification.reason, PASS_REASON);
      assert(!verification.reason.includes("테스트 통과"));
      assertEquals(verification.target_bundle_hash, after.hash);
      assertEquals(verification.before_release, REL_BEFORE);
      assertEquals(verification.after_release, REL_AFTER);
      assert(!held.fix.verification.includes(verification.id));
      const observed = JSON.parse(evidenceText) as {
        execution_evidence: {
          side: string;
          bundle_hash: string;
          test_hash: string;
          ended_at: string;
          end_reason: string;
          output: null;
          environment: string;
        }[];
        observations_json: {
          original_symptom: {
            before?: { symptom_reproduced?: boolean };
            after?: { symptom_reproduced?: boolean };
          };
          changed_expectation: { sides: { after?: { met?: boolean } } };
          isolation: {
            operating_db_copied: boolean;
            real_account_resend: boolean;
            sides: {
              side: string;
              fresh_fixture: boolean;
              source_read_only: boolean;
            }[];
          };
          external_effects: { invocations: Record<string, unknown>[] };
        };
        frozen: { symptom: string | null; blueprint: string | null };
      };
      assertEquals(
        observed.execution_evidence.map((item) => item.side),
        ["before", "after"],
      );
      assertEquals(observed.execution_evidence[0]!.bundle_hash, beforeHash);
      assertEquals(observed.execution_evidence[1]!.bundle_hash, after.hash);
      for (const item of observed.execution_evidence) {
        assertEquals(item.test_hash, stored.testHash);
        assertEquals(item.end_reason, "exited");
        assertEquals(item.output, null);
        assertEquals(item.environment, stored.environment);
        assertNotEquals(item.bundle_hash, item.test_hash);
      }
      assertEquals(observed.frozen.blueprint, null);
      assert(observed.frozen.symptom);
      const facts = observed.observations_json;
      assertEquals(facts.original_symptom.before?.symptom_reproduced, true);
      assertEquals(facts.original_symptom.after?.symptom_reproduced, false);
      assertEquals(facts.changed_expectation.sides.after?.met, true);
      assertEquals(facts.isolation.operating_db_copied, false);
      assertEquals(facts.isolation.real_account_resend, false);
      assertEquals(
        facts.isolation.sides.map((item) => [
          item.side,
          item.fresh_fixture,
          item.source_read_only,
        ]),
        [["before", true, true], ["after", true, true]],
      );
      for (const item of facts.external_effects.invocations) {
        assertEquals(Object.keys(item).sort(), ["invocation", "side"]);
      }
      const observationBytes = await Deno.readFile(
        objectPathFor(root, verification.observations),
      );
      assertEquals(
        await sha256Hex(observationBytes),
        verification.observations,
      );
      const latestEnd = observed.execution_evidence.map((item) => item.ended_at)
        .sort()
        .at(-1)!;

      const work = `${root}/work/problems/tests/${
        (await sha256Hex("repro-stage3")).slice(0, 24)
      }`;
      const files = await filesUnder(work);
      assert(files.some((path) => path.includes("/before/")), "before fixture");
      assert(files.some((path) => path.includes("/after/")), "after fixture");
      assert(!files.some((path) => path.endsWith("/lophn.db")));
      assert(!files.includes(`${root}/lophn.db`));
      for (const path of files) {
        if ((await Deno.stat(path)).size > 262_144) continue;
        const text = decoder.decode(await Deno.readFile(path));
        assert(!text.includes(opened.coding.token), path);
        assert(!text.includes("LOPHN_HOME="), path);
      }

      const issued = await opened.world.harness.credential({
        actor: "user",
        principal: "user-repair-stage3",
        scope: {
          operations: ["RequestTest"],
          targets: { app: opened.world.app },
        },
        conditions: { app: opened.world.app },
      });
      assert(issued.ok, issued.ok ? "" : issued.error.message);
      const missing = await post(
        opened.world,
        "problems/request-test",
        issued.value.token,
        envelope({
          request_key: "repro-missing",
          kind: "reproduction",
          app: opened.world.app,
          target: { bundle_hash: after.hash, release: REL_AFTER },
          problem: opened.problem,
          basis_seq: "1",
          reports: [rpt(1)],
          before: REL_BEFORE,
          after: REL_AFTER,
          ticket: null,
          test: TEST_HASH,
          timeout_ms: 30_000,
        }),
      );
      assertEquals(missing.status, 200, JSON.stringify(missing.body));
      assertEquals(missing.body["accepted"], true);
      const missed = await waitRequestEnd(root, "repro-missing", 30_000);
      assertEquals(missed.phase, "preparation_failed", missed.reason);
      assertEquals(missed.result_ref, null);
      const again = openDb(`${root}/lophn.db`, true);
      try {
        const count = again.prepare(
          `select count(*) as n from verifications where problem = ?`,
        ).get(opened.problem) as { n: number };
        assertEquals(count.n, 1);
        const pass = again.prepare(
          `select result from verifications where request_key = ?`,
        ).get("repro-stage3") as { result: string };
        assertEquals(pass.result, "pass");
      } finally {
        again.close();
      }

      home = await copyHome(root);
      // 봉인 bundle은 읽기 전용이라 close의 삭제가 거절된다. symlink는 따라가지 않는다.
      await widen(root);
      await opened.world.close();
      const flow = await openFlowShell({
        home,
        start: `app:${opened.world.app}`,
      });
      try {
        await waitFixing(flow, opened.problem);
        await openIssue(flow);
        await flow.click("[data-issue-open]");
        await flow.until(
          `document.querySelector('[data-issue-detail="fixing"]') !== null`,
          "Issues 상세",
        );
        assertEquals(
          await flow.evaluate(
            `document.querySelector("[data-check='tests']")?.getAttribute("data-test-state")`,
          ),
          "pass",
        );
        const tests = await screenText(flow, "[data-check='tests']");
        assert(tests.includes("passed"), tests);
        assert(!tests.includes("이 문장은 통과가 아니다"), tests);
        assert(!tests.includes(PASS_REASON), tests);
        assert(
          (await screenText(flow, "[data-check='claim']")).includes(CLAIM),
        );
        assertEquals(
          await flow.evaluate(
            `document.querySelector("[data-check='human']")?.getAttribute("data-checked")`,
          ),
          "false",
        );
        const visible = await screenText(flow, "[data-issue-detail]");
        for (
          const hidden of [
            beforeHash,
            after.hash,
            stored.testHash,
            opened.coding.token,
            "work/problems",
            "이 문장은 통과가 아니다",
            PASS_REASON,
            "lophn.invalid",
            STAGE3_SUMMARY,
          ]
        ) {
          assert(!visible.includes(hidden), hidden.slice(0, 24));
        }
        const problem = await mustCall(flow, {
          kind: "read",
          resource: "problems",
          method: "get",
          body: { problem: opened.problem },
        });
        assertNotEquals(
          (problem.problem as { status: string }).status,
          "closed",
        );
        const detail = (problem.detail as {
          result: {
            tests: {
              state: string;
              items: {
                kind: string;
                state: string;
                ended_at: string | null;
              }[];
            };
          };
        }).result.tests;
        assertEquals(detail.state, "pass");
        const item = detail.items.find((entry) =>
          entry.kind === "reproduction"
        );
        assertEquals(item?.state, "pass");
        assertEquals(item?.ended_at, latestEnd);
      } finally {
        await flow.close();
      }
    } finally {
      await made?.dispose();
      if (opened) {
        await widen(opened.world.harness.dataRoot);
        await opened.world.close();
      }
      if (home !== undefined) {
        await Deno.remove(home, { recursive: true });
      }
    }
  },
});

const SCREEN_RESULT: Record<string, string> = {
  pass: "pass",
  fail: "fail",
  inconclusive: "unconfirmed",
};

Deno.test({
  name:
    "problems/tests#R4 problems/tests#R5 problems/repairs#R2 apps/releases#R5 problems/closing#R2 problems/closing#R4 flow verify-app-repair 4: 통과·실패·판정 불가·미실행과 남은 확인을 구별하고 적용하지 않은 수리를 닫지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    let made: MadeFixture | undefined;
    let home: string | undefined;
    let opened: Opened | undefined;
    let beforeHash = "";
    try {
      opened = await openLedger({
        beforeBundle: async (app, dataRoot) => {
          made = await madeFixture("broken", await installedHome([]));
          const sealed = await sealBoard(made, "A", app, dataRoot);
          beforeHash = sealed.hash;
          return sealed.hash;
        },
      });
      const ticket = await readyTicket(opened);
      const stored = await storeReproduction(opened.world);
      assert(made, "봉인할 source가 없다");
      const fixed = await sealBoard(
        made,
        "B",
        opened.world.app,
        opened.world.harness.dataRoot,
      );
      const still = await sealBoard(
        made,
        "D",
        opened.world.app,
        opened.world.harness.dataRoot,
      );
      const other = await sealBoard(
        made,
        "E",
        opened.world.app,
        opened.world.harness.dataRoot,
      );
      assertNotEquals(fixed.hash, beforeHash);
      assertNotEquals(still.hash, fixed.hash);
      assertNotEquals(other.hash, fixed.hash);
      insertRelease(opened.world, {
        id: REL_STILL,
        number: 4,
        bundle: still.hash,
        source: null,
        by: "machine",
      });
      insertRelease(opened.world, {
        id: REL_OTHER,
        number: 5,
        bundle: other.hash,
        source: null,
        by: "machine",
      });
      await made.dispose();
      made = undefined;

      const script = await runStageThree(opened, ticket, {
        test: stored.testHash,
        after: fixed.hash,
      });
      assertEquals(script.halted_before, "release_prepare");
      assertEquals(step(script, "record_fix").isError, false);
      const root = opened.world.harness.dataRoot;
      const passed = await waitRequestEnd(root, "repro-stage3", 660_000);
      assertEquals(
        passed.phase,
        "result_ref",
        `${passed.phase} ${passed.reason}`,
      );
      const issued = await opened.world.harness.credential({
        actor: "user",
        principal: "user-repair-stage4",
        scope: {
          operations: ["RequestTest"],
          targets: { app: opened.world.app },
        },
        conditions: { app: opened.world.app },
      });
      assert(issued.ok, issued.ok ? "" : issued.error.message);
      const token = issued.value.token;
      const reproduction = (
        key: string,
        release: string,
        bundle: string,
      ) => ({
        request_key: key,
        kind: "reproduction",
        app: opened!.world.app,
        target: { bundle_hash: bundle, release },
        problem: opened!.problem,
        basis_seq: "1",
        reports: [rpt(1)],
        before: REL_BEFORE,
        after: release,
        ticket: null,
        test: stored.testHash,
        timeout_ms: STAGE3_TIMEOUT_MS,
      });
      const send = async (input: Record<string, unknown>) => {
        const sent = await post(
          opened!.world,
          "problems/request-test",
          token,
          envelope(input),
        );
        assertEquals(sent.status, 200, JSON.stringify(sent.body));
        assertEquals(sent.body["accepted"], true, JSON.stringify(sent.body));
      };
      await send(reproduction("repro-fail", REL_STILL, still.hash));
      const failed = await waitRequestEnd(root, "repro-fail", 660_000);
      assertEquals(
        failed.phase,
        "result_ref",
        `${failed.phase} ${failed.reason}`,
      );
      await send(reproduction("repro-other", REL_OTHER, other.hash));
      const unclear = await waitRequestEnd(root, "repro-other", 660_000);
      assertEquals(
        unclear.phase,
        "result_ref",
        `${unclear.phase} ${unclear.reason}`,
      );
      const derived = await deriveAppTest(fixed.path, fixed.hash);
      assert(derived.ok, derived.ok ? "" : derived.reason);
      await send({
        request_key: "app-stage4",
        kind: "app_test",
        app: opened.world.app,
        target: { bundle_hash: fixed.hash, release: null },
        problem: null,
        basis_seq: null,
        reports: [],
        before: null,
        after: null,
        ticket: null,
        test: derived.value.test_hash,
        timeout_ms: APP_TEST_TIMEOUT_MS,
      });
      const appRun = await waitRequestEnd(root, "app-stage4", 600_000);
      await send({
        request_key: "app-unrun",
        kind: "app_test",
        app: opened.world.app,
        target: { bundle_hash: fixed.hash, release: null },
        problem: null,
        basis_seq: null,
        reports: [],
        before: null,
        after: null,
        ticket: null,
        test: "f".repeat(64),
        timeout_ms: APP_TEST_TIMEOUT_MS,
      });
      const unrun = await waitRequestEnd(root, "app-unrun", 60_000);
      assertEquals(unrun.phase, "preparation_failed", unrun.reason);
      assertEquals(unrun.result_ref, null);
      // before Version에도 그 묶음을 대상으로 실제 돌아간 test가 있어야 한다.
      const derivedBefore = await deriveAppTest(
        `${root}/apps/${opened.world.app}/bundles/${beforeHash}`,
        beforeHash,
      );
      assert(derivedBefore.ok, derivedBefore.ok ? "" : derivedBefore.reason);
      await send({
        request_key: "app-before",
        kind: "app_test",
        app: opened.world.app,
        target: { bundle_hash: beforeHash, release: null },
        problem: null,
        basis_seq: null,
        reports: [],
        before: null,
        after: null,
        ticket: null,
        test: derivedBefore.value.test_hash,
        timeout_ms: APP_TEST_TIMEOUT_MS,
      });
      const beforeRun = await waitRequestEnd(root, "app-before", 600_000);
      assertEquals(
        beforeRun.phase,
        "result_ref",
        `${beforeRun.phase} ${beforeRun.reason}`,
      );
      // 각 Version은 그 묶음을 대상으로 실제 기록된 검증만 test로 단다.
      assert(appRun.result_ref !== null, appRun.phase);
      assert(failed.result_ref !== null, failed.phase);
      assert(unclear.result_ref !== null, unclear.phase);
      assert(beforeRun.result_ref !== null, beforeRun.phase);
      linkReleaseTest(opened.world, REL_BEFORE, beforeRun.result_ref);
      linkReleaseTest(opened.world, REL_AFTER, appRun.result_ref);
      linkReleaseTest(opened.world, REL_STILL, failed.result_ref);
      linkReleaseTest(opened.world, REL_OTHER, unclear.result_ref);

      const db = openDb(`${root}/lophn.db`, true);
      let results: { key: string; result: string }[];
      let active = 0;
      let problemStatus = "";
      let passEnded = "";
      try {
        results = db.prepare(
          `select request_key as key, result from verifications
           where request_key in ('repro-stage3', 'repro-fail', 'repro-other', 'app-stage4')`,
        ).all() as { key: string; result: string }[];
        active = Number(
          (db.prepare(
            `select count(*) as n from releases where app = ? and status = 'active'`,
          ).get(opened.world.app) as { n: number }).n,
        );
        problemStatus = (db.prepare(
          `select status from problems where id = ?`,
        ).get(opened.problem) as { status: string }).status;
        const evidence = db.prepare(
          `select evidence from test_evidence where request_key = ?`,
        ).get("repro-stage3") as { evidence: string };
        const observed = JSON.parse(evidence.evidence) as {
          execution_evidence: { ended_at: string }[];
        };
        passEnded = observed.execution_evidence.map((item) => item.ended_at)
          .sort()
          .at(-1)!;
      } finally {
        db.close();
      }
      const resultOf = (key: string) =>
        results.find((row) => row.key === key)?.result;
      assertEquals(resultOf("repro-stage3"), "pass");
      assertEquals(resultOf("repro-fail"), "fail");
      assertEquals(resultOf("repro-other"), "inconclusive");
      const appState = appRun.phase === "result_ref"
        ? SCREEN_RESULT[resultOf("app-stage4") ?? ""]
        : appRun.phase === "preparation_failed"
        ? "not_run"
        : "";
      assert(
        appState === "pass" || appState === "fail" ||
          appState === "unconfirmed" || appState === "not_run",
        `${appRun.phase} ${appRun.reason} ${resultOf("app-stage4") ?? ""}`,
      );
      assertEquals(active, 0);
      assertNotEquals(problemStatus, "closed");

      home = await copyHome(root);
      await widen(root);
      await opened.world.close();
      const flow = await openFlowShell({
        home,
        start: `app:${opened.world.app}`,
      });
      try {
        await waitFixing(flow, opened.problem);
        await flow.until(
          `document.querySelector('[data-app-bar="app-details"]') !== null`,
          "앱 막대",
        );
        await flow.click('[data-app-bar="app-details"]');
        await flow.until(
          `document.querySelector("[data-no-current]") !== null`,
          "운영 적용 없음",
        );
        assert(
          (await screenText(flow, "[data-no-current]")).includes(
            "No version is in use yet",
          ),
        );
        assertEquals(
          await flow.evaluate(
            `document.querySelector("[data-version][data-status='active']") !== null`,
          ),
          false,
        );
        await flow.until(
          `document.querySelector("[data-version-expand]") !== null`,
          "Version 목록",
        );
        await flow.click("[data-version-expand]");
        await flow.until(
          `document.querySelector("[data-fact='applied']")?.textContent?.includes("Not in use") && (document.querySelector("[data-fact='test']")?.textContent ?? "") !== ""`,
          "준비만 된 Version",
        );
        // 읽지 못한 test 결과는 통과로 보이지 않는다.
        assertEquals(
          await flow.evaluate(
            `document.querySelector("[data-fact='test'] [data-test-result='pass']") !== null`,
          ),
          false,
        );
        // 제품 결함으로 막혀 있다: 사람 token(targets {})은 problems/tests의 GetVerification을
        // 읽지 못해(forbidden) Version의 test 결과가 "Can't read the result right now"로만 보인다.
        // 열면 아래가 REL_OTHER의 inconclusive를 보여야 한다. problems/tests#R5에서 넘어온 것.
        await t.step({
          name: "Version의 실제 test 결과가 그 Version에서 구별되어 보인다",
          ignore: true,
          fn: async () => {
            assertEquals(
              await flow.evaluate(
                `document.querySelector("[data-fact='test'] [data-test-result]")?.getAttribute("data-test-result")`,
              ),
              "inconclusive",
            );
          },
        });
        assertEquals(
          await flow.evaluate(
            `document.querySelectorAll("[data-version][data-status='prepared']").length`,
          ),
          4,
        );
        await openIssuesTab(flow);
        const impact = await mustCall(flow, {
          kind: "read",
          resource: "problems",
          method: "get",
          body: { problem: opened.problem },
        });
        const symptom = String(impact.text);
        const openedRow = await flow.evaluate(`(() => {
          const button = [...document.querySelectorAll("[data-issue-open]")]
            .find((item) => item.textContent === ${JSON.stringify(symptom)});
          if (!button) return false;
          button.click();
          return true;
        })()`);
        assertEquals(openedRow, true, "문제 행이 없다");
        await flow.until(
          `document.querySelector('[data-issue-detail="fixing"]') !== null`,
          "Issues 상세",
        );
        const recorded = JSON.parse(String(
          await flow.evaluate(
            `JSON.stringify([...document.querySelectorAll("[data-recorded-item]")].map((item) => ({
            kind: item.getAttribute("data-recorded-kind"),
            state: item.getAttribute("data-recorded-item"),
            ended: item.querySelector("time")?.getAttribute("datetime") ?? null,
            text: item.textContent ?? ""
          })))`,
          ),
        )) as {
          kind: string;
          state: string;
          ended: string | null;
          text: string;
        }[];
        const has = (kind: string, state: string) =>
          recorded.some((item) => item.kind === kind && item.state === state);
        assert(has("reproduction", "pass"), JSON.stringify(recorded));
        assert(has("reproduction", "fail"), JSON.stringify(recorded));
        assert(has("reproduction", "unconfirmed"), JSON.stringify(recorded));
        assert(has("app_test", "not_run"), JSON.stringify(recorded));
        assert(has("app_test", appState), JSON.stringify(recorded));
        const passLine = recorded.find((item) =>
          item.kind === "reproduction" && item.state === "pass"
        );
        assertEquals(passLine?.ended, passEnded);
        const remaining = await screenText(flow, "[data-check='remaining']");
        assert(remaining.includes("not in use"), remaining);
        assert(remaining.includes("stays open"), remaining);
        assertEquals(
          await flow.evaluate(
            `document.querySelector("[data-check='human']")?.getAttribute("data-checked")`,
          ),
          "false",
        );
        assertEquals(
          await flow.evaluate(
            `document.querySelector("[data-issue-detail]")?.getAttribute("data-issue-detail")`,
          ),
          "fixing",
        );
        const visible = await screenText(flow, "[data-issue-detail]");
        for (
          const hidden of [
            beforeHash,
            fixed.hash,
            still.hash,
            other.hash,
            stored.testHash,
            derived.value.test_hash,
            derivedBefore.value.test_hash,
            opened.coding.token,
            token,
            PASS_REASON,
            STAGE3_SUMMARY,
            "f".repeat(64),
          ]
        ) {
          assert(!visible.includes(hidden), hidden.slice(0, 24));
        }
        const problem = await mustCall(flow, {
          kind: "read",
          resource: "problems",
          method: "get",
          body: { problem: opened.problem },
        });
        assertNotEquals(
          (problem.problem as { status: string }).status,
          "closed",
        );
        const detail = (problem.detail as {
          result: {
            remaining?: string;
            recorded?: { kind: string; state: string }[];
          };
        }).result;
        assert(
          detail.remaining?.includes("not in use"),
          detail.remaining ?? "",
        );
        assert(
          detail.recorded?.some((item) =>
            item.kind === "app_test" && item.state === appState
          ),
          JSON.stringify(detail.recorded),
        );
      } finally {
        await flow.close();
      }
    } finally {
      await made?.dispose();
      if (opened) {
        await widen(opened.world.harness.dataRoot);
        await opened.world.close();
      }
      if (home !== undefined) {
        await Deno.remove(home, { recursive: true });
      }
    }
  },
});

type Page = Awaited<ReturnType<FlowShell["shell"]["connect"]>>;

async function untilRead(
  what: string,
  check: () => Promise<boolean>,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    last = await check();
    if (last === true) return;
    await delay(500);
  }
  throw new Error(`${what}: ${JSON.stringify(last)}`);
}

async function pageUntil(
  page: Page,
  expression: string,
  what: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      last = await page.evaluate(expression);
    } catch (error) {
      last = String(error);
    }
    if (last) return;
    await delay(200);
  }
  throw new Error(`${what}: ${JSON.stringify(last)}`);
}

async function pageTap(page: Page, selector: string): Promise<void> {
  const clicked = await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assertEquals(clicked, true, `누를 요소가 없다: ${selector}`);
}

const WINDOW_URL = "confirmation/index.html";
// 닫히는 창의 webContents는 읽는 사이에 사라질 수 있다. 그런 창은 없는 것으로 본다.
const OPEN_WINDOW = `electron.BrowserWindow.getAllWindows().some((w) => {
  try {
    return !w.isDestroyed() && w.webContents.getURL().includes("${WINDOW_URL}");
  } catch {
    return false;
  }
})`;

async function untilWindow(flow: FlowShell, open: boolean): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if (await flow.shell.mainEvaluate(OPEN_WINDOW) === open) return;
    } catch { /* 창이 닫히는 중이다. 다시 본다. */ }
    await delay(200);
  }
  throw new Error(open ? "결정 창이 열리지 않았다" : "결정 창이 닫히지 않았다");
}

// 창 닫기는 결정이 아니다(shell/confirmation-window#R4).
async function closeWindow(flow: FlowShell): Promise<void> {
  await flow.shell.mainEvaluate(
    `(() => {
      for (const w of electron.BrowserWindow.getAllWindows()) {
        try {
          if (!w.isDestroyed() && w.webContents.getURL().includes("${WINDOW_URL}")) w.close();
        } catch { /* 이미 닫히는 창 */ }
      }
      return true;
    })()`,
  );
}

async function appOf(
  flow: FlowShell,
  app: string,
): Promise<{ active_release: string | null }> {
  const got = await mustCall(flow, {
    kind: "read",
    resource: "apps",
    method: "get",
    body: { app },
  });
  return got.app as { active_release: string | null };
}

async function releaseOf(
  flow: FlowShell,
  release: string,
): Promise<{ status: string; activation: unknown; failure: unknown }> {
  const got = await mustCall(flow, {
    kind: "read",
    resource: "releases",
    method: "get",
    body: { release },
  });
  return got.release as {
    status: string;
    activation: unknown;
    failure: unknown;
  };
}

// 실제로 도는 자식의 release와 시작 확인이다. 도는 자식이 없으면 null이다.
async function runningOf(
  flow: FlowShell,
  app: string,
): Promise<{ release: string | null; ready: boolean } | null> {
  const got = await mustCall(flow, {
    kind: "read",
    resource: "apps",
    method: "runtime",
    body: { app },
  });
  const seen = got.observation as
    | { release: string | null; mode: string; ready: boolean }
    | null;
  if (seen === null || seen.mode !== "live") return null;
  return { release: seen.release, ready: seen.ready };
}

function countRows(home: string, table: string): number {
  const db = openDb(`${home}/lophn.db`, true);
  try {
    return Number(
      (db.prepare(`select count(*) as n from ${table}`).get() as { n: number })
        .n,
    );
  } finally {
    db.close();
  }
}

// 앱을 처음 켠 activation이 남겼을 앱 DB다. 봉인 bundle의 migration 단계를 그대로 적용한다.
async function seedAppData(
  home: string,
  app: string,
  bundlePath: string,
): Promise<void> {
  const dataArea = `${home}/apps/${app}/data`;
  await Deno.mkdir(`${dataArea}/backups`, { recursive: true, mode: 0o700 });
  const steps: { from: number; to: number; name: string }[] = [];
  for await (const entry of Deno.readDir(`${bundlePath}/migrations`)) {
    const found = /^(\d+)-(\d+)\.sql$/.exec(entry.name);
    if (found) {
      steps.push({
        from: Number(found[1]),
        to: Number(found[2]),
        name: entry.name,
      });
    }
  }
  steps.sort((a, b) => a.from - b.from);
  const scripts = [];
  for (const step of steps) {
    const sql = await Deno.readTextFile(
      `${bundlePath}/migrations/${step.name}`,
    );
    scripts.push({
      change: {
        from: step.from,
        to: step.to,
        script_hash: await sha256Hex(sql),
        description: `migration ${step.from}-${step.to}`,
      },
      sql,
    });
  }
  const migrated = await migrateAppDatabase({
    dataArea,
    databasePath: `${dataArea}/app.sqlite`,
    backupPath: `${dataArea}/backups/seed`,
    targetSchema: BROKEN_DATA_SCHEMA,
    scripts,
    appliedAt: "2026-10-02T00:00:00.000Z",
    result: { release: REL_BEFORE, activation_seq: "1", invocation: null },
  });
  assert(migrated.ok, migrated.ok ? "" : JSON.stringify(migrated.error));
  assertEquals(migrated.value.result.data_schema, BROKEN_DATA_SCHEMA);
}

async function activationSteps(
  t: Deno.TestContext,
  home: string,
  app: string,
  problemId: string,
): Promise<void> {
  const verificationsBefore = countRows(home, "verifications");
  const flow = await openFlowShell({ home, start: `app:${app}` });
  let confirmation: Page | undefined;
  try {
    await waitFixing(flow, problemId);
    const problemStatus = async () =>
      ((await mustCall(flow, {
        kind: "read",
        resource: "problems",
        method: "get",
        body: { problem: problemId },
      })).problem as { status: string }).status;
    const unchanged = async (why: string) => {
      // 허락 전에는 이전 release가 그대로 운영되고 고친 release는 준비만 된 채다.
      assertEquals(
        (await appOf(flow, app)).active_release,
        REL_BEFORE,
        why,
      );
      const fixedRelease = await releaseOf(flow, REL_AFTER);
      assertEquals(fixedRelease.status, "prepared", why);
      assertEquals(fixedRelease.activation, null, why);
      assertEquals(fixedRelease.failure, null, why);
      assertEquals((await runningOf(flow, app))?.release, REL_BEFORE, why);
      assertNotEquals(await problemStatus(), "closed", why);
      assertEquals(countRows(home, "verifications"), verificationsBefore);
    };
    await untilRead("이전 release가 시작하지 않았다", async () => {
      const seen = await runningOf(flow, app);
      return seen?.release === REL_BEFORE && seen.ready;
    });
    await flow.until(
      `document.querySelector('[data-app-bar="app-details"]') !== null`,
      "앱 막대",
    );
    await flow.click('[data-app-bar="app-details"]');
    await flow.until(
      `document.querySelector(${
        JSON.stringify(`[data-version="${REL_BEFORE}"]`)
      })?.getAttribute("data-status") === "active"`,
      "지금 Version이 보이지 않는다",
    );
    await flow.click(`[data-version="${REL_AFTER}"] [data-version-expand]`);
    await flow.until(
      `document.querySelector(${
        JSON.stringify(
          `[data-version="${REL_AFTER}"] [data-fact="applied"]`,
        )
      })?.textContent?.includes("Not in use")`,
      "고친 Version이 준비만 된 채로 보이지 않는다",
    );
    await t.step({
      name: "Version의 실제 test 결과가 그 Version에서 보인다",
      ignore: true,
      // 사람 token(targets {})이 problems/tests GetVerification을 forbidden으로 받아
      // 읽지 못함으로만 보인다. 4단계에서 넘어온 결함이다.
      fn: async () => {
        assertEquals(
          await flow.evaluate(
            `document.querySelector(${
              JSON.stringify(
                `[data-version="${REL_AFTER}"] [data-fact="test"] [data-test-result]`,
              )
            })?.getAttribute("data-test-result")`,
          ),
          "pass",
        );
      },
    });
    await unchanged("사람이 고르기 전");

    const openVersions = async () => {
      await flow.until(
        `document.querySelector('[data-app-bar="app-details"]') !== null`,
        "앱 막대",
      );
      await flow.click('[data-app-bar="app-details"]');
      await flow.until(
        `document.querySelector(${
          JSON.stringify(`[data-version="${REL_BEFORE}"]`)
        })?.getAttribute("data-status") === "active"`,
        "지금 Version이 보이지 않는다",
      );
      await flow.click(
        `[data-version="${REL_AFTER}"] [data-version-expand]`,
      );
      await flow.until(
        `document.querySelector(${
          JSON.stringify(
            `[data-version="${REL_AFTER}"] [data-use-version]`,
          )
        }) !== null`,
        "고친 Version을 고를 수 없다",
      );
    };
    let windows = 0;
    const choose = async (again: boolean) => {
      if (again) {
        // 결정이 끝난 화면은 고른 상태를 지닌다. 사람이 앱 공간을 다시 열어 고른다.
        await flow.evaluate(
          `(() => { location.reload(); return true; })()`,
        );
        await delay(500);
        await flow.until(
          `document.querySelector('[data-space="app"]') !== null`,
          "앱 공간이 다시 서지 않았다",
        );
        await openVersions();
      }
      await flow.click(`[data-version="${REL_AFTER}"] [data-use-version]`);
      await untilWindow(flow, true);
      // connect는 url 조각마다 session을 기억한다. 닫힌 창의 session을 다시 받지 않게 조각을 매번 달리한다.
      const page = await flow.shell.connect(
        `${"lophn-shell://".slice(windows++)}confirmation/index.html`,
      );
      await pageUntil(
        page,
        `document.querySelector('[data-kind="release_activation"]') !== null`,
        "release 적용 결정 창이 서지 않았다",
      );
      // 사람이 보는 것은 정확한 release의 적용 결정이다.
      const shown = String(
        await page.evaluate("document.body.textContent ?? ''"),
      );
      assert(shown.includes("Use version 2 of"), shown.slice(0, 200));
      return page;
    };

    await t.step(
      "다른 갈래: 사람이 거절하면 적용하지 않고 미실행으로 남는다",
      async () => {
        confirmation = await choose(false);
        await pageUntil(
          confirmation,
          `document.querySelector('[data-decision="reject_approval_request"]') !== null`,
          "거절 버튼이 서지 않았다",
        );
        await pageTap(
          confirmation,
          '[data-decision="reject_approval_request"]',
        );
        await delay(3_000);
        await unchanged("거절 뒤");
        await closeWindow(flow);
        await untilWindow(flow, false);
      },
    );

    await t.step(
      "다른 갈래: 사람이 결정 창을 그만두면 적용하지 않는다",
      async () => {
        confirmation = await choose(true);
        await delay(1_000);
        await closeWindow(flow);
        await untilWindow(flow, false);
        await delay(3_000);
        await unchanged("그만둔 뒤");
      },
    );

    await t.step(
      "다른 갈래: 허락한 적용이 실패하면 적용 완료로 보이지 않고 이전 release가 계속 돈다",
      async () => {
        // 고친 bundle 사본이 없어 새 앱을 시작하지 못하게 한다. 사람이 허락해도 시작을 확인하지 못한 release는 지금 Version이 아니다.
        const row = openDb(`${home}/lophn.db`, true);
        let bundle = "";
        try {
          bundle =
            (row.prepare("select bundle_hash as b from releases where id = ?")
              .get(REL_AFTER) as { b: string }).b;
        } finally {
          row.close();
        }
        const dir = `${home}/apps/${app}/bundles/${bundle}`;
        await Deno.rename(dir, `${dir}.away`);
        try {
          confirmation = await choose(true);
          await pageTap(
            confirmation,
            '[data-decision="grant_approval_request"]',
          );
          await untilRead("실패한 적용이 기록되지 않았다", async () => {
            const seen = await releaseOf(flow, REL_AFTER);
            return seen.status === "failed";
          });
          const failed = await releaseOf(flow, REL_AFTER);
          assertNotEquals(failed.failure, null);
          assertEquals((await appOf(flow, app)).active_release, REL_BEFORE);
          assertEquals((await releaseOf(flow, REL_BEFORE)).status, "active");
          await untilRead("이전 release가 다시 돌지 않는다", async () => {
            const seen = await runningOf(flow, app);
            return seen?.release === REL_BEFORE && seen.ready === true;
          });
          assertNotEquals(await problemStatus(), "closed");
          assertEquals(countRows(home, "verifications"), verificationsBefore);
          // 화면도 실패한 Version을 지금 Version으로 보이지 않는다.
          await flow.until(
            `document.querySelector(${
              JSON.stringify(`[data-version="${REL_AFTER}"]`)
            })?.getAttribute("data-status") === "failed"`,
            "app-detail이 실패한 적용을 보이지 않는다",
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector(${
                JSON.stringify(`[data-version="${REL_BEFORE}"]`)
              })?.getAttribute("data-status")`,
            ),
            "active",
          );
          await closeWindow(flow);
          await untilWindow(flow, false);
        } finally {
          await Deno.rename(`${dir}.away`, dir);
        }
      },
    );

    await t.step(
      "flow 5: 사람이 허락하면 그 release가 시작 확인 뒤에 적용된다",
      async () => {
        confirmation = await choose(true);
        await pageTap(
          confirmation,
          '[data-decision="grant_approval_request"]',
        );
        // 접수와 적용은 다르다. 시작을 확인한 release만 지금 Version이 된다.
        await untilRead("허락한 release가 적용되지 않았다", async () => {
          const seen = await runningOf(flow, app);
          return seen?.release === REL_AFTER && seen.ready === true &&
            (await releaseOf(flow, REL_AFTER)).status === "active";
        });
        assertEquals((await appOf(flow, app)).active_release, REL_AFTER);
        assertEquals(
          (await releaseOf(flow, REL_BEFORE)).status,
          "superseded",
        );
        const applied = await releaseOf(flow, REL_AFTER);
        assertEquals(applied.failure, null);
        await flow.until(
          `document.querySelector(${
            JSON.stringify(`[data-version="${REL_AFTER}"]`)
          })?.getAttribute("data-status") === "active"`,
          "app-detail이 적용된 Version을 지금 Version으로 보이지 않는다",
        );
        assertEquals(
          await flow.text(
            `[data-version="${REL_AFTER}"] [data-fact="applied"]`,
          ),
          "In use",
        );
        await flow.until(
          `document.querySelector(${
            JSON.stringify(
              `[data-version="${REL_AFTER}"] [data-fact="start"]`,
            )
          })?.textContent === "Started and responding"`,
          "app-detail이 시작 확인을 보이지 않는다",
        );
        // 적용은 새 test를 만들지 않는다. 기록은 runner가 남긴 것뿐이다.
        assertEquals(
          countRows(home, "verifications"),
          verificationsBefore,
        );
        await closeWindow(flow);
        await untilWindow(flow, false);
      },
    );
  } finally {
    await flow.close();
  }
}

Deno.test({
  name:
    "apps/releases#R8 apps/releases#R9 apps/releases#R12 apps/releases#R14 platform/approvals#R9 shell/confirmation-window#R1 problems/closing#R2 flow verify-app-repair 5: 정확한 release를 사람이 허락해야 적용되고 거절·그만둠은 미실행으로 남는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    let made: MadeFixture | undefined;
    let home: string | undefined;
    let opened: Opened | undefined;
    let beforeHash = "";
    try {
      opened = await openLedger({
        sealedContent: true,
        beforeBundle: async (app, dataRoot) => {
          made = await madeFixture("broken", await installedHome([]));
          const sealed = await sealBoard(made, "A", app, dataRoot);
          beforeHash = sealed.hash;
          return sealed.hash;
        },
      });
      const ticket = await readyTicket(opened);
      const stored = await storeReproduction(opened.world);
      assert(made, "봉인할 source가 없다");
      const root = opened.world.harness.dataRoot;
      const fixed = await sealBoard(made, "B", opened.world.app, root);
      assertNotEquals(fixed.hash, beforeHash);
      await made.dispose();
      made = undefined;

      const script = await runStageThree(opened, ticket, {
        test: stored.testHash,
        after: fixed.hash,
        content: await sealedContent(root, opened.world.app, fixed.hash),
      });
      assertEquals(script.halted_before, "release_prepare");
      assertEquals(step(script, "record_fix").isError, false);
      const passed = await waitRequestEnd(root, "repro-stage3", 660_000);
      assertEquals(
        passed.phase,
        "result_ref",
        `${passed.phase} ${passed.reason}`,
      );
      // 두 묶음 모두 그 묶음을 대상으로 실제 돌아간 app test만 release의 test로 단다.
      const issued = await opened.world.harness.credential({
        actor: "user",
        principal: "user-repair-stage5",
        scope: {
          operations: ["RequestTest"],
          targets: { app: opened.world.app },
        },
        conditions: { app: opened.world.app },
      });
      assert(issued.ok, issued.ok ? "" : issued.error.message);
      const appTest = async (key: string, bundle: string, path: string) => {
        const derived = await deriveAppTest(path, bundle);
        assert(derived.ok, derived.ok ? "" : derived.reason);
        const sent = await post(
          opened!.world,
          "problems/request-test",
          issued.value.token,
          envelope({
            request_key: key,
            kind: "app_test",
            app: opened!.world.app,
            target: { bundle_hash: bundle, release: null },
            problem: null,
            basis_seq: null,
            reports: [],
            before: null,
            after: null,
            ticket: null,
            test: derived.value.test_hash,
            timeout_ms: APP_TEST_TIMEOUT_MS,
          }),
        );
        assertEquals(sent.status, 200, JSON.stringify(sent.body));
        assertEquals(sent.body["accepted"], true, JSON.stringify(sent.body));
        const end = await waitRequestEnd(root, key, 600_000);
        assertEquals(end.phase, "result_ref", `${end.phase} ${end.reason}`);
        assert(end.result_ref !== null, key);
        return end.result_ref;
      };
      const afterRun = await appTest(
        "app-stage5-after",
        fixed.hash,
        fixed.path,
      );
      const beforeRun = await appTest(
        "app-stage5-before",
        beforeHash,
        `${root}/apps/${opened.world.app}/bundles/${beforeHash}`,
      );
      linkReleaseTest(opened.world, REL_BEFORE, beforeRun);
      linkReleaseTest(opened.world, REL_AFTER, afterRun);

      // 이전 release가 지금 운영 중인 앱의 ledger를 만든다. 고친 release는 준비만 된 채다.
      home = await copyHome(root);
      const db = openDb(`${home}/lophn.db`, false);
      try {
        db.prepare("update releases set status = 'active' where id = ?").run(
          REL_BEFORE,
        );
        db.prepare(
          "update apps set active_release = ?, run_enabled = 1 where id = ?",
        ).run(REL_BEFORE, opened.world.app);
      } finally {
        db.close();
      }
      const bundles = `${root}/apps/${opened.world.app}/bundles`;
      // 데이터 root의 관리 폴더(apps)는 0700이 아니면 core가 기동을 거절한다.
      await Deno.mkdir(`${home}/apps`, { mode: 0o700 });
      await Deno.mkdir(`${home}/apps/${opened.world.app}`, { mode: 0o700 });
      const copied = await new Deno.Command("cp", {
        args: ["-a", bundles, `${home}/apps/${opened.world.app}/bundles`],
      }).output();
      assert(copied.success, decoder.decode(copied.stderr));
      await seedAppData(home, opened.world.app, fixed.path);
      const app = opened.world.app;
      const problemId = opened.problem;
      await widen(root);
      await opened.world.close();

      await activationSteps(t, home, app, problemId);
    } finally {
      await made?.dispose();
      if (opened) {
        await widen(opened.world.harness.dataRoot);
        await opened.world.close();
      }
      if (home !== undefined) {
        await widen(home);
        await Deno.remove(home, { recursive: true });
      }
    }
  },
});

// 6단계. 5단계와 같은 fixture(봉인 bundle·runner가 실제 기록한 reproduction pass·그 bundle의 app test)
// 로 운영 중인 이전 release와 준비만 된 고친 release를 만든다. 5단계 본문은 건드리지 않고 같은 준비를 한다.
type ClosingWorld = {
  home: string;
  app: string;
  problem: string;
  // runner가 실제로 기록한 reproduction pass다.
  reproduction: string;
};

// 고친 release의 board와 그 reproduction 판정을 고르는 선택이다. 기본은 B(고침)의 pass다.
type ClosingOptions = {
  declared?: boolean;
};

type ClosingBasis = { test: string; after: string; before: string };

async function closingWorld(
  inspect: (opened: Opened, basis: ClosingBasis) => Promise<void>,
  options?: ClosingOptions,
): Promise<ClosingWorld & { cleanup(): Promise<void> }> {
  let made: MadeFixture | undefined;
  let home: string | undefined;
  let opened: Opened | undefined;
  let beforeHash = "";
  const cleanup = async () => {
    await made?.dispose();
    if (opened) {
      await widen(opened.world.harness.dataRoot);
      await opened.world.close();
    }
    if (home !== undefined) {
      await widen(home);
      await Deno.remove(home, { recursive: true });
    }
  };
  try {
    opened = await openLedger({
      sealedContent: true,
      ...(options?.declared === true ? { declared: true } : {}),
      beforeBundle: async (app, dataRoot) => {
        made = await madeFixture("broken", await installedHome([]));
        const sealed = await sealBoard(made, "A", app, dataRoot);
        beforeHash = sealed.hash;
        return sealed.hash;
      },
    });
    const ticket = await readyTicket(opened);
    const stored = await storeReproduction(opened.world);
    assert(made, "봉인할 source가 없다");
    const root = opened.world.harness.dataRoot;
    const fixed = await sealBoard(made, "B", opened.world.app, root);
    assertNotEquals(fixed.hash, beforeHash);
    await made.dispose();
    made = undefined;

    const script = await runStageThree(opened, ticket, {
      test: stored.testHash,
      after: fixed.hash,
      content: await sealedContent(root, opened.world.app, fixed.hash),
      basis: problemSeq(root, opened.problem),
    });
    assertEquals(script.halted_before, "release_prepare");
    assertEquals(step(script, "record_fix").isError, false);
    const passed = await waitRequestEnd(root, "repro-stage3", 660_000);
    assertEquals(
      passed.phase,
      "result_ref",
      `${passed.phase} ${passed.reason}`,
    );
    const issued = await opened.world.harness.credential({
      actor: "user",
      principal: "user-repair-stage6",
      scope: {
        operations: ["RequestTest"],
        targets: { app: opened.world.app },
      },
      conditions: { app: opened.world.app },
    });
    assert(issued.ok, issued.ok ? "" : issued.error.message);
    const appTest = async (key: string, bundle: string, path: string) => {
      const derived = await deriveAppTest(path, bundle);
      assert(derived.ok, derived.ok ? "" : derived.reason);
      const sent = await post(
        opened!.world,
        "problems/request-test",
        issued.value.token,
        envelope({
          request_key: key,
          kind: "app_test",
          app: opened!.world.app,
          target: { bundle_hash: bundle, release: null },
          problem: null,
          basis_seq: null,
          reports: [],
          before: null,
          after: null,
          ticket: null,
          test: derived.value.test_hash,
          timeout_ms: APP_TEST_TIMEOUT_MS,
        }),
      );
      assertEquals(sent.status, 200, JSON.stringify(sent.body));
      assertEquals(sent.body["accepted"], true, JSON.stringify(sent.body));
      const end = await waitRequestEnd(root, key, 600_000);
      assertEquals(end.phase, "result_ref", `${end.phase} ${end.reason}`);
      assert(end.result_ref !== null, key);
      return end.result_ref;
    };
    const afterRun = await appTest("app-stage6-after", fixed.hash, fixed.path);
    const beforeRun = await appTest(
      "app-stage6-before",
      beforeHash,
      `${root}/apps/${opened.world.app}/bundles/${beforeHash}`,
    );
    linkReleaseTest(opened.world, REL_BEFORE, beforeRun);
    linkReleaseTest(opened.world, REL_AFTER, afterRun);
    await inspect(opened, {
      test: stored.testHash,
      after: fixed.hash,
      before: beforeHash,
    });

    home = await copyHome(root);
    const db = openDb(`${home}/lophn.db`, false);
    let reproduction = "";
    try {
      db.prepare("update releases set status = 'active' where id = ?").run(
        REL_BEFORE,
      );
      db.prepare(
        "update apps set active_release = ?, run_enabled = 1 where id = ?",
      ).run(REL_BEFORE, opened.world.app);
      reproduction = (db.prepare(
        `select id from verifications
          where kind = 'reproduction' and request_key = 'repro-stage3' and problem = ?`,
      ).get(opened.problem) as { id: string } | undefined)?.id ?? "";
    } finally {
      db.close();
    }
    assertNotEquals(
      reproduction,
      "",
      "runner가 기록한 reproduction이 없다",
    );
    await Deno.mkdir(`${home}/apps`, { mode: 0o700 });
    await Deno.mkdir(`${home}/apps/${opened.world.app}`, { mode: 0o700 });
    const copied = await new Deno.Command("cp", {
      args: [
        "-a",
        `${root}/apps/${opened.world.app}/bundles`,
        `${home}/apps/${opened.world.app}/bundles`,
      ],
    }).output();
    assert(copied.success, decoder.decode(copied.stderr));
    await seedAppData(home, opened.world.app, fixed.path);
    const world = {
      home,
      app: opened.world.app,
      problem: opened.problem,
      reproduction,
    };
    await widen(root);
    await opened.world.close();
    opened = undefined;
    return { ...world, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

// 테스트를 요청할 때 읽는 문제 기준(seq)이다. 이 뒤에 접수된 같은 문제의 live Report만 새 보고다.
function problemSeq(root: string, problem: string): string {
  const db = openDb(`${root}/lophn.db`, true);
  try {
    return String(
      (db.prepare(
        "select cast(max(seq) as text) as seq from events where subject = ?",
      ).get(problem) as { seq: string }).seq,
    );
  } finally {
    db.close();
  }
}

// 보호 창 renderer에서 표현식을 평가한다. 창이 없으면 null이다.
function inWindow(flow: FlowShell, expression: string): Promise<unknown> {
  return flow.shell.mainEvaluate(`(() => {
    const c = electron.webContents.getAllWebContents().find((c) =>
      !c.isDestroyed() && c.getURL().includes("${WINDOW_URL}"));
    return c ? c.executeJavaScript(${JSON.stringify(expression)}) : null;
  })()`);
}

// 창이 이 결정으로 서면 사람처럼 결정 버튼을 누른다. 창은 결정 뒤 스스로 닫힌다.
async function decideInWindow(
  flow: FlowShell,
  selector: string,
  expectChoice: string | null,
): Promise<void> {
  await untilWindow(flow, true);
  const deadline = Date.now() + 30_000;
  for (;;) {
    let shown: unknown = null;
    try {
      shown = await inWindow(
        flow,
        `(() => { const b = document.querySelector(${
          JSON.stringify(selector)
        }); return b && !b.disabled ? (b.getAttribute("data-choice") ?? "") : null; })()`,
      );
    } catch { /* 창이 서는 중이다 */ }
    if (shown !== null && (expectChoice === null || shown === expectChoice)) {
      break;
    }
    assert(Date.now() < deadline, `결정 창에 ${selector}가 서지 않았다`);
    await delay(250);
  }
  await inWindow(
    flow,
    `(() => { document.querySelector(${
      JSON.stringify(selector)
    }).click(); return true; })()`,
  );
}

// 앱 공간을 다시 열어 Issues의 그 문제 상세까지 간다. 결정이 끝난 화면은 고른 상태를 지닌다.
async function reopenIssueDetail(flow: FlowShell): Promise<void> {
  await flow.evaluate(`(() => { location.reload(); return true; })()`);
  await delay(500);
  await flow.until(
    `document.querySelector('[data-space="app"]') !== null`,
    "앱 공간이 다시 서지 않았다",
  );
  await openIssue(flow);
  await flow.click("[data-issue-open]");
  await flow.until(
    `document.querySelector("[data-issue-detail]") !== null`,
    "문제 상세가 서지 않았다",
  );
}

type ProblemRead = {
  status: string;
  closure: {
    reason: string;
    verification: string | null;
    confirmation: string | null;
    release: string | null;
  } | null;
};

async function problemOf(
  flow: FlowShell,
  problem: string,
): Promise<ProblemRead> {
  const got = await mustCall(flow, {
    kind: "read",
    resource: "problems",
    method: "get",
    body: { problem },
  });
  return got.problem as ProblemRead;
}

async function untilProblem(
  flow: FlowShell,
  problem: string,
  what: string,
  check: (read: ProblemRead) => boolean,
  timeoutMs = 60_000,
): Promise<ProblemRead> {
  const deadline = Date.now() + timeoutMs;
  let last: ProblemRead | undefined;
  for (;;) {
    last = await problemOf(flow, problem);
    if (check(last)) return last;
    assert(Date.now() < deadline, `${what}: ${JSON.stringify(last)}`);
    await delay(500);
  }
}

function eventCount(home: string, type: string, problem: string): number {
  const db = openDb(`${home}/lophn.db`, true);
  try {
    return Number(
      (db.prepare(
        "select count(*) as n from events where type = ? and subject = ?",
      ).get(type, problem) as { n: number }).n,
    );
  } finally {
    db.close();
  }
}

// 결정이 끝난 창을 닫고 닫힌 것을 확인한다. 창 닫기는 결정이 아니다.
async function settleWindow(flow: FlowShell): Promise<void> {
  await closeWindow(flow);
  await untilWindow(flow, false);
}

Deno.test({
  name:
    "problems/closing#R4 problems/closing#R6 problems/closing#R9 problems/closing#R10 shell/confirmation-window#R9 flow verify-app-repair 6: 기록된 reproduction 통과와 적용된 release로만 자동으로 닫히고 사람 확인은 사람 결정으로만 닫힌다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    let world: Awaited<ReturnType<typeof closingWorld>> | undefined;
    try {
      world = await closingWorld(async (opened) => {
        // agent·사람 token은 machine 판정만 하는 닫힘 command를 거절받고 문제는 닫히지 않는다.
        const attempt = envelope({
          problem: opened.problem,
          verification: "vrf_01arz3ndektsv4rrffq69g5fav",
          problem_seq: "1",
          release: REL_AFTER,
        }, { problem_seq: "1", release: REL_AFTER });
        for (const token of [opened.coding.token, opened.user]) {
          const sent = await post(
            opened.world,
            "problems/close-verified",
            token,
            attempt,
          );
          assertNotEquals(sent.status, 200, JSON.stringify(sent.body));
        }
        const db = openDb(`${opened.world.harness.dataRoot}/lophn.db`, true);
        try {
          const row = db.prepare("select status from problems where id = ?")
            .get(opened.problem) as { status: string };
          assertNotEquals(row.status, "closed");
        } finally {
          db.close();
        }
      });
      const { home, app, problem, reproduction } = world;
      const verificationsBefore = countRows(home, "verifications");
      const flow = await openFlowShell({ home, start: `app:${app}` });
      try {
        await waitFixing(flow, problem);
        await untilRead("이전 release가 시작하지 않았다", async () => {
          const seen = await runningOf(flow, app);
          return seen?.release === REL_BEFORE && seen.ready;
        });

        await t.step(
          "적용하기 전에는 reproduction 통과와 app test 통과가 있어도 닫히지 않는다",
          async () => {
            // 고친 release는 runner가 기록한 reproduction pass를 가졌지만 준비만 된 채다.
            const db = openDb(`${home}/lophn.db`, true);
            try {
              const row = db.prepare(
                "select result, after_release as after from verifications where id = ?",
              ).get(reproduction) as { result: string; after: string };
              assertEquals(row.result, "pass");
              assertEquals(row.after, REL_AFTER);
            } finally {
              db.close();
            }
            assertEquals((await appOf(flow, app)).active_release, REL_BEFORE);
            await delay(3_000);
            assertNotEquals((await problemOf(flow, problem)).status, "closed");
            assertEquals(eventCount(home, "ProblemClosed", problem), 0);
          },
        );

        await t.step(
          "flow 6: 사람이 허락해 고친 release가 적용되면 기록된 reproduction 통과로 자동으로 닫힌다",
          async () => {
            await flow.until(
              `document.querySelector('[data-app-bar="app-details"]') !== null`,
              "앱 막대",
            );
            await flow.click('[data-app-bar="app-details"]');
            await flow.until(
              `document.querySelector(${
                JSON.stringify(`[data-version="${REL_BEFORE}"]`)
              })?.getAttribute("data-status") === "active"`,
              "지금 Version이 보이지 않는다",
            );
            await flow.click(
              `[data-version="${REL_AFTER}"] [data-version-expand]`,
            );
            await flow.until(
              `document.querySelector(${
                JSON.stringify(
                  `[data-version="${REL_AFTER}"] [data-use-version]`,
                )
              }) !== null`,
              "고친 Version을 고를 수 없다",
            );
            await flow.click(
              `[data-version="${REL_AFTER}"] [data-use-version]`,
            );
            await decideInWindow(
              flow,
              '[data-decision="grant_approval_request"]',
              null,
            );
            await untilRead("허락한 release가 적용되지 않았다", async () => {
              const seen = await runningOf(flow, app);
              return seen?.release === REL_AFTER && seen.ready === true &&
                (await releaseOf(flow, REL_AFTER)).status === "active";
            });
            // 닫힘은 machine이 실제 기록을 다시 읽어 판정한다. 사람은 답하지 않았다.
            const closed = await untilProblem(
              flow,
              problem,
              "자동으로 닫히지 않았다",
              (read) => read.status === "closed",
              90_000,
            );
            assertEquals(closed.closure?.reason, "verified");
            assertEquals(closed.closure?.verification, reproduction);
            assertEquals(closed.closure?.release, REL_AFTER);
            assertEquals(closed.closure?.confirmation, null);
            // 적용도 닫힘도 새 test를 만들지 않는다.
            assertEquals(countRows(home, "verifications"), verificationsBefore);
            await settleWindow(flow);
            await reopenIssueDetail(flow);
            await flow.until(
              `document.querySelector('[data-issue-closed="verified"]') !== null`,
              "Issues 상세가 테스트로 확인된 닫힘을 보이지 않는다",
            );
            assert(
              (await screenText(flow, "[data-issue-attention]")).length > 0,
              "지금 필요한 주의가 없다",
            );
            // 닫힌 문제에는 아직 이상함만 남는다.
            assertEquals(await flow.count("[data-issue-choice]"), 1);
            assertEquals(
              await flow.count('[data-issue-choice="not_fixed"]'),
              1,
            );
          },
        );

        await t.step(
          "다른 갈래: 사람이 아직 이상하다고 하면 같은 문제를 다시 열고 다시 묻지 않는다",
          async () => {
            await flow.click('[data-issue-choice="not_fixed"]');
            await decideInWindow(
              flow,
              '[data-decision="ApplyProblemDecision"]',
              "not_fixed",
            );
            const reopened = await untilProblem(
              flow,
              problem,
              "다시 열리지 않았다",
              (read) => read.status !== "closed",
            );
            assertEquals(reopened.closure, null);
            assertEquals(eventCount(home, "ProblemReopened", problem), 1);
            // 같은 release에 같은 확인을 되묻지 않고 옛 reproduction 통과로 다시 닫지도 않는다.
            await settleWindow(flow);
            await delay(5_000);
            await untilWindow(flow, false);
            assertNotEquals((await problemOf(flow, problem)).status, "closed");
            assertEquals(countRows(home, "verifications"), verificationsBefore);
          },
        );

        await t.step(
          "flow 6: 사람이 보호 화면에서 내가 확인함으로 답해야만 사람 확인으로 닫히고 테스트 통과를 만들지 않는다",
          async () => {
            await reopenIssueDetail(flow);
            await flow.until(
              `document.querySelector('[data-issue-choice="fixed"]:not([disabled])') !== null`,
              "[Fixed]가 켜지지 않았다",
            );
            await flow.click('[data-issue-choice="fixed"]');
            await untilWindow(flow, true);
            // 창에서 답하기 전에는 닫히지 않는다.
            assertNotEquals((await problemOf(flow, problem)).status, "closed");
            await decideInWindow(
              flow,
              '[data-decision="ApplyProblemDecision"]',
              "fixed",
            );
            const confirmed = await untilProblem(
              flow,
              problem,
              "사람 확인으로 닫히지 않았다",
              (read) => read.status === "closed",
            );
            assertEquals(confirmed.closure?.reason, "user_confirmed");
            assertEquals(confirmed.closure?.verification, null);
            assertNotEquals(confirmed.closure?.confirmation, null);
            assertEquals(confirmed.closure?.release, REL_AFTER);
            // 사람의 확인은 reproduction 통과를 만들지 않는다.
            assertEquals(countRows(home, "verifications"), verificationsBefore);
            await settleWindow(flow);
            await reopenIssueDetail(flow);
            await flow.until(
              `document.querySelector('[data-issue-closed="user_confirmed"]') !== null`,
              "Issues 상세가 내가 확인함 닫힘을 보이지 않는다",
            );
            assertEquals(
              await flow.count('[data-issue-closed="verified"]'),
              0,
            );
          },
        );
      } finally {
        await flow.close();
      }
    } finally {
      await world?.cleanup();
    }
  },
});

// 7단계. 6단계와 같은 준비(봉인 bundle·기록된 reproduction pass·그 bundle의 app test)로 운영 중인 이전 release와
// 준비만 된 고친 release를 만든다. 첫 보고만 앱이 선언한 code(fixture_broken)의 보고라, 닫힌 뒤 실제 앱이 같은
// code로 보고하면 같은 묶기 key로 같은 문제에 모인다. 6단계 본문은 건드리지 않고 같은 준비를 한다.
const APP_VIEW =
  `electron.webContents.getAllWebContents().find((c) => c.getURL().startsWith("lophn-app:"))`;

type AppReply = {
  ok: boolean;
  value?: Record<string, unknown>;
  message?: string;
};

// 실행 중인 앱 view에서 앱 command를 부른다. 답은 command 결과 값이다.
async function callApp(
  flow: FlowShell,
  command: string,
  input: unknown,
): Promise<AppReply> {
  const script =
    `lophnApp.call(${JSON.stringify(command)}, ${JSON.stringify(input)})` +
    `.then((value) => ({ ok: true, value }), (error) => ({ ok: false, message: String(error && error.message) }))`;
  const raw = await flow.shell.mainEvaluate(
    `${APP_VIEW}.executeJavaScript(${JSON.stringify(script)})`,
  ) as AppReply;
  const outer = raw.value?.["result"];
  const inner = outer !== null && typeof outer === "object"
    ? (outer as { result?: unknown }).result
    : undefined;
  if (inner !== null && typeof inner === "object") {
    return { ok: true, value: inner as Record<string, unknown> };
  }
  return raw;
}

// 사람이 허락해 고친 release를 적용한다(6단계와 같은 길). 적용이 시작 확인까지 끝나면 돌아온다.
async function applyFixed(flow: FlowShell, app: string): Promise<void> {
  await flow.until(
    `document.querySelector('[data-app-bar="app-details"]') !== null`,
    "앱 막대",
  );
  await flow.click('[data-app-bar="app-details"]');
  await flow.until(
    `document.querySelector(${
      JSON.stringify(`[data-version="${REL_BEFORE}"]`)
    })?.getAttribute("data-status") === "active"`,
    "지금 Version이 보이지 않는다",
  );
  await flow.click(`[data-version="${REL_AFTER}"] [data-version-expand]`);
  await flow.until(
    `document.querySelector(${
      JSON.stringify(`[data-version="${REL_AFTER}"] [data-use-version]`)
    }) !== null`,
    "고친 Version을 고를 수 없다",
  );
  await flow.click(`[data-version="${REL_AFTER}"] [data-use-version]`);
  await decideInWindow(flow, '[data-decision="grant_approval_request"]', null);
  await untilRead("허락한 release가 적용되지 않았다", async () => {
    const seen = await runningOf(flow, app);
    return seen?.release === REL_AFTER && seen.ready === true &&
      (await releaseOf(flow, REL_AFTER)).status === "active";
  });
}

// 적용한 뒤 기록된 reproduction 통과로 자동으로 닫힐 때까지 간다.
async function applyFixedAndClose(
  flow: FlowShell,
  world: { app: string; problem: string; reproduction: string },
): Promise<ProblemRead> {
  await applyFixed(flow, world.app);
  const closed = await untilProblem(
    flow,
    world.problem,
    "자동으로 닫히지 않았다",
    (read) => read.status === "closed",
    90_000,
  );
  assertEquals(closed.closure?.reason, "verified");
  assertEquals(closed.closure?.verification, world.reproduction);
  await settleWindow(flow);
  return closed;
}

// 닫힌 문제에 이전 release의 늦은 보고를 접수한다. 앱 process는 이미 새 release라 이전 release 이름으로
// 보고할 수 없으므로, shell core를 멈춘 같은 데이터 root에서 보고 접수 command를 직접 보낸다.
async function recordLateReport(
  home: string,
  app: string,
  release: string,
): Promise<string> {
  const db = openDb(`${home}/lophn.db`, true);
  let bundle = "";
  try {
    bundle = (db.prepare("select bundle_hash from releases where id = ?")
      .get(release) as { bundle_hash: string }).bundle_hash;
  } finally {
    db.close();
  }
  const started = await startCore({
    lophnHome: home,
    port: 0,
    writerClock: "system",
    testCredentials: true,
    teams: [
      { createLedgerRegistration: createDocumentsRegistration },
      { createLedgerRegistration: createAppsRegistration },
      { problemsTestDefinitions },
      { problemsReportDefinitions },
      { createLedgerRegistration: createProblemsRegistration },
      { codingAgentConnectionDefinitions },
      { lophnAgentDefinitions },
      { createLedgerRegistration: createLophnAgentRegistration },
      { ticketDefinitions },
      { createCoreRegistration: createTicketPortsRegistration },
    ],
    teamModules: [
      new URL("../../apps/core/documents.ts", import.meta.url).href,
      new URL("../../apps/core/apps.ts", import.meta.url).href,
      new URL("../../apps/core/problems.ts", import.meta.url).href,
      new URL("../../apps/core/coding-agent.ts", import.meta.url).href,
      new URL("../../apps/core/lophn-agent.ts", import.meta.url).href,
      new URL("../../apps/core/tickets.ts", import.meta.url).href,
      new URL("../../apps/core/ticket-ports.ts", import.meta.url).href,
    ],
  });
  assert(started.ok, started.ok ? "" : JSON.stringify(started.error));
  const core = started.value;
  try {
    const context = {
      principal: "machine-late",
      actor: "machine" as const,
      scope: { operations: ["RecordReport"], targets: {} },
      conditions: {},
      credential_ref: "late-1",
    };
    const token = "9".repeat(43);
    assert(core.acceptTestCredential);
    const accepted = await core.acceptTestCredential!(context, token);
    assert(accepted.ok, accepted.ok ? "" : JSON.stringify(accepted.error));
    assert((await core.record(context)).ok);
    const base = reportInput(
      context.principal,
      app,
      9,
      { preparation: "", principal: "", purpose: "", hash: "", size_bytes: 0 },
      bundle,
    );
    const at = new Date().toISOString();
    const late = declaredReport(base);
    const input = {
      ...late,
      report: { ...late.report, release, observed_at: at },
      snapshot: {
        ...late.snapshot,
        captured_at: at,
        logs: null,
        logs_missing_reason: { reason: "logs off" },
      },
      blobs: [],
      origin: {
        ...late.origin,
        context: { ...late.origin.context, release },
      },
    };
    const sent = await fetch(
      `http://127.0.0.1:${core.port}/v1/problems/record-report`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(
          envelope(input, { active_release: REL_AFTER, problem_seq: null }),
        ),
      },
    );
    const body = await sent.json() as Record<string, unknown>;
    assertEquals(sent.status, 200, JSON.stringify(body));
    return String(body["problem"]);
  } finally {
    await core.shutdown();
  }
}

/** shell 아래의 core를 SIGKILL하고 그 자손도 정리한다(다시 열 때 ledger를 잡고 있지 않게). */
async function killCoreOf(shellPid: number): Promise<void> {
  let corePid: number | undefined;
  for (const pid of await descendantPids(shellPid)) {
    try {
      const raw = await Deno.readFile(`/proc/${pid}/cmdline`);
      if (decoder.decode(raw).includes("apps/core/main.ts")) {
        corePid = pid;
        break;
      }
    } catch { /* 이미 끝남 */ }
  }
  assert(corePid !== undefined, "core pid를 찾지 못했다");
  const children = (await descendantPids(corePid)).filter((pid) =>
    pid !== corePid
  );
  signalPids([corePid], "SIGKILL");
  const gone = Date.now() + 30_000;
  while (processAlive(corePid)) {
    assert(Date.now() < gone, "core가 끝나지 않았다");
    await delay(200);
  }
  signalPids(children.filter((pid) => processAlive(pid)), "SIGKILL");
  const childrenGone = Date.now() + 5_000;
  while (children.some((pid) => processAlive(pid))) {
    assert(Date.now() < childrenGone, "core 자손이 끝나지 않았다");
    await delay(100);
  }
}

type ReportRow = { id: string; release: string | null; code: string };

async function reportsOfProblem(
  flow: FlowShell,
  problem: string,
): Promise<ReportRow[]> {
  const got = await mustCall(flow, {
    kind: "read",
    resource: "problems",
    method: "list-reports",
    body: { problem },
  });
  return got.reports as ReportRow[];
}

Deno.test({
  name:
    "problems/closing#R11 problems/closing#R12 problems/closing#R13 problems/grouping#R10 problems/repairs#R3 problems/snapshots#R17 shell/desktop#R7 flow verify-app-repair 7: 닫힌 뒤 현재 release의 재발은 같은 문제를 다시 열고 이전 release의 늦은 보고는 열지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    let world: Awaited<ReturnType<typeof closingWorld>> | undefined;
    let flow: FlowShell | undefined;
    try {
      world = await closingWorld(() => Promise.resolve(), { declared: true });
      const { home, app, problem, reproduction } = world;
      const verificationsBefore = countRows(home, "verifications");
      flow = await openFlowShell({ home, start: `app:${app}` });
      await waitFixing(flow, problem);
      await untilRead("이전 release가 시작하지 않았다", async () => {
        const seen = await runningOf(flow!, app);
        return seen?.release === REL_BEFORE && seen.ready;
      });
      let originalReport = "";
      let fixCount = 0;

      await t.step(
        "닫힌 문제는 닫힌 이유와 지금 필요한 주의를 먼저 보이고 원할 때 실제 확인 범위와 근거를 펼친다",
        async () => {
          await applyFixedAndClose(flow!, { app, problem, reproduction });
          await reopenIssueDetail(flow!);
          await flow!.until(
            `document.querySelector('[data-issue-closed="verified"]') !== null`,
            "테스트로 확인된 닫힘이 보이지 않는다",
          );
          assert(
            (await screenText(flow!, "[data-issue-attention]")).length > 0,
            "지금 필요한 주의가 없다",
          );
          // 실제 확인 범위와 근거는 접힌 상세에 있고 펼쳐야 읽는다. 미확인 부분은 따로 읽힌다.
          assertEquals(
            await flow!.evaluate(
              `document.querySelector("[data-issue-details]")?.open`,
            ),
            false,
          );
          await flow!.click("[data-issue-details] summary");
          await flow!.until(
            `document.querySelector("[data-issue-details]")?.open === true`,
            "근거가 펼쳐지지 않는다",
          );
          assert(
            (await screenText(flow!, "[data-issue-details]")).length > 0,
            "펼친 근거가 비었다",
          );
          assert(
            (await screenText(flow!, "[data-check='unconfirmed']")).length > 0,
            "미확인 부분이 없다",
          );
          const reports = await reportsOfProblem(flow!, problem);
          assertEquals(reports.length, 1);
          originalReport = reports[0]!.id;
          const fixes = await mustCall(flow!, {
            kind: "read",
            resource: "problems",
            method: "list-fixes",
            body: { problem },
          });
          fixCount = (fixes.fixes as unknown[]).length;
          assert(fixCount >= 1, "닫힌 문제에 고친 기록이 없다");
        },
      );

      await t.step(
        "다른 갈래: 이전 release의 늦은 보고는 근거로 남지만 현재 release의 재발로 다시 열지 않는다",
        async () => {
          await flow!.close();
          flow = undefined;
          const late = await recordLateReport(home, app, REL_BEFORE);
          assertEquals(late, problem);
          flow = await openFlowShell({ home, start: `app:${app}` });
          const still = await problemOf(flow, problem);
          assertEquals(still.status, "closed");
          assertEquals(still.closure?.reason, "verified");
          assertEquals(eventCount(home, "ProblemReopened", problem), 0);
          // 보고는 읽히고 그 보고의 release는 이전 release다.
          const reports = await reportsOfProblem(flow, problem);
          assertEquals(reports.length, 2);
          const lateRow = reports.find((row) => row.id !== originalReport);
          assertEquals(lateRow?.release, REL_BEFORE);
          // 닫힌 화면은 그대로다.
          await reopenIssueDetail(flow);
          await flow.until(
            `document.querySelector('[data-issue-closed="verified"]') !== null`,
            "늦은 보고 뒤 닫힘이 바뀌었다",
          );
        },
      );

      await t.step(
        "flow 7: 닫힌 뒤 현재 release에서 같은 분류가 재발하면 같은 문제를 다시 열고 이전 수리와 근거를 보존한다",
        async () => {
          await untilRead("고친 release가 다시 시작하지 않았다", async () => {
            const seen = await runningOf(flow!, app);
            return seen?.release === REL_AFTER && seen.ready;
          });
          // 앱 view는 앱 공간에 있다. 상세를 닫고 앱 공간으로 돌아가 앱이 보일 때 앱을 부른다.
          await flow!.evaluate(`(() => { location.reload(); return true; })()`);
          await delay(500);
          await flow!.until(
            `document.querySelector('[data-space="app"]') !== null`,
            "앱 공간이 다시 서지 않았다",
          );
          await untilRead("앱 view가 서지 않았다", async () => {
            try {
              return await flow!.shell.mainEvaluate(
                `${APP_VIEW}.executeJavaScript("typeof lophnApp !== 'undefined'")`,
              ) === true;
            } catch {
              return false;
            }
          });
          const sent = await callApp(flow!, "repeat_report", { kind: "same" });
          assert(sent.ok, sent.message);
          assertEquals(sent.value?.["first"], "accepted");
          const reopened = await untilProblem(
            flow!,
            problem,
            "같은 문제가 다시 열리지 않았다",
            (read) => read.status !== "closed",
          );
          assertEquals(reopened.closure, null);
          assertEquals(eventCount(home, "ProblemReopened", problem), 1);
          // 같은 문제다: 새 문제를 만들지 않았다.
          const listed = await mustCall(flow!, {
            kind: "read",
            resource: "problems",
            method: "list",
            body: { app },
          });
          assertEquals((listed.problems as unknown[]).length, 1);
          // 이전 닫힘의 근거는 event에 남는다.
          const db = openDb(`${home}/lophn.db`, true);
          try {
            const row = db.prepare(
              "select payload from events where type = 'ProblemReopened' and subject = ?",
            ).get(problem) as { payload: string };
            const payload = JSON.parse(row.payload) as {
              previous: {
                reason: string;
                verification: string;
                release: string;
              };
            };
            assertEquals(payload.previous.reason, "verified");
            assertEquals(payload.previous.verification, reproduction);
            assertEquals(payload.previous.release, REL_AFTER);
            assertEquals(
              (db.prepare(
                "select count(*) as n from events where type = 'ProblemClosed' and subject = ?",
              ).get(problem) as { n: number }).n,
              1,
            );
            const verification = db.prepare(
              "select result from verifications where id = ?",
            ).get(reproduction) as { result: string };
            assertEquals(verification.result, "pass");
          } finally {
            db.close();
          }
          // 재발은 새 test를 만들지 않고 이전 수리 기록과 당시 보고·snapshot이 그대로 읽힌다.
          assertEquals(countRows(home, "verifications"), verificationsBefore);
          const fixes = await mustCall(flow!, {
            kind: "read",
            resource: "problems",
            method: "list-fixes",
            body: { problem },
          });
          assertEquals((fixes.fixes as unknown[]).length, fixCount);
          const reports = await reportsOfProblem(flow!, problem);
          assertEquals(reports.length, 3);
          assert(reports.some((row) => row.id === originalReport));
          const recurred = reports.find((row) =>
            row.release === REL_AFTER && row.id !== originalReport
          );
          assert(recurred !== undefined, "현재 release 재발 보고가 없다");
          const original = await mustCall(flow!, {
            kind: "read",
            resource: "problems",
            method: "get-report",
            body: { report: originalReport },
          });
          assertEquals(
            (original.report as { release: string }).release,
            REL_BEFORE,
          );
          // 화면은 닫힘이 아니라 열린 문제를 보이고 닫힘 이유는 없다.
          await reopenIssueDetail(flow!);
          assertEquals(await flow!.count("[data-issue-closed]"), 0);
          assertNotEquals(
            await flow!.evaluate(
              `document.querySelector("[data-issue-detail]")?.getAttribute("data-issue-detail")`,
            ),
            "closed",
          );
        },
      );

      await t.step(
        "다른 갈래: 연결이 끊기면 마지막 화면을 두고 최신 확인 못함을 보이며 지난 상태를 새 판정으로 바꾸지 않는다",
        async () => {
          const before = await flow!.evaluate(
            `document.querySelector("[data-issue-detail]")?.getAttribute("data-issue-detail")`,
          );
          // 문제 상세 자신의 최신 확인 못함 표시(상세 바로 앞 줄)를 본다. 다른 자리의 연결 표시가 아니다.
          const stale = "[data-stale] + [data-issue-detail]";
          assertEquals(await flow!.count(stale), 0);
          // 답을 기다리는 동안 화면은 다시 읽는다.
          await flow!.click('[data-issue-choice="not_fixed"]');
          await untilWindow(flow!, true);
          await closeWindow(flow!);
          await untilWindow(flow!, false);
          await killCoreOf(flow!.shell.pid);
          await flow!.until(
            `document.querySelector(${JSON.stringify(stale)}) !== null`,
            "연결이 끊겼는데 문제 상세에 최신 확인 못함이 보이지 않는다",
            30_000,
          );
          assert(
            (await screenText(flow!, "[data-stale]:has(+ [data-issue-detail])"))
              .includes("Last updated"),
            "마지막 확인 시각이 없다",
          );
          assertEquals(
            await flow!.evaluate(
              `document.querySelector("[data-issue-detail]")?.getAttribute("data-issue-detail")`,
            ),
            before,
          );
          assertEquals(await flow!.count("[data-issue-closed]"), 0);
        },
      );
    } finally {
      await flow?.close();
      await world?.cleanup();
    }
  },
});
