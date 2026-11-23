import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ok } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import type { AgentAtWorkspace } from "../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import {
  createJobCommands,
  eraseJobsOfAgent,
  eraseJobsOfWorkflow,
  renameJobsOfWorkflow,
} from "./commands.ts";
import {
  JOBS_CHANGED_TOPIC,
  jobMachinePort,
  jobTargetsPort,
  jobZonePort,
} from "./ports.ts";
import { insertJob, loadJob, loadJobRuns } from "./store.ts";
import { jobsTestSteps, THIS_MACHINE } from "./test-steps.ts";

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

// agent 삭제와 workflow 이름 변경·삭제가 관련 job·job_runs를 결정적으로 정리하고, 인계용 명세를 돌려주며 jobsChanged를 낸다.
test("eraseJobsOfAgent, eraseJobsOfWorkflow, and renameJobsOfWorkflow clean up and update jobs deterministically", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of jobsTestSteps) db.exec(step.sql);
    const sql = createSql(db, () => true);
    const topics: string[] = [];
    const tx = {
      sql,
      now: () => "2026-10-22T00:00:00.000Z",
      newId: (prefix: string) => `${prefix}_01hzzzzzzzzzzzzzzzzzzzzzzz`,
      port: () => ({
        push: (topic: string) => topics.push(topic),
      }),
    } as unknown as Tx;

    const PRJ_2 = "prj_01hzzzzzzzzzzzzzzzzzzzzzzb" as Id<"prj">;
    const GLOBAL_AGT = "agt_01hzzzzzzzzzzzzzzzzzzzzzzg";
    const SCOPED_AGT = "agt_01hzzzzzzzzzzzzzzzzzzzzzzs";
    const KEEP_AGT = "agt_01hzzzzzzzzzzzzzzzzzzzzzzk";

    const addRun = (id: string, job: string) => {
      sql.run(
        `INSERT INTO job_runs (id, job, due_at, missed_count, state, created_at)
         VALUES (?, ?, '2026-10-23T00:00:00.000Z', 0, 'done', '2026-10-23T00:00:00.000Z')`,
        [id, job],
      );
    };

    // 1) 전역 agent가 만든 job과 전역 agent를 project에서 부르는 job.
    insertJob(sql, {
      id: "job_01hzzzzzzzzzzzzzzzzzzzzzz1",
      title: "Created by global",
      creator: { agent: GLOBAL_AGT as never, workspace: null },
      every: "1d",
      at: "09:00",
      action: { kind: "tool_run", app: APP as never, tool: "sweep" },
      missed_policy: "run",
      enabled: true,
      machine: THIS_MACHINE,
      created_at: "2026-10-22T00:00:00.000Z",
    });
    addRun("jbr_01hzzzzzzzzzzzzzzzzzzzzzz1", "job_01hzzzzzzzzzzzzzzzzzzzzzz1");
    insertJob(sql, {
      id: "job_01hzzzzzzzzzzzzzzzzzzzzzz2",
      title: "Targets global in project",
      creator: { agent: "lophn_home", workspace: null },
      every: "1h",
      at: null,
      action: {
        kind: "agent_run",
        agent: GLOBAL_AGT as never,
        agent_workspace: { kind: "project", id: PRJ as never },
        prompt: "review",
      },
      missed_policy: "run",
      enabled: true,
      machine: THIS_MACHINE,
      created_at: "2026-10-22T00:00:00.000Z",
    });
    // 2) project 범위 agent의 job과 다른 project 범위의 무관한 job.
    insertJob(sql, {
      id: "job_01hzzzzzzzzzzzzzzzzzzzzzz3",
      title: "Scoped agent job",
      creator: {
        agent: "lophn_home",
        workspace: { kind: "project", id: PRJ as never },
      },
      every: "1h",
      at: null,
      action: {
        kind: "agent_run",
        agent: SCOPED_AGT as never,
        agent_workspace: { kind: "project", id: PRJ as never },
        prompt: "sync",
      },
      missed_policy: "run",
      enabled: true,
      machine: THIS_MACHINE,
      created_at: "2026-10-22T00:00:00.000Z",
    });
    insertJob(sql, {
      id: "job_01hzzzzzzzzzzzzzzzzzzzzzz4",
      title: "Keep unrelated agent",
      creator: { agent: KEEP_AGT as never, workspace: null },
      every: "1h",
      at: null,
      action: {
        kind: "agent_run",
        agent: KEEP_AGT as never,
        agent_workspace: { kind: "project", id: PRJ_2 },
        prompt: "keep",
      },
      missed_policy: "run",
      enabled: true,
      machine: THIS_MACHINE,
      created_at: "2026-10-22T00:00:00.000Z",
    });
    // 3) workflow_start job 둘(같은 project, 다른 project).
    insertJob(sql, {
      id: "job_01hzzzzzzzzzzzzzzzzzzzzzz5",
      title: "Deploy prj1",
      creator: { agent: "lophn_home", workspace: null },
      every: "1d",
      at: null,
      action: {
        kind: "workflow_start",
        project: PRJ as never,
        workflow: "deploy",
        text: "ship",
        inputs: { env: "prod" },
      },
      missed_policy: "run",
      enabled: true,
      machine: THIS_MACHINE,
      created_at: "2026-10-22T00:00:00.000Z",
    });
    addRun("jbr_01hzzzzzzzzzzzzzzzzzzzzzz5", "job_01hzzzzzzzzzzzzzzzzzzzzzz5");
    insertJob(sql, {
      id: "job_01hzzzzzzzzzzzzzzzzzzzzzz6",
      title: "Deploy prj2",
      creator: { agent: "lophn_home", workspace: null },
      every: "1d",
      at: null,
      action: {
        kind: "workflow_start",
        project: PRJ_2,
        workflow: "deploy",
        text: "ship2",
      },
      missed_policy: "run",
      enabled: true,
      machine: THIS_MACHINE,
      created_at: "2026-10-22T00:00:00.000Z",
    });

    const erasedGlobal = eraseJobsOfAgent(tx, {
      id: GLOBAL_AGT,
      handle: "reviewer",
      workspace: null,
    });
    assert.deepStrictEqual(
      erasedGlobal.map((item) => [item.id, item.title]),
      [
        ["job_01hzzzzzzzzzzzzzzzzzzzzzz1", "Created by global"],
        ["job_01hzzzzzzzzzzzzzzzzzzzzzz2", "Targets global in project"],
      ],
    );
    assert.ok(erasedGlobal[0]!.summary.includes("every 1d at 09:00"));
    const job1 = loadJob(sql, "job_01hzzzzzzzzzzzzzzzzzzzzzz1", THIS_MACHINE);
    assert.ok(job1.ok && job1.value === null);
    const runsGone = loadJobRuns(sql, "job_01hzzzzzzzzzzzzzzzzzzzzzz1", {
      limit: 10,
    });
    assert.ok(runsGone.ok && runsGone.value.length === 0);
    assert.equal(topics.pop(), JOBS_CHANGED_TOPIC);

    // 다른 project 범위로 지우면 PRJ의 scoped agent job은 남고, PRJ 범위로 지우면 지워진다.
    assert.deepStrictEqual(
      eraseJobsOfAgent(tx, {
        id: SCOPED_AGT,
        handle: "syncer",
        workspace: { kind: "project", id: PRJ_2 },
      }),
      [],
    );
    assert.equal(topics.length, 0);
    const erasedScoped = eraseJobsOfAgent(tx, {
      id: SCOPED_AGT,
      handle: "syncer",
      workspace: { kind: "project", id: PRJ as Id<"prj"> },
    });
    assert.deepStrictEqual(
      erasedScoped.map((item) => item.id),
      ["job_01hzzzzzzzzzzzzzzzzzzzzzz3"],
    );
    assert.equal(topics.pop(), JOBS_CHANGED_TOPIC);

    // renameJobsOfWorkflow는 같은 project만 바꾸고 inputs 등 나머지 필드를 유지한다.
    assert.equal(
      renameJobsOfWorkflow(tx, PRJ as Id<"prj">, "deploy", "deploy"),
      0,
    );
    assert.equal(
      renameJobsOfWorkflow(tx, PRJ as Id<"prj">, "deploy", "release"),
      1,
    );
    assert.equal(topics.pop(), JOBS_CHANGED_TOPIC);
    const renamed = loadJob(
      sql,
      "job_01hzzzzzzzzzzzzzzzzzzzzzz5",
      THIS_MACHINE,
    );
    assert.ok(renamed.ok && renamed.value !== null);
    assert.deepStrictEqual(renamed.value.action, {
      kind: "workflow_start",
      project: PRJ,
      workflow: "release",
      text: "ship",
      inputs: { env: "prod" },
    });
    const otherPrj = loadJob(
      sql,
      "job_01hzzzzzzzzzzzzzzzzzzzzzz6",
      THIS_MACHINE,
    );
    assert.ok(
      otherPrj.ok &&
        otherPrj.value?.action.kind === "workflow_start" &&
        otherPrj.value.action.workflow === "deploy",
    );

    // eraseJobsOfWorkflow는 바뀐 이름의 job과 그 job_runs만 지운다.
    const erasedWf = eraseJobsOfWorkflow(tx, PRJ as Id<"prj">, "release");
    assert.deepStrictEqual(
      erasedWf.map((item) => [item.id, item.title]),
      [["job_01hzzzzzzzzzzzzzzzzzzzzzz5", "Deploy prj1"]],
    );
    assert.ok(erasedWf[0]!.summary.includes("workflow_start"));
    const wfRunsGone = loadJobRuns(sql, "job_01hzzzzzzzzzzzzzzzzzzzzzz5", {
      limit: 10,
    });
    assert.ok(wfRunsGone.ok && wfRunsGone.value.length === 0);
    assert.equal(topics.pop(), JOBS_CHANGED_TOPIC);

    // 무관한 agent와 다른 project의 workflow job은 그대로 남는다.
    const kept4 = loadJob(sql, "job_01hzzzzzzzzzzzzzzzzzzzzzz4", THIS_MACHINE);
    assert.ok(kept4.ok && kept4.value !== null);
    const kept6 = loadJob(sql, "job_01hzzzzzzzzzzzzzzzzzzzzzz6", THIS_MACHINE);
    assert.ok(kept6.ok && kept6.value !== null);
  } finally {
    db.close();
  }
});
