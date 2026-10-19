import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import type { RequestContext, Tx } from "../../../protocol/server/mod.ts";
import type { Violation } from "../../../protocol/projects/mod.ts";
import { KINDS_DISPATCH_PRINCIPAL } from "../../../protocol/projects/mod.ts";
import { DOMAIN_PROBLEMS_SCHEMA_STEPS } from "./schema.ts";
import { syncDomainProblemsCommand } from "./commands.ts";

const DOMAIN = "dom_01hzzzzzzzzzzzzzzzzzzzzzza";
const OTHER = "dom_01hzzzzzzzzzzzzzzzzzzzzzzb";
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

// 한 domain의 위반이 다른 domain의 problem을 열거나 닫으면 안 된다.
Deno.test("위반 problem은 domain마다 따로 열리고 닫힌다", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of DOMAIN_PROBLEMS_SCHEMA_STEPS) db.exec(step.sql);
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
    const sync = (domain: string, violations: Violation[]) =>
      syncDomainProblemsCommand.handle(tx, ctx, {
        domain,
        violations: violations.map((violation) => ({
          id: `prb_${String(++n).padStart(26, "0")}`,
          violation,
        })),
        truncated: false,
      }, {});
    const open = (domain: string) =>
      db.prepare(
        "select count(*) as c from domain_problems where domain = ? and state = 'open'",
      ).get(domain)?.["c"];

    // 같은 위반이 남은 채 다시 알려도 실패하지 않고 새 위반만 연다.
    const first = sync(DOMAIN, [doc("a.md"), doc("b.md")]);
    assertEquals(first.ok && first.value.opened, 2);
    const second = sync(DOMAIN, [doc("a.md"), doc("b.md"), kindsFile]);
    assertEquals(second.ok && second.value.opened, 1);
    assertEquals(open(DOMAIN), 3);

    // 다른 domain의 같은 위반은 따로 열리고, 한쪽이 비어도 다른 쪽을 닫지 않는다.
    const other = sync(OTHER, [doc("a.md")]);
    assertEquals(other.ok && other.value.opened, 1);
    sync(OTHER, []);
    assertEquals(open(OTHER), 0);
    assertEquals(open(DOMAIN), 3);
  } finally {
    db.close();
  }
});
