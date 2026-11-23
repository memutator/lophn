import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ok } from "../../base/mod.ts";
import type { AgentAtWorkspace } from "../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import { createJobCommands } from "./commands.ts";
import { jobMachinePort, jobTargetsPort, jobZonePort } from "./ports.ts";
import { jobsTestSteps, THIS_MACHINE } from "./test-steps.ts";
import { loadJob, loadJobRuns } from "./store.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const PRJ = "prj_01hzzzzzzzzzzzzzzzzzzzzzza";
const LOPHN_1 = "ses_01hzzzzzzzzzzzzzzzzzzzzzza";
const LOPHN_2 = "ses_01hzzzzzzzzzzzzzzzzzzzzzzb";
const LOPHN_PRJ = "ses_01hzzzzzzzzzzzzzzzzzzzzzzc";
const OTHER = "ses_01hzzzzzzzzzzzzzzzzzzzzzzd";
const OTHER_AGENT = "agt_01hzzzzzzzzzzzzzzzzzzzzzza";

const agents: Record<string, AgentAtWorkspace> = {
  [LOPHN_1]: { agent: "lophn_home", workspace: null },
  [LOPHN_2]: { agent: "lophn_home", workspace: null },
  [LOPHN_PRJ]: { agent: "lophn_home", workspace: { kind: "project", id: PRJ } },
  [OTHER]: { agent: OTHER_AGENT, workspace: null },
};

// 같은 agent라도 다른 workspace에 있으면 남의 job이다. 그 job을 고치면 남의 할당으로 일을 시키는 길이 된다.
test("agent는 같은 agent가 같은 workspace에서 만든 job만 고치고 지운다. 다른 workspace의 같은 agent와 다른 agent에게는 없는 job이고, 사람은 모두 고치고 지운다", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of jobsTestSteps) db.exec(step.sql);
    const sql = createSql(db, () => true);
    const ports = new Map<unknown, unknown>([
      [
        jobTargetsPort,
        {
          creatorOf: (session: string) => agents[session],
          resolveApp: () => ok(APP),
        },
      ],
      [jobZonePort, { zone: () => "UTC" }],
      [jobMachinePort, { id: () => ok(THIS_MACHINE) }],
    ]);
    const tx = {
      sql,
      now: () => "2026-10-22T00:00:00.000Z",
      newId: (prefix: string) => `${prefix}_01hzzzzzzzzzzzzzzzzzzzzzzb`,
      port: (key: unknown) => ports.get(key) ?? { push: () => {} },
    } as unknown as Tx;
    const commands = createJobCommands();
    const agent = (session: string) => ({ actor: `agent:${session}` }) as never;
    const user = { actor: "user" } as never;

    const created = commands.create.handle(
      tx,
      agent(LOPHN_1),
      {
        title: "Nightly",
        every: "1d",
        action: { kind: "tool_run", app: "notes", tool: "sweep" },
        missed_policy: "run",
      },
      {} as never,
    );
    assert.ok(created.ok);
    const job = created.value.job.id;
    sql.run(
      `INSERT INTO job_runs (id, job, due_at, missed_count, state, created_at)
       VALUES ('jbr_01hzzzzzzzzzzzzzzzzzzzzzza', ?, ?, 0, 'done', ?)`,
      [job, "2026-10-23T00:00:00.000Z", "2026-10-23T00:00:00.000Z"],
    );

    const code = (result: { ok: boolean; error?: { code: string } }) =>
      result.ok ? "ok" : result.error!.code;
    const kept = loadJob(sql, job, THIS_MACHINE);
    assert.ok(kept.ok && kept.value !== null);
    const unchanged = kept;

    for (const [name, session] of [
      ["another workspace", LOPHN_PRJ],
      ["another agent", OTHER],
    ] as const) {
      assert.deepStrictEqual(
        code(
          commands.update.handle(
            tx,
            agent(session),
            { job, title: `Changed by ${name}` },
            {} as never,
          ),
        ),
        "not_found",
      );
      assert.deepStrictEqual(
        code(commands.remove.handle(tx, agent(session), { job }, {} as never)),
        "not_found",
      );
      assert.deepStrictEqual(loadJob(sql, job, THIS_MACHINE), unchanged);
    }

    // 같은 agent와 workspace의 다른 session은 같은 job을 다룬다.
    for (const [session, title] of [
      [LOPHN_2, "Renamed by another session"],
      [null, "Renamed by user"],
    ] as const) {
      const who = session === null ? user : agent(session);
      assert.deepStrictEqual(
        code(commands.update.handle(tx, who, { job, title }, {} as never)),
        "ok",
      );
      const renamed = loadJob(sql, job, THIS_MACHINE);
      assert.ok(renamed.ok && renamed.value?.title === title);
    }

    assert.deepStrictEqual(
      code(commands.remove.handle(tx, user, { job }, {} as never)),
      "ok",
    );
    const gone = loadJob(sql, job, THIS_MACHINE);
    assert.ok(gone.ok && gone.value === null);
    const runs = loadJobRuns(sql, job, { limit: 10 });
    assert.ok(runs.ok && runs.value.length === 0);
  } finally {
    db.close();
  }
});

test("workflow_start job persists and reads optional inputs", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of jobsTestSteps) db.exec(step.sql);
    const sql = createSql(db, () => true);
    let seq = 0;
    const ports = new Map<unknown, unknown>([
      [
        jobTargetsPort,
        {
          creatorOf: (session: string) => agents[session],
          resolveProject: () => ok(PRJ),
        },
      ],
      [jobZonePort, { zone: () => "UTC" }],
      [jobMachinePort, { id: () => ok(THIS_MACHINE) }],
    ]);
    const tx = {
      sql,
      now: () => "2026-10-22T00:00:00.000Z",
      newId: (prefix: string) =>
        `${prefix}_01hzzzzzzzzzzzzzzzzzzzzzz${String.fromCharCode(97 + seq++)}`,
      port: (key: unknown) => ports.get(key) ?? { push: () => {} },
    } as unknown as Tx;
    const commands = createJobCommands();
    const agent = { actor: `agent:${LOPHN_1}` } as never;

    const withInputs = commands.create.handle(
      tx,
      agent,
      {
        title: "Deploy nightly",
        every: "1d",
        action: {
          kind: "workflow_start",
          workflow: "acme/deploy",
          text: "Run nightly deploy",
          step: "prepare",
          inputs: { env: "staging", dry_run: true, tags: ["a", "b"] },
        },
        missed_policy: "run",
      },
      {} as never,
    );
    assert.ok(withInputs.ok);
    const loaded = loadJob(sql, withInputs.value.job.id, THIS_MACHINE);
    assert.ok(loaded.ok && loaded.value !== null);
    assert.deepStrictEqual(loaded.value.action, {
      kind: "workflow_start",
      project: PRJ,
      workflow: "deploy",
      text: "Run nightly deploy",
      step: "prepare",
      inputs: { env: "staging", dry_run: true, tags: ["a", "b"] },
    });

    const withoutInputs = commands.create.handle(
      tx,
      agent,
      {
        title: "Plain workflow",
        every: "1d",
        action: {
          kind: "workflow_start",
          workflow: "acme/deploy",
          text: "Run plain",
        },
        missed_policy: "run",
      },
      {} as never,
    );
    assert.ok(withoutInputs.ok);
    const loadedPlain = loadJob(sql, withoutInputs.value.job.id, THIS_MACHINE);
    assert.ok(loadedPlain.ok && loadedPlain.value !== null);
    assert.deepStrictEqual(loadedPlain.value.action, {
      kind: "workflow_start",
      project: PRJ,
      workflow: "deploy",
      text: "Run plain",
    });
  } finally {
    db.close();
  }
});
