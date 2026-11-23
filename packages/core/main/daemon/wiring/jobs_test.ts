import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { type Logger, manualClock, ok } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/mod.ts";
import { resolveMachine } from "../../../../protocol/machine/requester.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";
import { createJobCommands } from "../../../jobs/commands.ts";
import { createDueCommands } from "../../../jobs/due.ts";
import {
  jobMachinePort,
  type JobSchedulerStore,
  jobTargetsPort,
  jobZonePort,
} from "../../../jobs/ports.ts";
import { createJobScheduler } from "../../../jobs/scheduler.ts";
import { jobsTestSteps, THIS_MACHINE } from "../../../jobs/test-steps.ts";
import { createSql } from "../../../storage/ledger/sqlite.ts";
import type { CommandEnvelope, Writer } from "../../../storage/ledger/mod.ts";
import { createJobStarter, withTriggerMachine } from "./jobs.ts";

const mch = (suffix: string) => `mch_${"0".repeat(24)}${suffix}` as Id<"mch">;
const dev = (suffix: string) => `dev_${"0".repeat(24)}${suffix}` as Id<"dev">;
const computers = [
  { machine: mch("00"), device: dev("00"), name: "studio", self: true },
  { machine: mch("a1"), device: dev("a1"), name: "laptop", self: false },
  { machine: mch("b1"), device: dev("b1"), name: "office", self: false },
  { machine: mch("b2"), device: dev("b2"), name: "office", self: false },
];

// 명단은 main thread에만 있어 job을 저장하기 전에 컴퓨터 이름을 `mch_`로 풀어 둔다. 못 풀거나 이 컴퓨터를 가리키는 이름이 job으로 저장되면 그 job은 영영 돌지 않는다.
test("job을 만들 때 trigger의 컴퓨터 이름은 저장 전에 mch_로 풀리고, 못 풀거나 이름이 겹치거나 이 컴퓨터이거나 명단이 아직 없으면 job을 저장하지 않는다", async () => {
  const stored: CommandEnvelope[] = [];
  const inner = {
    command: async (_ctx: unknown, envelope: CommandEnvelope) => {
      stored.push(envelope);
      return ok({ result: {}, replayed: false });
    },
  } as unknown as Writer;
  let known: typeof computers | undefined = computers;
  const writer = withTriggerMachine(inner, (ref) =>
    known === undefined ? undefined : resolveMachine(ref, known),
  );
  const create = (machine: string) =>
    writer.command(
      {} as never,
      {
        command: "job.create",
        input: {
          title: "t",
          trigger: { source: "app_x", event: "e", machine },
          action: {},
        },
        compare: {},
        idempotency_key: "k",
        prepared: [],
      } as never,
    );
  const code = (done: { ok: boolean; error?: { code: string } }) =>
    done.ok ? "ok" : done.error?.code;

  assert.equal(code(await create("laptop")), "ok");
  assert.equal(
    (stored[0]!.input as { trigger: { machine: string } }).trigger.machine,
    mch("a1"),
  );
  assert.equal(code(await create("nowhere")), "not_found");
  assert.equal(code(await create("office")), "invalid_input");
  assert.equal(code(await create("studio")), "invalid_input");
  known = undefined;
  assert.equal(code(await create("laptop")), "unavailable");
  // 저장 쪽에는 첫 하나만 갔다.
  assert.equal(stored.length, 1);

  // 다른 command와 trigger에 machine이 없는 job은 그대로 지난다.
  known = computers;
  await writer.command(
    {} as never,
    {
      command: "job.create",
      input: {
        title: "t",
        trigger: { source: "masup", event: "e" },
        action: {},
      },
    } as never,
  );
  assert.equal(stored.length, 2);
});

const silentLogger: Logger = {
  log: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  flush: () => Promise.resolve(),
};

test("workflow_start job persists inputs and forwards them to workflowService.start when fired", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of jobsTestSteps) db.exec(step.sql);
    const sql = createSql(db, () => true);
    const PRJ = "prj_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"prj">;
    const SES = "ses_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"ses">;
    const WFI = "wfi_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"wfi">;
    let now = "2026-10-22T00:00:00.000Z";
    let seq = 0;
    const ports = new Map<unknown, unknown>([
      [
        jobTargetsPort,
        {
          creatorOf: (session: string) =>
            session === SES
              ? { agent: "lophn_home", workspace: null }
              : undefined,
          resolveProject: () => ok(PRJ),
        },
      ],
      [jobZonePort, { zone: () => "UTC" }],
      [jobMachinePort, { id: () => ok(THIS_MACHINE) }],
    ]);
    const tx = {
      sql,
      now: () => now,
      newId: (prefix: string) =>
        `${prefix}_01hzzzzzzzzzzzzzzzzzzzzzz${String.fromCharCode(97 + seq++)}`,
      port: (key: unknown) => ports.get(key) ?? { push: () => {} },
    } as unknown as Tx;

    const jobCommands = createJobCommands();
    const dueCommands = createDueCommands();
    const created = jobCommands.create.handle(
      tx,
      { actor: `agent:${SES}` } as never,
      {
        title: "Release job",
        every: "1h",
        action: {
          kind: "workflow_start",
          workflow: "acme/release",
          text: "Start release",
          step: "build",
          inputs: { env: "prod", retries: 2, notify: true },
        },
        missed_policy: "run",
      },
      {} as never,
    );
    assert.ok(created.ok);
    const jobId = created.value.job.id;

    const approved = jobCommands.approve.handle(
      tx,
      { actor: "user" } as never,
      { job: jobId, choice: "approve" },
      {} as never,
    );
    assert.ok(approved.ok);

    now = "2026-10-22T01:05:00.000Z";
    const startedWorkflows: { input: unknown; by: unknown }[] = [];
    const startedJobRuns: unknown[] = [];

    const store: JobSchedulerStore = {
      open: () => Promise.resolve(ok([])),
      claimDue: (startup) =>
        Promise.resolve(
          dueCommands.claimDue.handle(
            tx,
            { actor: "machine" } as never,
            { startup },
            {} as never,
          ),
        ),
      started: (jobRun, found) => {
        startedJobRuns.push({ jobRun, found });
        return Promise.resolve(ok(undefined));
      },
      ended: () => Promise.resolve(ok(undefined)),
    };

    const starter = createJobStarter({
      workflowService: {
        start: (input, by) => {
          startedWorkflows.push({ input, by });
          return Promise.resolve(
            ok({
              instance: { id: WFI },
              handed: null,
            } as never),
          );
        },
      },
      runService: {
        start: () => Promise.reject(new Error("unused")),
        wait: () => Promise.reject(new Error("unused")),
      },
      instanceState: () => Promise.reject(new Error("unused")),
      isClosing: () => false,
    });

    const scheduler = createJobScheduler({
      clock: manualClock(Date.parse(now)),
      timers: { set: () => 1, clear: () => {} },
      store,
      starter,
      logger: silentLogger,
    });
    await scheduler.start();
    await scheduler.stop();

    assert.deepStrictEqual(startedWorkflows, [
      {
        input: {
          workflow: `${PRJ}/release`,
          text: "Start release",
          step: "build",
          inputs: { env: "prod", retries: 2, notify: true },
        },
        by: { kind: "job", job: jobId },
      },
    ]);
    assert.equal(startedJobRuns.length, 1);
  } finally {
    db.close();
  }
});
