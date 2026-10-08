import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "../../base/mod.ts";
import type { SqlParams, SqlRow, Tx } from "../../contracts/platform/mod.ts";
import { buildGroups, type RevertGroup, type RevertOwner } from "./model.ts";
import { revertSchemaSteps } from "./schema.ts";
import {
  createInterpretationOwner,
  INTERPRETATION_REVERT_OWNER,
} from "./interpretation-owner.ts";
import { defaultRevertOwners } from "./owners.ts";

// 문제 해석 참조의 복원 판정(roles/app-engineer#R15의 되돌리기). run의 해석 연결
// event를 문제별로 묶어 예전 참조를 가리키는 LinkProblemInterpretation command의 새
// 변경으로 되돌림을 본다. 실제 core·에서 run의 변경이 복원되는 것은 E2E가 본다.

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const RUN = id("run", 1);
const ASG = id("asg", 1);
const PROBLEM = id("prb", 1);
const PROBLEM_B = id("prb", 2);
const VER_A = id("ver", 1);
const VER_B = id("ver", 2);
const AGENT = `agent:${ASG}`;

function open(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table events (
      seq integer primary key autoincrement,
      type text not null, subject text, actor text not null, run text,
      payload text not null, at text not null default ''
    );
    create table runs (id text primary key, assignment text, state text);
  `);
  for (const step of revertSchemaSteps) db.exec(step.sql);
  db.prepare("insert into runs values (?, ?, 'finished')").run(RUN, ASG);
  return db;
}

function lookupOf(db: DatabaseSync) {
  return {
    sql: {
      get: (query: string, params: SqlParams) =>
        db.prepare(query).get(...(params as never[])) as SqlRow | undefined,
      all: (query: string, params: SqlParams) =>
        db.prepare(query).all(...(params as never[])) as SqlRow[],
    },
  };
}

function emit(
  db: DatabaseSync,
  type: string,
  subject: string | null,
  payload: Record<string, unknown>,
  options: { actor?: string; run?: string | null } = {},
): string {
  const result = db.prepare(
    "insert into events (type, subject, actor, run, payload) values (?, ?, ?, ?, ?)",
  ).run(
    type,
    subject,
    options.actor ?? AGENT,
    options.run === undefined ? RUN : options.run,
    JSON.stringify(payload),
  );
  return String(result.lastInsertRowid);
}

function linked(
  db: DatabaseSync,
  problem: string,
  previous: unknown,
  current: unknown,
  options: { actor?: string; run?: string | null } = {},
): string {
  return emit(db, "ProblemInterpretationLinked", problem, {
    previous,
    current,
  }, options);
}

function groupsOf(db: DatabaseSync, owners = defaultRevertOwners()) {
  return buildGroups(lookupOf(db), RUN, owners);
}

function interpretationGroups(db: DatabaseSync) {
  return groupsOf(db).filter((group) =>
    group.owner === INTERPRETATION_REVERT_OWNER
  );
}

function recordingTx(problemSeq: string = "0", failAt: number | null = null) {
  const calls: { route: string; input: unknown; compare: unknown }[] = [];
  const tx = {
    sql: {
      get(_query: string, _params: SqlParams): SqlRow | undefined {
        return { seq: problemSeq };
      },
    },
    call(
      route: { name: string },
      input: unknown,
      compare: unknown,
    ): Result<unknown> {
      calls.push({ route: route.name, input, compare });
      if (failAt === calls.length) {
        return err({ code: "conflict", message: "참조가 바뀌었다" });
      }
      return ok({
        interpretation: (input as { interpretation?: unknown }).interpretation,
      });
    },
  } as unknown as Tx;
  return { tx, calls };
}

function reversible(owner: RevertOwner, db: DatabaseSync): RevertGroup {
  const [group] = buildGroups(lookupOf(db), RUN, [owner]);
  assertEquals(group.owner, INTERPRETATION_REVERT_OWNER);
  assertEquals(group.capability, "reversible");
  return group;
}

Deno.test("lophn-agent/roles/app-engineer#R15: run의 해석 연결은 예전 참조를 가리키는 한 묶음으로 분류되고 이전 참조는 event에 남는다", () => {
  const db = open();
  // run이 연결을 한 번 만들었다: 이전 참조는 run 이전(null), current는 run 이후다.
  const seq = linked(db, PROBLEM, null, { version: VER_B, section: "cause" });
  const groups = interpretationGroups(db);
  assertEquals(groups.length, 1);
  const group = groups[0]!;
  assertEquals(group.capability, "reversible");
  assertEquals(group.target, PROBLEM);
  assertEquals(group.source_seqs, [seq]);
  assertEquals(group.comparison, {
    kind: "interpretation",
    problem: PROBLEM,
    previous: { version: VER_B, section: "cause" },
    interpretation: null,
  });
});

Deno.test("lophn-agent/roles/app-engineer#R15: 연속한 해석 변경은 한 묶음이고 복원은 현재 참조를 previous로 싣는다", () => {
  const db = open();
  linked(db, PROBLEM, null, { version: VER_A, section: null });
  linked(db, PROBLEM, { version: VER_A, section: null }, {
    version: VER_B,
    section: "cause",
  });
  const [group] = interpretationGroups(db);
  assertEquals(group!.capability, "reversible");
  assertEquals(group!.comparison, {
    kind: "interpretation",
    problem: PROBLEM,
    previous: { version: VER_B, section: "cause" },
    interpretation: null,
  });
});

Deno.test("lophn-agent/roles/app-engineer#R15: 복원은 같은 LinkProblemInterpretation command로 다시 연결한다", () => {
  const db = open();
  linked(db, PROBLEM, null, { version: VER_B, section: "cause" });
  const owner = createInterpretationOwner();
  const group = reversible(owner, db);
  const { tx, calls } = recordingTx("20");
  const done = owner.restore(tx, group, {
    source_seqs: group.source_seqs,
    comparison: group.comparison as never,
    prepared_ref: null,
  });
  assert(done.ok);
  assertEquals(calls, [{
    route: "LinkProblemInterpretation",
    input: { problem: PROBLEM, interpretation: null },
    compare: {
      problem_seq: "20",
      previous: { version: VER_B, section: "cause" },
    },
  }]);
});

Deno.test("lophn-agent/roles/app-engineer#R15: 이전에 다른 참조가 있던 문제의 복원은 예전 참조를 다시 연결한다", () => {
  const db = open();
  // run 이전에 OLD 참조가 있었고 run이 NEW로 바꿨다: 복원은 OLD를 다시 연결한다.
  const old = { version: VER_A, section: "summary" };
  linked(db, PROBLEM, old, { version: VER_B, section: "cause" });
  const owner = createInterpretationOwner();
  const [group] = groupsOf(db, [owner]);
  assertEquals(group!.capability, "reversible");
  const { tx, calls } = recordingTx("22");
  const done = owner.restore(tx, group!, {
    source_seqs: group!.source_seqs,
    comparison: group!.comparison as never,
    prepared_ref: null,
  });
  assert(done.ok);
  assertEquals(calls, [{
    route: "LinkProblemInterpretation",
    input: { problem: PROBLEM, interpretation: old },
    compare: {
      problem_seq: "22",
      previous: { version: VER_B, section: "cause" },
    },
  }]);
});

Deno.test("lophn-agent/roles/app-engineer#R15: 사람이 직접 바꾼 해석 참조는 복원 대상이 아니다", () => {
  const db = open();
  linked(db, PROBLEM, null, { version: VER_B, section: "cause" }, {
    actor: "user",
  });
  linked(db, PROBLEM_B, null, { version: VER_B, section: "cause" }, {
    actor: "machine",
  });
  const groups = interpretationGroups(db);
  assertEquals(groups.length, 2);
  for (const group of groups) {
    assertEquals(group.capability, "irreversible");
    assertEquals(group.reason, "not_agent_output");
  }
});

Deno.test("lophn-agent/roles/app-engineer#R15: 한 호출이 거절하면 복원은 그 오류로 끝난다", () => {
  const db = open();
  linked(db, PROBLEM, null, { version: VER_B, section: "cause" });
  const owner = createInterpretationOwner();
  const group = reversible(owner, db);
  const failing = recordingTx("20", 1);
  const refused = owner.restore(failing.tx, group, {
    source_seqs: group.source_seqs,
    comparison: group.comparison as never,
    prepared_ref: null,
  });
  assertEquals(!refused.ok && refused.error.code, "conflict");
});
