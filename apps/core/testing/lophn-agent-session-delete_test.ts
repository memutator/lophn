import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  err,
  type LophnError,
  manualClock,
  ok,
  seededRandom,
} from "../../../packages/base/mod.ts";
import type {
  AuthenticatedContext,
  Sql,
} from "../../../packages/contracts/platform/mod.ts";
import { applyMigrations } from "../../../packages/platform/backup-and-migration/mod.ts";
import {
  LEDGER_SCHEMA_STEPS,
  openConnection,
  runCommand,
} from "../../../packages/platform/ledger/mod.ts";
import { APPROVAL_SCHEMA_STEPS } from "../../../packages/platform/approvals/mod.ts";
import {
  cred,
  id,
} from "../../../packages/lophn-agent/conversation/testing/mod.ts";
import { lophnAgentDefinitions } from "../lophn-agent.ts";

// DeleteSession이 그 session의 run을 가리키는 다른 concern의 기록까지 지우는지 본다
// (lophn-agent/conversation#R20, open-issues conversation#Q7). 실제 core 조립의 DeleteSession을
// 모든 concern의 표가 있는 파일 ledger에 부른다. 각 표에는 지울 session과 남길 session의 행을
// 같은 모양으로 먼저 넣는다. 실제 provider를 부르지 않고 LOPHN_HOME을 열지 않는다.

const NOW = Date.UTC(2026, 0, 1);
const AT = new Date(NOW).toISOString();
const ASSIGNMENT = id("asg", 1);
const DOOMED = id("ses", 1);
const KEPT = id("ses", 2);

// run을 가리키는 표(지우는 쪽)와 둘 모두 건드리면 안 되는 표다. 사실로 남는 event와 다른 concern이
// 소유한 참조는 뒤쪽 목록이다.
const ERASED = [
  "sessions",
  "messages",
  "runs",
  "model_calls",
  "model_call_supplements",
  "session_compact_requests",
  "tool_calls",
  "tool_call_supplements",
  "run_wait_resolutions",
  "question_groups",
  "questions",
  "reverts",
  "revert_changes",
  "revert_change_sources",
  "revert_change_compensations",
  "approval_requests",
  "approval_uses",
] as const;

const BLOB_OWNERS = [
  "message",
  "model_call",
  "tool_call",
  "run",
  "question",
  "approval_request",
] as const;

const hex = (n: number) => n.toString(16).padStart(2, "0").repeat(32);

type Db = { sql: Sql; exec(sql: string): void; close(): void };

function event(db: Db, type: string, subject: string, run: string | null) {
  return Number(
    db.sql.run(
      `insert into events (type, subject, actor, run, payload, at)
       values (?, ?, 'machine', ?, '{}', ?)`,
      [type, subject, run, AT],
    ).lastInsertRowid,
  );
}

// 한 session의 기록을 모든 표에 한 모양으로 넣는다. n은 session마다 달라 ID가 겹치지 않는다.
// 이어진 run, 다시 시도한 call처럼 같은 표 안에서 서로를 가리키는 행도 넣어 지우는 순서를 시험한다.
function seedSession(
  db: Db,
  session: string,
  n: number,
  unfinished = false,
) {
  const key = (name: string, i = 1) => `${name}_${n}_${i}`;
  const run1 = id("run", n * 10 + 1);
  const run2 = id("run", n * 10 + 2);
  const seq = (type = "Fact") => event(db, type, session, run1);
  db.sql.run(
    `insert into sessions (id, assignment, work_place_kind, work_place_id, state,
       created_seq, state_seq) values (?, ?, 'project', ?, 'open', ?, ?)`,
    [session, ASSIGNMENT, id("prj", 1), seq("SessionOpened"), seq()],
  );
  db.sql.run(
    `insert into messages (id, session, actor, body, mode, created_seq, state_seq)
     values (?, ?, 'user', ?, 'request', ?, ?)`,
    [id("msg", n), session, hex(n), seq("MessageReceived"), seq()],
  );
  for (const [run, continued] of [[run1, null], [run2, run1]] as const) {
    const running = unfinished && run === run1;
    db.sql.run(
      `insert into runs (id, assignment, session, source, source_kind, source_message,
         continued_from, start_after, state, basis, started_at, limits, finished_at,
         outcome_kind, outcome_reason, result, state_seq, accepted_seq)
       values (?, ?, ?, 'message', 'message', ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, 3, 1)`,
      [
        run,
        ASSIGNMENT,
        session,
        `m_${run}`,
        continued,
        continued,
        running ? "running" : "finished",
        hex(n),
        AT,
        running ? null : AT,
        running ? null : "completed",
        running ? null : "done",
        running ? null : "result",
      ],
    );
  }
  const calls = [1, 2, 3].map((i) => id("mcl", n * 10 + i));
  for (const [i, call] of calls.entries()) {
    const kind = ["initial", "retry", "credential_change"][i]!;
    db.sql.run(
      `insert into model_calls (id, run, session, model_use, agent_hash, purpose, attempt_kind,
         attempt_order, retry_of, credential_change_of, provider, model_name, protocol,
         call_model, input, context_basis, state, state_seq, started_at, usage, cost)
       values (?, ?, ?, 'judgment', ?, 'judgment', ?, ?, ?, ?, ?, 'model',
         'anthropic-messages', '{}', ?, ?, 'started', 1, ?, '{}', '{}')`,
      [
        call,
        run1,
        session,
        hex(n),
        kind,
        i + 1,
        kind === "retry" ? calls[0]! : null,
        kind === "credential_change" ? calls[1]! : null,
        id("pvd", 1),
        hex(n),
        hex(n),
        AT,
      ],
    );
  }
  db.sql.run(
    `insert into model_call_supplements (call, supplement_key, event_seq, at)
     values (?, 'late', ?, ?)`,
    [calls[0]!, seq(), AT],
  );
  // Compact의 요약 call은 run이 아니라 session을 가리킨다. 그 session의 요청과 함께 지운다.
  const summary = id("mcl", n * 10 + 4);
  db.sql.run(
    `insert into model_calls (id, run, session, model_use, agent_hash, purpose, attempt_kind,
       attempt_order, provider, model_name, protocol, call_model, input, context_basis,
       state, state_seq, started_at, usage, cost)
     values (?, null, ?, 'organizing', null, 'conversation_compression', 'initial', 1, ?,
       'model', 'anthropic-messages', '{}', ?, ?, 'started', 1, ?, '{}', '{}')`,
    [summary, session, id("pvd", 1), hex(n), hex(n), AT],
  );
  db.sql.run(
    `insert into session_compact_requests (request_seq, session, state)
     values (?, ?, 'requested')`,
    [seq("SessionCompactRequested"), session],
  );
  const tools = [1, 2].map((i) => id("tcl", n * 10 + i));
  for (const [i, tool] of tools.entries()) {
    db.sql.run(
      `insert into tool_calls (id, run, model_call, response_key, response_order, tool,
         definition_revision, effect, confirm, input, retry_of, attempt, state, state_seq)
       values (?, ?, ?, 'k', 0, 'tool', 'r1', 'read', 0, ?, ?, ?, 'requested', 1)`,
      [tool, run1, calls[0]!, hex(n), i === 0 ? null : tools[0]!, i],
    );
  }
  db.sql.run(
    `insert into tool_call_supplements (tool_call, supplement_key, fact, event_seq, at)
     values (?, 'late', 'fact', ?, ?)`,
    [tools[0]!, seq(), AT],
  );
  const group = id("qgr", n);
  const approval = id("apr", n);
  db.sql.run(
    `insert into run_wait_resolutions (run, request, decision_seq, tool_call, result,
       reason, resolved_seq) values (?, ?, ?, null, 'resumed', 'answered', ?)`,
    [run1, group, seq(), seq()],
  );
  db.sql.run(
    `insert into run_wait_resolutions (run, request, decision_seq, tool_call, result,
       reason, resolved_seq) values (?, ?, ?, ?, 'call_started', 'granted', ?)`,
    [run1, approval, seq(), tools[0]!, seq()],
  );
  db.sql.run(
    `insert into question_groups (id, run, session, created_by, status, created_seq)
     values (?, ?, ?, 'agent', 'pending', ?)`,
    [group, run1, session, seq()],
  );
  db.sql.run(
    `insert into questions (id, "group", position, prompt_blob, reason_blob, options)
     values (?, ?, 1, ?, ?, '[]')`,
    [id("qst", n), group, hex(n), hex(n + 1)],
  );
  const revert = id("rvt", n);
  db.sql.run(
    `insert into reverts (id, run, allow_partial, outcome, preview_hash, created_seq,
       state_seq, result_seq) values (?, ?, 0, 'applied', ?, ?, ?, ?)`,
    [revert, run1, hex(n), seq(), seq(), seq()],
  );
  db.sql.run(
    `insert into revert_changes (revert, ordinal, owner, target, capability, result)
     values (?, 0, 'documents', ?, 'reversible', 'restored')`,
    [revert, key("target")],
  );
  db.sql.run(
    "insert into revert_change_sources (revert, ordinal, source_seq) values (?, 0, ?)",
    [revert, seq("DocumentVersionSaved")],
  );
  db.sql.run(
    "insert into revert_change_compensations (revert, ordinal, restored_seq) values (?, 0, ?)",
    [revert, seq("DocumentVersionRestored")],
  );
  db.sql.run(
    `insert into approval_requests (id, requester, run, reason_blob, effect, action,
       action_binding_hash, session_grantable, status, grant_scope, created_seq, closed_seq)
     values (?, 'agent', ?, ?, 'write', 'a', ?, 0, 'granted', 'once', ?, ?)`,
    [approval, run1, hex(n), hex(n), seq(), seq()],
  );
  db.sql.run(
    "insert into approval_uses (approval, concern, receipt, accepted_seq) values (?, 'c', 'r', ?)",
    [approval, seq()],
  );
  // 이 run이 만든 문서의 version 본문 참조는 documents 소유라 session을 지워도 남는다.
  const owners: [string, string, string][] = [
    ["message", id("msg", n), "body"],
    ["model_call", calls[0]!, "input"],
    ["model_call", calls[1]!, "output"],
    ["model_call", summary, "input"],
    ["tool_call", tools[0]!, "input"],
    ["run", run1, "result"],
    ["question", group, "prompt"],
    ["approval_request", approval, "reason"],
    ["document_version", key("version"), "content"],
  ];
  for (const [kind, owner, field] of owners) {
    db.sql.run(
      `insert into blob_refs (owner_kind, owner_key, field, hash, size_bytes, registered_seq)
       values (?, ?, ?, ?, 1, ?)`,
      [kind, owner, field, hex(n), seq()],
    );
  }
}

async function open() {
  const dir = await Deno.makeTempDir({ prefix: "session-delete-" });
  const path = `${dir}/ledger.db`;
  const clock = manualClock(NOW);
  const applied = await applyMigrations(
    path,
    [
      ...LEDGER_SCHEMA_STEPS,
      ...APPROVAL_SCHEMA_STEPS,
      ...lophnAgentDefinitions.schemaSteps,
    ],
    { clock },
  );
  assert(applied.ok, applied.ok ? "" : JSON.stringify(applied.error));
  const deps = {
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
    ports: [],
    registerBlobRef: () =>
      err<LophnError>({ code: "forbidden", message: "no blobs here" }),
    call: () =>
      err<LophnError>({ code: "unavailable", message: "dispatch 없음" }),
    checkCredential: (ctx: AuthenticatedContext) => ok(ctx),
  };
  const observe = <T>(read: (db: Db) => T): T => {
    const opened = openConnection(path);
    assert(opened.ok, "open");
    try {
      return read(opened.value);
    } finally {
      opened.value.close();
    }
  };
  const count = (table: string, where = "1 = 1") =>
    observe((db) =>
      Number(
        db.sql.get(`select count(*) as n from ${table} where ${where}`, [])![
          "n"
        ],
      )
    );
  let n = 0;
  const deleteSession = (session: string) =>
    runDelete(path, deps, session, ++n);
  return { path, count, observe, deleteSession };
}

async function runDelete(
  path: string,
  // deno-lint-ignore no-explicit-any
  deps: any,
  session: string,
  key: number,
) {
  const opened = openConnection(path);
  assert(opened.ok, "open");
  try {
    const row = opened.value.sql.get(
      "select cast(state_seq as text) as s from sessions where id = ?",
      [session],
    );
    return await runCommand(
      opened.value,
      deps,
      lophnAgentDefinitions.commands,
      cred("user"),
      {
        command: "DeleteSession",
        input: { session },
        idempotency_key: `delete-${key}`,
        compare: { state_seq: row === undefined ? "1" : String(row["s"]) },
        prepared: [],
      },
    );
  } finally {
    opened.value.close();
  }
}

const TABLES = [...ERASED, "blob_refs", "events"] as const;

Deno.test("lophn-agent/conversation#R20 [agent-I12b]: deleting a session erases every record that points at its runs and nothing else", async () => {
  const ledger = await open();
  ledger.observe((db) => {
    db.exec("pragma foreign_keys = off");
    seedSession(db, DOOMED, 1);
    seedSession(db, KEPT, 2);
    // run이 없는 approval(질문 option의 settings 변경 같은)과 그 본문 참조는 어느 session 것도 아니다.
    db.sql.run(
      `insert into approval_requests (id, requester, run, reason_blob, effect, action,
         action_binding_hash, session_grantable, status, grant_scope, created_seq, closed_seq)
       values (?, 'user', null, ?, 'write', 'a', ?, 0, 'granted', 'once', ?, ?)`,
      [
        id("apr", 99),
        hex(9),
        hex(9),
        event(db, "Fact", id("apr", 99), null),
        event(db, "Fact", id("apr", 99), null),
      ],
    );
    db.sql.run(
      `insert into blob_refs (owner_kind, owner_key, field, hash, size_bytes, registered_seq)
       values ('approval_request', ?, 'reason', ?, 1, ?)`,
      [id("apr", 99), hex(9), event(db, "Fact", id("apr", 99), null)],
    );
  });
  // 모든 표에 두 session의 행이 있어야 아래 단언이 뜻을 가진다.
  const before = new Map<string, number>();
  for (const table of TABLES) {
    before.set(table, ledger.count(table));
    assert(before.get(table)! >= 2, `${table} is seeded`);
  }
  const result = await ledger.deleteSession(DOOMED);
  assert(result.ok, result.ok ? "" : JSON.stringify(result.error));

  // 지운 session의 행은 어느 표에도 없고 FK 때문에 internal이 나지 않았다.
  for (const table of ERASED) {
    assertEquals(
      ledger.count(table),
      before.get(table)! - seededPerSession(table),
      `${table} keeps only the other session`,
    );
  }
  assertEquals(ledger.count("sessions", `id = '${DOOMED}'`), 0);
  assertEquals(ledger.count("runs", `session = '${DOOMED}'`), 0);
  for (const kind of BLOB_OWNERS) {
    const owned = (n: number) =>
      ledger.count(
        "blob_refs",
        `owner_kind = '${kind}' and hash = '${hex(n)}'`,
      );
    assertEquals(owned(1), 0, `${kind} refs of the deleted session`);
    assert(owned(2) > 0, `${kind} refs of the other session stay`);
  }
  // 다른 session의 기록은 그대로다: 같은 모양의 행이 남는다.
  assertEquals(ledger.count("runs", `session = '${KEPT}'`), 2);
  // 문서 version 본문 참조와 run이 낸 event는 지우지 않는다. event는 SessionDeleted 하나만 늘어난다.
  assertEquals(ledger.count("blob_refs", "owner_kind = 'document_version'"), 2);
  assertEquals(
    ledger.count("blob_refs", "owner_key = '" + id("apr", 99) + "'"),
    1,
  );
  assertEquals(
    ledger.count("approval_requests", `id = '${id("apr", 99)}'`),
    1,
  );
  assertEquals(ledger.count("events"), before.get("events")! + 1);
  assertEquals(
    ledger.count("events", `type = 'SessionDeleted' and subject = '${DOOMED}'`),
    1,
  );
  assertEquals(
    ledger.count(
      "events",
      "type in ('DocumentVersionSaved', 'DocumentVersionRestored')",
    ),
    4,
  );
});

// 표마다 한 session이 넣은 행 수다(seedSession과 같다).
function seededPerSession(table: (typeof ERASED)[number]): number {
  const perSession: Record<(typeof ERASED)[number], number> = {
    sessions: 1,
    messages: 1,
    runs: 2,
    model_calls: 4,
    model_call_supplements: 1,
    session_compact_requests: 1,
    tool_calls: 2,
    tool_call_supplements: 1,
    run_wait_resolutions: 2,
    question_groups: 1,
    questions: 1,
    reverts: 1,
    revert_changes: 1,
    revert_change_sources: 1,
    revert_change_compensations: 1,
    approval_requests: 1,
    approval_uses: 1,
  };
  return perSession[table];
}

Deno.test("lophn-agent/conversation#R20 [agent-I12b]: records of an unfinished run and the platform records are not deleted outside DeleteSession", async () => {
  const ledger = await open();
  ledger.observe((db) => {
    db.exec("pragma foreign_keys = off");
    seedSession(db, DOOMED, 1, true);
  });
  const refused = (table: string) =>
    ledger.observe((db) => {
      try {
        db.sql.run(`delete from ${table}`, []);
        return false;
      } catch {
        return true;
      }
    });
  for (
    const table of [
      "model_calls",
      "tool_calls",
      "run_wait_resolutions",
      "reverts",
      "revert_changes",
      "revert_change_sources",
      "revert_change_compensations",
      "approval_uses",
      "approval_requests",
      "blob_refs",
    ]
  ) {
    assert(refused(table), `${table} rows are kept`);
  }
  // 진행 중인 run이 있으면 DeleteSession도 지우지 않고 아무것도 바뀌지 않는다.
  const before = ledger.count("model_calls");
  const result = await ledger.deleteSession(DOOMED);
  assert(!result.ok && result.error.code === "conflict");
  assertEquals(ledger.count("model_calls"), before);
  assertEquals(ledger.count("blob_refs") > 0, true);
});
