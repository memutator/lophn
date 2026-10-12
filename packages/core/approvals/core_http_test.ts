// 실제 core(temp LOPHN_HOME)에서 approval 등록이 기동에 붙는지 확인한다.
// 사람 데이터 root는 열지 않는다. harness가 temp dir를 LOPHN_HOME으로 준다.
// approval의 HTTP route는 contract ROUTES가 소유한다. 제품 core는 packages/core/main/daemon/platform-register.ts가
// schema·command·read를 한 번만 조립하므로 팀 등록 없이도 표가 붙는다. HTTP 동작은
// packages/core/main/daemon/platform-register_test.ts가 본다.

import { assert, assertEquals } from "@std/assert";
import { createCoreHarness } from "../testing/core.ts";

const NOW = Date.UTC(2026, 9, 5);

Deno.test("platform/approvals#R1: approval schema가 team 등록 없이 실제 core의 temp ledger에 붙는다", async () => {
  const opened = await createCoreHarness({ teams: [], nowMs: NOW });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    assert(harness.dataRoot.includes("lophn-core-harness-"));
    assertEquals(harness.port > 0, true);
    const db = `${harness.dataRoot}/lophn.db`;
    const { DatabaseSync } = await import("node:sqlite");
    const connection = new DatabaseSync(db, { readOnly: true });
    try {
      const tables = connection.prepare(
        "select name from sqlite_master where type = 'table' and name like 'approval_%' order by name",
      ).all() as { name: string }[];
      assertEquals(tables.map((row) => row.name), [
        "approval_requests",
        "approval_uses",
      ]);
    } finally {
      connection.close();
    }
  } finally {
    await harness.close();
  }
});
