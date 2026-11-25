import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import type { PermissionMode } from "../../../protocol/lophn-agent/mod.ts";
import type { RequestContext, Sql, Tx } from "../../../protocol/server/mod.ts";
import { turnSchemaSteps } from "../run-loop/schema.ts";
import { startSession } from "../workspaces/lifecycle.ts";
import type { OpenDeps } from "../workspaces/ports.ts";
import {
  UNWIRED_END_DEPS,
  UNWIRED_WORKSPACE_DEPS,
} from "../workspaces/unwired.ts";
import { createConversationCommands } from "./commands.ts";
import { guiMemberSchemaSteps } from "./gui-member-schema.ts";
import { conversationSchemaSteps } from "./model.ts";
import {
  appMessagesSchemaSteps,
  sessionOpenerSchemaSteps,
} from "./opener-schema.ts";
import { sessionPermissionModeSchemaSteps } from "./permission-mode-schema.ts";
import {
  memberRunsOnSchemaSteps,
  remoteSenderMessagesSchemaSteps,
} from "./remote-sender-schema.ts";
import { revertSchemaSteps } from "./rewind/mod.ts";
import { conversationTestSteps } from "./test-steps.ts";
import { workflowOriginSchemaSteps } from "./workflow-origin-schema.ts";

const FULL_AGENT = "agt_00000000000000000000000001" as const;
const PLAIN_AGENT = "agt_00000000000000000000000002" as const;
const READONLY_AGENT = "agt_00000000000000000000000003" as const;

function setupDb(steps = conversationTestSteps) {
  const db = new DatabaseSync(":memory:");
  for (const step of steps) {
    db.exec(step.sql);
  }
  const sql: Sql = {
    run: (query, params = []) => db.prepare(query).run(...params),
    get: (query, params = []) => db.prepare(query).get(...params) as never,
    all: (query, params = []) => db.prepare(query).all(...params) as never,
  };
  let seq = 0;
  const tx = {
    sql,
    now: () => "2026-11-25T00:00:00.000Z",
    newId: (prefix: string) => `${prefix}_${String(++seq).padStart(26, "0")}`,
    registerBlobRef: () => ok(undefined),
  } as unknown as Tx;
  return { db, sql, tx };
}

function makeOpenDeps(defaultMode: PermissionMode = "workspace"): OpenDeps {
  return {
    projects: { project: () => null, projectByName: () => null },
    apps: {
      app: () => null,
      appByName: () =>
        ({
          ok: false,
          error: { code: "not_found", message: "no app" },
        }) as never,
    },
    agents: {
      agent: (id) => {
        if (id === FULL_AGENT) {
          return {
            id,
            handle: "fuller",
            name: "Fuller",
            workspace: null,
            permissionMode: "full",
            runtime: "lophn",
            apps: [],
            deny: [],
            remoteApps: [],
            browserProfile: null,
          };
        }
        if (id === READONLY_AGENT) {
          return {
            id,
            handle: "reader",
            name: "Reader",
            workspace: null,
            permissionMode: "read_only",
            runtime: "lophn",
            apps: [],
            deny: [],
            remoteApps: [],
            browserProfile: null,
          };
        }
        if (id === PLAIN_AGENT) {
          return {
            id,
            handle: "plain",
            name: "Plain",
            workspace: null,
            runtime: "lophn",
            apps: [],
            deny: [],
            remoteApps: [],
            browserProfile: null,
          };
        }
        return null;
      },
      agents: () => [],
      cardOf: () => null,
    },
    names: UNWIRED_WORKSPACE_DEPS.names,
    defaultMode: () => defaultMode,
    publish: () => {},
  };
}

// 기기(device:*)는 session 권한 단계를 낮출 수만 있고 올리지 못한다. 로컬 user는 자유롭게 바꾼다.
test("sessions/change-mode는 로컬 user에게 자유롭고 원격 device에게는 하향만 허용한다", () => {
  const { sql, tx } = setupDb();
  const openDeps = makeOpenDeps("workspace");
  const started = startSession(tx, openDeps, {
    id: "ses_01hzzzzzzzzzzzzzzzzzzzzz01",
    agent: FULL_AGENT,
    workspace: null,
  });
  assert.ok(started.ok);
  assert.equal(started.value.permission_mode, "full");

  const commands = createConversationCommands({
    open: () => openDeps,
    end: UNWIRED_END_DEPS,
  } as never);
  const localUser = { actor: "user", principal: "user" } as RequestContext;
  const phone = {
    actor: "user",
    principal: "device:dev_01hzzzzzzzzzzzzzzzzzzzzz01",
  } as RequestContext;

  let stateSeq = started.value.state_seq;

  // 원격 기기는 full -> workspace -> ask -> read_only로만 내릴 수 있다.
  for (const mode of ["workspace", "ask", "read_only"] as const) {
    const res = commands.changeMode.handle(
      tx,
      phone,
      { session: started.value.id, mode },
      { state_seq: stateSeq },
    );
    assert.ok(res.ok, `downgrade to ${mode}`);
    assert.equal(res.value.permission_mode, mode);
    stateSeq = res.value.state_seq;
  }

  // 원격 기기는 단계를 올리지 못한다(forbidden).
  for (const mode of ["ask", "workspace", "full"] as const) {
    const refused = commands.changeMode.handle(
      tx,
      phone,
      { session: started.value.id, mode },
      { state_seq: stateSeq },
    );
    assert.ok(!refused.ok, `upgrade to ${mode} should fail`);
    assert.equal(refused.error.code, "forbidden");
  }

  // 같은 단계 요청은 멱등 ok다.
  const same = commands.changeMode.handle(
    tx,
    phone,
    { session: started.value.id, mode: "read_only" },
    { state_seq: stateSeq },
  );
  assert.ok(same.ok);
  assert.equal(same.value.permission_mode, "read_only");

  // 로컬 user는 read_only -> full로 다시 올릴 수 있다.
  const raised = commands.changeMode.handle(
    tx,
    localUser,
    { session: started.value.id, mode: "full" },
    { state_seq: stateSeq },
  );
  assert.ok(raised.ok);
  assert.equal(raised.value.permission_mode, "full");
  assert.equal(
    sql.get("select permission_mode from sessions where id = ?", [
      started.value.id,
    ])?.["permission_mode"],
    "full",
  );
});

// startSession의 mode 결정·팀 자식 상한(minPermissionMode)·비허락 mail 상한·fork 초기화를 확인한다.
test("startSession은 defaultMode·팀 자식 parentMode 상한·비허락 mail 상한을 지키고 fork는 출처 단계를 잇지 않는다", () => {
  const { db, sql, tx } = setupDb([
    ...conversationTestSteps,
    ...revertSchemaSteps,
  ]);
  void db;
  const openDeps = makeOpenDeps("ask");

  // 정의에 permission_mode가 없으면 defaultMode('ask')를 쓴다.
  const plain = startSession(tx, openDeps, {
    id: "ses_plain",
    agent: PLAIN_AGENT,
    workspace: null,
  });
  assert.ok(plain.ok);
  assert.equal(plain.value.permission_mode, "ask");

  // 명시적 permissionMode override(workflow participant 등)가 agent 정의보다 우선한다.
  const override = startSession(tx, openDeps, {
    id: "ses_override",
    agent: FULL_AGENT,
    workspace: null,
    permissionMode: "read_only",
  });
  assert.ok(override.ok);
  assert.equal(override.value.permission_mode, "read_only");

  // 팀 자식 session(spawnedBy)은 parentMode를 넘지 못한다.
  const childClamped = startSession(tx, openDeps, {
    id: "ses_child_clamped",
    agent: FULL_AGENT,
    workspace: null,
    spawnedBy: "ses_plain",
    parentMode: "ask",
  });
  assert.ok(childClamped.ok);
  assert.equal(childClamped.value.permission_mode, "ask");

  const childLower = startSession(tx, openDeps, {
    id: "ses_child_lower",
    agent: READONLY_AGENT,
    workspace: null,
    spawnedBy: "ses_override",
    parentMode: "full",
  });
  assert.ok(childLower.ok);
  assert.equal(childLower.value.permission_mode, "read_only");

  // 허락 없는 원격 mail(skipAllowed: false)은 최대 workspace다.
  const untrustedMail = startSession(tx, openDeps, {
    id: "ses_mail_clamped",
    agent: FULL_AGENT,
    workspace: null,
    skipAllowed: false,
  });
  assert.ok(untrustedMail.ok);
  assert.equal(untrustedMail.value.permission_mode, "workspace");

  // fork는 출처 session을 full로 올려 두었어도 agent 정의/defaultMode로 새로 시작한다.
  sql.run("update sessions set permission_mode = 'full' where id = ?", [
    "ses_plain",
  ]);
  sql.run(
    `insert into messages (id, session, from_kind, delivery, body, created_seq, created_at, state_seq)
     values ('msg_1', 'ses_plain', 'human', 'next_turn', ?, 1, '2026-11-25T00:00:00.000Z', 1)`,
    ["a".repeat(64)],
  );
  sql.run(
    "create table if not exists blob_refs (owner_kind text, owner_key text, field text, hash text, size_bytes integer, registered_seq integer)",
    [],
  );
  const commands = createConversationCommands({
    open: () => openDeps,
    end: UNWIRED_END_DEPS,
  } as never);
  const forked = commands.fork.handle(
    tx,
    { actor: "user", principal: "user" } as RequestContext,
    {
      id: "ses_01hzzzzzzzzzzzzzzzzzzzzz99",
      source: "ses_plain" as never,
      through_seq: "1",
    },
    {},
  );
  assert.ok(forked.ok, JSON.stringify(forked));
  assert.equal(
    sql.get("select permission_mode from sessions where id = ?", [
      "ses_01hzzzzzzzzzzzzzzzzzzzzz99",
    ])?.["permission_mode"],
    "ask",
  );
});

// 운영 schema step이 skip=1을 full로, turns.mode='skip'(진행 중·종료 모두)을 'attended'로 옮기고 두 trigger를 복구한다.
test("sessionPermissionModeSchemaSteps는 sessions·turns를 옮기고 turns 불변·종료 trigger를 보존한다", () => {
  const preSteps = [
    ...conversationSchemaSteps,
    ...appMessagesSchemaSteps,
    ...sessionOpenerSchemaSteps,
    ...guiMemberSchemaSteps,
    ...remoteSenderMessagesSchemaSteps,
    ...memberRunsOnSchemaSteps,
    ...workflowOriginSchemaSteps,
    ...turnSchemaSteps,
  ];
  const { db } = setupDb(preSteps);
  const hash = "b".repeat(64);
  db.exec(`
    insert into sessions (id, agent, lifecycle, skip, created_seq, state_seq)
      values ('ses_skip', 'lophn_home', 'open', 1, 1, 1),
             ('ses_norm', 'lophn_home', 'open', 0, 2, 2);
    insert into messages (id, session, from_kind, delivery, body, created_seq, created_at, state_seq)
      values ('msg_1', 'ses_skip', 'human', 'next_turn', '${hash}', 1, '2026-11-25T00:00:00.000Z', 1),
             ('msg_2', 'ses_skip', 'human', 'next_turn', '${hash}', 2, '2026-11-25T00:00:00.000Z', 2);
    insert into turns (id, session, input_message, state, basis, started_at, limits, mode, finished_at, outcome_kind, outcome_reason, result, state_seq)
      values ('trn_run', 'ses_skip', 'msg_1', 'running', '${hash}', '2026-11-25T00:00:00.000Z', '{}', 'skip', null, null, null, null, 1),
             ('trn_fin', 'ses_skip', 'msg_2', 'finished', '${hash}', '2026-11-25T00:00:00.000Z', '{}', 'skip', '2026-11-25T00:00:01.000Z', 'completed', 'done', '{}', 2);
  `);

  for (const step of sessionPermissionModeSchemaSteps) {
    db.exec(step.sql);
  }

  const sessions = db
    .prepare("select id, permission_mode from sessions order by id")
    .all();
  assert.deepStrictEqual(
    sessions.map((r) => [r["id"], r["permission_mode"]]),
    [
      ["ses_norm", "workspace"],
      ["ses_skip", "full"],
    ],
  );
  const turns = db.prepare("select id, mode from turns order by id").all();
  assert.deepStrictEqual(
    turns.map((r) => [r["id"], r["mode"]]),
    [
      ["trn_fin", "attended"],
      ["trn_run", "attended"],
    ],
  );

  // 두 trigger가 다시 살아 있어 mode 변경과 finished turn 수정을 막아야 한다.
  assert.throws(
    () => db.exec("update turns set mode = 'unattended' where id = 'trn_run'"),
    /fixed once started/,
  );
  assert.throws(
    () => db.exec("update turns set state = 'running' where id = 'trn_fin'"),
    /never reopened/,
  );
});
