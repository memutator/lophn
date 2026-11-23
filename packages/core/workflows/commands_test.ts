import assert from "node:assert/strict";
import { test } from "node:test";

import { DatabaseSync } from "node:sqlite";
import { err, ok } from "../../base/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import { DEFAULT_CALL_POLICY } from "../../protocol/lophn-agent/call-policy.ts";
import type { HandoffPlan } from "../../protocol/workflows/mod.ts";
import { createRouter } from "../router/mod.ts";
import type { RoutedInput } from "../router/ports.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import { createWorkflowCommands } from "./commands.ts";
import { workflowLinesSchemaSteps } from "./lines-schema.ts";
import { workflowsSchemaSteps } from "./schema.ts";
import { loadInstance, loadLines } from "./store.ts";

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

    // 멈추기 전에는 같은 report가 입력을 하나 넣는다. 넘어가지 않으면 이 test가 헛돈다.
    const before = report();
    assert.ok(before.ok && before.value.handed?.outcome === "handed");
    assert.deepStrictEqual(delivered.length, 2);
    // 넘길 때마다 받은 session의 workflow_origin을 갱신한다(session: same이면 step만 바뀐다).
    assert.deepStrictEqual(origins, [
      { session: SES, step: "a" },
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
    assert.deepStrictEqual(delivered.length, 2);
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
    assert.deepStrictEqual(delivered.length, 2);
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
