import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  HANDOFF_DIRECTIONS,
  handoffResult,
  handoffStatus,
} from "../../../../protocol/lophn-agent/mod.ts";
import type {
  RequestContext,
  SqlParams,
  SqlRow,
} from "../../../../protocol/server/mod.ts";
import {
  adoptionOf,
  checkReferences,
  directionAllowed,
  HANDOFF_CONTENT_MAX_BYTES,
  handoffBodyFields,
  handoffBodyHash,
  handoffContentBytes,
  humanOrigin,
} from "./mod.ts";
import { createHandoffReads } from "./reads.ts";

// 순수 규칙과 읽기 권한을 본다. SubmitHandoff를 포함한 ledger·core 동작(접수·계보·
// 원자 확정·재전송·거절 억제)은 실제 core로 apps/core/handoff_test.ts가 본다.

const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const VER = "ver_01arz3ndektsv4rrffq69g5fav";
const OTHER_VER = "ver_01arz3ndektsv4rrffq69g5fbw";
const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
const GROUP = "qgr_01arz3ndektsv4rrffq69g5fav";
const SENDER = "run_01arz3ndektsv4rrffq69g5fav";
const RECEIVER = "run_01arz3ndektsv4rrffq69g5fbw";
const ASG_SENDER = "asg_01arz3ndektsv4rrffq69g5fav";
const ASG_RECEIVER = "asg_01arz3ndektsv4rrffq69g5fbw";
const ASG_OTHER = "asg_01arz3ndektsv4rrffq69g5fcx";
const MSG = "msg_01arz3ndektsv4rrffq69g5fav";
const RESULT = "e".repeat(64);
const VERSION = "ver_01arz3ndektsv4rrffq69g5fcx";

const CONTENT = {
  what: "문서 묶음을 정리한다",
  why: "사람이 정리를 요청했다",
  excludes: [],
  expected_outputs: ["정리된 context"],
};

// 시험용 ledger 모양. 이 leaf가 읽는 열만 둔다(실제 표는 core 시험이 본다).
function open(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table assignments (id text primary key, role text, state text, revision integer);
    create table runs (
      id text primary key, assignment text, state text, source text,
      source_kind text, source_sender_run text, source_dedup_key text,
      source_original_message text, result text, accepted_seq integer
    );
    create table question_groups (id text primary key, status text);
    create table questions (
      id text primary key, "group" text, answer text, options text
    );
  `);
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
    as_of_seq: "7",
    port: () => {
      throw new Error("no ports in this fixture");
    },
  };
}

function addAssignment(
  db: DatabaseSync,
  id: string,
  role: string,
  state = "enabled",
) {
  db.prepare("insert into assignments values (?, ?, ?, 1)").run(
    id,
    role,
    state,
  );
}

function addRun(
  db: DatabaseSync,
  run: {
    id: string;
    assignment: string;
    state: string;
    source: Record<string, unknown>;
    result?: string | null;
  },
) {
  const source = run.source;
  db.prepare(
    "insert into runs values (?, ?, ?, ?, ?, ?, ?, ?, ?, 3)",
  ).run(
    run.id,
    run.assignment,
    run.state,
    JSON.stringify(source),
    String(source["kind"]),
    (source["sender_run"] as string | undefined) ?? null,
    (source["dedup_key"] as string | undefined) ?? null,
    (source["original_message"] as string | undefined) ?? null,
    run.result ?? null,
  );
}

function ctxOf(actor: string): RequestContext {
  return {
    actor,
    principal: actor,
    credential_ref: `ref-${actor}`,
    scope: { operations: [], targets: {} },
    conditions: {},
  } as unknown as RequestContext;
}

// 보낸 run(lophn, 사람 요청)과 받는 run(Context Engineer)이 있는 ledger.
function seeded(receiverState = "accepted", result: string | null = null) {
  const db = open();
  addAssignment(db, ASG_SENDER, "lophn");
  addAssignment(db, ASG_RECEIVER, "context_engineer");
  addRun(db, {
    id: SENDER,
    assignment: ASG_SENDER,
    state: "running",
    source: { kind: "message", message: MSG },
  });
  addRun(db, {
    id: RECEIVER,
    assignment: ASG_RECEIVER,
    state: receiverState,
    result,
    source: {
      kind: "handoff",
      sender_run: SENDER,
      original_message: MSG,
      body: handoffBodyHash(CONTENT),
      references: [],
      dedup_key: "key-1",
    },
  });
  return db;
}

Deno.test("lophn-agent/handoff#R1: 허용 방향은 다섯 개뿐이고 Operator는 보내기와 받기가 모두 없다", () => {
  const roles = ["lophn", "app_engineer", "context_engineer", "operator"];
  const allowed = roles.flatMap((from) =>
    roles.filter((to) => directionAllowed(from, to)).map((to) => [from, to])
  );
  assertEquals(allowed, [
    ["lophn", "app_engineer"],
    ["lophn", "context_engineer"],
    ["app_engineer", "lophn"],
    ["app_engineer", "context_engineer"],
    ["context_engineer", "lophn"],
  ]);
  assertEquals(allowed.length, HANDOFF_DIRECTIONS.length);
  assert(!directionAllowed("context_engineer", "app_engineer"));
  for (const role of roles) {
    assert(!directionAllowed("operator", role));
    assert(!directionAllowed(role, "operator"));
  }
});

Deno.test("lophn-agent/handoff#R3: 근거 고정 판이 있어야 하고 질문을 단 근거는 그 판을 채택한 답이어야 하며 App Engineer에게는 채택한 판이 하나 필요하다", () => {
  const db = open();
  const plain = { document: DOC, version: VER, section: null, question: null };
  const asked = { ...plain, question: QUESTION };
  const lookup = lookupOf(db);
  // 근거가 하나도 없으면 시작하지 않는다.
  assertEquals(checkReferences(lookup, "context_engineer", []).ok, false);
  // 질문이 없는 근거는 Context Engineer·lophn에게는 충분하다.
  assert(checkReferences(lookup, "context_engineer", [plain]).ok);
  assert(checkReferences(lookup, "lophn", [plain]).ok);
  // 같은 근거를 두 번 싣지 않는다.
  assertEquals(
    checkReferences(lookup, "lophn", [plain, plain]).ok,
    false,
  );
  // 답이 없는 질문은 채택 근거가 될 수 없다.
  assertEquals(checkReferences(lookup, "lophn", [asked]).ok, false);
  const options = [{
    key: "one",
    adoption: { document: DOC, version: VER, section: null },
  }, { key: "none", adoption: null }];
  db.prepare("insert into question_groups values (?, 'pending')").run(GROUP);
  db.prepare("insert into questions values (?, ?, null, ?)").run(
    QUESTION,
    GROUP,
    JSON.stringify(options),
  );
  assertEquals(adoptionOf(lookup, QUESTION), undefined);
  assertEquals(checkReferences(lookup, "lophn", [asked]).ok, false);
  db.prepare("update question_groups set status = 'answered' where id = ?")
    .run(GROUP);
  db.prepare("update questions set answer = ? where id = ?").run(
    JSON.stringify({ kind: "option", option_key: "one" }),
    QUESTION,
  );
  assertEquals(adoptionOf(lookup, QUESTION), {
    document: DOC,
    version: VER,
    section: null,
  });
  assert(checkReferences(lookup, "app_engineer", [asked]).ok);
  // 다른 판의 채택 답과 최신 주소는 거절한다.
  assertEquals(
    checkReferences(lookup, "lophn", [{ ...asked, version: OTHER_VER }]).ok,
    false,
  );
  // App Engineer에게는 채택한 판이 하나는 있어야 한다.
  assertEquals(checkReferences(lookup, "app_engineer", [plain]).ok, false);
  // 채택하지 않는 선택지를 고른 답은 채택이 아니다.
  db.prepare("update questions set answer = ? where id = ?").run(
    JSON.stringify({ kind: "option", option_key: "none" }),
    QUESTION,
  );
  assertEquals(checkReferences(lookup, "app_engineer", [asked]).ok, false);
});

Deno.test("lophn-agent/handoff#R4: 내용은 정규 직렬화 bytes의 hash 하나로 묶이고 필드 순서에 흔들리지 않으며 영구·일반 읽기 없는 blob이다", () => {
  const reordered = {
    expected_outputs: CONTENT.expected_outputs,
    excludes: CONTENT.excludes,
    why: CONTENT.why,
    what: CONTENT.what,
  };
  assertEquals(handoffBodyHash(reordered), handoffBodyHash(CONTENT));
  assertNotEquals(
    handoffBodyHash({ ...CONTENT, what: "다른 일" }),
    handoffBodyHash(CONTENT),
  );
  assert(handoffContentBytes(CONTENT).length < HANDOFF_CONTENT_MAX_BYTES);
  assertEquals(handoffBodyFields.length, 1);
  const field = handoffBodyFields[0]!;
  assertEquals(field.retention, { kind: "permanent" });
  assertEquals(field.general_read, false);
});

Deno.test("lophn-agent/handoff#R5: 사람 요청과 그 handoff로 이어진 run은 원래 요청이 있다", () => {
  assertEquals(humanOrigin({ kind: "message", message: MSG }), MSG);
  assertEquals(
    humanOrigin({ kind: "handoff", original_message: MSG }),
    MSG,
  );
});

Deno.test("lophn-agent/handoff#R8: 끝난 run의 결과는 문서 고정 version 또는 산출물이 없는 이유 둘 중 하나이고 끝나기 전에는 비어 있다", () => {
  const running = seeded("running");
  const reads = createHandoffReads({ savedVersion: () => VERSION });
  const open = reads.result.handle(
    snapshotOf(running),
    ctxOf("user"),
    { receiver_run: RECEIVER },
  );
  assert(open.ok);
  assertEquals(open.value.finished, false);
  assertEquals(open.value.result, null);
  assertEquals(open.value.version, null);
  assertEquals(open.value.absent_reason, null);
  assert(handoffResult.output.safeParse(open.value).success);

  const done = seeded("finished", RESULT);
  const withVersion = reads.result.handle(
    snapshotOf(done),
    ctxOf("user"),
    { receiver_run: RECEIVER },
  );
  assert(withVersion.ok);
  assertEquals(withVersion.value.finished, true);
  assertEquals(withVersion.value.result, RESULT);
  assertEquals(withVersion.value.version, VERSION);
  assertEquals(withVersion.value.absent_reason, null);
  assert(handoffResult.output.safeParse(withVersion.value).success);

  // 저장한 문서가 없으면 이유가 run의 확정 결과다. 후속 version은 이 읽기를 바꾸지 않는다.
  const none = createHandoffReads({ savedVersion: () => null });
  const absent = none.result.handle(
    snapshotOf(done),
    ctxOf("user"),
    { receiver_run: RECEIVER },
  );
  assert(absent.ok);
  assertEquals(absent.value.version, null);
  assertEquals(absent.value.absent_reason, RESULT);
  assert(handoffResult.output.safeParse(absent.value).success);
  // handoff가 아닌 run은 handoff 결과가 아니다.
  const notHandoff = none.result.handle(
    snapshotOf(done),
    ctxOf("user"),
    { receiver_run: SENDER },
  );
  assertEquals(notHandoff.ok, false);
});

Deno.test("lophn-agent/handoff#R9: 현황과 결과 읽기는 보낸·받은 assignment와 사람·machine만 현재 권한으로 보고 그 밖은 없는 handoff와 같다", () => {
  const db = seeded("running");
  const reads = createHandoffReads({ savedVersion: () => null });
  const status = (actor: string) =>
    reads.status.handle(snapshotOf(db), ctxOf(actor), {
      sender_run: SENDER,
      dedup_key: "key-1",
    });
  const result = (actor: string) =>
    reads.result.handle(snapshotOf(db), ctxOf(actor), {
      receiver_run: RECEIVER,
    });
  const seen = status("user");
  assert(seen.ok);
  assertEquals(seen.value.receiver_run, RECEIVER);
  assertEquals(seen.value.state, "running");
  assert(handoffStatus.output.safeParse(seen.value).success);
  for (
    const actor of ["machine", `agent:${ASG_SENDER}`, `agent:${ASG_RECEIVER}`]
  ) {
    assert(status(actor).ok, actor);
    assert(result(actor).ok, actor);
  }
  // 관계없는 assignment의 agent와 coding agent는 없는 handoff와 똑같이 본다.
  const absent = reads.status.handle(snapshotOf(db), ctxOf("user"), {
    sender_run: SENDER,
    dedup_key: "no-such-key",
  });
  assert(!absent.ok);
  for (
    const actor of [
      `agent:${ASG_OTHER}`,
      "coding_agent:cac_01arz3ndektsv4rrffq69g5fav",
    ]
  ) {
    const hidden = status(actor);
    assert(!hidden.ok);
    assertEquals(hidden.error, absent.error);
    assert(!result(actor).ok);
  }
  // 받은 assignment가 회수되면 그 agent의 현재 권한이 없어 읽을 수 없다. 사람은 그대로 읽는다.
  db.prepare("update assignments set state = 'withdrawn' where id = ?").run(
    ASG_RECEIVER,
  );
  assert(!status(`agent:${ASG_RECEIVER}`).ok);
  assert(!result(`agent:${ASG_RECEIVER}`).ok);
  assert(status(`agent:${ASG_SENDER}`).ok);
  assert(status("user").ok);
});
