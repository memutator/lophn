import { assertEquals } from "@std/assert";
import { id, ids } from "../api/testing.ts";
import { contextStatusOf } from "./status.ts";
import { ledgerFixture } from "./testing.ts";

Deno.test("documents/contexts#R1 [ctx-I58]: contextStatusOf reads the status and gives undefined for unknown ids or an unreadable table", () => {
  const ledger = ledgerFixture();
  try {
    ledger.seedProject(ids.project);
    // active는 적용된 판이 있어야 한다. 판 표는 이 시험의 관심이 아니라 FK를 끄고 심는다.
    ledger.db.exec("PRAGMA foreign_keys=OFF");
    const insert = ledger.db.prepare(
      `INSERT INTO contexts (id, project, title, purpose, status, applied_bundle, revision)
       VALUES (?, ?, ?, 'purpose', ?, ?, '101')`,
    );
    const drafting = id("ctx", 11);
    const active = id("ctx", 12);
    const archived = id("ctx", 13);
    insert.run(drafting, ids.project, "Drafting", "drafting", null);
    insert.run(active, ids.project, "Active", "active", id("cbn", 12));
    insert.run(archived, ids.project, "Archived", "archived", null);

    assertEquals(contextStatusOf(ledger.sql, drafting), "drafting");
    assertEquals(contextStatusOf(ledger.sql, active), "active");
    assertEquals(contextStatusOf(ledger.sql, archived), "archived");
    assertEquals(contextStatusOf(ledger.sql, id("ctx", 99)), undefined);
    ledger.db.exec("DROP TABLE contexts");
    assertEquals(contextStatusOf(ledger.sql, active), undefined);
  } finally {
    ledger.close();
  }
});
