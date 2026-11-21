import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ok } from "../../../base/mod.ts";
import {
  type forkSession,
  isLophn,
  LOPHN_HOME_ID,
  lophnIdOf,
  workspaceOfLophn,
  type Workspace,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
  Sql,
  Tx,
} from "../../../protocol/server/mod.ts";
import { turnSchemaSteps } from "../run-loop/schema.ts";
import { createConversationCommands } from "../session/commands.ts";
import { revertSchemaSteps } from "../session/rewind/mod.ts";
import { createSessionDirectory } from "./directory.ts";
import { acceptsInput } from "./model.ts";
import type { OpenDeps } from "./ports.ts";
import { UNWIRED_END_DEPS, UNWIRED_WORKSPACE_DEPS } from "./unwired.ts";
import { conversationTestSteps } from "../session/test-steps.ts";

const PROJECT = "prj_00000000000000000000000001";
const APP = "app_00000000000000000000000001";
const OTHER_APP = "app_00000000000000000000000002";
const REVIEWER = "agt_00000000000000000000000001";
const MISSING_AGENT = "agt_00000000000000000000000009";
// APP 범위 agent. 그 workspace에서만 열린다.
const SCOPED = "agt_00000000000000000000000003";

// 저장소만 쓴다. 표는 실제 schema step 그대로다.
function store() {
  const db = new DatabaseSync(":memory:");
  for (const step of [
    ...conversationTestSteps,
    ...turnSchemaSteps,
    ...revertSchemaSteps,
  ]) {
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

const archivedWorkspaces = new Set<string>();
let reviewerSkip = false;
const deps: OpenDeps = {
  projects: {
    project: (id) => ({ id, archived: archivedWorkspaces.has(id) }) as never,
    projectByName: () => null,
  },
  apps: {
    app: (id) =>
      id === OTHER_APP
        ? null
        : ({ id, archived: archivedWorkspaces.has(id) } as never),
    appByName: () => ({
      ok: false,
      error: { code: "not_found", message: "app not found" },
    }),
  },
  agents: {
    agent: (id) =>
      id === SCOPED
        ? {
            id,
            handle: "scoped",
            name: "scoped",
            workspace: { kind: "app" as const, id: APP },
            skip: false,
            runtime: "lophn" as const,
            apps: [],
            deny: [],
            remoteApps: [],
          }
        : id === REVIEWER
          ? {
              id,
              handle: "reviewer",
              workspace: null,
              name: "reviewer",
              skip: reviewerSkip,
              runtime: "lophn" as const,
              apps: [],
              deny: [],
              remoteApps: [],
            }
          : isLophn(id)
            ? {
                id,
                handle: "lophn",
                workspace: workspaceOfLophn(id),
                name: "lophn",
                skip: false,
                runtime: "lophn" as const,
                apps: [],
                deny: [],
                remoteApps: [],
              }
            : null,
    agents: () => [],
    cardOf: () => null,
  },
  names: UNWIRED_WORKSPACE_DEPS.names,
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
      directory: { find: () => null, app: () => null },
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
  input: { id: string; agent: string; workspace: Workspace | null },
) {
  return commandsOf().open.handle(tx, user, input as never, {} as never);
}

test("archive한 session은 입력을 받지 않고 보관한 workspace의 session도 받지 않는다", () => {
  const { sql, tx } = store();
  archivedWorkspaces.clear();
  const directory = createSessionDirectory({ ...deps, sql: () => sql });
  const opened = open(tx, {
    id: "ses_a",
    agent: REVIEWER,
    workspace: { kind: "app", id: APP },
  });
  assert.ok(opened.ok);
  const session = opened.value.id as never;
  assert.deepStrictEqual(directory.find(session)?.accepting, true);

  // workspace를 보관하면 session은 열린 채 남고 입력만 거절한다. 다시 꺼내면 이어서 받는다.
  archivedWorkspaces.add(APP);
  assert.deepStrictEqual(directory.find(session)?.accepting, false);
  assert.deepStrictEqual(
    sql.get("select lifecycle from sessions where id = ?", [session])?.[
      "lifecycle"
    ],
    "open",
  );
  archivedWorkspaces.delete(APP);
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

  // 보관한 workspace에는 새 session도 열리지 않는다.
  archivedWorkspaces.add(APP);
  const refused = open(tx, {
    id: "ses_b",
    agent: REVIEWER,
    workspace: { kind: "app", id: APP },
  });
  assert.ok(!refused.ok && refused.error.code === "conflict");
  archivedWorkspaces.clear();
});

// agent가 archived 앱 workspace로 보낸 call은 없는 앱과 같이 not_found다. 사람이 그 workspace를 여는 길은 conflict 그대로다.
test("agent가 archived 앱 workspace에 session을 열면 not_found이고 사람은 conflict다", () => {
  const { sql, tx } = store();
  archivedWorkspaces.clear();
  const directory = createSessionDirectory({ ...deps, sql: () => sql });
  const target = {
    agent: REVIEWER,
    workspace: { kind: "app" as const, id: APP },
  } as never;
  archivedWorkspaces.add(APP);
  const byAgent = directory.open(
    tx,
    target,
    { kind: "agent", session: "ses_from" as never },
    null,
  );
  assert.ok(!byAgent.ok && byAgent.error.code === "not_found");
  const byHuman = directory.open(tx, target, { kind: "human" }, null);
  assert.ok(!byHuman.ok && byHuman.error.code === "conflict");
  archivedWorkspaces.clear();
});

test("fork는 이력만 복사하고 허락, 대기 요청, 열린 call, rewind 기록은 가져오지 않는다", () => {
  const { sql, tx } = store();
  archivedWorkspaces.clear();
  const opened = open(tx, {
    id: "ses_source",
    agent: REVIEWER,
    workspace: { kind: "app", id: APP },
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
  // `!` 기록: 원본 turn이 가져간 것(3)과 아직 가져가지 않은 것(4).
  for (const [seq, turn] of [
    [3, "trn_x"],
    [4, null],
  ] as const) {
    sql.run(
      `insert into messages (id, session, from_kind, refs, delivery, shell, turn, body,
         created_seq, created_at, state_seq)
       values (?, ?, 'human', '[]', 'next_turn', 1, ?, ?, ?, ?, ?)`,
      [`msg_${seq}`, source, turn, body, seq, "2026-10-16T00:00:00.000Z", seq],
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
    { id: "ses_fork", source, through_seq: "4" },
    undefined as never,
  );
  assert.ok(forked.ok);
  assert.deepStrictEqual(forked.value.copied_messages, 4);

  const copies = sql.all(
    "select from_kind, call, turn from messages where session = ? order by created_seq",
    ["ses_fork"],
  );
  assert.deepStrictEqual(
    copies.map((row) => row["from_kind"]),
    ["human", "agent", "human", "human"],
  );
  // 열린 call과 turn은 원래 session에 묶여 있어 새 session의 turn이 가져간 적이 없다. 다만 원본 turn이 이미 가져간
  // `!` 기록은 가져간 채로 복사해, 복사본의 첫 turn이 다시 가져가지 않는다.
  assert.deepStrictEqual(
    copies.map((row) => row["turn"]),
    [null, null, "trn_x", null],
  );
  const forkedRow = sql.get("select * from sessions where id = ?", [
    "ses_fork",
  ]);
  assert.deepStrictEqual(forkedRow?.["agent"], REVIEWER);
  assert.deepStrictEqual(forkedRow?.["workspace_kind"], "app");
  assert.deepStrictEqual(forkedRow?.["workspace_id"], APP);
  assert.deepStrictEqual(forkedRow?.["compaction_through_seq"], null);
  assert.deepStrictEqual(forkedRow?.["forked_from_session"], source);
});

test("열린 session의 agent와 workspace는 바뀌지 않고, 정의가 없는 agent나 없거나 보관한 workspace에는 열리지 않는다", () => {
  const { sql, tx } = store();
  archivedWorkspaces.clear();
  const rows = () =>
    Number(sql.get("select count(*) as n from sessions", [])?.["n"]);

  archivedWorkspaces.add(PROJECT);
  const refused: [string, Workspace | null, string][] = [
    [MISSING_AGENT, null, "not_found"],
    [REVIEWER, { kind: "app", id: OTHER_APP }, "conflict"],
    [REVIEWER, { kind: "project", id: PROJECT }, "conflict"],
    // 범위 agent는 자기 workspace 밖(home, 다른 workspace)에서는 없는 agent다.
    [SCOPED, null, "not_found"],
    [SCOPED, { kind: "project", id: PROJECT }, "not_found"],
    // lophn도 자기 workspace 밖에서는 없는 agent다. Home lophn은 Home에서만 열린다.
    [LOPHN_HOME_ID, { kind: "project", id: PROJECT }, "not_found"],
    [lophnIdOf({ kind: "project", id: PROJECT }), null, "not_found"],
  ];
  for (const [agent, workspace, code] of refused) {
    const done = open(tx, { id: "ses_bad", agent, workspace });
    assert.ok(!done.ok && done.error.code === code, `${agent} ${code}`);
    assert.deepStrictEqual(rows(), 0);
  }
  archivedWorkspaces.clear();

  assert.ok(
    open(tx, {
      id: "ses_scoped",
      agent: SCOPED,
      workspace: { kind: "app", id: APP },
    }).ok,
  );
  // 그 project의 lophn @ project, agt_… @ app은 열린다.
  assert.ok(
    open(tx, {
      id: "ses_project",
      agent: lophnIdOf({ kind: "project", id: PROJECT }),
      workspace: { kind: "project", id: PROJECT },
    }).ok,
  );
  reviewerSkip = true;
  assert.ok(
    open(tx, {
      id: "ses_app",
      agent: REVIEWER,
      workspace: { kind: "app", id: APP },
    }).ok,
  );
  reviewerSkip = false;
  assert.deepStrictEqual(
    sql.get("select skip from sessions where id = 'ses_app'", [])?.["skip"],
    1,
  );

  // 같은 id로 다른 workspace나 다른 agent를 열면 conflict이고 행은 그대로다.
  for (const input of [
    {
      id: "ses_app",
      agent: REVIEWER,
      workspace: { kind: "app", id: OTHER_APP },
    },
    {
      id: "ses_app",
      agent: LOPHN_HOME_ID,
      workspace: { kind: "app", id: APP },
    },
  ] as const) {
    const done = open(tx, input);
    assert.ok(!done.ok && done.error.code === "conflict");
  }
  const row = sql.get(
    "select agent, workspace_kind, workspace_id from sessions where id = 'ses_app'",
    [],
  );
  assert.deepStrictEqual(
    [row?.["agent"], row?.["workspace_kind"], row?.["workspace_id"]],
    [REVIEWER, "app", APP],
  );

  // 열린 행의 agent와 workspace는 trigger가 지킨다.
  assert.throws(() =>
    sql.run("update sessions set agent = 'lophn' where id = 'ses_app'", []),
  );
  assert.throws(() =>
    sql.run(
      "update sessions set workspace_kind = 'project', workspace_id = 'prj_x' where id = 'ses_app'",
      [],
    ),
  );
});

// 팀. root R 밑에서 spawn한 session은 R의 자손이고, 상한을 넘는 spawn은 session을 남기지 않는다.
function teamWorld() {
  const { sql, tx } = store();
  archivedWorkspaces.clear();
  const directory = createSessionDirectory({ ...deps, sql: () => sql });
  const at = { agent: REVIEWER, workspace: null } as never;
  const spawn = (parent: string | null) => {
    const opened = directory.open(
      tx,
      at,
      parent === null
        ? { kind: "human" }
        : { kind: "agent", session: parent as never },
      parent as never,
    );
    return opened.ok ? opened.value.session : opened;
  };
  const count = () =>
    Number(sql.get("select count(*) as n from sessions", [])?.["n"]);
  return { sql, tx, spawn, count };
}

test("max_depth와 max_members를 넘는 spawn은 conflict이고 session이 남지 않는다", () => {
  const { tx, spawn, count } = teamWorld();
  const root = commandsOf().open.handle(
    tx,
    user,
    { id: "ses_root", agent: REVIEWER, workspace: null } as never,
    {} as never,
  );
  assert.ok(root.ok);
  // 깊이: root 0 → 1 → 2는 되고 3은 안 된다(기본 max_depth 2).
  let parent = "ses_root";
  for (let depth = 1; depth <= 2; depth += 1) {
    parent = String(spawn(parent));
  }
  const before = count();
  const tooDeep = spawn(parent) as { ok: false; error: { code: string } };
  assert.deepStrictEqual(tooDeep.error.code, "conflict");
  assert.deepStrictEqual(count(), before);
  // 폭: root 아래 열린 자손이 이미 2다. 기본 max_members 8에 닿을 때까지 채우면 다음은 conflict다.
  for (let n = 2; n < 8; n += 1)
    assert.equal(typeof spawn("ses_root"), "string");
  const beforeFull = count();
  const full = spawn("ses_root") as { ok: false; error: { code: string } };
  assert.deepStrictEqual(full.error.code, "conflict");
  assert.deepStrictEqual(count(), beforeFull);
});

test("team end는 자기 엄격한 자손만 잎부터 끝내고 형제의 자식은 forbidden이다", () => {
  const { sql, tx, spawn } = teamWorld();
  const root = String(spawn(null));
  const a = String(spawn(root));
  const b = String(spawn(root));
  const aChild = String(spawn(a));
  const as = (session: string): RequestContext => ({
    ...user,
    actor: `agent:${session}`,
  });
  const end = (by: string, target: string) =>
    commandsOf().teamEnd.handle(
      tx,
      as(by),
      { session: target } as never,
      {} as never,
    );
  // b는 형제 a의 자식을 끝내지 못하고, 자기 자신이나 부모도 끝내지 못한다. 아무것도 닫히지 않는다.
  for (const target of [aChild, b, root]) {
    const refused = end(b, target);
    assert.ok(!refused.ok && refused.error.code === "forbidden");
  }
  const open = () =>
    sql.all("select id from sessions where lifecycle = 'open'", []).length;
  assert.deepStrictEqual(open(), 4);
  // root는 아래 어디든 끝낼 수 있고 대상 밑까지 닫는다.
  const done = end(root, a);
  assert.ok(done.ok);
  assert.deepStrictEqual(done.value.ended, [aChild, a]);
  assert.deepStrictEqual(open(), 2);
});

// project에서 부른 내장 coding agent는 그 project의 GUI 탭 팀원이 된다(headless host가 가져가지 않고 core가 탭을 연다).
test("a coding agent called into a project opens as a GUI tab member", () => {
  const { sql, tx } = store();
  const coding = {
    ...deps,
    agents: {
      ...deps.agents,
      agent: (id: string) =>
        id === "coding_claude"
          ? {
              id: "coding_claude" as never,
              handle: "claude",
              workspace: null,
              name: "Claude Code",
              skip: false,
              runtime: "claude-code" as const,
              apps: [],
              deny: [],
              remoteApps: [],
            }
          : deps.agents.agent(id as never),
    },
  };
  const directory = createSessionDirectory({ ...coding, sql: () => sql });
  const called = directory.open(
    tx,
    {
      agent: "coding_claude",
      workspace: { kind: "project", id: PROJECT },
    } as never,
    { kind: "agent", session: "ses_from" as never },
    null,
  );
  assert.ok(called.ok);
  const member = sql.get(
    "select harness, harness_gui from sessions where id = ?",
    [called.value.session],
  );
  assert.deepStrictEqual(
    [member?.["harness"], Number(member?.["harness_gui"])],
    ["claude-code", 1],
  );
});
