import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { err, ok } from "../../base/mod.ts";
import { DEFAULT_CALL_POLICY } from "../../protocol/lophn-agent/call-policy.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import type { HandoffPlan } from "../../protocol/workflows/mod.ts";
import { createRouter } from "../router/mod.ts";
import type { RoutedInput } from "../router/ports.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import { createWorkflowCommands } from "./commands.ts";
import { workflowLinesSchemaSteps } from "./lines-schema.ts";
import { WORKFLOW_PARTICIPANT_MODES_SCHEMA_STEP } from "./participant-modes-schema.ts";
import { workflowsSchemaSteps } from "./schema.ts";
import { loadInstance, loadLines } from "./store.ts";
import { WORKFLOW_TITLE_SCHEMA_STEP } from "./title-schema.ts";
import {
  parentPermissionCeiling,
  runSubWorkflowCall,
} from "./workflow-call.ts";

const WFI = "wfi_01hzzzzzzzzzzzzzzzzzzzzzza";
const PRJ = "prj_01hzzzzzzzzzzzzzzzzzzzzzza";
const SES = "ses_01hzzzzzzzzzzzzzzzzzzzzzza";
const lophnAddress = { agent: "lophn", workspace: { project: PRJ } } as const;
const lophnAtWorkspace = { agent: "lophn", workspace: null } as const;

const plan = (step: string): HandoffPlan => ({
  step,
  participant: "planner",
  human_turn: false,
  cause: "report",
  session: "new",
  delivery: { to: lophnAddress, body: `do ${step}` },
  unresolved: null,
});

// 사람이 멈춘 instance에 늦게 온 report가 일을 다시 시작시키면 멈춘 뜻이 없어진다.
test("a stopped instance is not handed: report with next records the line only and hand_now is a conflict", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(workflowsSchemaSteps[0]!.sql);
    const sql = createSql(db, () => true);
    const delivered: RoutedInput[] = [];
    const origins: { session: string; step: string }[] = [];
    const tx = {
      sql,
      now: () => "2026-10-22T00:00:00.000Z",
      newId: (prefix: string) => `${prefix}_01hzzzzzzzzzzzzzzzzzzzzzzb`,
      port: () => ({ push: () => {} }),
    } as unknown as Tx;
    const router = createRouter({
      directory: {
        find: () => null,
        resolveAddress: () => ok(lophnAtWorkspace),
        archive: () => ok(false),
        membersOn: () => [],
        membersFrom: () => [],
        membersUnder: () => [],
        setWorkflowOrigin: (_tx, session, origin) => {
          origins.push({ session, step: origin.step });
        },
        openMember: () =>
          err({ code: "forbidden", message: "not in this test" }),
        open: () =>
          ok({
            session: SES,
            transport: "lophn",
            agent: lophnAtWorkspace,
            accepting: true,
            runs_on: null,
          } as never),
        app: () => null,
        accepts: () => null,
        listOpen: () => [],
        projectOfIdentity: () => null,
        identityOfProject: () => ok("pri_test"),
        appIdOf: () => err({ code: "not_found", message: "app not found" }),
      },
      store: {} as never,
      outbox: {} as never,
      seen: {} as never,
      self: () => "mch_self",
      steps: {} as never,
      announce: () => {},
      callPolicy: () => DEFAULT_CALL_POLICY,
      transport: {
        deliver: (_tx, _to, input) => {
          delivered.push(input);
          return ok(undefined);
        },
        cancel: () => ok(undefined),
        withdraw: () => ok(undefined),
      },
    });
    const commands = createWorkflowCommands(() => ok(router));
    const ctx = { actor: "machine" } as never;
    const seq = () => {
      const loaded = loadInstance(sql, WFI);
      assert.ok(loaded.ok && loaded.value !== null);
      return loaded.value.state_seq;
    };
    const count = () => {
      const lines = loadLines(sql, WFI, { after: 0, limit: null });
      assert.ok(lines.ok);
      return lines.value.length;
    };
    const report = () =>
      commands.apply.handle(
        tx,
        ctx,
        {
          instance: WFI,
          change: {
            kind: "report",
            step: "a",
            text: "done a",
            next: "b",
            session: "new",
          },
          by: { kind: "agent", session: SES },
          handoff: plan("b"),
        },
        { state_seq: seq() },
      );

    const created = commands.create.handle(
      tx,
      ctx,
      {
        id: WFI,
        project: PRJ,
        workflow: "demo",
        input: "go",
        participants: { planner: { agent: "lophn" } },
        steps: [],
        started_by: { kind: "user" },
        handoff: { ...plan("a"), cause: "start" },
      },
      {},
    );
    assert.ok(created.ok);
    assert.deepStrictEqual(delivered.length, 1);
    assert.equal(delivered[0]!.unattended, true);

    // 사람 step(human_turn: true)은 ask·승인 카드가 첫 turn부터 열리도록 attended(unattended: false)로 넘긴다.
    const toHuman = commands.apply.handle(
      tx,
      ctx,
      {
        instance: WFI,
        change: {
          kind: "report",
          step: "a",
          text: "ready for person",
          next: "design",
          session: "new",
        },
        by: { kind: "agent", session: SES },
        handoff: { ...plan("design"), human_turn: true },
      },
      { state_seq: seq() },
    );
    assert.ok(toHuman.ok && toHuman.value.handed?.outcome === "handed");
    assert.equal(delivered.at(-1)!.unattended, false);

    // 멈추기 전에는 같은 report가 입력을 하나 넣는다. 넘어가지 않으면 이 test가 헛돈다.
    const before = report();
    assert.ok(before.ok && before.value.handed?.outcome === "handed");
    assert.deepStrictEqual(delivered.length, 3);
    assert.equal(delivered.at(-1)!.unattended, true);
    // 넘길 때마다 받은 session의 workflow_origin을 갱신한다(session: same이면 step만 바뀐다).
    assert.deepStrictEqual(origins, [
      { session: SES, step: "a" },
      { session: SES, step: "design" },
      { session: SES, step: "b" },
    ]);

    const stop = commands.apply.handle(
      tx,
      ctx,
      {
        instance: WFI,
        change: { kind: "stop" },
        by: { kind: "user" },
        handoff: null,
      },
      { state_seq: seq() },
    );
    assert.ok(stop.ok);
    const lines = count();

    const after = report();
    assert.ok(after.ok);
    assert.deepStrictEqual(after.value.handed, null);
    assert.deepStrictEqual(delivered.length, 3);
    assert.deepStrictEqual(count(), lines + 1);

    const handNow = commands.apply.handle(
      tx,
      ctx,
      {
        instance: WFI,
        change: { kind: "edit", edit: { op: "hand_now", step: "b" } },
        by: { kind: "user" },
        handoff: plan("b"),
      },
      { state_seq: seq() },
    );
    assert.ok(!handNow.ok);
    assert.deepStrictEqual(handNow.error.code, "conflict");
    assert.deepStrictEqual(delivered.length, 3);
    assert.deepStrictEqual(count(), lines + 1);
  } finally {
    db.close();
  }
});

// report의 refs/data가 줄에 저장되어 다시 읽히고, same-session retry는 새 session을 열지 않으며(no fallback: "new")
// 닫힌 session이면 conflict로 tx 전체가 되돌아간다.
test("report persists refs/data and same-session retried never opens a new session", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(workflowsSchemaSteps[0]!.sql);
    db.exec(workflowLinesSchemaSteps[0]!.sql);
    const sql = createSql(db, () => true);
    const delivered: { session: string; input: RoutedInput }[] = [];
    let openedCount = 0;
    let sessionAccepting = true;
    const tx = {
      sql,
      now: () => "2026-10-22T00:00:00.000Z",
      newId: (prefix: string) => `${prefix}_01hzzzzzzzzzzzzzzzzzzzzzzb`,
      port: () => ({ push: () => {} }),
    } as unknown as Tx;
    const router = createRouter({
      directory: {
        find: (session) =>
          session === SES
            ? ({
                session: SES,
                transport: "lophn",
                agent: lophnAtWorkspace,
                accepting: sessionAccepting,
                open: sessionAccepting,
                spawned_by: null,
                opened_by_machine: null,
                runs_on: null,
              } as never)
            : null,
        resolveAddress: () => ok(lophnAtWorkspace),
        archive: () => ok(false),
        membersOn: () => [],
        membersFrom: () => [],
        membersUnder: () => [],
        setWorkflowOrigin: () => {},
        openMember: () =>
          err({ code: "forbidden", message: "not in this test" }),
        open: () => {
          openedCount += 1;
          return ok({
            session: SES,
            transport: "lophn",
            agent: lophnAtWorkspace,
            accepting: true,
            runs_on: null,
          } as never);
        },
        app: () => null,
        accepts: () => null,
        listOpen: () => [],
        projectOfIdentity: () => null,
        identityOfProject: () => ok("pri_test"),
        appIdOf: () => err({ code: "not_found", message: "app not found" }),
      },
      store: {} as never,
      outbox: {} as never,
      seen: {} as never,
      self: () => "mch_self",
      steps: {} as never,
      announce: () => {},
      callPolicy: () => DEFAULT_CALL_POLICY,
      transport: {
        deliver: (_tx, to, input) => {
          delivered.push({ session: to.session, input });
          return ok(undefined);
        },
        cancel: () => ok(undefined),
        withdraw: () => ok(undefined),
      },
    });
    const commands = createWorkflowCommands(() => ok(router));
    const ctx = { actor: "machine" } as never;
    const seq = () => {
      const loaded = loadInstance(sql, WFI);
      assert.ok(loaded.ok && loaded.value !== null);
      return loaded.value.state_seq;
    };

    const created = commands.create.handle(
      tx,
      ctx,
      {
        id: WFI,
        project: PRJ,
        workflow: "demo",
        input: "go",
        participants: { planner: { agent: "lophn" } },
        steps: [],
        started_by: { kind: "user" },
        handoff: { ...plan("a"), cause: "start" },
      },
      {},
    );
    assert.ok(created.ok);
    assert.equal(openedCount, 1);

    // refs와 data가 report 줄에 그대로 남는다.
    const reported = commands.apply.handle(
      tx,
      ctx,
      {
        instance: WFI,
        change: {
          kind: "report",
          step: "a",
          text: "progress",
          next: null,
          session: "new",
          refs: ["reports/a.md"],
          data: { score: 42, ok: true },
        },
        by: { kind: "agent", session: SES },
        handoff: null,
      },
      { state_seq: seq() },
    );
    assert.ok(reported.ok);
    const afterReport = loadLines(sql, WFI, { after: 0, limit: null });
    assert.ok(afterReport.ok);
    const reportLine = afterReport.value.find((l) => l.kind === "report");
    assert.ok(reportLine?.kind === "report");
    assert.deepStrictEqual(reportLine.refs, ["reports/a.md"]);
    assert.deepStrictEqual(reportLine.data, { score: 42, ok: true });

    // same-session retry는 같은 session으로 배달하고 새 session을 열지 않는다.
    const retried = commands.apply.handle(
      tx,
      ctx,
      {
        instance: WFI,
        change: {
          kind: "retried",
          step: "a",
          session: SES,
          body: "continue step a",
        },
        by: { kind: "user" },
        handoff: null,
      },
      { state_seq: seq() },
    );
    assert.ok(retried.ok);
    assert.equal(openedCount, 1);
    assert.equal(delivered.length, 2);
    assert.equal(delivered[1]!.session, SES);

    // session이 닫혔으면 새 session으로 fallback하지 않고 conflict다.
    sessionAccepting = false;
    const closedRetry = commands.apply.handle(
      tx,
      ctx,
      {
        instance: WFI,
        change: {
          kind: "retried",
          step: "a",
          session: SES,
          body: "continue again",
        },
        by: { kind: "user" },
        handoff: null,
      },
      { state_seq: seq() },
    );
    assert.ok(!closedRetry.ok);
    assert.equal(closedRetry.error.code, "conflict");
    assert.equal(openedCount, 1);
  } finally {
    db.close();
  }
});

test("workflow instance title: rename persists user title and AI title does not overwrite user rename", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(workflowsSchemaSteps[0]!.sql);
    db.exec(WORKFLOW_TITLE_SCHEMA_STEP.sql);
    const sql = createSql(db, () => true);
    const tx = {
      sql,
      now: () => "2026-11-25T00:00:00.000Z",
      newId: (prefix: string) => `${prefix}_01hzzzzzzzzzzzzzzzzzzzzzzb`,
      port: () => ({ push: () => {} }),
    } as unknown as Tx;
    const commands = createWorkflowCommands();
    const machineCtx = {
      actor: "machine",
      principal: "machine:workflows",
      conditions: {},
    } as never;
    const userCtx = {
      actor: "user",
      principal: "user:person",
      conditions: {},
    } as never;

    const created = commands.create.handle(
      tx,
      machineCtx,
      {
        id: WFI,
        project: PRJ,
        workflow: "cleanroom",
        title: "Initial auto title",
        input: "Initial auto title\nmore detail",
        participants: {},
        steps: [],
        started_by: { kind: "user" },
        handoff: null,
      },
      {},
    );
    assert.ok(created.ok);
    assert.equal(created.value.instance.title, "Initial auto title");

    // non-user cannot call rename
    const forbidden = commands.rename.handle(
      tx,
      machineCtx,
      { instance: WFI, title: "Not allowed" },
      {},
    );
    assert.ok(!forbidden.ok);
    assert.equal(forbidden.error.code, "forbidden");

    // AI title applies when expected matches current title
    const aiApplied = commands.setAiTitle.handle(
      tx,
      machineCtx,
      {
        instance: WFI,
        expected: "Initial auto title",
        title: "Fix auth timeout",
      },
      {},
    );
    assert.ok(aiApplied.ok);
    assert.equal(aiApplied.value.changed, true);
    assert.equal(aiApplied.value.title, "Fix auth timeout");

    // User rename updates title
    const renamed = commands.rename.handle(
      tx,
      userCtx,
      { instance: WFI, title: "  Auth timeout hotfix  " },
      {},
    );
    assert.ok(renamed.ok);
    assert.equal(renamed.value.title, "Auth timeout hotfix");

    // Stale AI title with old expected does NOT overwrite user's title
    const staleAi = commands.setAiTitle.handle(
      tx,
      machineCtx,
      {
        instance: WFI,
        expected: "Fix auth timeout",
        title: "Late AI overwrite",
      },
      {},
    );
    assert.ok(staleAi.ok);
    assert.equal(staleAi.value.changed, false);
    assert.equal(staleAi.value.title, "Auth timeout hotfix");

    const loaded = loadInstance(sql, WFI);
    assert.ok(loaded.ok && loaded.value !== null);
    assert.equal(loaded.value.title, "Auth timeout hotfix");
  } finally {
    db.close();
  }
});

test("workflow participant_modes persists on instance and passes permissionMode to router on step handoffs", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(workflowsSchemaSteps[0]!.sql);
    db.exec(WORKFLOW_PARTICIPANT_MODES_SCHEMA_STEP.sql);
    const sql = createSql(db, () => true);
    const routedCalls: Array<{
      step: string | undefined;
      permissionMode: string | undefined;
      unattended: boolean | undefined;
    }> = [];
    const tx = {
      sql,
      now: () => "2026-11-25T00:00:00.000Z",
      newId: (prefix: string) => `${prefix}_01hzzzzzzzzzzzzzzzzzzzzzzb`,
      port: () => ({ push: () => {} }),
    } as unknown as Tx;
    const fakeRouter = {
      route: (_tx: Tx, input: Record<string, unknown>) => {
        routedCalls.push({
          step: (input.step as { step?: string } | undefined)?.step,
          permissionMode: input.permissionMode as string | undefined,
          unattended: input.unattended as boolean | undefined,
        });
        return ok({
          call: null,
          state: "done",
          fail_reason: null,
          session: SES,
        });
      },
    };
    const commands = createWorkflowCommands(() => ok(fakeRouter as never));
    const ctx = { actor: "machine" } as never;

    const created = commands.create.handle(
      tx,
      ctx,
      {
        id: WFI,
        project: PRJ,
        workflow: "deploy",
        input: "ship",
        participants: {
          planner: { agent: "lophn" },
          executor: { agent: "lophn" },
          coder: { agent: "claude" },
        },
        participant_modes: {
          planner: "read_only",
          executor: "full",
        },
        steps: [],
        started_by: { kind: "user" },
        handoff: { ...plan("plan"), participant: "planner", cause: "start" },
      },
      {},
    );
    assert.ok(created.ok);
    assert.deepStrictEqual(created.value.instance.participant_modes, {
      planner: "read_only",
      executor: "full",
    });

    const loaded = loadInstance(sql, WFI);
    assert.ok(loaded.ok && loaded.value !== null);
    assert.deepStrictEqual(loaded.value.participant_modes, {
      planner: "read_only",
      executor: "full",
    });

    // 다음 step(executor, human_turn: false)은 저장된 participant_modes.executor("full")을 받는다.
    const nextHand = commands.apply.handle(
      tx,
      ctx,
      {
        instance: WFI,
        change: {
          kind: "report",
          step: "plan",
          text: "planned",
          next: "exec",
          session: "new",
        },
        by: { kind: "agent", session: SES },
        handoff: { ...plan("exec"), participant: "executor" },
      },
      { state_seq: loaded.value.state_seq },
    );
    assert.ok(nextHand.ok);

    // harness participant(coder)는 participant_modes에 없으므로 permissionMode가 undefined다.
    const harnessHand = commands.apply.handle(
      tx,
      ctx,
      {
        instance: WFI,
        change: {
          kind: "report",
          step: "exec",
          text: "handoff to harness",
          next: "code",
          session: "new",
        },
        by: { kind: "agent", session: SES },
        handoff: { ...plan("code"), participant: "coder", human_turn: true },
      },
      { state_seq: nextHand.value.instance.state_seq },
    );
    assert.ok(harnessHand.ok);

    assert.deepStrictEqual(routedCalls, [
      { step: "plan", permissionMode: "read_only", unattended: true },
      { step: "exec", permissionMode: "full", unattended: true },
      { step: "code", permissionMode: undefined, unattended: false },
    ]);
  } finally {
    db.close();
  }
});

test("sub-workflow call computes parentPermissionCeiling and passes maxMode to start", async () => {
  assert.equal(
    parentPermissionCeiling({
      current: { step: "plan", human_turn: false },
      steps: [
        {
          name: "plan",
          by: "planner",
          with: null,
          prompt: "p",
          in: "",
          out: "",
          next: [],
        },
      ],
      participants: {
        planner: { agent: "lophn" },
        deployer: { agent: "lophn" },
      },
      participant_modes: { planner: "ask", deployer: "full" },
    }),
    "ask",
  );
  // flow 등 current가 없으면 부모 participant_modes 중 가장 좁은 단계를 상한으로 삼는다.
  assert.equal(
    parentPermissionCeiling({
      current: null,
      steps: [],
      participants: {
        a: { agent: "lophn" },
        b: { agent: "lophn" },
      },
      participant_modes: { a: "full", b: "read_only" },
    }),
    "read_only",
  );

  const CHILD = "wfi_01hzzzzzzzzzzzzzzzzzzzzzzc" as const;
  let receivedMaxMode: string | undefined;
  const parentInstance = {
    id: WFI,
    project: PRJ,
    workflow: "parent",
    input: "go",
    state: "running" as const,
    participants: { planner: { agent: "lophn" }, deployer: { agent: "lophn" } },
    steps: [
      {
        name: "plan",
        by: "planner",
        with: null,
        prompt: "p",
        in: "",
        out: "",
        next: [],
      },
    ],
    current: { step: "plan", human_turn: false },
    started_by: { kind: "user" as const },
    participant_modes: {
      planner: "workspace" as const,
      deployer: "full" as const,
    },
    created_at: "2026-11-25T00:00:00.000Z",
    finished_at: null,
    state_seq: "1",
  };
  const childInstance = {
    ...parentInstance,
    id: CHILD,
    workflow: "child",
    state: "ended" as const,
    started_by: { kind: "workflow" as const, instance: WFI },
    finished_at: "2026-11-25T00:01:00.000Z",
  };

  const outcome = await runSubWorkflowCall(
    {
      store: {
        create: () => Promise.reject(new Error("unused")),
        apply: () => Promise.reject(new Error("unused")),
        running: () => Promise.resolve(ok([])),
        read: (id) =>
          Promise.resolve(
            ok({
              instance: id === WFI ? parentInstance : childInstance,
              last_reports: {},
              lines: [],
              remote_steps: [],
              as_of_seq: "1",
              next_cursor: null,
            }),
          ),
      },
      projects: {
        resolve: () => Promise.resolve(ok({ id: PRJ, name: "demo" })),
        nameOf: () => Promise.resolve(ok("demo")),
      },
      start: (_input, _by, options) => {
        receivedMaxMode = options?.maxMode;
        return Promise.resolve(ok({ instance: childInstance, handed: null }));
      },
      stop: () => Promise.resolve(ok({ instance: childInstance })),
      subscribeInstanceUpdated: () => () => {},
      loadCheckpoints: () => Promise.resolve(ok([])),
    },
    {
      parentInstance: WFI,
      key: "sub#1",
      workflow: "child",
      input: "run child",
    },
  );
  assert.ok(outcome.ok);
  assert.equal(receivedMaxMode, "workspace");
});
