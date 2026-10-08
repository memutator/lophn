// 테스트로 확인됨 닫힘의 제품 core 조립 시험(problems/closing#R1, R2, R3, R4, R14; plan problems T20).
// temp LOPHN_HOME의 실제 core(writer·reader·test-runner worker)에서 문제는 실제 record-report로,
// verified 근거·release·활성 release·VerificationRecorded event는 검증 조건이 읽는 열만 같은 이름으로
// 심는다(test-only seeding, problems-repair-blob_test.ts의 같은 자리). 닫힘은 같은 test-runner kind의
// problems.closing 반응기가 event를 읽어 CloseProblemVerified를 내는 실제 경로로 확인한다. 사람 data
// root·keychain은 열지 않는다(testCredentials, wire 없음).
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import { createLedgerRegistration as createAppsRegistration } from "./apps.ts";
import { createLedgerRegistration as createDocumentsRegistration } from "./documents.ts";
import {
  problemsReportDefinitions,
  problemsTestDefinitions,
} from "./problems.ts";
import { startCore } from "./core.ts";

const START = Date.parse("2026-10-06T00:00:00.000Z");
const BUNDLE = "a".repeat(64);
const EXECUTION = "c".repeat(64);
const FROZEN = "d".repeat(64);
const APP = "app_01arz3ndektsv4rrffq69g5fav";
const REL_AFTER = "rel_01arz3ndektsv4rrffq69g5fav";
const REL_BEFORE = "rel_01arz3ndektsv4rrffq69g5fbv";

type Reply = { status: number; body: Record<string, unknown> };

async function post(
  port: number,
  path: string,
  token: string,
  input: unknown,
  compare: unknown = {},
): Promise<Reply> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/${path}`, {
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
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

function withDb<T>(home: string, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(`${home}/lophn.db`);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    return run(db);
  } finally {
    db.close();
  }
}

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
function serialSuffix(serial: number): string {
  // ULID의 마지막 두 글자만 바꾼다(26자 모양은 그대로다).
  return `${ALPHABET[Math.floor(serial / 32) % 32]}${ALPHABET[serial % 32]}`;
}

const BASE = "01arz3ndektsv4rrffq69g5f";

// 실제 record-report의 보고다. collector가 접수하는 최소 모양이다.
function reportInput(
  app: string,
  principal: string,
  observedMs: number,
): Record<string, unknown> {
  const n = Math.floor(observedMs / 1_000_000) % 32;
  const suffix = serialSuffix(n);
  const rpt = `rpt_${BASE}${suffix}`;
  const snp = `snp_${BASE}${suffix}`;
  const at = new Date(observedMs).toISOString();
  return {
    report: {
      id: rpt,
      app,
      mode: "live",
      diagnostic_scope: null,
      release: REL_AFTER,
      release_missing_reason: null,
      bundle_hash: BUNDLE,
      source: "exception",
      code: "_exception",
      text: null,
      details: null,
      snapshot: snp,
      observed_at: at,
      principal,
      content_hash: "1".repeat(64),
    },
    snapshot: {
      id: snp,
      captured_at: at,
      invocation: null,
      invocation_missing_reason: { reason: "no invocation" },
      error: {
        name: "TypeError",
        message: "boom",
        message_missing_reason: null,
        frames: [{ path: "src/f.ts", function: null, line: 1, column: 1 }],
        source_missing_reason: null,
        stack: null,
        stack_missing_reason: { reason: "stack unavailable" },
        truncation_notes: [],
      },
      error_missing_reason: null,
      logs: null,
      logs_missing_reason: { reason: "log not collected" },
      screen: null,
      screen_missing_reason: { reason: "not collected" },
    },
    group_key: {
      kind: "exception",
      code: "_exception",
      discriminator: rpt,
    },
    existing_problem: null,
    blobs: [],
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
        release: REL_AFTER,
        release_missing_reason: null,
        bundle_hash: BUNDLE,
        binding: "sdk",
        origin: "process_observer",
      },
      report_id: rpt,
      content_hash: "1".repeat(64),
    },
  };
}

async function recordProblem(
  port: number,
  token: string,
  principal: string,
  app: string,
  observedMs: number,
): Promise<string> {
  const sent = await post(
    port,
    "problems/record-report",
    token,
    reportInput(app, principal, observedMs),
    { active_release: null, problem_seq: null },
  );
  assertEquals(sent.status, 200, JSON.stringify(sent.body));
  return String(sent.body["problem"]);
}

// verified 근거 행과 그 VerificationRecorded event다. 실제 RecordVerification은
// 준비 port가 붙기 전이라(core 조립에 없다, T12 이어받음) 검증 조건이 읽는 열만
// 같은 이름으로 심는다(problems-repair-blob_test.ts의 같은 자리). 문제 seq 뒤 event가
// 붙으므로 반응기의 problem_seq CAS는 이 event seq를 기준으로 세팅된다.
function seedVerification(
  home: string,
  input: {
    id: string;
    app: string;
    problem: string;
    basis_seq: string;
    result?: string;
    before_release?: string | null;
  },
): void {
  withDb(home, (db) => {
    db.prepare(
      `insert into verifications (id, request_principal, request_key, request_hash, kind, app,
         target_bundle_hash, target_release, problem, basis_seq,
         before_release, after_release, ticket, ticket_check_index,
         ticket_check_hash, ticket_completion_seq, test, execution, result,
         reason, observations, recorded_seq, verification_canonical)
       values (?, 'runner-1', ?, ?, 'reproduction', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, 'ran', '[]', '1', '{}')`,
    ).run(
      input.id,
      `key-${input.id}`,
      "f".repeat(64),
      input.app,
      BUNDLE,
      REL_AFTER,
      input.problem,
      input.basis_seq,
      input.before_release ?? null,
      REL_AFTER,
      FROZEN,
      EXECUTION,
      input.result ?? "pass",
    );
    db.prepare(
      `insert into events (type, subject, actor, run, payload, at)
       values ('VerificationRecorded', ?, 'machine', NULL, ?, '2026-10-06T00:00:01.000Z')`,
    ).run(
      input.id,
      JSON.stringify({
        kind: "reproduction",
        app: input.app,
        target: { bundle_hash: BUNDLE, release: REL_AFTER },
        problem: input.problem,
        basis_seq: input.basis_seq,
        result: input.result ?? "pass",
        test: FROZEN,
        execution: EXECUTION,
      }),
    );
  });
}

// 고친 release 두 개다(준비된 release 조립은 apps 몫이라 시험이 직접 심는다).
function seedReleases(home: string, app: string): void {
  withDb(home, (db) => {
    const insert = db.prepare(
      `insert into releases (id, app, number, code_commit, bundle_hash, blueprint_hash,
         data_schema, data_changes, ticket_source, created_by, created_at, status,
         blueprint, declarations)
       values (?, ?, ?, ?, ?, ?, 0, '[]', NULL, 'coding_agent', ?, ?, '{}', '[]')`,
    );
    insert.run(
      REL_BEFORE,
      app,
      1,
      "b".repeat(40),
      "b".repeat(64),
      FROZEN,
      "2026-10-05T00:00:00.000Z",
      "superseded",
    );
    insert.run(
      REL_AFTER,
      app,
      2,
      "b".repeat(40),
      BUNDLE,
      EXECUTION,
      "2026-10-06T00:00:00.000Z",
      "active",
    );
  });
}

function rows<T>(home: string, sql: string, ...params: string[]): T[] {
  return withDb(home, (db) => db.prepare(sql).all(...params) as T[]);
}

function problemStatus(home: string, problem: string): string {
  const found = withDb(
    home,
    (db) =>
      db.prepare("select status, closure from problems where id = ?")
        .get(problem) as { status: string; closure: string | null } | undefined,
  );
  return found?.status ?? "";
}

function closureOf(home: string, problem: string): string | null {
  const found = withDb(
    home,
    (db) =>
      db.prepare("select closure from problems where id = ?")
        .get(problem) as { closure: string | null } | undefined,
  );
  return found?.closure ?? null;
}

function lastSeq(home: string, subject: string): string {
  const found = withDb(
    home,
    (db) =>
      db.prepare(
        "select cast(max(seq) as text) as seq from events where subject = ?",
      )
        .get(subject) as { seq: string | number | null } | undefined,
  );
  return found?.seq === undefined || found.seq === null
    ? "0"
    : String(found.seq);
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (!check()) {
    assert(Date.now() < deadline, `시간 안에 ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

type Opened = {
  port: number;
  home: string;
  machine: string;
  agent: string;
  appCredential: string;
  user: string;
  app: string;
  close(): Promise<void>;
};

async function open(): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-problems-closing-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [
      { createLedgerRegistration: createDocumentsRegistration },
      { createLedgerRegistration: createAppsRegistration },
      { problemsTestDefinitions },
      { problemsReportDefinitions },
    ],
    teamModules: [
      new URL("./documents.ts", import.meta.url).href,
      new URL("./apps.ts", import.meta.url).href,
      new URL("./problems.ts", import.meta.url).href,
    ],
    clock: manualClock(START),
    random: seededRandom(1),
    testCredentials: true,
  });
  if (!started.ok) await Deno.remove(home, { recursive: true });
  assert(started.ok, started.ok ? undefined : JSON.stringify(started.error));
  const core = started.value;
  let sequence = 0;
  const issue = async (
    actor: string,
    principal: string,
    operations: string[],
  ): Promise<string> => {
    const context = {
      principal,
      actor: actor as never,
      scope: { operations, targets: {} },
      conditions: {},
      credential_ref: `restart-${++sequence}`,
    };
    const token = `${sequence}`.repeat(43).slice(0, 43);
    assert(core.acceptTestCredential);
    const accepted = await core.acceptTestCredential!(context, token);
    assert(accepted.ok, accepted.ok ? "" : JSON.stringify(accepted.error));
    assert((await core.record(context)).ok);
    return token;
  };
  // 닫기는 machine만 한다(R1). 거절 검사의 agent·앱 자격도 기록한다(problem-codes#R7).
  const machine = await issue("machine", "machine-1", ["RecordReport"]);
  const user = await issue("user", "user-1", [
    "app.create",
    "CreateCodingAgentConnection",
    "CloseProblemVerified",
  ]);
  const agent = await issue(
    `coding_agent:cac_01arz3ndektsv4rrffq69g5fav`,
    `coding_agent:cac_01arz3ndektsv4rrffq69g5fav`,
    ["CloseProblemVerified"],
  );
  const appCredential = await issue(
    `app:${APP}`,
    `app:${APP}`,
    ["CloseProblemVerified"],
  );
  const created = await post(core.port, "apps/create", user, {
    slug: "notes",
    name: "Notes",
    description: "notes app",
  });
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const app = String(created.body["id"]);
  return {
    port: core.port,
    home,
    machine,
    agent,
    appCredential,
    user,
    app,
    close() {
      return core.shutdown().finally(() =>
        Deno.remove(home, { recursive: true })
      );
    },
  };
}

Deno.test("problems/closing#R3 R4 R5 R14: VerificationRecorded 뒤 닫힘·ProblemClosed이 실제 core 반응기로 나온다", async () => {
  const opened = await open();
  try {
    const { port, home, machine, app } = opened;
    // 활성 release를 먼저 심는다(activation 조립은 apps 몫이라 시험이 직접 심는다).
    seedReleases(home, app);
    const problem = await recordProblem(
      port,
      machine,
      "machine-1",
      app,
      START + 1_000_000,
    );
    // RecordReport가 ProblemObserved event를 남기므로 그 seq가 근거의 basis다.
    const basis = lastSeq(home, problem);
    seedVerification(home, {
      id: "vrf_01arz3ndektsv4rrffq69g5fav",
      app,
      problem,
      basis_seq: basis,
    });
    // 반응기는 VerificationRecorded를 읽어 CloseProblemVerified를 낸다. 문제 seq CAS는
    // 이 event seq(마지막)와 같다면 좁혀진 것이다.
    await waitFor(() => problemStatus(home, problem) === "closed", "닫힘");
    assertEquals(problemStatus(home, problem), "closed");
    // 닫힘 근거는 출처대로 verification·release·basis가 남는다(R13).
    const closure = JSON.parse(closureOf(home, problem)!) as Record<
      string,
      unknown
    >;
    assertEquals(closure["reason"], "verified");
    assertEquals(closure["verification"], "vrf_01arz3ndektsv4rrffq69g5fav");
    assertEquals(closure["release"], REL_AFTER);
    // ProblemClosed event도 남는다(반응기 command가 emit한다).
    assert(
      rows(
        home,
        "select seq from events where type = 'ProblemClosed' and subject = ?",
        problem,
      ).length >= 1,
      "ProblemClosed event가 없다",
    );
  } finally {
    await opened.close();
  }
});

Deno.test("problems/closing#R4 R5: basis_seq 뒤 새 live Report가 있으면 verification pass 근거로도 안 닫힌다", async () => {
  const opened = await open();
  try {
    const { port, home, machine, app } = opened;
    seedReleases(home, app);
    const problem = await recordProblem(
      port,
      machine,
      "machine-1",
      app,
      START + 1_000_000,
    );
    const basis = lastSeq(home, problem);
    seedVerification(home, {
      id: "vrf_01arz3ndektsv4rrffq69g5fav",
      app,
      problem,
      basis_seq: basis,
    });
    // 근거 뒤 같은 문제의 새 live 보고를 실제 record-report로 접수한다(R4).
    await recordProblem(port, machine, "machine-1", app, START + 2_000_000);
    // 반응기가 몇 번을 다시 읽어도 닫힘과 ProblemClosed가 없다.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    assertEquals(problemStatus(home, problem), "open");
    assertEquals(
      rows(
        home,
        "select seq from events where type = 'ProblemClosed' and subject = ?",
        problem,
      ).length,
      0,
      "닫힘 근거 뒤 새 live 보고가 있을 때 ProblemClosed가 남았다",
    );
    assertEquals(closureOf(home, problem), null);
  } finally {
    await opened.close();
  }
});

Deno.test("problems/closing#R1 problem-codes#R7: coding agent·앱 자격의 close-verified는 거절이다", async () => {
  const opened = await open();
  try {
    const { port, home, machine, agent, appCredential, app } = opened;
    seedReleases(home, app);
    const problem = await recordProblem(
      port,
      machine,
      "machine-1",
      app,
      START + 1_000_000,
    );
    const basis = lastSeq(home, problem);
    seedVerification(home, {
      id: "vrf_01arz3ndektsv4rrffq69g5fav",
      app,
      problem,
      basis_seq: basis,
    });
    // 문제 seq CAS는 반응기와 같은 문제 seq로 두고, 자격만 coding agent와 앱이다(R1).
    const problemSeq = lastSeq(home, problem);
    const forAgent = await post(
      port,
      "problems/close-verified",
      agent,
      {
        problem,
        verification: "vrf_01arz3ndektsv4rrffq69g5fav",
        problem_seq: problemSeq,
        release: REL_AFTER,
      },
      { problem_seq: problemSeq, release: REL_AFTER },
    );
    assertEquals(forAgent.status, 403, JSON.stringify(forAgent.body));
    const forApp = await post(
      port,
      "problems/close-verified",
      appCredential,
      {
        problem,
        verification: "vrf_01arz3ndektsv4rrffq69g5fav",
        problem_seq: problemSeq,
        release: REL_AFTER,
      },
      { problem_seq: problemSeq, release: REL_AFTER },
    );
    assertEquals(forApp.status, 403, JSON.stringify(forApp.body));
    // 아무것도 닫지 않았다.
    assertEquals(problemStatus(home, problem), "open");
  } finally {
    await opened.close();
  }
});
