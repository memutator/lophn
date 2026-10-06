import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  revertList,
  revertPreview,
  revertRun,
} from "../../contracts/lophn-agent/mod.ts";
import type {
  RequestContext,
  SqlParams,
  SqlRow,
} from "../../contracts/platform/mod.ts";
import { createAuditOwners } from "./audit-owners.ts";
import {
  bindingHash,
  buildGroups,
  decide,
  hashOf,
  matchInput,
  reasonOf,
  REVERT_REASON_CODES,
  REVERT_REASONS,
  type RevertGroup,
  type RevertOwner,
} from "./model.ts";
import { createDocumentsOwner } from "./documents-owner.ts";
import { defaultRevertOwners } from "./owners.ts";
import { createRevertReads } from "./reads.ts";
import { revertSchemaSteps } from "./schema.ts";
import { buildRevertInput } from "./work.ts";

// 순수 분류 규칙과 읽기 권한을 본다. 전체 사전 검사와 원자 적용은
// apps/core/testing/lophn-agent-revert_test.ts, 실제 core·documents와 복원 결과는
// apps/core/revert_test.ts가 본다.

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const RUN = id("run", 1);
const OTHER_RUN = id("run", 2);
const ASG = id("asg", 1);
const OTHER_ASG = id("asg", 2);
const DOC = id("doc", 1);
const DOC_B = id("doc", 2);
const VER_1 = id("ver", 1);
const VER_2 = id("ver", 2);
const VER_3 = id("ver", 3);
const AGENT = `agent:${ASG}`;
const HASH = "a".repeat(64);

function open(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    pragma foreign_keys = on;
    create table events (
      seq integer primary key autoincrement,
      type text not null, subject text, actor text not null, run text,
      payload text not null, at text not null default ''
    );
    create table runs (id text primary key, assignment text, state text);
  `);
  for (const step of revertSchemaSteps) db.exec(step.sql);
  db.prepare("insert into runs values (?, ?, 'finished')").run(RUN, ASG);
  db.prepare("insert into runs values (?, ?, 'finished')").run(
    OTHER_RUN,
    OTHER_ASG,
  );
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

function snapshotOf(db: DatabaseSync) {
  return {
    ...lookupOf(db),
    as_of_seq: "99",
    port: () => {
      throw new Error("no ports in this fixture");
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

const FORMAT = {
  name: "document",
  module_hash: HASH,
  explicit: false,
};

function created(db: DatabaseSync, doc = DOC, over = {}) {
  return emit(db, "DocumentCreated", doc, {
    place: null,
    name: null,
    title: "문서",
    file_source: null,
    version: VER_1,
    ...over,
  });
}

function saved(
  db: DatabaseSync,
  version: string,
  previous: string | null,
  doc = DOC,
  options: { actor?: string; run?: string | null } = {},
) {
  return emit(db, "DocumentSaved", doc, {
    version,
    previous_version: previous,
    content_hash: HASH,
    format: FORMAT,
    source: null,
  }, options);
}

function groupsOf(db: DatabaseSync, owners = defaultRevertOwners()) {
  return buildGroups(lookupOf(db), RUN, owners);
}

function docGroups(db: DatabaseSync) {
  return groupsOf(db).filter((group) => group.owner === "documents/versions");
}

Deno.test("lophn-agent/revert#R5: run이 만든 문서는 보관으로, 고친 문서는 이전 판으로의 복원으로 분류하고 연속한 변경은 한 묶음이다", () => {
  const db = open();
  const createdSeq = created(db, DOC_B);
  // 이미 있던 문서(DOC)를 run이 두 번 고쳤다: 시작 전 판(VER_1)으로 돌아가는 한 묶음이다.
  saved(db, VER_2, VER_1);
  const lastSave = saved(db, VER_3, VER_2);
  const groups = docGroups(db);
  assertEquals(groups.length, 2);
  const archive = groups.find((group) => group.target === DOC_B)!;
  assertEquals(archive.capability, "reversible");
  assertEquals(archive.source_seqs, [createdSeq]);
  assertEquals(archive.comparison, {
    kind: "archive",
    document: DOC_B,
    base_revision: createdSeq,
  });
  const restore = groups.find((group) => group.target === DOC)!;
  assertEquals(restore.capability, "reversible");
  assertEquals(restore.source_seqs.length, 2);
  assertEquals(restore.comparison, {
    kind: "restore",
    document: DOC,
    base_version: VER_3,
    // 문서 revision은 내용 저장이 아니라 만들기·제목·보관·자리 변경의 seq다. 이 문서의 그런
    // event는 없으므로 기준은 처음 값이고, 중간 판(VER_2) 하나를 고르지 않고 시작 전 판으로 간다.
    base_revision: "0",
    restore_version: VER_1,
  });
  assert(lastSave !== undefined);
  assert(restore.before_ref !== null);
});

Deno.test("lophn-agent/revert#R5: 문서 revision 기준은 마지막 metadata 변경 seq이고 복원은 이전 판을 가리킨다", () => {
  const db = open();
  // run 밖에서 문서가 만들어진 뒤 run이 새 판을 저장했다.
  const base = created(db, DOC, { version: VER_1 });
  db.prepare(
    "update events set run = null, actor = 'coding_agent:cac_x' where seq = ?",
  )
    .run(Number(base));
  saved(db, VER_2, VER_1);
  const [restore] = docGroups(db);
  assertEquals(restore.capability, "reversible");
  assertEquals(restore.comparison, {
    kind: "restore",
    document: DOC,
    base_version: VER_2,
    base_revision: base,
    restore_version: VER_1,
  });
  assertEquals(restore.before_ref, {
    kind: "version",
    document: DOC,
    version: VER_1,
  });
});

Deno.test("lophn-agent/revert#R4: run 뒤에 끼거나 이어진 다른 주체의 변경은 값이 같아도 충돌이다", () => {
  const db = open();
  saved(db, VER_2, VER_1);
  // 같은 판을 사람이 다시 저장해 값이 우연히 같아도 충돌이다.
  const later = saved(db, VER_3, VER_2, DOC, {
    actor: "user",
    run: null,
  });
  const [group] = docGroups(db);
  assertEquals(group.capability, "conflict");
  assertEquals(group.reason_blob, REVERT_REASONS.later_change);
  assert(group.comparison !== null);
  assertEquals(group.source_seqs.includes(later), false);
  // 끼어든 변경도 같다.
  const mid = open();
  const first = saved(mid, VER_2, VER_1);
  saved(mid, VER_3, VER_2, DOC, { actor: "user", run: null });
  emit(mid, "DocumentUpdated", DOC, {
    before_title: "a",
    title: "b",
    before_revision: "1",
  });
  const [middle] = docGroups(mid);
  assertEquals(middle.capability, "conflict");
  assertEquals(middle.source_seqs[0], first);
});

Deno.test("lophn-agent/revert#R9: 소유 concern이 복원할 수 없다고 본 변경은 이유와 함께 복원 불가로 남고 목록에서 빠지지 않는다", () => {
  const db = open();
  // 제목 변경은 사람 자격으로 부를 수 없는 보상 값이라 남는 변경이다. 내용 변경과 따로 설명한다.
  saved(db, VER_2, VER_1);
  emit(db, "DocumentUpdated", DOC, {
    before_title: "a",
    title: "b",
    before_revision: "1",
  });
  const mixed = docGroups(db);
  assertEquals(mixed.map((group) => group.capability), [
    "reversible",
    "irreversible",
  ]);
  assertEquals(mixed[1].reason_blob, REVERT_REASONS.title_change);
  // 이전 판이 없는 저장(첫 판)은 되돌릴 기준이 없다.
  const first = open();
  saved(first, VER_1, null);
  assertEquals(
    docGroups(first)[0].reason_blob,
    REVERT_REASONS.no_previous_version,
  );
  // agent가 낸 변경이 아니면 보상 대상이 아니다.
  const human = open();
  saved(human, VER_2, VER_1, DOC, { actor: "user" });
  assertEquals(
    docGroups(human)[0].reason_blob,
    REVERT_REASONS.not_agent_output,
  );
  // 원본 연결 문서는 디스크 원본이 걸려 있어 보관하지 않는다.
  const linked = open();
  created(linked, DOC, {
    file_source: { kind: "project_file", project: id("prj", 1), path: "a.md" },
  });
  assertEquals(
    docGroups(linked)[0].reason_blob,
    REVERT_REASONS.linked_document,
  );
  // run이 할 수 없는 문서 event(자리 이동)는 안전하다고 가정하지 않는다.
  const moved = open();
  emit(moved, "DocumentMoved", DOC, {
    before_place: null,
    before_name: null,
    place: null,
    name: null,
    before_revision: "1",
  });
  assertEquals(
    docGroups(moved)[0].reason_blob,
    REVERT_REASONS.unclassified_document_event,
  );
});

Deno.test("lophn-agent/revert#R9: 분류되지 않은 event와 owner가 빠뜨린 event도 복원 불가로 목록에 남고 한 묶음에만 속한다", () => {
  const db = open();
  emit(db, "StrangerHappened", id("trm", 1), {});
  emit(db, "SomethingElseHappened", null, {});
  created(db, DOC_B);
  saved(db, VER_2, VER_1);
  // 아무 event도 맡지 않는 owner만 있어도 모든 event가 복원 불가로 설명된다.
  const none: RevertOwner = {
    concern: "fixture/none",
    claims: () => false,
    classify: () => [],
    restore: () => {
      throw new Error("never");
    },
  };
  const groups = groupsOf(db, [none]);
  assert(groups.every((group) => group.capability === "irreversible"));
  assert(groups.every((group) => group.owner === "unclassified"));
  // 목록은 이 run의 event 전체를 겹치지 않고 빠짐없이 덮는다.
  const covered = groups.flatMap((group) => group.source_seqs);
  assertEquals(new Set(covered).size, covered.length);
  assertEquals(covered.length, 4);
  // owner가 일부 event를 빠뜨려도 마찬가지다.
  const lazy: RevertOwner = {
    concern: "fixture/lazy",
    claims: (type) => type === "DocumentSaved" || type === "DocumentCreated",
    classify: ({ events }) => [{
      owner: "fixture/lazy",
      target: null,
      source_seqs: [events[0].seq],
      capability: "reversible",
      reason: null,
      comparison: {},
      before_ref: {},
      dependencies: [],
    }],
    restore: () => {
      throw new Error("never");
    },
  };
  const partial = groupsOf(db, [lazy]);
  assertEquals(partial.flatMap((group) => group.source_seqs).length, 4);
  assertEquals(
    partial.filter((group) => group.owner === "fixture/lazy").length,
    1,
  );
});

Deno.test("lophn-agent/revert#R6: run·tool call·model call·질문·승인 같은 과거 사실은 모두 유지하는 사실이고 복원 command가 없다", () => {
  const db = open();
  for (
    const [type, subject] of [
      ["RunStarted", RUN],
      ["ToolCallStarted", id("tcl", 1)],
      ["ToolCallFinished", id("tcl", 1)],
      ["ModelCallFinished", id("mcl", 1)],
      ["QuestionAnswered", id("qst", 1)],
      ["ApprovalRequestGranted", id("apr", 1)],
      ["MessageRecorded", id("msg", 1)],
    ] as const
  ) emit(db, type, subject, {});
  const groups = groupsOf(db);
  // tool call 두 event는 같은 대상의 한 묶음이다.
  assertEquals(groups.length, 6);
  for (const group of groups) {
    assertEquals(group.capability, "retained", group.owner);
    assertEquals(group.reason_blob, REVERT_REASONS.audit_fact);
    assertEquals(group.comparison, null);
  }
  const owners = new Set(groups.map((group) => group.owner));
  assert(owners.has("lophn-agent/harness/tools"));
  assert(owners.has("lophn-agent/harness/usage"));
  assert(owners.has("platform/approvals"));
  for (const owner of createAuditOwners()) {
    assertEquals(
      owner.restore({} as never, {} as never, {} as never).ok,
      false,
    );
  }
});

function group(over: Partial<RevertGroup>): RevertGroup {
  return {
    ordinal: 0,
    owner: "fixture",
    target: DOC,
    source_seqs: ["1"],
    capability: "reversible",
    reason_blob: null,
    comparison: { kind: "x" },
    before_ref: {},
    dependencies: [],
    app_revert: null,
    ...over,
  };
}

Deno.test("lophn-agent/revert#R7: 충돌 하나, 동의 없는 복원 불가, 의존 위반, 준비 불충족은 어떤 변경도 시작하지 않는다", () => {
  const ready = new Map<number, null>();
  const reversible = group({ ordinal: 0 });
  const retained = group({
    ordinal: 1,
    capability: "retained",
    reason_blob: REVERT_REASONS.audit_fact,
    comparison: null,
    before_ref: null,
  });
  const irreversible = group({
    ordinal: 2,
    target: id("doc", 9),
    capability: "irreversible",
    reason_blob: REVERT_REASONS.external_effect,
    comparison: null,
    before_ref: null,
  });
  const conflict = group({
    ordinal: 3,
    capability: "conflict",
    reason_blob: REVERT_REASONS.later_change,
    before_ref: null,
  });
  // 유지하는 사실만 있는 것은 부분 복원이 아니다.
  assertEquals(decide([reversible, retained], false, ready), { kind: "apply" });
  assertEquals(decide([reversible, irreversible], false, ready), {
    kind: "blocked",
    reason: "blocked_irreversible",
  });
  assertEquals(decide([reversible, irreversible], true, ready), {
    kind: "apply",
  });
  // 동의는 충돌을 덮어쓰는 허락이 아니다.
  assertEquals(decide([reversible, conflict], true, ready), {
    kind: "blocked",
    reason: "blocked_conflict",
  });
  assertEquals(
    decide(
      [
        group({
          dependencies: [{
            owner: irreversible.owner,
            target: irreversible.target as string,
            comparison: {},
          }],
        }),
        irreversible,
      ],
      true,
      ready,
    ),
    { kind: "blocked", reason: "blocked_dependency" },
  );
  assertEquals(
    decide(
      [reversible],
      false,
      new Map([[0, "blocked_not_prepared" as const]]),
    ),
    { kind: "blocked", reason: "blocked_not_prepared" },
  );
});

Deno.test("lophn-agent/revert#R4: 사람이 본 내용 지문은 묶음·기준·분류 중 하나라도 달라지면 달라지고 준비 결과는 지문에 들지 않는다", () => {
  const base = [group({})];
  const hash = bindingHash(RUN, base);
  assertEquals(bindingHash(RUN, [group({})]), hash);
  for (
    const changed of [
      group({ source_seqs: ["1", "2"] }),
      group({ comparison: { kind: "y" } }),
      group({
        capability: "conflict",
        reason_blob: REVERT_REASONS.later_change,
      }),
      group({ target: id("doc", 3) }),
      group({ before_ref: { other: true } }),
    ]
  ) {
    assert(bindingHash(RUN, [changed]) !== hash);
  }
  assert(bindingHash(OTHER_RUN, base) !== hash);
  // 입력의 묶음은 현재 판정의 묶음 전체와 같은 기준이어야 하고 준비 결과는 기준이 아니다.
  const withPrepared = [{
    source_seqs: ["1"],
    comparison: { kind: "x", prepared: { any: 1 } },
    prepared_ref: hashOf({ any: 1 }),
  }];
  assert(matchInput(base, withPrepared).ok);
  assert(!matchInput(base, []).ok);
  assert(
    !matchInput(base, [{
      source_seqs: ["1"],
      comparison: { kind: "z" },
      prepared_ref: null,
    }]).ok,
  );
  assert(
    !matchInput(base, [
      withPrepared[0],
      { source_seqs: ["1"], comparison: {}, prepared_ref: null },
    ]).ok,
  );
});

Deno.test("lophn-agent/revert#R9: 준비 결과는 복원 가능한 묶음에만 붙고 준비하지 못한 묶음은 그대로 둔다", async () => {
  const reversible = group({ ordinal: 0, source_seqs: ["1"] });
  const retained = group({
    ordinal: 1,
    source_seqs: ["2"],
    capability: "retained",
    reason_blob: REVERT_REASONS.audit_fact,
    comparison: null,
    before_ref: null,
  });
  const calls: number[] = [];
  const built = await buildRevertInput([reversible, retained], (item) => {
    calls.push(item.ordinal);
    return Promise.resolve({ ok: true as const, value: { token: "p" } });
  });
  assert(built.ok);
  assertEquals(calls, [0]);
  assertEquals(built.value[0].prepared_ref, hashOf({ token: "p" }));
  assertEquals(built.value[0].comparison, {
    kind: "x",
    prepared: { token: "p" },
  });
  assertEquals(built.value[1], {
    source_seqs: ["2"],
    comparison: {},
    prepared_ref: null,
  });
  const none = await buildRevertInput(
    [reversible],
    () => Promise.resolve({ ok: true as const, value: null }),
  );
  assert(none.ok);
  assertEquals(none.value[0].prepared_ref, null);
  assert(!("prepared" in none.value[0].comparison));
});

Deno.test("lophn-agent/revert#R9: 문서 owner는 준비 결과가 없거나 다른 문서·기준의 것이면 복원을 시작하지 않는다", () => {
  const owner = createDocumentsOwner();
  const restore = {
    ...group({
      owner: "documents/versions",
      target: DOC,
      comparison: {
        kind: "restore",
        document: DOC,
        base_version: VER_2,
        base_revision: "1",
        restore_version: VER_1,
      },
    }),
  };
  const missing = owner.ready!(restore, {
    source_seqs: ["1"],
    comparison: {},
    prepared_ref: null,
  });
  assert(missing.ok);
  assertEquals(missing.value, "blocked_not_prepared");
  // 준비 결과의 hash가 참조와 다르면 입력이 어긋난 것이다.
  const wrong = owner.ready!(restore, {
    source_seqs: ["1"],
    comparison: { prepared: { x: 1 } },
    prepared_ref: HASH,
  });
  assert(!wrong.ok);
  // 보관은 준비가 필요 없다.
  const archive = owner.ready!(
    group({
      comparison: { kind: "archive", document: DOC, base_revision: "1" },
    }),
    { source_seqs: ["1"], comparison: {}, prepared_ref: null },
  );
  assert(archive.ok && archive.value === null);
});

Deno.test("lophn-agent/revert#R2: revert는 사람만 요청하고 확인 handle이 필요하며 agent는 목록만 읽는다", () => {
  assertEquals([...revertRun.actors], ["user"]);
  assertEquals(revertRun.confirmation, "required");
  for (const read of [revertPreview, revertList]) {
    assert(read.actors.includes("agent"));
    assert(read.actors.includes("user"));
  }
  // 적용 command를 agent tool로 제공하는 길은 이 concern에 없다: command는 한 개이고 user 전용이다.
  assertEquals(REVERT_REASON_CODES.length, new Set(REVERT_REASON_CODES).size);
  for (const code of REVERT_REASON_CODES) {
    assertEquals(reasonOf(REVERT_REASONS[code]), code);
  }
});

function ctxOf(actor: string): RequestContext {
  return {
    actor,
    principal: actor,
    credential_ref: `test:${actor}`,
    scope: { operations: [], targets: {} },
    conditions: {},
  } as RequestContext;
}

Deno.test("lophn-agent/revert#R1: 끝난 run만 미리보고 agent는 자기 assignment의 run만 보며 범위 밖은 없는 run과 같다", () => {
  const db = open();
  const reads = createRevertReads({ owners: defaultRevertOwners() });
  saved(db, VER_2, VER_1);
  const snapshot = snapshotOf(db);
  const preview = (actor: string, run: string) =>
    reads.preview.handle(snapshot as never, ctxOf(actor), { run });
  const own = preview(AGENT, RUN);
  assert(own.ok);
  assertEquals(own.value.groups.length, 1);
  assert(preview("user", RUN).ok);
  assert(preview("machine", RUN).ok);
  // 다른 assignment의 agent와 coding agent·app은 없는 run과 같은 not_found다.
  for (
    const actor of [`agent:${OTHER_ASG}`, "coding_agent:cac_x", "app:app_x"]
  ) {
    const denied = preview(actor, RUN);
    assert(!denied.ok);
    assertEquals(denied.error.code, "not_found");
  }
  const absent = preview(AGENT, id("run", 40));
  assert(!absent.ok);
  assertEquals(absent.error.code, "not_found");
  // 진행 중인 run은 먼저 멈춰야 한다.
  db.prepare("update runs set state = 'waiting_user' where id = ?").run(RUN);
  const waiting = preview("user", RUN);
  assert(!waiting.ok);
  assertEquals(waiting.error.code, "invalid_input");
  const listed = reads.list.handle(
    snapshot as never,
    ctxOf(`agent:${OTHER_ASG}`),
    {},
  );
  assert(listed.ok);
  assertEquals(listed.value.reverts, []);
});

Deno.test("lophn-agent/revert#R8: 최종 결과 행과 원래 event는 고치거나 지울 수 없다", () => {
  const db = open();
  const source = emit(db, "NoteChanged", id("ctx", 1), {});
  const result = emit(db, "RevertApplied", id("rvt", 1), {}, { run: null });
  db.prepare(
    `insert into reverts (id, run, allow_partial, outcome, preview_hash, created_seq, state_seq, result_seq)
     values (?, ?, 0, 'applied', ?, ?, ?, ?)`,
  ).run(
    id("rvt", 1),
    RUN,
    HASH,
    Number(result),
    Number(result),
    Number(result),
  );
  db.prepare(
    `insert into revert_changes (revert, ordinal, owner, target, capability, result, reason_blob, app_revert)
     values (?, 0, 'fixture', null, 'retained', 'retained', ?, null)`,
  ).run(id("rvt", 1), HASH);
  db.prepare(
    "insert into revert_change_sources (revert, ordinal, source_seq) values (?, 0, ?)",
  ).run(id("rvt", 1), Number(source));
  const mustFail = (query: string, ...params: (string | number)[]) => {
    let failed = false;
    try {
      db.prepare(query).run(...params);
    } catch {
      failed = true;
    }
    assert(failed, query);
  };
  mustFail("update reverts set outcome = 'blocked' where id = ?", id("rvt", 1));
  mustFail("delete from reverts where id = ?", id("rvt", 1));
  mustFail(
    "update revert_changes set result = 'unchanged' where revert = ?",
    id("rvt", 1),
  );
  mustFail("delete from revert_changes where revert = ?", id("rvt", 1));
  mustFail("delete from revert_change_sources where revert = ?", id("rvt", 1));
  // 같은 run의 활성 revert는 하나다. blocked는 그렇지 않다.
  mustFail(
    `insert into reverts (id, run, allow_partial, outcome, preview_hash, created_seq, state_seq, result_seq)
     values (?, ?, 0, 'applied', ?, ?, ?, ?)`,
    id("rvt", 2),
    RUN,
    HASH,
    Number(emit(db, "RevertApplied", id("rvt", 2), {}, { run: null })),
    99,
    99,
  );
  // 원래 event는 ledger가 고치지 못하게 막는 표이고 이 leaf는 쓰지 않는다. 한 event는 한 묶음에만 연결된다.
  mustFail(
    "insert into revert_change_sources (revert, ordinal, source_seq) values (?, 0, ?)",
    id("rvt", 1),
    Number(source),
  );
});
