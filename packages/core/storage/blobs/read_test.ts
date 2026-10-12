// blob 읽기의 요구 테스트(platform/blob-store#R5, R6, R7, platform/identity#R9).

import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  RequestContext,
  Sql,
  SqlRow,
} from "../../../protocol/server/mod.ts";
import {
  BLOB_READ_MAX_BYTES,
  type BlobFieldDefinition,
  type BlobReadInput,
  blobReadResultSchema,
  defineBlobField,
} from "../../../protocol/storage/mod.ts";
import { decideRead, readBlob, type StoredBlobRef } from "./read.ts";

const HASH = "a".repeat(64);
const OPEN = defineBlobField({
  owner_kind: "document_version",
  field: "file",
  retention: { kind: "permanent" },
  general_read: true,
});
const SEALED = defineBlobField({
  owner_kind: "backup",
  field: "archive",
  retention: { kind: "permanent" },
  general_read: false,
});

function ctx(targets: Record<string, string> = {}): RequestContext {
  return {
    principal: "user-1",
    actor: "user",
    scope: { operations: ["blobs/read"], targets },
    conditions: {},
    credential_ref: "cred-1",
  };
}

function input(over: Partial<BlobReadInput> = {}): BlobReadInput {
  return {
    owner_kind: OPEN.owner_kind,
    owner_key: "ver_1",
    field: OPEN.field,
    offset_bytes: 0,
    length_bytes: 4,
    ...over,
  };
}

function sqlOf(rows: SqlRow[]): Pick<Sql, "get"> {
  return {
    get(_query, params) {
      return rows.find((row) =>
        row["owner_kind"] === params[0] && row["owner_key"] === params[1] &&
        row["field"] === params[2]
      );
    },
  };
}

function row(hash = HASH, size = 4): SqlRow {
  return {
    owner_kind: OPEN.owner_kind,
    owner_key: "ver_1",
    field: OPEN.field,
    hash,
    size_bytes: BigInt(size),
  };
}

// scope는 owner_key가 targets에 있을 때만 허용한다. hash는 권한이 아니다.
function authorize(current: RequestContext, reference: { owner_key: string }) {
  const allowed = current.scope.targets["owner_key"];
  if (allowed !== undefined && allowed !== reference.owner_key) {
    return err({ code: "forbidden" as const, message: "scope 밖이다" });
  }
  return ok(undefined);
}

function stored(): StoredBlobRef {
  return { hash: HASH, size_bytes: 4 };
}

Deno.test("platform/blob-store#R5 platform/identity#R9: hash를 알아도 허용되지 않은 소유 참조는 읽지 못한다", () => {
  const decision = decideRead(
    [OPEN],
    ctx({ owner_key: "ver_2" }),
    authorize,
    input(),
    stored(),
  );
  assert(!decision.ok);
  assertEquals(decision.error.code, "forbidden");
});

Deno.test("platform/blob-store#R5: 일반 읽기를 막은 field는 어떤 actor도 읽지 못한다", () => {
  const decision = decideRead(
    [SEALED],
    ctx(),
    () => ok(undefined),
    input({ owner_kind: SEALED.owner_kind, field: SEALED.field }),
    { hash: HASH, size_bytes: 4 },
  );
  assert(!decision.ok);
  assertEquals(decision.error.code, "forbidden");
});

Deno.test("platform/blob-store#R5: 같은 blob을 허용 대상에서는 읽고 금지 대상에서는 거절한다", async () => {
  const bytes = new TextEncoder().encode("blob");
  const fields: BlobFieldDefinition[] = [OPEN];
  const deps = {
    fields,
    authorize,
    bytes: {
      read: () => Promise.resolve(ok({ hash: HASH, sizeBytes: 4, bytes })),
    },
  };
  const shared = sqlOf([row(), { ...row(), owner_key: "ver_2" }]);
  const allowed = await readBlob(
    shared,
    deps,
    ctx({ owner_key: "ver_1" }),
    input(),
  );
  assert(allowed.ok);
  assert(allowed.value.status === "available");
  const denied = await readBlob(
    shared,
    deps,
    ctx({ owner_key: "ver_1" }),
    input({ owner_key: "ver_2" }),
  );
  assert(!denied.ok);
  assertEquals(denied.error.code, "forbidden");
});

Deno.test("platform/blob-store#R6: 참조된 blob이 없으면 unavailable이고 빈 내용을 돌려주지 않는다", async () => {
  const result = await readBlob(
    sqlOf([row()]),
    {
      fields: [OPEN],
      authorize: () => ok(undefined),
      bytes: {
        read: () =>
          Promise.resolve(
            err({ code: "not_found", message: "blob이 없다" }),
          ),
      },
    },
    ctx(),
    input(),
  );
  assert(result.ok);
  assertEquals(result.value.status, "unavailable");
  if (result.value.status === "unavailable") {
    assertEquals(result.value.reason, "missing");
  }
  assert(blobReadResultSchema.safeParse(result.value).success);
});

Deno.test("platform/blob-store#R6: hash가 다르면 손상으로 unavailable이다", async () => {
  const result = await readBlob(
    sqlOf([row()]),
    {
      fields: [OPEN],
      authorize: () => ok(undefined),
      bytes: {
        read: () =>
          Promise.resolve(
            ok({
              hash: "c".repeat(64),
              sizeBytes: 4,
              bytes: new Uint8Array(4),
            }),
          ),
      },
    },
    ctx(),
    input(),
  );
  assert(result.ok);
  assert(
    result.value.status === "unavailable" && result.value.reason === "corrupt",
  );
});

Deno.test("platform/blob-store#R6: 정상 0바이트 blob은 부재와 구별된다", async () => {
  const result = await readBlob(
    sqlOf([row(HASH, 0)]),
    {
      fields: [OPEN],
      authorize: () => ok(undefined),
      bytes: {
        read: () =>
          Promise.resolve(
            ok({ hash: HASH, sizeBytes: 0, bytes: new Uint8Array() }),
          ),
      },
    },
    ctx(),
    input({ length_bytes: 0 }),
  );
  assert(result.ok);
  assert(result.value.status === "available");
  if (result.value.status === "available") {
    assertEquals(result.value.length_bytes, 0);
    assertEquals(result.value.truncated, false);
  }
});

Deno.test("platform/blob-store#R7: 구간 한도를 넘으면 실제 범위와 잘림을 함께 돌려준다", async () => {
  const size = BLOB_READ_MAX_BYTES + 10;
  const result = await readBlob(
    sqlOf([row(HASH, size)]),
    {
      fields: [OPEN],
      authorize: () => ok(undefined),
      bytes: {
        read: (_hash, _offset, length) =>
          Promise.resolve(
            ok({ hash: HASH, sizeBytes: size, bytes: new Uint8Array(length) }),
          ) as Promise<
            Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>
          >,
      },
    },
    ctx(),
    input({ offset_bytes: 0, length_bytes: size }),
  );
  assert(result.ok);
  assert(result.value.status === "available");
  if (result.value.status === "available") {
    assertEquals(result.value.size_bytes, size);
    assertEquals(result.value.length_bytes, BLOB_READ_MAX_BYTES);
    assertEquals(result.value.truncated, true);
    assertEquals(result.value.offset_bytes, 0);
  }
});

Deno.test("platform/blob-store#R7: 전체 구간은 잘림이 아니다", async () => {
  const bytes = new TextEncoder().encode("blob");
  const result = await readBlob(
    sqlOf([row()]),
    {
      fields: [OPEN],
      authorize: () => ok(undefined),
      bytes: {
        read: () => Promise.resolve(ok({ hash: HASH, sizeBytes: 4, bytes })),
      },
    },
    ctx(),
    input(),
  );
  assert(result.ok);
  assert(
    result.value.status === "available" && result.value.truncated === false,
  );
  if (result.value.status === "available") {
    assertEquals(result.value.bytes, btoa("blob"));
  }
});
