import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createKnownSecretRegistry } from "../../base/redaction/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import {
  MESSAGE_BODY_FIELD,
  MESSAGE_BODY_OWNER_KIND,
} from "../../protocol/lophn-agent/mod.ts";
import type { ReadSnapshot, Sql } from "../../protocol/server/mod.ts";
import { turnSchemaSteps } from "../lophn-agent/run-loop/schema.ts";
import { conversationTestSteps } from "../lophn-agent/session/test-steps.ts";
import { toolsSchemaSteps } from "../lophn-agent/tools/mod.ts";
import { appSenderSchemaSteps } from "../router/app-sender-schema.ts";
import { mailSchemaSteps } from "../router/mail-schema.ts";
import { remoteSenderCallsSchemaSteps } from "../router/remote-sender-schema.ts";
import { ROUTER_SCHEMA_STEPS } from "../router/schema.ts";
import { objectPathFor } from "../storage/blobs/mod.ts";
import {
  KNOWN_SECRETS,
  type KnownSecretMatch,
  LEDGER_SCHEMA_STEPS,
} from "../storage/ledger/mod.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import { workflowLinesSchemaSteps } from "./lines-schema.ts";
import { createWorkflowReads } from "./reads.ts";
import { workflowsNoHarnessKindSteps, workflowsSchemaSteps } from "./schema.ts";
import { appendLine, insertInstance, updateInstance } from "./store.ts";

const PRJ = "prj_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"prj">;
const OTHER_PRJ = "prj_01hzzzzzzzzzzzzzzzzzzzzzzb" as Id<"prj">;
const WFI = "wfi_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"wfi">;
const WFI_OTHER = "wfi_01hzzzzzzzzzzzzzzzzzzzzzzb" as Id<"wfi">;
const SES_MAIN = "ses_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"ses">;
const SES_CHILD = "ses_01hzzzzzzzzzzzzzzzzzzzzzzb" as Id<"ses">;
const SES_OTHER = "ses_01hzzzzzzzzzzzzzzzzzzzzzzc" as Id<"ses">;
const CAL_REMOTE = "cal_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"cal">;
const MCH_REMOTE = "mch_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"mch">;
const AT = "2026-11-23T00:00:00.000Z";
const HASH_ZERO = "0".repeat(64);
const CTX = { actor: "user:person" } as never;

function openDb(dbPath = ":memory:"): { db: DatabaseSync; sql: Sql } {
  const db = new DatabaseSync(dbPath);
  const steps = [
    ...LEDGER_SCHEMA_STEPS.filter(
      (step) => step.id === "erase-windows" || step.id === "blob-refs",
    ),
    ...workflowsSchemaSteps,
    ...workflowsNoHarnessKindSteps,
    ...workflowLinesSchemaSteps,
    ...conversationTestSteps,
    ...turnSchemaSteps,
    ...toolsSchemaSteps,
    ...ROUTER_SCHEMA_STEPS,
    appSenderSchemaSteps.find(
      (step) => step.id === "router.app-sender.agent-calls",
    )!,
    ...remoteSenderCallsSchemaSteps,
    ...mailSchemaSteps,
  ];
  for (const step of steps) db.exec(step.sql);
  return { db, sql: createSql(db, () => true) };
}

function snapshotOf(sql: Sql, known?: KnownSecretMatch): ReadSnapshot {
  return {
    sql,
    as_of_seq: "1",
    port<T>(key: unknown): T {
      if (key === KNOWN_SECRETS && known !== undefined) return known as T;
      throw new Error("unregistered read port");
    },
  };
}

function writeBlob(
  root: string,
  content: unknown,
): {
  hash: string;
  size: number;
} {
  const bytes = new TextEncoder().encode(JSON.stringify(content));
  const hash = createHash("sha256").update(bytes).digest("hex");
  const target = objectPathFor(root, hash);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return { hash, size: bytes.byteLength };
}

function seedSession(
  sql: Sql,
  input: {
    id: Id<"ses">;
    agent: string;
    project: Id<"prj">;
    parent?: Id<"ses"> | null;
    origin?: {
      project: Id<"prj">;
      workflow: string;
      instance: Id<"wfi">;
      step: string;
    } | null;
    seq: number;
  },
): void {
  sql.run(
    `INSERT INTO sessions
      (id, agent, project, workspace_kind, workspace_id, lifecycle, spawned_by, workflow_origin, created_seq, state_seq)
     VALUES (?, ?, ?, 'project', ?, 'open', ?, ?, ?, ?)`,
    [
      input.id,
      input.agent,
      input.project,
      input.project,
      input.parent ?? null,
      input.origin ? JSON.stringify(input.origin) : null,
      input.seq,
      input.seq,
    ],
  );
}

test("derived_status reflects working, needs_you, blocked, retry/report clearing, and appears in list", () => {
  const { db, sql } = openDb();
  try {
    const reads = createWorkflowReads();
    const readStatus = (id: Id<"wfi">) => {
      const res = reads.read.handle(snapshotOf(sql), CTX, { instance: id });
      assert.ok(res.ok);
      return res.value.derived_status;
    };
    const listStatuses = () => {
      const res = reads.list.handle(snapshotOf(sql), CTX, { project: PRJ });
      assert.ok(res.ok);
      return new Map(
        res.value.instances.map((item) => [item.id, item.derived_status]),
      );
    };

    insertInstance(sql, {
      id: WFI,
      project: PRJ,
      workflow: "eval-loop",
      input: "run eval",
      participants: { runner: { agent: "lophn" } },
      steps: [],
      current: { step: "run", human_turn: false },
      started_by: { kind: "user" },
      created_at: AT,
    });
    appendLine(sql, WFI, AT, {
      kind: "handed",
      by: { kind: "lophn" },
      step: "run",
      participant: "runner",
      receiver: SES_MAIN,
      human_turn: false,
      cause: "start",
      session: "new",
    });
    assert.equal(readStatus(WFI), "working");
    assert.equal(listStatuses().get(WFI), "working");

    // step_stalled -> blocked, retried -> clears back to working, second step_stalled -> blocked, report -> clears
    appendLine(sql, WFI, AT, {
      kind: "step_stalled",
      by: { kind: "lophn" },
      step: "run",
      session: SES_MAIN,
    });
    assert.equal(readStatus(WFI), "blocked");
    assert.equal(listStatuses().get(WFI), "blocked");

    appendLine(sql, WFI, AT, {
      kind: "retried",
      by: { kind: "user" },
      step: "run",
      session: SES_MAIN,
    });
    assert.equal(readStatus(WFI), "working");

    appendLine(sql, WFI, AT, {
      kind: "step_stalled",
      by: { kind: "lophn" },
      step: "run",
      session: SES_MAIN,
    });
    assert.equal(readStatus(WFI), "blocked");

    appendLine(sql, WFI, AT, {
      kind: "report",
      by: { kind: "agent", session: SES_MAIN },
      step: "run",
      text: "finished",
      next: null,
      session: "new",
    });
    assert.equal(readStatus(WFI), "working");

    // Connected session waiting on approval -> needs_you in both read & list
    seedSession(sql, {
      id: SES_MAIN,
      agent: "lophn",
      project: PRJ,
      origin: {
        project: PRJ,
        workflow: "eval-loop",
        instance: WFI,
        step: "run",
      },
      seq: 1,
    });
    sql.run(
      `INSERT INTO turns (id, session, input_message, state, basis, started_at, limits, mode, state_seq)
       VALUES ('trn_1', ?, 'msg_in', 'running', ?, ?, '{"model_attempts":null,"stall_ms":300000}', 'attended', 1)`,
      [SES_MAIN, HASH_ZERO, AT],
    );
    sql.run(
      `INSERT INTO tool_calls
        (id, turn, model_call, response_key, response_order, tool, definition_revision, effect, confirm, input, attempt, state, state_seq)
       VALUES ('tcl_1', 'trn_1', 'mcl_1', 'k1', 0, 'shell.run', 'rev_1', 'write', 1, ?, 0, 'requested', 1)`,
      [HASH_ZERO],
    );
    assert.equal(readStatus(WFI), "needs_you");
    assert.equal(listStatuses().get(WFI), "needs_you");

    // Question wait -> needs_you as well
    sql.run(
      `UPDATE tool_calls SET state = 'started', tool = 'ask', confirm = 0, started_at = ? WHERE id = 'tcl_1'`,
      [AT],
    );
    assert.equal(readStatus(WFI), "needs_you");

    // Finish turn -> clears waiting_for, back to working
    sql.run(
      `UPDATE turns SET state = 'finished', finished_at = ?, outcome_kind = 'completed', outcome_reason = 'answer_completed', result = ?, state_seq = 2 WHERE id = 'trn_1'`,
      [AT, HASH_ZERO],
    );
    assert.equal(readStatus(WFI), "working");

    // Remote step held -> needs_you
    appendLine(sql, WFI, AT, {
      kind: "handed",
      by: { kind: "lophn" },
      step: "remote_step",
      participant: "runner",
      receiver: null,
      human_turn: false,
      cause: "report",
      session: "new",
      remote: { machine: MCH_REMOTE, computer: "mac-studio", call: CAL_REMOTE },
    });
    const remoteTo = JSON.stringify({
      kind: "remote",
      machine: MCH_REMOTE,
      computer: "mac-studio",
      address: { session: SES_MAIN },
    });
    sql.run(
      `INSERT INTO agent_calls
        (call, "to", reply, state, delivery, created_at, state_at)
       VALUES (?, ?, 'none', 'accepted', 'held', ?, ?)`,
      [CAL_REMOTE, remoteTo, AT, AT],
    );
    assert.equal(readStatus(WFI), "needs_you");
    assert.equal(listStatuses().get(WFI), "needs_you");

    // Escalated -> needs_you; not_handed overrides stale human_turn -> blocked; stopped/ended -> stored state
    sql.run(
      `UPDATE agent_calls SET state = 'done', delivery = NULL WHERE call = ?`,
      [CAL_REMOTE],
    );
    appendLine(sql, WFI, AT, {
      kind: "escalated",
      by: { kind: "lophn" },
      step: "run",
      text: "need decision",
    });
    assert.equal(readStatus(WFI), "needs_you");

    updateInstance(sql, WFI, {
      state: "running",
      current: { step: "spec", human_turn: true },
      steps: [],
      finished_at: null,
    });
    appendLine(sql, WFI, AT, {
      kind: "not_handed",
      by: { kind: "lophn" },
      step: "next_step",
      reason: "unresolved",
      message: "agent missing",
    });
    assert.equal(readStatus(WFI), "blocked");

    updateInstance(sql, WFI, {
      state: "ended",
      current: null,
      steps: [],
      finished_at: AT,
    });
    assert.equal(readStatus(WFI), "ended");
    assert.equal(listStatuses().get(WFI), "ended");

    updateInstance(sql, WFI, {
      state: "stopped",
      current: null,
      steps: [],
      finished_at: AT,
    });
    assert.equal(readStatus(WFI), "stopped");
  } finally {
    db.close();
  }
});

test("sessions tree builds parent/child links, redacts and truncates 160-char previews, and exposes last_error", () => {
  const root = mkdtempSync(join(tmpdir(), "lophn-wf-reads-"));
  const { db, sql } = openDb(join(root, "lophn.db"));
  try {
    insertInstance(sql, {
      id: WFI,
      project: PRJ,
      workflow: "eval-loop",
      input: "go",
      participants: {},
      steps: [],
      current: { step: "run", human_turn: false },
      started_by: { kind: "user" },
      created_at: AT,
    });

    // Main session + spawned child (cross-project workspace) + unrelated session
    seedSession(sql, {
      id: SES_MAIN,
      agent: "lophn",
      project: PRJ,
      origin: {
        project: PRJ,
        workflow: "eval-loop",
        instance: WFI,
        step: "run",
      },
      seq: 1,
    });
    seedSession(sql, {
      id: SES_CHILD,
      agent: "coding_codex",
      project: OTHER_PRJ,
      parent: SES_MAIN,
      origin: {
        project: PRJ,
        workflow: "eval-loop",
        instance: WFI,
        step: "run",
      },
      seq: 2,
    });
    seedSession(sql, {
      id: SES_OTHER,
      agent: "lophn",
      project: PRJ,
      origin: {
        project: PRJ,
        workflow: "eval-loop",
        instance: WFI_OTHER,
        step: "run",
      },
      seq: 3,
    });

    // Long assistant message (>160 chars) with a known secret placed right across the 160-char boundary
    const secret = "TOP_SECRET_WORKFLOW_TOKEN_9876543210";
    const longText = `${"alpha ".repeat(25)}token=${secret} trailing details beyond one hundred sixty characters`;
    const blob = writeBlob(root, {
      schema_version: 1,
      parts: [{ kind: "text", text: longText }],
    });
    sql.run(
      `INSERT INTO messages (id, session, from_kind, from_ref, refs, delivery, turn, body, created_seq, created_at, state_seq)
       VALUES ('msg_a1', ?, 'agent', ?, '[]', 'next_turn', 'trn_m1', ?, 1, ?, 1)`,
      [SES_MAIN, SES_MAIN, blob.hash, AT],
    );
    sql.run(
      `INSERT INTO blob_refs (owner_kind, owner_key, field, hash, size_bytes, registered_seq)
       VALUES (?, 'msg_a1', ?, ?, ?, 1)`,
      [MESSAGE_BODY_OWNER_KIND, MESSAGE_BODY_FIELD, blob.hash, blob.size],
    );

    // Child session latest turn failed -> last_error set
    sql.run(
      `INSERT INTO turns (id, session, input_message, state, basis, started_at, limits, mode, finished_at, outcome_kind, outcome_reason, result, state_seq)
       VALUES ('trn_c1', ?, 'msg_c1', 'finished', ?, ?, '{"model_attempts":null,"stall_ms":300000}', 'unattended', ?, 'failed', 'model_error', ?, 1)`,
      [SES_CHILD, HASH_ZERO, AT, AT, HASH_ZERO],
    );

    const registry = createKnownSecretRegistry();
    registry.register([secret]);
    const readyKnown: KnownSecretMatch = {
      match: (t) => registry.match(t),
      prefixFrom: (t) => registry.prefixFrom(t),
      ready: true,
    };
    const unreadyKnown: KnownSecretMatch = {
      match: (t) => registry.match(t),
      prefixFrom: (t) => registry.prefixFrom(t),
      ready: false,
    };

    const reads = createWorkflowReads();
    const res = reads.read.handle(snapshotOf(sql, readyKnown), CTX, {
      instance: WFI,
    });
    assert.ok(res.ok);
    const sessions = res.value.sessions!;
    assert.equal(sessions.length, 2);

    const main = sessions.find((s) => s.session === SES_MAIN)!;
    assert.equal(main.parent, null);
    assert.deepEqual(main.workspace, { kind: "project", id: PRJ });
    assert.equal(main.state, "idle");
    assert.equal(main.last_error, null);
    assert.ok(main.last_assistant_preview !== null);
    assert.ok(main.last_assistant_preview.length <= 160);
    assert.ok(main.last_assistant_preview.endsWith("…"));
    assert.ok(!main.last_assistant_preview.includes(secret));
    assert.ok(!main.last_assistant_preview.includes("TOP_SECRET"));

    const child = sessions.find((s) => s.session === SES_CHILD)!;
    assert.equal(child.parent, SES_MAIN);
    assert.deepEqual(child.workspace, { kind: "project", id: OTHER_PRJ });
    assert.equal(child.last_error, "model_error");
    assert.equal(child.last_assistant_preview, null);

    // Fail-closed when KNOWN_SECRETS is not ready yet: preview and error must not leak unredacted text
    const unready = reads.read.handle(snapshotOf(sql, unreadyKnown), CTX, {
      instance: WFI,
    });
    assert.ok(unready.ok);
    assert.equal(unready.value.sessions![0]!.last_assistant_preview, null);
    assert.equal(unready.value.sessions![1]!.last_error, null);

    // Later completed turn clears last_error
    sql.run(
      `INSERT INTO turns (id, session, input_message, state, basis, started_at, limits, mode, finished_at, outcome_kind, outcome_reason, result, state_seq)
       VALUES ('trn_c2', ?, 'msg_c2', 'finished', ?, ?, '{"model_attempts":null,"stall_ms":300000}', 'unattended', ?, 'completed', 'answer_completed', ?, 2)`,
      [SES_CHILD, HASH_ZERO, AT, AT, HASH_ZERO],
    );
    const recovered = reads.read.handle(snapshotOf(sql, readyKnown), CTX, {
      instance: WFI,
    });
    assert.ok(recovered.ok);
    assert.equal(recovered.value.sessions![1]!.last_error, null);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("refs extracts deduplicated explicit report refs in order independent of line cursor", () => {
  const { db, sql } = openDb();
  try {
    insertInstance(sql, {
      id: WFI,
      project: PRJ,
      workflow: "eval-loop",
      input: "go",
      participants: {},
      steps: [],
      current: { step: "report", human_turn: false },
      started_by: { kind: "user" },
      created_at: AT,
    });
    const seq1 = appendLine(sql, WFI, AT, {
      kind: "report",
      by: { kind: "agent", session: SES_MAIN },
      step: "spec",
      text: "wrote spec",
      next: "run",
      session: "new",
      refs: ["specs/exp-01.md", "notes/context.txt"],
    });
    appendLine(sql, WFI, AT, {
      kind: "report",
      by: { kind: "agent", session: SES_MAIN },
      step: "run",
      text: "no refs on this report",
      next: "report",
      session: "new",
    });
    appendLine(sql, WFI, AT, {
      kind: "report",
      by: { kind: "agent", session: SES_MAIN },
      step: "report",
      text: "final report",
      next: null,
      session: "new",
      refs: ["notes/context.txt", "reports/final.md"],
    });

    const reads = createWorkflowReads();
    // Even with cursor past seq1, refs still reflects all explicit report refs of the instance.
    const res = reads.read.handle(snapshotOf(sql), CTX, {
      instance: WFI,
      cursor: seq1,
    });
    assert.ok(res.ok);
    assert.deepEqual(res.value.refs, [
      "specs/exp-01.md",
      "notes/context.txt",
      "reports/final.md",
    ]);
  } finally {
    db.close();
  }
});
