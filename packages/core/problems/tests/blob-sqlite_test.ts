import { assert, assertEquals, assertFalse } from "@std/assert";
import { err } from "../../../base/mod.ts";
import type {
  BlobRefRegistration,
  Tx,
} from "../../../protocol/platform/mod.ts";
import { appendActualSideStart } from "./commands.ts";
import { handleRecordVerification } from "./record.ts";
import { fileLedger } from "./testing/mod.ts";
import {
  accept,
  attempt,
  blob,
  evidence,
  executed,
  HASH,
  proof,
  REQUEST_HASH,
  runner,
  TEST_HASH,
  verification,
} from "./fixtures.ts";

const tables = [
  "test_requests",
  "test_side_starts",
  "probe_events",
  "probe_refs",
  "verifications",
  "verification_reports",
];
Deno.test("problems/tests#R2: extra·duplicate·existing·잘못된 permanent ref·중간 실패는 file transaction 전체 rollback", () => {
  const ledger = fileLedger();
  try {
    assert(ledger.transaction(accept).ok);
    assert(ledger.transaction(attempt).ok);
    assert(
      ledger.transaction((tx) =>
        appendActualSideStart(tx, runner(), {
          request_principal: "user-1",
          request_key: "key-1",
          request_hash: REQUEST_HASH,
          side: "single",
          bundle_hash: HASH,
          test_hash: TEST_HASH,
          started_at: executed.started_at,
        }, proof())
      ).ok,
    );
    const state = () =>
      tables.map((table) => ledger.sql.all(`select * from ${table}`, []));
    const before = state();
    const refs = blob();
    const existing: BlobRefRegistration = {
      ...refs[0],
      source: {
        kind: "existing",
        reference: {
          owner_kind: refs[0].owner_kind,
          owner_key: refs[0].owner_key,
          field: refs[0].field,
          hash: verification().test,
          registered_seq: "1",
        },
      },
    };
    for (
      const bad of [
        [...refs, { ...refs[0], field: "extra" }],
        [...refs, refs[0]],
        [...refs.slice(0, -1), {
          ...existing,
          owner_kind: refs.at(-1)!.owner_kind,
          owner_key: refs.at(-1)!.owner_key,
          field: refs.at(-1)!.field,
        }],
      ]
    ) {
      let calls = 0;
      const rejected = ledger.transaction((tx) =>
        handleRecordVerification(
          {
            ...tx,
            registerBlobRef(reference) {
              calls++;
              return tx.registerBlobRef(reference);
            },
          },
          runner(),
          { verification: verification(), blobs: bad },
          evidence(),
        )
      );
      assertFalse(rejected.ok);
      assertEquals(calls, bad.length - 1);
      assertEquals(state(), before);
    }
    for (
      const patch of [
        { owner_kind: "wrong" },
        { owner_key: "wrong" },
        { field: "wrong" },
        { hash: "b".repeat(64) },
        { registered_seq: "2" },
      ]
    ) {
      let calls = 0;
      const rejected = ledger.transaction((tx) =>
        handleRecordVerification(
          {
            ...tx,
            registerBlobRef(reference) {
              calls++;
              const registered = tx.registerBlobRef(reference);
              return registered.ok && calls === 2
                ? { ...registered, value: { ...registered.value, ...patch } }
                : registered;
            },
          },
          runner(),
          { verification: verification(), blobs: refs },
          evidence(),
        )
      );
      assertFalse(rejected.ok);
      assertEquals(calls, 2);
      assertEquals(state(), before);
    }
    let calls = 0;
    const register: Tx["registerBlobRef"] = (reference) => {
      if (++calls === 3) {
        return err({ code: "forbidden", message: "middle failure" });
      }
      return ledger.tx.registerBlobRef(reference);
    };
    assertFalse(
      ledger.transaction((tx) =>
        handleRecordVerification(
          { ...tx, registerBlobRef: register },
          runner(),
          {
            verification: verification(),
            blobs: refs,
          },
          evidence(),
        )
      ).ok,
    );
    assertEquals(calls, 3);
    assertEquals(state(), before);
  } finally {
    ledger.close();
  }
});
