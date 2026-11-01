import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { AppInvocation } from "../../../protocol/apps/calls/mod.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import { LEDGER_SCHEMA_STEPS } from "../../storage/ledger/schema.ts";
import type { InvocationLedger } from "../ports.ts";
import { CHANGESET_MAX_BYTES } from "./changesets.ts";
import { createInvocationLedger } from "./ledger.ts";
import { invocationsSchemaSteps } from "./schema.ts";

const n = (value: number) => String(value).padStart(26, "0");
const APP = `app_${n(1)}` as Id<"app">;
const REL1 = `rel_${n(1)}` as Id<"rel">;
const REL2 = `rel_${n(2)}` as Id<"rel">;
const inv = (value: number) => `inv_${n(value)}` as Id<"inv">;
const AT = "2026-10-16T00:00:00.000Z";
const LATER = "2026-10-16T00:00:01.000Z";

// 진짜 SQLite(in-memory)와 가짜 blob 저장.
function setup() {
  const db = new DatabaseSync(":memory:");
  // events(registered_seq의 근원)와 blob_refs 표만 쓴다.
  const ledgerSteps = LEDGER_SCHEMA_STEPS.filter((step) =>
    ["common-tables", "erase-windows", "blob-refs"].includes(step.id),
  );
  for (const step of [...ledgerSteps, ...invocationsSchemaSteps]) {
    db.exec(step.sql);
  }
  const sql: Sql = {
    run: (text, params) => db.prepare(text).run(...params),
    get: (text, params) => db.prepare(text).get(...params) as never,
    all: (text, params) => db.prepare(text).all(...params) as never,
  };
  const stored = new Map<string, Uint8Array>();
  const tx = {
    sql,
    registerBlobRef: (ref: {
      owner_kind: string;
      owner_key: string;
      field: string;
      registered_seq: string;
      source: { kind: string; blob?: { hash: string; size_bytes: number } };
    }) => {
      const blob = ref.source.blob!;
      sql.run(
        `insert into blob_refs
           (owner_kind, owner_key, field, hash, size_bytes, registered_seq)
         values (?, ?, ?, ?, ?, ?)`,
        [
          ref.owner_kind,
          ref.owner_key,
          ref.field,
          blob.hash,
          blob.size_bytes,
          BigInt(ref.registered_seq),
        ],
      );
      return ok({} as never);
    },
  } as unknown as Tx;
  const ledger = createInvocationLedger({
    sql,
    transaction<T>(fn: (tx: Tx) => Result<T>): Result<T> {
      db.exec("begin immediate");
      const done = fn(tx);
      db.exec(done.ok ? "commit" : "rollback");
      return done;
    },
    blobs: {
      async prepare(stream) {
        const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
        const hash = createHash("sha256").update(bytes).digest("hex");
        stored.set(hash, bytes);
        return ok({
          preparation: "prep",
          principal: "machine:test",
          purpose: "app_changeset",
          hash,
          size_bytes: bytes.length,
        });
      },
      read(hash, offset, length) {
        const bytes = stored.get(hash)!;
        return Promise.resolve(
          ok({
            hash,
            sizeBytes: bytes.length,
            bytes: bytes.slice(offset, offset + length),
          }),
        );
      },
    },
  });
  const refs = (owner: string) =>
    sql.all("select hash from blob_refs where owner_key = ?", [owner]).length;
  return { db, ledger, refs };
}

async function write(
  ledger: InvocationLedger,
  value: number,
  release: Id<"rel">,
  changeset: Uint8Array | null,
): Promise<AppInvocation> {
  const begun = ledger.begin({
    id: inv(value),
    app: APP,
    release,
    mode: "live",
    operation: { kind: "command", name: "app.save" },
    caller: {
      kind: "agent",
      session: `ses_${n(1)}` as Id<"ses">,
      turn: `trn_${n(value)}` as Id<"trn">,
      tool_call: `tcl_${n(value)}` as Id<"tcl">,
    },
    effect: "write",
    started_at: AT,
    input_hash: null,
  });
  assert.deepStrictEqual(begun.ok, true);
  const finished = await ledger.finish(inv(value), {
    status: "succeeded",
    finished_at: LATER,
    summary: { outcome: "succeeded" },
    detail_hash: null,
    changeset,
  });
  assert.deepStrictEqual(finished.ok, true);
  return (finished as { value: AppInvocation }).value;
}

test("끝난 invocation은 되돌림 표시와 changeset 지우기 말고는 바뀌지 않고 지워지지도 않는다", async () => {
  const { db, ledger, refs } = setup();
  const done = await write(ledger, 1, REL1, new Uint8Array([1, 2, 3]));
  assert.deepStrictEqual(done.changeset?.size_bytes, 3);
  assert.deepStrictEqual(refs(inv(1)), 1);
  assert.deepStrictEqual(done.status, "succeeded");

  // 다시 끝낼 수 없다.
  const again = await ledger.finish(inv(1), {
    status: "failed",
    finished_at: LATER,
    summary: {},
    detail_hash: null,
    changeset: null,
  });
  assert.deepStrictEqual(!again.ok && again.error.code, "conflict");
  // 표를 직접 고치거나 지울 수 없다.
  for (const text of [
    "update invocations set status = 'failed'",
    "update invocations set summary = '{}'",
    "update invocations set finished_at = '2027-01-01T00:00:00.000Z'",
    "update invocations set changeset_hash = '" + "a".repeat(64) + "'",
    "delete from invocations",
  ])
    assert.throws(() => db.exec(text));

  // 되돌림 표시는 한 번만, 같은 rewind로는 다시 해도 된다.
  const rwd = `rwd_${n(1)}` as Id<"rwd">;
  assert.deepStrictEqual(ledger.markReverted([inv(1)], rwd).ok, true);
  assert.deepStrictEqual(ledger.markReverted([inv(1)], rwd).ok, true);
  const other = ledger.markReverted([inv(1)], `rwd_${n(2)}` as Id<"rwd">);
  assert.deepStrictEqual(!other.ok && other.error.code, "conflict");
  const got = ledger.get(inv(1));
  assert.deepStrictEqual(got.ok && got.value?.reverted_by, rwd);
  assert.deepStrictEqual(got.ok && got.value?.summary, {
    outcome: "succeeded",
  });

  // session·turn으로 찾는다.
  const byTurn = ledger.list({ session: `ses_${n(1)}`, turn: `trn_${n(1)}` });
  assert.deepStrictEqual(byTurn.ok && byTurn.value.map((one) => one.id), [
    inv(1),
  ]);

  // 한도를 넘는 changeset은 결과를 살리고 changeset 없이 닫는다.
  const big = await write(
    ledger,
    2,
    REL1,
    new Uint8Array(CHANGESET_MAX_BYTES + 1),
  );
  assert.deepStrictEqual(big.status, "succeeded");
  assert.deepStrictEqual(big.changeset, null);
  assert.deepStrictEqual(big.summary.changeset_dropped, "too_large");
});

test("activation 뒤 changeset 지우기는 이전 release의 changeset만 지우고 invocation 기록은 남긴다", async () => {
  const { ledger, refs } = setup();
  await write(ledger, 1, REL1, new Uint8Array([1]));
  await write(ledger, 2, REL2, new Uint8Array([2, 2]));

  const pruned = await ledger.pruneChangesets(APP, REL2);
  assert.deepStrictEqual(pruned.ok && pruned.value, 1);

  const old = ledger.get(inv(1));
  assert.deepStrictEqual(old.ok && old.value?.status, "succeeded");
  assert.deepStrictEqual(old.ok && old.value?.changeset, null);
  assert.deepStrictEqual(refs(inv(1)), 0);
  const current = await ledger.changesetOf(inv(2));
  assert.deepStrictEqual(current.ok && Array.from(current.value ?? []), [2, 2]);
  assert.deepStrictEqual(refs(inv(2)), 1);
  assert.deepStrictEqual((await ledger.changesetOf(inv(1))).ok, true);
  // 이미 지운 것은 다시 지울 것이 없다.
  const again = await ledger.pruneChangesets(APP, REL2);
  assert.deepStrictEqual(again.ok && again.value, 0);
});
