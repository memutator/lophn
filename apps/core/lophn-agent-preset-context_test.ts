// lophn-agent/presets#R11: preset 저장의 context 선택 검사는 documents/contexts가 소유한
// contexts 표의 상태를 읽는다. 조립(apps/core)이 그 표를 읽는 조회를 실제 표로 본다.
import { assertEquals } from "@std/assert";
import { id, ids } from "../../packages/documents/contexts/api/testing.ts";
import { ledgerFixture } from "../../packages/documents/contexts/ledger/testing.ts";
import { contextStatusIn } from "./lophn-agent.ts";

Deno.test("lophn-agent/presets#R11 [ctx-I58]: the context status lookup reads the real contexts table and fails closed for unknown ids", () => {
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

    assertEquals(contextStatusIn(ledger.sql, drafting), "drafting");
    assertEquals(contextStatusIn(ledger.sql, active), "active");
    assertEquals(contextStatusIn(ledger.sql, archived), "archived");
    assertEquals(contextStatusIn(ledger.sql, id("ctx", 99)), undefined);
    // 표를 읽지 못하면(없는 표) 없는 것으로 본다.
    ledger.db.exec("DROP TABLE contexts");
    assertEquals(contextStatusIn(ledger.sql, active), undefined);
  } finally {
    ledger.close();
  }
});
