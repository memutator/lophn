import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ok } from "../../base/mod.ts";
import type { AgentRef } from "../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import { createJobCommands } from "./commands.ts";
import { jobTargetsPort, jobZonePort } from "./ports.ts";
import { jobsSchemaSteps } from "./schema.ts";
import { loadJob, loadJobRuns } from "./store.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const PRJ = "prj_01hzzzzzzzzzzzzzzzzzzzzzza";
const LOPHN_1 = "ses_01hzzzzzzzzzzzzzzzzzzzzzza";
const LOPHN_2 = "ses_01hzzzzzzzzzzzzzzzzzzzzzzb";
const PM = "ses_01hzzzzzzzzzzzzzzzzzzzzzzc";

const agents: Record<string, AgentRef> = {
  [LOPHN_1]: { role: "lophn" },
  [LOPHN_2]: { role: "lophn" },
  [PM]: { role: "project_manager", project: PRJ },
};

// 다른 agent가 만든 job을 고치거나 지울 수 있으면 agent가 서로의 예약을 망가뜨린다.
test("an agent cannot change or delete a job another agent made; a user changes and deletes any job", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(jobsSchemaSteps[0]!.sql);
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
    assert.deepStrictEqual(
      code(
        commands.update.handle(
          tx,
          agent(PM),
          { job, title: "Mine" },
          {} as never,
        ),
      ),
      "not_found",
    );
    assert.deepStrictEqual(
      code(commands.remove.handle(tx, agent(PM), { job }, {} as never)),
      "not_found",
    );
    const kept = loadJob(sql, job);
    assert.ok(kept.ok && kept.value?.title === "Nightly");

    // 같은 lophn의 다른 session은 같은 agent다.
    assert.deepStrictEqual(
      code(
        commands.update.handle(
          tx,
          agent(LOPHN_2),
          { job, title: "Renamed" },
          {} as never,
        ),
      ),
      "ok",
    );
    assert.deepStrictEqual(
      code(
        commands.update.handle(
          tx,
          user,
          { job, title: "By user" },
          {} as never,
        ),
      ),
      "ok",
    );

    assert.deepStrictEqual(
      code(commands.remove.handle(tx, user, { job }, {} as never)),
      "ok",
    );
    const gone = loadJob(sql, job);
    assert.ok(gone.ok && gone.value === null);
    const runs = loadJobRuns(sql, job, { limit: 10 });
    assert.ok(runs.ok && runs.value.length === 0);
  } finally {
    db.close();
  }
});
