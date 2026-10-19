import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import type { RequestContext, Tx } from "../../../protocol/server/mod.ts";
import type { Violation } from "../../../protocol/projects/mod.ts";
import { KINDS_DISPATCH_PRINCIPAL } from "../../../protocol/projects/mod.ts";
import { PROJECT_PROBLEMS_SCHEMA_STEPS } from "./schema.ts";
import { syncProjectProblemsCommand } from "./commands.ts";

const PROJECT = "prj_01hzzzzzzzzzzzzzzzzzzzzzza";
const NOW = "2026-10-19T00:00:00.000Z";

const doc = (path: string): Violation => ({
  source: "document",
  rule: "required",
  kind: "note",
  path,
  field: "title",
  message: "m",
});
const kindsFile: Violation = {
  source: "kinds_file",
  rule: "kinds_syntax",
  kind: null,
  path: null,
  field: null,
  message: "m",
};

Deno.test("같은 위반이 남은 채 다시 알려도 sync가 실패하지 않고 새 위반만 연다", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of PROJECT_PROBLEMS_SCHEMA_STEPS) db.exec(step.sql);
    const tx = {
      sql: {
        run: (text: string, params: never[]) => {
          const done = db.prepare(text).run(...params);
          return {
            changes: done.changes,
            lastInsertRowid: done.lastInsertRowid,
          };
        },
        get: (text: string, params: never[]) =>
          db.prepare(text).get(...params) as Record<string, never> | undefined,
        all: (text: string, params: never[]) =>
          db.prepare(text).all(...params) as Record<string, never>[],
      },
      now: () => NOW,
      emit: () => "evt",
    } as unknown as Tx;
    const ctx = {
      actor: "machine",
      principal: KINDS_DISPATCH_PRINCIPAL,
    } as unknown as RequestContext;
    let n = 0;
    const sync = (violations: Violation[]) =>
      syncProjectProblemsCommand.handle(tx, ctx, {
        project: PROJECT,
        violations: violations.map((violation) => ({
          id: `prb_${String(++n).padStart(26, "0")}`,
          violation,
        })),
        truncated: false,
      }, {});

    const first = sync([doc("a.md"), doc("b.md")]);
    assertEquals(first.ok && first.value.opened, 2);
    const second = sync([doc("a.md"), doc("b.md"), kindsFile]);
    assertEquals(second.ok && second.value.opened, 1);
    assertEquals(
      db.prepare(
        "select count(*) as c from project_problems where state = 'open'",
      )
        .get()?.["c"],
      3,
    );
  } finally {
    db.close();
  }
});
