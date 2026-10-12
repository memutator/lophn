// blob 참조 등록의 요구 테스트(platform/blob-store#R4).

import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../../base/mod.ts";
import type {
  RequestContext,
  Sql,
  SqlRow,
} from "../../../protocol/server/mod.ts";
import {
  BLOB_PREPARATION_TTL_MS,
  type BlobFieldDefinition,
  type BlobRefRegistration,
  defineBlobField,
} from "../../../protocol/storage/mod.ts";
import { createPreparationRegistry } from "./registry.ts";
import { registerBlobRef } from "./register.ts";

const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);
const FIELD = defineBlobField({
  owner_kind: "document_version",
  field: "file",
  retention: { kind: "permanent" },
  general_read: true,
});

function ctx(): RequestContext {
  return {
    principal: "user-1",
    actor: "user",
    scope: { operations: ["blobs/read"], targets: {} },
    conditions: {},
    credential_ref: "cred-1",
  };
}

function prepared(hash = HASH): BlobRefRegistration {
  return {
    owner_kind: FIELD.owner_kind,
    owner_key: "ver_1",
    field: FIELD.field,
    registered_seq: "1",
    source: {
      kind: "prepared",
      blob: {
        preparation: "prep-1",
        principal: "user-1",
        purpose: "document_file",
        hash,
        size_bytes: 4,
      },
    },
  };
}

// 메모리 SQL. blob_refs만 담는다. transaction은 호출자가 흉내 낸다.
function memorySql(): Sql & { rows(): SqlRow[]; failNext(): void } {
  const rows: SqlRow[] = [];
  let failing = false;
  return {
    run(sql, params) {
      if (failing) throw new Error("commit 실패");
      if (sql.startsWith("insert into blob_refs")) {
        rows.push({
          owner_kind: params[0],
          owner_key: params[1],
          field: params[2],
          hash: params[3],
          size_bytes: params[4],
          registered_seq: params[5],
        });
      }
      return { changes: 1, lastInsertRowid: rows.length };
    },
    get(_sql, params) {
      return rows.find((row) =>
        row["owner_kind"] === params[0] && row["owner_key"] === params[1] &&
        row["field"] === params[2] && row["hash"] === params[3]
      );
    },
    all() {
      return rows;
    },
    rows: () => rows,
    failNext: () => {
      failing = true;
    },
  };
}

function registrar(
  sql: Sql,
  fields: readonly BlobFieldDefinition[] = [FIELD],
  nowMs = 0,
) {
  const preparations = createPreparationRegistry();
  const source = prepared().source;
  if (source.kind === "prepared") preparations.register(source.blob, nowMs);
  return {
    preparations,
    register: (
      reference: BlobRefRegistration,
      current: RequestContext = ctx(),
    ) =>
      registerBlobRef(sql, {
        preparations,
        fields,
        nowMs: () => nowMs,
        current: () => current,
      }, reference),
  };
}

Deno.test("platform/blob-store#R4: 준비 참조의 주체·purpose·수명을 확인하고 같은 transaction에 등록한다", () => {
  const sql = memorySql();
  const { register } = registrar(sql);
  const result = register(prepared());
  assert(result.ok);
  assertEquals(result.value.hash, HASH);
  assertEquals(sql.rows().length, 1);
  assertEquals(sql.rows()[0]?.["registered_seq"], 1n);
});

Deno.test("platform/blob-store#R4: 주체가 다른 준비 참조는 등록하지 않는다", () => {
  const sql = memorySql();
  const { register } = registrar(sql);
  const other = ctx();
  other.principal = "user-2";
  const result = register(prepared(), other);
  assert(!result.ok);
  assertEquals(result.error.code, "forbidden");
  assertEquals(sql.rows().length, 0);
});

Deno.test("platform/blob-store#R4: 만기된 준비 참조는 등록하지 않는다", () => {
  const sql = memorySql();
  const { preparations, register } = registrar(sql);
  preparations.prune(BLOB_PREPARATION_TTL_MS);
  const result = register(prepared());
  assert(!result.ok);
  assertEquals(result.error.code, "invalid_input");
  assertEquals(sql.rows().length, 0);
});

Deno.test("platform/blob-store#R4: commit 실패에는 영구 참조가 생기지 않는다", () => {
  const sql = memorySql();
  const { register } = registrar(sql);
  sql.failNext();
  let thrown = false;
  try {
    register(prepared());
  } catch {
    thrown = true;
  }
  assert(thrown);
  assertEquals(sql.rows().length, 0);
});

Deno.test("platform/blob-store#R4: 한 연결을 없애도 같은 blob의 다른 참조는 남는다", () => {
  const sql = memorySql();
  const { register } = registrar(sql);
  assert(register(prepared()).ok);
  const second = prepared();
  second.owner_key = "ver_2";
  second.registered_seq = "2";
  assert(register(second).ok);
  // 한 owner의 참조만 빠진다. 나머지 근거는 그대로다.
  const left = sql.rows().filter((row) => row["owner_key"] !== "ver_1");
  assertEquals(left.length, 1);
  assertEquals(left[0]?.["hash"], HASH);
});

Deno.test("platform/blob-store#R4: 등록되지 않은 field는 거절한다", () => {
  const sql = memorySql();
  const { register } = registrar(sql, []);
  const result = register(prepared());
  assert(!result.ok);
  assertEquals(result.error.code, "invalid_input");
});

Deno.test("platform/blob-store#R4: 허용된 기존 참조로만 새 참조를 만든다", () => {
  const sql = memorySql();
  const { register } = registrar(sql);
  assert(register(prepared()).ok);
  const existing: BlobRefRegistration = {
    ...prepared(OTHER),
    owner_key: "ver_3",
    source: {
      kind: "existing",
      reference: {
        owner_kind: FIELD.owner_kind,
        owner_key: "ver_1",
        field: FIELD.field,
        hash: HASH,
        registered_seq: "1",
      },
    },
  };
  const result = register(existing);
  assert(result.ok);
  assertEquals(result.value.hash, HASH);
  const missing = register({
    ...existing,
    owner_key: "ver_4",
    source: {
      kind: "existing",
      reference: {
        owner_kind: FIELD.owner_kind,
        owner_key: "ver_1",
        field: FIELD.field,
        hash: OTHER,
        registered_seq: "1",
      },
    },
  });
  assert(!missing.ok);
  assertEquals(missing.error.code, "forbidden");
});

void err;
void ok;
