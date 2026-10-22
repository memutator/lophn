import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { ok } from "../../base/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import type { HandoffPlan } from "../../protocol/workflows/mod.ts";
import { createRouter } from "../router/mod.ts";
import type { RoutedInput } from "../router/ports.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import { createWorkflowCommands } from "./commands.ts";
import { workflowsSchemaSteps } from "./schema.ts";
import { loadInstance, loadLines } from "./store.ts";

const WFI = "wfi_01hzzzzzzzzzzzzzzzzzzzzzza";
const PRJ = "prj_01hzzzzzzzzzzzzzzzzzzzzzza";
const SES = "ses_01hzzzzzzzzzzzzzzzzzzzzzza";
const lophn = { role: "lophn" } as const;

const plan = (step: string): HandoffPlan => ({
  step,
  participant: "pm",
  human_turn: false,
  cause: "report",
  session: "new",
  delivery: { to: lophn, body: `do ${step}` },
  unresolved: null,
});

// 사람이 멈춘 instance에 늦게 온 report가 일을 다시 시작시키면 멈춘 뜻이 없어진다.
Deno.test("a stopped instance is not handed: report with next records the line only and hand_now is a conflict", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(workflowsSchemaSteps[0]!.sql);
    const sql = createSql(db, () => true);
    const delivered: RoutedInput[] = [];
    const tx = {
      sql,
      now: () => "2026-10-22T00:00:00.000Z",
      newId: (prefix: string) => `${prefix}_01hzzzzzzzzzzzzzzzzzzzzzzb`,
      port: () => ({ push: () => {} }),
    } as unknown as Tx;
    const router = createRouter({
      directory: {
        find: () => null,
        resolveAgent: () => ok(lophn),
        openOf: () => null,
        open: () =>
          ok({
            session: SES,
            transport: "lophn",
            agent: lophn,
            accepting: true,
          } as never),
        listOpen: () => [],
      },
      store: {} as never,
      transport: {
        deliver: (_tx, _to, input) => {
          delivered.push(input);
          return ok("delivered" as const);
        },
        cancel: () => ok(undefined),
        queued: () => [],
      },
    });
    const commands = createWorkflowCommands(() => ok(router));
    const ctx = { actor: "machine" } as never;
    const seq = () => {
      const loaded = loadInstance(sql, WFI);
      assert(loaded.ok && loaded.value !== null);
      return loaded.value.state_seq;
    };
    const count = () => {
      const lines = loadLines(sql, WFI, { after: 0, limit: null });
      assert(lines.ok);
      return lines.value.length;
    };
    const report = () =>
      commands.apply.handle(tx, ctx, {
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
      }, { state_seq: seq() });

    const created = commands.create.handle(tx, ctx, {
      id: WFI,
      project: PRJ,
      workflow: "demo",
      input: "go",
      participants: { pm: { role: "lophn" } },
      steps: [],
      started_by: { kind: "user" },
      handoff: { ...plan("a"), cause: "start" },
    }, {});
    assert(created.ok);
    assertEquals(delivered.length, 1);

    // 멈추기 전에는 같은 report가 입력을 하나 넣는다. 넘어가지 않으면 이 test가 헛돈다.
    const before = report();
    assert(before.ok && before.value.handed?.outcome === "handed");
    assertEquals(delivered.length, 2);

    const stop = commands.apply.handle(tx, ctx, {
      instance: WFI,
      change: { kind: "stop" },
      by: { kind: "user" },
      handoff: null,
    }, { state_seq: seq() });
    assert(stop.ok);
    const lines = count();

    const after = report();
    assert(after.ok);
    assertEquals(after.value.handed, null);
    assertEquals(delivered.length, 2);
    assertEquals(count(), lines + 1);

    const handNow = commands.apply.handle(tx, ctx, {
      instance: WFI,
      change: { kind: "edit", edit: { op: "hand_now", step: "b" } },
      by: { kind: "user" },
      handoff: plan("b"),
    }, { state_seq: seq() });
    assert(!handNow.ok);
    assertEquals(handNow.error.code, "conflict");
    assertEquals(delivered.length, 2);
    assertEquals(count(), lines + 1);
  } finally {
    db.close();
  }
});
