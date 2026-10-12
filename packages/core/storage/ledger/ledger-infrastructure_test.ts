import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import {
  createIdSource,
  err,
  manualClock,
  ok,
  seededRandom,
} from "../../../base/mod.ts";
import type { RequestContext } from "../../../protocol/server/mod.ts";
import type { BlobRefRegistration } from "../../../protocol/storage/mod.ts";
import { defineEvent } from "../../../protocol/events/mod.ts";
import { definePort } from "../../../protocol/base/mod.ts";
import { applyMigrations } from "../migration/mod.ts";
import { LEDGER_SCHEMA_STEPS, openLedger } from "./mod.ts";
import { createSubscriberGate } from "../../events/subscriber-registration.ts";

function deps() {
  const clock = manualClock(Date.parse("2026-01-01T00:00:00.000Z"));
  return {
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
    registerBlobRef: () =>
      err({ code: "internal" as const, message: "blob 등록 없음" }),
    call: () => err({ code: "internal" as const, message: "dispatch 없음" }),
  };
}
function machineRequest(): RequestContext {
  return {
    principal: "machine-1",
    actor: "machine",
    scope: { operations: ["AdvanceSubscriberCursor"], targets: {} },
    conditions: {},
    credential_ref: "cred-m",
  };
}
async function schema(path: string) {
  const applied = await applyMigrations(path, LEDGER_SCHEMA_STEPS, {
    clock: deps().clock,
  });
  assert(applied.ok);
}
const created = defineEvent("ThingCreated", {
  subject: z.string(),
  payload: z.strictObject({ name: z.string() }),
});

Deno.test("platform/ledger#R15 platform/ledger#R22: cursor는 gate와 full request가 있어야 event 없이 commit하고 후퇴를 거절한다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ledger-cursor-" });
  const path = `${dir}/ledger.db`;
  await schema(path);
  const gate = createSubscriberGate([{
    name: "notifications",
    authorize: (ctx) =>
      ok(ctx.principal === "machine-1" && ctx.credential_ref === "cred-m"),
  }]);
  assert(gate.ok);
  const opened = openLedger(path, { ...deps(), subscriberGate: gate.value });
  assert(opened.ok);
  const ledger = opened.value;
  try {
    const bare = ledger.transaction({ actor: "machine" }, (tx) => {
      try {
        tx.advanceSubscriberCursor("notifications", "4");
      } catch { /* swallowed */ }
      tx.emit(created, "thing:1", { name: "denied" });
      return ok(undefined);
    });
    assert(!bare.ok);
    assertEquals(bare.error.code, "unavailable");
    const advanced = ledger.transaction(
      { actor: "machine", request: machineRequest() },
      (tx) => tx.advanceSubscriberCursor("notifications", "4"),
    );
    assert(advanced.ok);
    const events = ledger.transaction(
      { actor: "machine" },
      (tx) => ok(tx.sql.get("select count(*) as n from events", [])),
    );
    assert(events.ok);
    assertEquals(events.value?.n, 0n);
    for (
      const [seq, expected] of [["3", "conflict"], ["01", "invalid_input"]]
    ) {
      const denied = ledger.transaction(
        { actor: "machine", request: machineRequest() },
        (tx) => tx.advanceSubscriberCursor("notifications", seq),
      );
      assert(!denied.ok);
      assertEquals(denied.error.code, expected);
    }
    assert(
      ledger.transaction(
        { actor: "machine", request: machineRequest() },
        (tx) => tx.advanceSubscriberCursor("notifications", "4"),
      ).ok,
    );
  } finally {
    ledger.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/ledger#R22: 등록되지 않은 port는 내부 오류다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ledger-port-" });
  const path = `${dir}/ledger.db`;
  await schema(path);
  const opened = openLedger(path, deps());
  assert(opened.ok);
  const key = definePort<{ n: number }>("missing");
  try {
    const result = opened.value.transaction({ actor: "user" }, (tx) => {
      tx.port(key);
      return ok(undefined);
    });
    assert(!result.ok);
    assertEquals(result.error.code, "internal");
  } finally {
    opened.value.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/ledger#R22: blob 참조 등록은 주입한 구현이 같은 transaction에서 돈다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ledger-blob-" });
  const path = `${dir}/ledger.db`;
  await schema(path);
  const seen: BlobRefRegistration[] = [];
  const opened = openLedger(path, {
    ...deps(),
    registerBlobRef: (reference) => {
      seen.push(reference);
      return ok({
        owner_kind: reference.owner_kind,
        owner_key: reference.owner_key,
        field: reference.field,
        hash: "ab".repeat(32),
        registered_seq: reference.registered_seq,
      });
    },
  });
  assert(opened.ok);
  try {
    const hash = "ab".repeat(32);
    const result = opened.value.transaction({ actor: "user" }, (tx) => {
      const seq = tx.emit(created, "thing:1", { name: "a" });
      return tx.registerBlobRef({
        owner_kind: "event",
        owner_key: "thing:1",
        field: "body",
        registered_seq: seq,
        source: {
          kind: "prepared",
          blob: {
            preparation: "prep",
            principal: "user",
            purpose: "note",
            hash,
            size_bytes: 4,
          },
        },
      });
    });
    assert(result.ok);
    assertEquals(result.value.hash, hash);
    assertEquals(seen.length, 1);
  } finally {
    opened.value.close();
    await Deno.remove(dir, { recursive: true });
  }
});
