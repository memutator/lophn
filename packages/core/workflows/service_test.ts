import assert from "node:assert/strict";
import { test } from "node:test";

import { DatabaseSync } from "node:sqlite";
import { createIdSource, ok } from "../../base/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import { createWorkflowCommands } from "./commands.ts";
import type { WorkflowFlows } from "./ports.ts";
import { workflowsSchemaSteps } from "./schema.ts";
import { createWorkflowService } from "./service.ts";
import {
  appendLine,
  insertInstance,
  lastReports,
  loadInstance,
  loadLines,
  runningInstances,
} from "./store.ts";
import { createSql } from "../storage/ledger/sqlite.ts";

const FLOW = "wfi_01hzzzzzzzzzzzzzzzzzzzzzza";
const AGENT = "wfi_01hzzzzzzzzzzzzzzzzzzzzzzb";
const PRJ = "prj_01hzzzzzzzzzzzzzzzzzzzzzza";
const AT = "2026-10-22T00:00:00.000Z";

// 켤 때 running인 flow instance를 닫는 것이 process를 다시 띄우면 바깥 효과가 두 번 난다.
// agent instance는 handed 줄이 없을 뿐 건드리지 않는다.
test("reconcile closes a running flow instance without launching again and leaves an agent instance alone", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(workflowsSchemaSteps[0]!.sql);
    const sql = createSql(db, () => true);
    const tx = {
      sql,
      now: () => AT,
      newId: (prefix: string) => `${prefix}_01hzzzzzzzzzzzzzzzzzzzzzzc`,
      port: () => ({ push: () => {} }),
    } as unknown as Tx;
    const commands = createWorkflowCommands(() => {
      throw new Error("router is not used");
    });
    const ctx = { actor: "machine" } as never;
    const launched: unknown[] = [];
    const flows: WorkflowFlows = {
      launch: (start) => {
        launched.push(start);
        return Promise.resolve(ok(undefined));
      },
      stop: () => Promise.resolve(ok(undefined)),
    };
    const kinds = (id: string) => {
      const lines = loadLines(sql, id, { after: 0, limit: null });
      assert.ok(lines.ok);
      return lines.value.map((l) => l.kind);
    };
    const stateOf = (id: string) => {
      const loaded = loadInstance(sql, id);
      assert.ok(loaded.ok && loaded.value !== null);
      return loaded.value.state;
    };

    const created = commands.create.handle(tx, ctx, {
      id: FLOW,
      project: PRJ,
      workflow: "demo",
      input: "go",
      participants: {},
      steps: [],
      started_by: { kind: "user" },
      handoff: null,
    }, {});
    assert.ok(created.ok);
    insertInstance(sql, {
      id: AGENT,
      project: PRJ,
      workflow: "demo",
      input: "go",
      participants: { pm: { role: "lophn" } },
      steps: [],
      current: null,
      started_by: { kind: "user" },
      created_at: AT,
    });
    appendLine(sql, AGENT, AT, {
      kind: "started",
      by: { kind: "user" },
      step: "a",
      text: "go",
    });

    const service = createWorkflowService({
      files: {} as never,
      projects: {} as never,
      turns: {} as never,
      store: {
        create: (input) =>
          Promise.resolve(commands.create.handle(tx, ctx, input, {})),
        apply: (input, compare) =>
          Promise.resolve(commands.apply.handle(tx, ctx, input, compare)),
        read: (id) => {
          const instance = loadInstance(sql, id);
          const lines = loadLines(sql, id, { after: 0, limit: null });
          const reports = lastReports(sql, id);
          assert.ok(
            instance.ok && instance.value !== null && lines.ok && reports.ok,
          );
          return Promise.resolve(ok({
            instance: instance.value,
            lines: lines.value,
            last_reports: reports.value,
            next_cursor: null,
          } as never));
        },
        running: () => Promise.resolve(runningInstances(sql)),
      },
      flows,
      ids: createIdSource({
        clock: { now: () => AT } as never,
        random: {} as never,
      }),
    });

    const agentBefore = kinds(AGENT);
    await service.reconcile();

    assert.deepStrictEqual(kinds(FLOW), [
      "started",
      "lophn_restarted",
      "ended",
    ]);
    assert.deepStrictEqual(stateOf(FLOW), "ended");
    assert.deepStrictEqual(kinds(AGENT), agentBefore);
    assert.deepStrictEqual(stateOf(AGENT), "running");
    assert.deepStrictEqual(launched, []);
  } finally {
    db.close();
  }
});
