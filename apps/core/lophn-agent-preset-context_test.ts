// lophn-agent/presets#R11: core가 preset 검사에 넣는 context 상태 조회는 documents/contexts의
// 실제 표를 읽는다. 이 시험은 preset 저장이 보관·없는 context를 거절하는 통합을 본다.
import { assertEquals } from "@std/assert";
import { id, ids } from "../../packages/documents/contexts/api/testing.ts";
import { ledgerFixture } from "../../packages/documents/contexts/ledger/testing.ts";
import { contextStatusOf } from "../../packages/documents/contexts/mod.ts";
import { presetValidateDeps } from "../../packages/lophn-agent/presets/registration_test.ts";
import {
  productPresetDefinition,
  validateDefinition,
} from "../../packages/lophn-agent/presets/mod.ts";

Deno.test("lophn-agent/presets#R11 [ctx-I58]: validateDefinition with the real contexts lookup rejects archived and unknown contexts", () => {
  const ledger = ledgerFixture();
  try {
    ledger.seedProject(ids.project);
    const active = id("ctx", 12);
    const archived = id("ctx", 13);
    ledger.db.exec("PRAGMA foreign_keys=OFF");
    const insert = ledger.db.prepare(
      `INSERT INTO contexts (id, project, title, purpose, status, applied_bundle, revision)
       VALUES (?, ?, ?, 'purpose', ?, ?, '101')`,
    );
    insert.run(active, ids.project, "Active", "active", id("cbn", 12));
    insert.run(archived, ids.project, "Archived", "archived", null);
    const deps = {
      ...presetValidateDeps(),
      contextStatus: (context: string) => contextStatusOf(ledger.sql, context),
    };
    const base = productPresetDefinition("context_engineer", "a".repeat(64));
    const check = (target: string) =>
      validateDefinition(
        { ...base, context: [{ kind: "context", target, section: null }] },
        deps,
      );
    const item = (target: string) => {
      const result = check(target);
      return result.ok ? "ok" : result.error.details.item;
    };
    assertEquals(item(active), "ok");
    assertEquals(item(archived), `context:${archived}`);
    assertEquals(item(id("ctx", 99)), `context:${id("ctx", 99)}`);
  } finally {
    ledger.close();
  }
});
