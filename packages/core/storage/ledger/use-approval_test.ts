import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import {
  createIdSource,
  err,
  manualClock,
  ok,
  seededRandom,
} from "../../../base/mod.ts";
import { defineEvent } from "../../../protocol/server/mod.ts";
import { applyMigrations } from "../migration/mod.ts";
import { LEDGER_SCHEMA_STEPS, openLedger } from "./mod.ts";

Deno.test(
  "platform/approvals#R7, platform/approvals#R11: approval 표가 없는 ledger에서는 approval 사용을 거절하고 변경을 rollback한다",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "lophn-approval-hook-" });
    const path = `${dir}/ledger.db`;
    const clock = manualClock(Date.parse("2026-01-01T00:00:00.000Z"));
    const ids = createIdSource({ clock, random: seededRandom(1) });
    const migrated = await applyMigrations(path, LEDGER_SCHEMA_STEPS, {
      clock,
    });
    assert(migrated.ok);
    const opened = openLedger(path, {
      clock,
      ids,
      registerBlobRef: () => err({ code: "unavailable", message: "blob 없음" }),
      call: () => err({ code: "unavailable", message: "dispatch 없음" }),
    });
    assert(opened.ok);
    const ledger = opened.value;
    try {
      const approval = ids.newId("apr");
      const target = ids.newId("doc");
      const attempted = defineEvent("ApprovalAttempted", {
        subject: z.string(),
        payload: z.strictObject({}),
      });
      const result = ledger.transaction({ actor: "user" }, (tx) => {
        const seq = tx.emit(attempted, target, {});
        return tx.useApproval(approval, {
          concern: "documents/versions",
          command: "save_version",
          caller: "user",
          targets: [target],
          input: { kind: "inline", value: {} },
          input_hash: "ab".repeat(32),
          comparison: {},
          binding_hash: "cd".repeat(32),
        }, {
          approval,
          concern: "documents/versions",
          receipt: { kind: "event", seq },
          accepted_seq: seq,
        });
      });
      assert(!result.ok);
      assertEquals(result.error.code, "unavailable");
      const stored = ledger.transaction({ actor: "user" }, (tx) =>
        ok({
          events: tx.sql.get("select count(*) as n from events", []),
          results: tx.sql.get("select count(*) as n from command_results", []),
        }));
      assert(stored.ok);
      assertEquals(stored.value.events?.["n"], 0n);
      assertEquals(stored.value.results?.["n"], 0n);
    } finally {
      ledger.close();
      await Deno.remove(dir, { recursive: true });
    }
  },
);
