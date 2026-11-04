import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ok } from "../../../base/mod.ts";
import {
  type forkSession,
  LOPHN_AGENT_ID,
  type Place,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
  Sql,
  Tx,
} from "../../../protocol/server/mod.ts";
import { createConversationCommands } from "../session/commands.ts";
import { conversationSchemaSteps } from "../session/model.ts";
import { revertSchemaSteps } from "../session/rewind/mod.ts";
import { createSessionDirectory } from "./directory.ts";
import { acceptsInput } from "./model.ts";
import type { OpenDeps } from "./ports.ts";
import { UNWIRED_END_DEPS, UNWIRED_PLACE_DEPS } from "./unwired.ts";

const PROJECT = "prj_00000000000000000000000001";
const APP = "app_00000000000000000000000001";
const OTHER_APP = "app_00000000000000000000000002";
const REVIEWER = "agt_00000000000000000000000001";
const MISSING_AGENT = "agt_00000000000000000000000009";

// 저장소만 쓴다. 표는 실제 schema step 그대로다.
function store() {
  const db = new DatabaseSync(":memory:");
  for (const step of [...conversationSchemaSteps, ...revertSchemaSteps]) {
    db.exec(step.sql);
  }
  // fork가 복사한 메시지의 이미지 참조를 읽는다.
  db.exec(
    `create table blob_refs (owner_kind text, owner_key text, field text,
       hash text, size_bytes integer, registered_seq integer)`,
  );
  const sql: Sql = {
    run: (query, params) => db.prepare(query).run(...params),
    get: (query, params) => db.prepare(query).get(...params) as never,
    all: (query, params) => db.prepare(query).all(...params) as never,
  };
  let counter = 0;
  const tx = {
    sql,
    now: () => "2026-10-16T00:00:00.000Z",
    newId: (prefix: string) =>
      `${prefix}_${String(++counter).padStart(26, "0")}`,
    registerBlobRef: () => ok(undefined),
  } as unknown as Tx;
  return { db, sql, tx };
}

const archivedPlaces = new Set<string>();
let reviewerSkip = false;
const deps: OpenDeps = {
  projects: {
    project: (id) => ({ id, archived: archivedPlaces.has(id) }) as never,
    projectByName: () => null,
  },
  apps: {
    app: (id) =>
      id === OTHER_APP
        ? null
        : ({ id, archived: archivedPlaces.has(id) } as never),
    appByName: () => null,
  },
  agents: {
    agent: (id) =>
      id === REVIEWER
        ? {
            id,
            name: "reviewer",
            skip: reviewerSkip,
            runtime: "lophn" as const,
            apps: [],
            deny: [],
          }
        : id === LOPHN_AGENT_ID
          ? {
              id,
              name: "lophn",
              skip: false,
              runtime: "lophn" as const,
              apps: [],
              deny: [],
            }
          : null,
    agents: () => [],
    cardOf: () => null,
  },
  names: UNWIRED_PLACE_DEPS.names,
  publish: () => {},
};

const user: RequestContext = {
  principal: "user",
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "user",
};

function commandsOf() {
  return createConversationCommands({
    send: {
      router: { route: () => ok({ session: null }) },
      directory: { find: () => null },
    },
    deleteSessionRecords: () => ok(undefined),
    catalog: () => [],
    eraseBlobRefs: () => ok(undefined),
    open: () => deps,
    end: UNWIRED_END_DEPS,
  });
}

function open(
  tx: Tx,
  input: { id: string; agent: string; place: Place | null },
) {
  return commandsOf().open.handle(tx, user, input as never, {} as never);
}

test("archive한 session은 입력을 받지 않고 보관한 place의 session도 받지 않는다", () => {
  const { sql, tx } = store();
  archivedPlaces.clear();
  const directory = createSessionDirectory({ ...deps, sql: () => sql });
  const opened = open(tx, {
    id: "ses_a",
    agent: REVIEWER,
    place: { kind: "app", id: APP },
  });
  assert.ok(opened.ok);
  const session = opened.value.id as never;
  assert.deepStrictEqual(directory.find(session)?.accepting, true);

  // place를 보관하면 session은 열린 채 남고 입력만 거절한다. 다시 꺼내면 이어서 받는다.
  archivedPlaces.add(APP);
  assert.deepStrictEqual(directory.find(session)?.accepting, false);
  assert.deepStrictEqual(
    sql.get("select lifecycle from sessions where id = ?", [session])?.[
      "lifecycle"
    ],
    "open",
  );
  archivedPlaces.delete(APP);
  assert.deepStrictEqual(directory.find(session)?.accepting, true);

  const row = sql.get("select state_seq from sessions where id = ?", [session]);
  const archived = commandsOf().archive.handle(
    tx,
    user,
    { session },
    { state_seq: String(row?.["state_seq"]) },
  );
  assert.ok(archived.ok);
  assert.deepStrictEqual(directory.find(session)?.accepting, false);
  assert.deepStrictEqual(acceptsInput({ lifecycle: "archived" }, false), false);

  // 보관한 place에는 새 session도 열리지 않는다.
  archivedPlaces.add(APP);
  const refused = open(tx, {
    id: "ses_b",
    agent: REVIEWER,
    place: { kind: "app", id: APP },
  });
  assert.ok(!refused.ok && refused.error.code === "conflict");
  archivedPlaces.clear();
});

test("fork는 이력만 복사하고 허락, 대기 요청, 열린 call, rewind 기록은 가져오지 않는다", () => {
  const { sql, tx } = store();
  archivedPlaces.clear();
  const opened = open(tx, {
    id: "ses_source",
    agent: REVIEWER,
    place: { kind: "app", id: APP },
  });
  assert.ok(opened.ok);
  const source = opened.value.id;
  const body = "a".repeat(64);
  for (const [seq, from] of [
    [1, "human"],
    [2, "agent"],
  ] as const) {
    sql.run(
      `insert into messages (id, session, from_kind, from_ref, call, reply_to,
         refs, delivery, turn, body, created_seq, created_at, state_seq)
       values (?, ?, ?, ?, ?, null, '[]', 'next_turn', 'trn_x', ?, ?, ?, ?)`,
      [
        `msg_${seq}`,
        source,
        from,
        from === "human" ? null : "ses_other",
        from === "human" ? null : "cal_open",
        body,
        seq,
        "2026-10-16T00:00:00.000Z",
        seq,
      ],
    );
  }
  sql.run(
    `update sessions set compaction_through_seq = 1, compaction_summary_call = 'mcl_x'
     where id = ?`,
    [source],
  );

  const fork = commandsOf().fork as CommandDefinition<typeof forkSession>;
  const forked = fork.handle(
    tx,
    user,
    { id: "ses_fork", source, through_seq: "2" },
    undefined as never,
  );
  assert.ok(forked.ok);
  assert.deepStrictEqual(forked.value.copied_messages, 2);

  const copies = sql.all(
    "select from_kind, call, turn from messages where session = ? order by created_seq",
    ["ses_fork"],
  );
  assert.deepStrictEqual(
    copies.map((row) => row["from_kind"]),
    ["human", "agent"],
  );
  // 열린 call과 turn은 원래 session에 묶여 있어 새 session의 turn이 가져간 적이 없다.
  assert.deepStrictEqual(
    copies.map((row) => row["turn"]),
    [null, null],
  );
  const forkedRow = sql.get("select * from sessions where id = ?", [
    "ses_fork",
  ]);
  assert.deepStrictEqual(forkedRow?.["agent"], REVIEWER);
  assert.deepStrictEqual(forkedRow?.["place_kind"], "app");
  assert.deepStrictEqual(forkedRow?.["place_id"], APP);
  assert.deepStrictEqual(forkedRow?.["compaction_through_seq"], null);
  assert.deepStrictEqual(forkedRow?.["forked_from_session"], source);
});

test("열린 session의 agent와 place는 바뀌지 않고, 정의가 없는 agent나 없거나 보관한 place에는 열리지 않는다", () => {
  const { sql, tx } = store();
  archivedPlaces.clear();
  const rows = () =>
    Number(sql.get("select count(*) as n from sessions", [])?.["n"]);

  archivedPlaces.add(PROJECT);
  const refused: [string, Place | null, string][] = [
    [MISSING_AGENT, null, "not_found"],
    [REVIEWER, { kind: "app", id: OTHER_APP }, "conflict"],
    [REVIEWER, { kind: "project", id: PROJECT }, "conflict"],
  ];
  for (const [agent, place, code] of refused) {
    const done = open(tx, { id: "ses_bad", agent, place });
    assert.ok(!done.ok && done.error.code === code, `${agent} ${code}`);
    assert.deepStrictEqual(rows(), 0);
  }
  archivedPlaces.clear();

  // lophn @ project, agt_… @ app은 열린다.
  assert.ok(
    open(tx, {
      id: "ses_project",
      agent: LOPHN_AGENT_ID,
      place: { kind: "project", id: PROJECT },
    }).ok,
  );
  reviewerSkip = true;
  assert.ok(
    open(tx, {
      id: "ses_app",
      agent: REVIEWER,
      place: { kind: "app", id: APP },
    }).ok,
  );
  reviewerSkip = false;
  assert.deepStrictEqual(
    sql.get("select skip from sessions where id = 'ses_app'", [])?.["skip"],
    1,
  );

  // 같은 id로 다른 place나 다른 agent를 열면 conflict이고 행은 그대로다.
  for (const input of [
    { id: "ses_app", agent: REVIEWER, place: { kind: "app", id: OTHER_APP } },
    {
      id: "ses_app",
      agent: LOPHN_AGENT_ID,
      place: { kind: "app", id: APP },
    },
  ] as const) {
    const done = open(tx, input);
    assert.ok(!done.ok && done.error.code === "conflict");
  }
  const row = sql.get(
    "select agent, place_kind, place_id from sessions where id = 'ses_app'",
    [],
  );
  assert.deepStrictEqual(
    [row?.["agent"], row?.["place_kind"], row?.["place_id"]],
    [REVIEWER, "app", APP],
  );

  // 열린 행의 agent와 place는 trigger가 지킨다.
  assert.throws(() =>
    sql.run("update sessions set agent = 'lophn' where id = 'ses_app'", []),
  );
  assert.throws(() =>
    sql.run(
      "update sessions set place_kind = 'project', place_id = 'prj_x' where id = 'ses_app'",
      [],
    ),
  );
});
