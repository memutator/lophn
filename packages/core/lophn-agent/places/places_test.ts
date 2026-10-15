import { assert, assertEquals, assertThrows } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { ok } from "../../../base/mod.ts";
import {
  type AgentRef,
  type forkSession,
  rolePlaceFits,
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
import { UNWIRED_END_DEPS } from "./unwired.ts";

const PROJECT = "prj_00000000000000000000000001";
const APP = "app_00000000000000000000000001";
const OTHER_APP = "app_00000000000000000000000002";
const OPERATOR = "agt_00000000000000000000000001";

// 저장소만 쓴다. 표는 실제 schema step 그대로다.
function store() {
  const db = new DatabaseSync(":memory:");
  for (const step of [...conversationSchemaSteps, ...revertSchemaSteps]) {
    db.exec(step.sql);
  }
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
const deps: OpenDeps = {
  projects: {
    project: (id) => ({ id, archived: archivedPlaces.has(id) }) as never,
    projectByName: () => null,
  },
  apps: {
    app: (id) =>
      id === OTHER_APP
        ? null
        : ({ id, archived: archivedPlaces.has(id) }) as never,
    appByName: () => null,
  },
  operators: {
    operator: (id) =>
      id === OPERATOR
        ? { id, name: "reviewer", place: { kind: "app", id: APP } } as never
        : null,
    operators: () => [],
  },
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
    eraseBlobRefs: () => ok(undefined),
    open: deps,
    end: UNWIRED_END_DEPS,
  });
}

Deno.test("archive한 session은 입력을 받지 않고 보관한 place의 session도 받지 않는다", () => {
  const { sql, tx } = store();
  archivedPlaces.clear();
  const directory = createSessionDirectory({ ...deps, sql: () => sql });
  const from = { kind: "human" as const };
  const opened = directory.open(tx, { role: "app_engineer", app: APP }, from);
  assert(opened.ok);
  const session = opened.value.session;
  assertEquals(directory.find(session)?.accepting, true);

  // place를 보관하면 session은 열린 채 남고 입력만 거절한다. 다시 꺼내면 이어서 받는다.
  archivedPlaces.add(APP);
  assertEquals(directory.find(session)?.accepting, false);
  assertEquals(
    sql.get("select lifecycle from sessions where id = ?", [session])
      ?.["lifecycle"],
    "open",
  );
  archivedPlaces.delete(APP);
  assertEquals(directory.find(session)?.accepting, true);

  const row = sql.get("select state_seq from sessions where id = ?", [session]);
  const archived = commandsOf().archive.handle(
    tx,
    user,
    { session },
    { state_seq: String(row?.["state_seq"]) },
  );
  assert(archived.ok);
  assertEquals(directory.find(session)?.accepting, false);
  assertEquals(acceptsInput({ lifecycle: "archived" }, false), false);

  // 보관한 place에는 새 session도 열리지 않는다.
  archivedPlaces.add(APP);
  const refused = directory.open(tx, { role: "app_engineer", app: APP }, from);
  assert(!refused.ok && refused.error.code === "conflict");
  archivedPlaces.clear();
});

Deno.test("fork는 이력만 복사하고 허락, 대기 요청, 열린 call, rewind 기록은 가져오지 않는다", () => {
  const { sql, tx } = store();
  archivedPlaces.clear();
  const directory = createSessionDirectory({ ...deps, sql: () => sql });
  const opened = directory.open(
    tx,
    { role: "operator", agent: OPERATOR },
    { kind: "human" },
  );
  assert(opened.ok);
  const source = opened.value.session;
  const body = "a".repeat(64);
  for (const [seq, from] of [[1, "human"], [2, "agent"]] as const) {
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
  assert(forked.ok);
  assertEquals(forked.value.copied_messages, 2);

  const copies = sql.all(
    "select from_kind, call, turn from messages where session = ? order by created_seq",
    ["ses_fork"],
  );
  assertEquals(copies.map((row) => row["from_kind"]), ["human", "agent"]);
  // 열린 call과 turn은 원래 session에 묶여 있어 새 session의 turn이 가져간 적이 없다.
  assertEquals(copies.map((row) => row["turn"]), [null, null]);
  const forkedRow = sql.get("select * from sessions where id = ?", [
    "ses_fork",
  ]);
  assertEquals(forkedRow?.["operator"], OPERATOR);
  assertEquals(forkedRow?.["compaction_through_seq"], null);
  assertEquals(forkedRow?.["forked_from_session"], source);
});

Deno.test("role과 place가 맞지 않는 session은 열리지 않는다", () => {
  const { db, sql, tx } = store();
  archivedPlaces.clear();
  const bad: [string, string | null, string | null][] = [
    ["lophn", "project", PROJECT],
    ["project_manager", "app", APP],
    ["app_engineer", "project", PROJECT],
    ["project_manager", null, null],
  ];
  for (const [role, kind, id] of bad) {
    assert(
      !rolePlaceFits(
        role as never,
        kind === null ? null : { kind, id } as never,
      ),
    );
    assertThrows(() =>
      db.prepare(
        `insert into sessions (id, role, project, app, place_kind, place_id,
           created_seq, state_seq) values ('ses_bad', ?, ?, ?, ?, ?, 1, 1)`,
      ).run(
        role,
        kind === "project" ? id : null,
        kind === "app" ? id : null,
        kind,
        id,
      )
    );
  }

  // 없는 Operator와 없는 place는 열리지 않는다.
  const directory = createSessionDirectory({ ...deps, sql: () => sql });
  const from = { kind: "human" as const };
  const missing: AgentRef[] = [
    { role: "operator", agent: "agt_00000000000000000000000009" },
    { role: "app_engineer", app: OTHER_APP },
  ];
  for (const agent of missing) {
    assert(!directory.open(tx, agent, from).ok);
  }
});
