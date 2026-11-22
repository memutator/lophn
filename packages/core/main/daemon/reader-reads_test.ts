import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { ReadSnapshot } from "../../../protocol/server/mod.ts";
import { appsSchemaSteps } from "../../apps/registration/schema.ts";
import { conversationTestSteps } from "../../lophn-agent/session/test-steps.ts";
import { modelSchemaSteps } from "../../lophn-agent/models/schema.ts";
import { turnSchemaSteps } from "../../lophn-agent/run-loop/schema.ts";
import {
  PROJECTS_FORMER_IDENTITY_STEPS,
  PROJECTS_IDENTITY_STEPS,
  PROJECTS_SEPARATED_STEPS,
  projectsSchemaSteps,
} from "../../projects/registry/schema.ts";
import { appSenderSchemaSteps } from "../../router/app-sender-schema.ts";
import { remoteSenderCallsSchemaSteps } from "../../router/remote-sender-schema.ts";
import { ROUTER_SCHEMA_STEPS } from "../../router/schema.ts";
import {
  composeReaderReads,
  readerModulesOf,
} from "../../storage/ledger/mod.ts";
import { TEAM_MODULES } from "./assembly.ts";

const PRJ = "prj_00000000000000000000000001";
const ses = (n: number) => `ses_${String(n).padStart(26, "0")}`;
const PARENT = ses(1);
const CHILD = ses(2);
const SIBLING = ses(3);
const OUTSIDER = ses(4);

// reader Worker가 조립하는 그대로 read를 만든다(core가 고르는 module, Worker의 조립). project의 팀원이 team read와
// session 목록에서 부모와 형제를 잃었던 것은 reader에 workspace 환경이 없어 project session이 모두 닫힌 것으로 읽혔기 때문이다.
test("reader에서 project의 팀원은 team read와 session 목록에서 부모와 형제를 handle로 본다", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "lophn-reader-reads-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const db = new DatabaseSync(join(root, "lophn.db"));
  t.after(() => db.close());
  for (const step of [
    ...projectsSchemaSteps,
    ...PROJECTS_IDENTITY_STEPS,
    ...PROJECTS_FORMER_IDENTITY_STEPS,
    ...PROJECTS_SEPARATED_STEPS,
    ...appsSchemaSteps,
    ...conversationTestSteps,
    ...modelSchemaSteps,
    ...turnSchemaSteps,
    ...ROUTER_SCHEMA_STEPS,
    appSenderSchemaSteps.find(
      (step) => step.id === "router.app-sender.agent-calls",
    )!,
    remoteSenderCallsSchemaSteps[0]!,
  ]) {
    db.exec(step.sql);
  }
  db.prepare(
    `insert into projects (id, name, title, purpose, revision, status, identity)
     values (?, 'site', 'site', '', '1', 'active', 'pri_00000000000000000000000001')`,
  ).run(PRJ);
  const insert = db.prepare(
    `insert into sessions (id, agent, project, workspace_kind, workspace_id, spawned_by,
       created_seq, state_seq) values (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const lophn = `lophn_${PRJ}`;
  insert.run(PARENT, lophn, PRJ, "project", PRJ, null, 1, 1);
  insert.run(CHILD, lophn, PRJ, "project", PRJ, PARENT, 2, 2);
  insert.run(SIBLING, lophn, PRJ, "project", PRJ, PARENT, 3, 3);
  insert.run(OUTSIDER, "lophn", null, null, null, null, 4, 4);

  const reads = await composeReaderReads(
    (await readerModulesOf(TEAM_MODULES)).map((url) => url.href),
    new Map(),
  );
  const snapshot = {
    as_of_seq: 1n,
    sql: {
      get: (query: string, params: never[]) => db.prepare(query).get(...params),
      all: (query: string, params: never[]) => db.prepare(query).all(...params),
    },
    port() {
      throw new Error("unregistered read port");
    },
  } as unknown as ReadSnapshot;
  const run = (key: string) => {
    const result = reads
      .get(key)!
      .read.handle(snapshot, { actor: `agent:${CHILD}` } as never, {});
    if (!result.ok) assert.fail(result.error.message);
    return result.value as Record<string, unknown>;
  };

  const team = run("team.read") as {
    parent: { session: string; agent: string } | null;
    siblings: { session: string; agent: string }[];
  };
  assert.equal(team.parent?.session, PARENT);
  assert.deepEqual(
    team.siblings.map((one) => one.session),
    [SIBLING],
  );
  assert.equal(team.parent?.agent, "lophn");

  const listed = run("calls.sendable") as {
    sessions: { session: string; handle: string }[];
  };
  assert.deepEqual(
    listed.sessions.map((one) => one.session),
    [PARENT, SIBLING],
  );
  assert.deepEqual(
    listed.sessions.map((one) => one.handle),
    ["lophn", "lophn"],
  );
});
