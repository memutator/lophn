import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  CONTEXT_EVENTS,
  contextArchive,
  contextRemoveItem,
  contextSetItem,
  contextUnarchive,
  contextUpdate,
  TERM_EVENTS,
  termArchive,
  termUnarchive,
  termUpdate,
} from "../../contracts/documents/mod.ts";
import type { SqlParams, SqlRow, Tx } from "../../contracts/platform/mod.ts";
import { buildGroups, type RevertGroup, type RevertOwner } from "./model.ts";
import { revertSchemaSteps } from "./schema.ts";
import { CONTEXT_REVERT_OWNER, createContextOwner } from "./context-owner.ts";
import { createTermOwner, TERM_REVERT_OWNER } from "./term-owner.ts";
import { defaultRevertOwners } from "./owners.ts";

// context·term 변경의 복원 판정과 보상 열. run의 event만으로 분류하고(이 leaf는 context·term 표를 읽지
// 않는다) 복원은 documents가 dispatchable로 선언한 command를 같은 Tx에서 부르는지 본다. 실제 core·
// documents에서 run의 변경이 복원되는 것은 apps/core/context-revert_test.ts가 본다.

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const RUN = id("run", 1);
const ASG = id("asg", 1);
const CTX = id("ctx", 1);
const CTX_B = id("ctx", 2);
const TRM = id("trm", 1);
const DOC_A = id("doc", 1);
const DOC_B = id("doc", 2);
const VER_A = id("ver", 1);
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

const OUTSIDE = { actor: "user", run: null } as const;

function target(document: string, section: string | null = null) {
  return { kind: "document", document, section };
}

function entry(
  document: string,
  perspective = "basis",
  reason = "근거다",
  section: string | null = null,
) {
  return { target: target(document, section), perspective, reason };
}

function groupsOf(
  db: DatabaseSync,
  owners: RevertOwner[] = defaultRevertOwners(),
) {
  return buildGroups(lookupOf(db), RUN, owners);
}
const contextGroups = (db: DatabaseSync) =>
  groupsOf(db).filter((group) => group.owner === CONTEXT_REVERT_OWNER);
const termGroups = (db: DatabaseSync) =>
  groupsOf(db).filter((group) => group.owner === TERM_REVERT_OWNER);

function createdContext(db: DatabaseSync, context = CTX, over = {}) {
  return emit(db, "ContextCreated", context, {
    title: "알파",
    purpose: "목적",
    items: [],
    ...over,
  });
}

function evidenceOf(version = VER_A) {
  return [{
    document: DOC_A,
    version,
    section: "intro",
    start_line: null,
    end_line: null,
  }];
}

Deno.test("lophn-agent/revert#R3: 이름·목적·항목·보관 변경은 event가 남긴 이전 값을 거꾸로 되돌리는 열 하나로 분류되고 기준 revision과 열이 복원 기준에 실린다", () => {
  const db = open();
  // run 밖에서 만든 context(revision 10)를 run이 여섯 번 바꿨다.
  const base = createdContext(db, CTX, {});
  db.prepare("update events set run = null, actor = 'user' where seq = ?")
    .run(Number(base));
  const title = emit(db, "ContextUpdated", CTX, {
    before: { title: "알파" },
    after: { title: "알파 설계" },
    before_revision: base,
  });
  const purpose = emit(db, "ContextUpdated", CTX, {
    before: { purpose: "목적" },
    after: { purpose: "새 목적" },
    before_revision: title,
  });
  const added = emit(db, "ContextItemSet", CTX, {
    target: target(DOC_A),
    before_item: null,
    item: entry(DOC_A),
    before_position: null,
    position: 0,
    before_revision: purpose,
  });
  const changed = emit(db, "ContextItemSet", CTX, {
    target: target(DOC_A),
    before_item: entry(DOC_A),
    item: entry(DOC_A, "watch", "변화만 본다"),
    before_position: 0,
    position: 0,
    before_revision: added,
  });
  const removed = emit(db, "ContextItemRemoved", CTX, {
    target: target(DOC_A),
    before_item: entry(DOC_A, "watch", "변화만 본다"),
    before_position: 0,
    before_revision: changed,
  });
  const archived = emit(db, "ContextArchived", CTX, {
    before_revision: removed,
  });
  const [group] = contextGroups(db);
  assertEquals(contextGroups(db).length, 1);
  assertEquals(group.capability, "reversible");
  assertEquals(group.reason, null);
  assertEquals(group.target, CTX);
  assertEquals(group.source_seqs, [
    title,
    purpose,
    added,
    changed,
    removed,
    archived,
  ]);
  assertEquals(group.comparison, {
    kind: "context",
    context: CTX,
    base_revision: archived,
    // 나중 변경부터 거꾸로: 보관 해제, 제거한 항목을 그 자리에 복원, 항목을 이전 관점으로, 새로 넣은
    // 항목 제거, 목적과 이름을 이전 값으로.
    steps: [
      { op: "unarchive" },
      {
        op: "set_item",
        item: entry(DOC_A, "watch", "변화만 본다"),
        position: 0,
      },
      { op: "set_item", item: entry(DOC_A) },
      { op: "remove_item", target: target(DOC_A) },
      { op: "update", purpose: "목적" },
      { op: "update", title: "알파" },
    ],
  });
  assertEquals(group.before_ref, {
    kind: "context_state",
    context: CTX,
    revision: base,
  });
  assertEquals(group.dependencies, []);
});

Deno.test("lophn-agent/revert#R5: run이 만든 context는 삭제가 아니라 보관으로 되돌리고 이미 보관했으면 되돌릴 일이 없다", () => {
  const db = open();
  const first = createdContext(db, CTX);
  const item = emit(db, "ContextItemSet", CTX, {
    target: target(DOC_A),
    before_item: null,
    item: entry(DOC_A),
    before_position: null,
    position: 0,
    before_revision: first,
  });
  const [made] = contextGroups(db);
  assertEquals(made.capability, "reversible");
  assertEquals(made.source_seqs, [first, item]);
  assertEquals(made.comparison, {
    kind: "context",
    context: CTX,
    base_revision: item,
    steps: [{ op: "archive" }],
  });
  assertEquals(made.before_ref, { kind: "created_context", context: CTX });
  // 만들고 곧 보관한 context는 이미 보관 상태라 열이 비어 있다.
  const gone = createdContext(db, CTX_B);
  emit(db, "ContextArchived", CTX_B, { before_revision: gone });
  const second = contextGroups(db).find((group) => group.target === CTX_B)!;
  assertEquals(second.capability, "reversible");
  assertEquals((second.comparison as { steps: unknown[] }).steps, []);
  // 보관한 뒤 해제했으면 다시 보관한다.
  const reopened = open();
  const c = createdContext(reopened, CTX);
  const a = emit(reopened, "ContextArchived", CTX, { before_revision: c });
  emit(reopened, "ContextUnarchived", CTX, { before_revision: a });
  assertEquals(
    (contextGroups(reopened)[0].comparison as { steps: unknown[] }).steps,
    [{ op: "archive" }],
  );
});

Deno.test("lophn-agent/revert#R4: run 뒤에 끼거나 이어진 다른 주체의 context 변경은 값이 같아도 충돌이고 감시 변화 기록은 막지 않는다", () => {
  const db = open();
  const base = createdContext(db, CTX);
  db.prepare("update events set run = null, actor = 'user' where seq = ?")
    .run(Number(base));
  const mine = emit(db, "ContextUpdated", CTX, {
    before: { title: "알파" },
    after: { title: "베타" },
    before_revision: base,
  });
  // 감시 변화 기록은 구성이 아니라서 복원을 막지 않는다.
  emit(
    db,
    "ContextWatchedItemChanged",
    CTX,
    {
      target: target(DOC_A),
      before_version: null,
      after_version: VER_A,
      source_seq: "1",
      change_kind: "content_changed",
    },
    { actor: "machine", run: null },
  );
  assertEquals(contextGroups(db)[0].capability, "reversible");
  // 사람이 같은 값으로 다시 바꿔도 충돌이다.
  const later = emit(db, "ContextUpdated", CTX, {
    before: { title: "베타" },
    after: { title: "알파" },
    before_revision: mine,
  }, OUTSIDE);
  const [group] = contextGroups(db);
  assertEquals(group.capability, "conflict");
  assertEquals(group.reason, "later_change");
  assertEquals(group.source_seqs, [mine]);
  assertEquals(group.source_seqs.includes(later), false);
  assertEquals(group.comparison, {
    kind: "context",
    context: CTX,
    base_revision: later,
  });
  // run의 두 변경 사이에 끼어든 변경도 충돌이다.
  const mid = open();
  const first = emit(mid, "ContextUpdated", CTX, {
    before: { title: "a" },
    after: { title: "b" },
    before_revision: "1",
  });
  emit(mid, "ContextItemRemoved", CTX, {
    target: target(DOC_A),
    before_item: entry(DOC_A),
    before_position: 0,
    before_revision: first,
  }, OUTSIDE);
  emit(mid, "ContextArchived", CTX, { before_revision: first });
  const [middle] = contextGroups(mid);
  assertEquals(middle.capability, "conflict");
  assertEquals(middle.source_seqs[0], first);
});

Deno.test("lophn-agent/revert#R9: agent가 낸 변경이 아니거나 이전 값을 풀 수 없는 context·용어 변경은 이유와 함께 복원 불가로 남고 목록에서 빠지지 않는다", () => {
  const db = open();
  // agent가 아닌 주체가 run 이름으로 남긴 변경은 이 owner가 복원하지 않는다.
  const human = emit(db, "ContextArchived", CTX, { before_revision: "1" }, {
    actor: "user",
  });
  assertEquals(contextGroups(db)[0].reason, "not_agent_output");
  assertEquals(contextGroups(db)[0].capability, "irreversible");
  assertEquals(contextGroups(db)[0].source_seqs, [human]);
  // 항목 이전 값을 읽을 수 없는 event는 분류되지 않은 복원 불가다.
  const broken = open();
  emit(broken, "ContextItemSet", CTX, { target: target(DOC_A) });
  assertEquals(contextGroups(broken)[0].reason, "unclassified_event");
  // 사람이 정의한 용어는 복원 대상이 아니다. 정의가 낀 수정과 blob 참조로만 남은 근거도 풀 수 없다.
  const terms = open();
  const defined = emit(terms, "TermDefined", TRM, {
    context: CTX,
    name: "정산",
    before_definition: null,
    definition: "매월 정산",
    before_revision: null,
  }, { actor: "user" });
  const [people] = termGroups(terms);
  assertEquals(people.capability, "irreversible");
  assertEquals(people.reason, "not_agent_output");
  assertEquals(people.source_seqs, [defined]);
  const withDefinition = open();
  emit(withDefinition, "TermUpdated", TRM, {
    before: { definition: "a" },
    after: { definition: "b" },
    before_revision: "1",
  });
  assertEquals(termGroups(withDefinition)[0].reason, "unclassified_event");
  const blobEvidence = open();
  emit(blobEvidence, "TermUpdated", TRM, {
    before: { evidence: { hash: "a".repeat(64), size_bytes: 99999 } },
    after: { evidence: evidenceOf() },
    before_revision: "1",
  });
  assertEquals(termGroups(blobEvidence)[0].capability, "irreversible");
  assertEquals(termGroups(blobEvidence)[0].reason, "unclassified_event");
  // context와 term event type은 모두 이 owner들이 맡는다. 맡지 않은 event로 새지 않는다.
  const all = open();
  for (const definition of [...CONTEXT_EVENTS, ...TERM_EVENTS]) {
    emit(
      all,
      definition.type,
      definition.type.startsWith("Term") ? TRM : CTX,
      {},
    );
  }
  const owners = new Set(groupsOf(all).map((group) => group.owner));
  assertEquals([...owners].sort(), [CONTEXT_REVERT_OWNER, TERM_REVERT_OWNER]);
  const covered = groupsOf(all).flatMap((group) => group.source_seqs);
  assertEquals(
    covered.length,
    CONTEXT_EVENTS.length + TERM_EVENTS.length,
  );
});

Deno.test("lophn-agent/revert#R5: 용어 후보 제안은 보관으로, 이름·근거 수정은 이전 값으로, 보관과 해제는 반대로 되돌리고 정의는 건드리지 않는다", () => {
  const db = open();
  const proposed = emit(db, "TermProposed", TRM, {
    context: CTX,
    name: "정산 주기",
    evidence: evidenceOf(),
  });
  const renamed = emit(db, "TermUpdated", TRM, {
    before: { name: "정산 주기" },
    after: { name: "정산 주기(월)" },
    before_revision: proposed,
  });
  const [made] = termGroups(db);
  assertEquals(made.capability, "reversible");
  assertEquals(made.source_seqs, [proposed, renamed]);
  assertEquals(made.comparison, {
    kind: "term",
    term: TRM,
    base_revision: renamed,
    steps: [{ op: "archive" }],
  });
  assertEquals(made.before_ref, { kind: "proposed_term", term: TRM });
  // 이미 있던 후보를 run이 고치고 보관한 뒤 해제했다.
  const existing = open();
  const base = emit(existing, "TermProposed", TRM, {
    context: CTX,
    name: "a",
    evidence: evidenceOf(),
  }, { actor: "user", run: null });
  const updated = emit(existing, "TermUpdated", TRM, {
    before: { name: "a", evidence: evidenceOf() },
    after: { name: "b", evidence: evidenceOf(id("ver", 7)) },
    before_revision: base,
  });
  const archived = emit(existing, "TermArchived", TRM, {
    context: CTX,
    before_revision: updated,
  });
  const unarchived = emit(existing, "TermUnarchived", TRM, {
    context: CTX,
    before_revision: archived,
  });
  const [group] = termGroups(existing);
  assertEquals(group.capability, "reversible");
  assertEquals(group.comparison, {
    kind: "term",
    term: TRM,
    base_revision: unarchived,
    steps: [
      { op: "archive" },
      { op: "unarchive" },
      { op: "update", name: "a", evidence: evidenceOf() },
    ],
  });
  // 사람이 그 뒤 정의하면 충돌이다. 정의를 지우거나 덮어쓰는 길은 없다.
  const defined = emit(existing, "TermDefined", TRM, {
    context: CTX,
    name: "b",
    before_definition: null,
    definition: "사람의 뜻",
    before_revision: unarchived,
  }, OUTSIDE);
  const [conflict] = termGroups(existing);
  assertEquals(conflict.capability, "conflict");
  assertEquals(conflict.reason, "later_change");
  assertEquals(conflict.comparison, {
    kind: "term",
    term: TRM,
    base_revision: defined,
  });
});

// 복원 호출을 기록하는 Tx다. 호출마다 revision이 하나씩 늘어난다.
function recordingTx(failAt: number | null = null) {
  const calls: { route: string; input: unknown; compare: unknown }[] = [];
  const tx = {
    call(
      route: { name: string },
      input: unknown,
      compare: unknown,
    ): Result<unknown> {
      calls.push({ route: route.name, input, compare });
      if (failAt === calls.length) {
        return err({ code: "conflict", message: "revision changed" });
      }
      return ok({ revision: String(100 + calls.length) });
    },
  } as unknown as Tx;
  return { tx, calls };
}

function reversible(
  owner: RevertOwner,
  db: DatabaseSync,
): RevertGroup {
  const [group] = buildGroups(lookupOf(db), RUN, [owner]);
  assertEquals(group.capability, "reversible");
  return group;
}

Deno.test("lophn-agent/revert#R5: context 복원은 열을 같은 Tx의 owner command로 차례로 부르고 매번 직전 호출이 돌려준 revision을 기준으로 한다", () => {
  const db = open();
  const base = createdContext(db, CTX);
  db.prepare("update events set run = null, actor = 'user' where seq = ?")
    .run(Number(base));
  const title = emit(db, "ContextUpdated", CTX, {
    before: { title: "알파" },
    after: { title: "베타" },
    before_revision: base,
  });
  const added = emit(db, "ContextItemSet", CTX, {
    target: target(DOC_B, "intro"),
    before_item: null,
    item: entry(DOC_B, "reference", "배경", "intro"),
    before_position: null,
    position: 0,
    before_revision: title,
  });
  const archived = emit(db, "ContextArchived", CTX, {
    before_revision: added,
  });
  const owner = createContextOwner();
  const group = reversible(owner, db);
  const { tx, calls } = recordingTx();
  const done = owner.restore(tx, group, {
    source_seqs: group.source_seqs,
    comparison: group.comparison as never,
    prepared_ref: null,
  });
  assert(done.ok);
  assertEquals(calls, [
    {
      route: contextUnarchive.name,
      input: { context: CTX },
      compare: { base_revision: archived },
    },
    {
      route: contextRemoveItem.name,
      input: { context: CTX, target: target(DOC_B, "intro") },
      compare: { base_revision: "101" },
    },
    {
      route: contextUpdate.name,
      input: { context: CTX, title: "알파" },
      compare: { base_revision: "102" },
    },
  ]);
  assert(contextArchive !== undefined && contextSetItem !== undefined);
  // 한 호출이 거절하면 그 오류로 끝나 나머지는 부르지 않는다(transaction 전체가 취소된다).
  const failing = recordingTx(2);
  const refused = owner.restore(failing.tx, group, {
    source_seqs: group.source_seqs,
    comparison: group.comparison as never,
    prepared_ref: null,
  });
  assertEquals(!refused.ok && refused.error.code, "conflict");
  assertEquals(failing.calls.length, 2);
  // 보관으로 되돌리는 묶음은 archive 하나이고 항목 복원은 위치까지 보낸다.
  const made = open();
  const created = createdContext(made, CTX);
  const archiving = reversible(owner, made);
  const one = recordingTx();
  assert(
    owner.restore(one.tx, archiving, {
      source_seqs: archiving.source_seqs,
      comparison: archiving.comparison as never,
      prepared_ref: null,
    }).ok,
  );
  assertEquals(one.calls, [{
    route: contextArchive.name,
    input: { context: CTX },
    compare: { base_revision: created },
  }]);
  const removedItem = open();
  const seed = emit(removedItem, "ContextItemRemoved", CTX, {
    target: target(DOC_A),
    before_item: entry(DOC_A),
    before_position: 2,
    before_revision: "1",
  });
  const restoring = reversible(owner, removedItem);
  const item = recordingTx();
  assert(
    owner.restore(item.tx, restoring, {
      source_seqs: restoring.source_seqs,
      comparison: restoring.comparison as never,
      prepared_ref: null,
    }).ok,
  );
  assertEquals(item.calls, [{
    route: contextSetItem.name,
    input: { context: CTX, item: entry(DOC_A), position: 2 },
    compare: { base_revision: seed },
  }]);
});

Deno.test("lophn-agent/revert#R5: 용어 후보 복원은 term.archive·update·unarchive만 부르고 term.define은 부르지 않는다", () => {
  const db = open();
  const base = emit(db, "TermProposed", TRM, {
    context: CTX,
    name: "a",
    evidence: evidenceOf(),
  }, { actor: "user", run: null });
  const updated = emit(db, "TermUpdated", TRM, {
    before: { name: "a" },
    after: { name: "b" },
    before_revision: base,
  });
  const archived = emit(db, "TermArchived", TRM, {
    context: CTX,
    before_revision: updated,
  });
  const owner = createTermOwner();
  const group = reversible(owner, db);
  const { tx, calls } = recordingTx();
  assert(
    owner.restore(tx, group, {
      source_seqs: group.source_seqs,
      comparison: group.comparison as never,
      prepared_ref: null,
    }).ok,
  );
  assertEquals(calls, [
    {
      route: termUnarchive.name,
      input: { term: TRM },
      compare: { base_revision: archived },
    },
    {
      route: termUpdate.name,
      input: { term: TRM, name: "a" },
      compare: { base_revision: "101" },
    },
  ]);
  assertEquals(calls.some((call) => call.route === "term.define"), false);
  // 제안을 되돌리면 archive 하나다.
  const proposed = open();
  const first = emit(proposed, "TermProposed", TRM, {
    context: CTX,
    name: "a",
    evidence: evidenceOf(),
  });
  const made = reversible(owner, proposed);
  const archiving = recordingTx();
  assert(
    owner.restore(archiving.tx, made, {
      source_seqs: made.source_seqs,
      comparison: made.comparison as never,
      prepared_ref: null,
    }).ok,
  );
  assertEquals(archiving.calls, [{
    route: termArchive.name,
    input: { term: TRM },
    compare: { base_revision: first },
  }]);
  // 비교 기준이 없는 묶음은 복원하지 않는다.
  const empty = recordingTx();
  const rejected = owner.restore(empty.tx, { ...made, comparison: null }, {
    source_seqs: made.source_seqs,
    comparison: {},
    prepared_ref: null,
  });
  assertEquals(rejected.ok, false);
  assertEquals(empty.calls.length, 0);
});
