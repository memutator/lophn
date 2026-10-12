import { assert, assertEquals, assertThrows } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import {
  BLOB_PREPARATION_TTL_MS,
  BLOB_PREPARE_MAX_BYTES,
  BLOB_READ_MAX_BYTES,
  BLOB_RETENTION_CATEGORIES,
  BLOB_ROUTES,
  BLOB_UNREFERENCED_GRACE_MS,
  blobFieldDefinitionSchema,
  blobReadInputSchema,
  blobReadResultSchema,
  blobRefRegistrationSchema,
  blobRefSchema,
  blobsRead,
  defineBlobField,
  defineBlobPurpose,
  permanentBlobReferenceSchema,
  preparedBlobSchema,
} from "./blob.ts";
import { routePath } from "../base/route.ts";

const hash = "a".repeat(64);
const version = "ver_01arz3ndektsv4rrffq69g5fav";
const owner = "doc_01arz3ndektsv4rrffq69g5fav";
const input = {
  owner_kind: "DocumentVersion",
  owner_key: owner,
  version,
  field: "file",
  offset_bytes: 0,
  length_bytes: 3,
};
const prepared = {
  preparation: "worker-preparation-1",
  principal: "user",
  purpose: "document_file",
  hash,
  size_bytes: 3,
};
const permanent = {
  owner_kind: "DocumentVersion",
  owner_key: version,
  field: "file",
  hash,
  registered_seq: "42",
};
const read = {
  status: "available" as const,
  hash,
  size_bytes: 3,
  offset_bytes: 0,
  length_bytes: 3,
  truncated: false,
  bytes: "YWJj",
};

Deno.test("platform/blob-store#R3 platform/blob-store#R5: blob route와 event 표는 architecture 5장과 같다", () => {
  assertEquals(BLOB_ROUTES.map(routePath), ["/v1/blobs/read"]);
  assertEquals(BLOB_ROUTES.map((route) => route.kind), ["read"]);
  assertEquals(blobsRead.name, "blob.read");
  for (const code of blobsRead.errors) assert(ERROR_CODES.includes(code));
});

Deno.test("platform/blob-store#R1 platform/blob-store#R4: blob 값과 준비·기존 참조 등록 예시는 통과한다", () => {
  assert(blobRefSchema.safeParse({ hash, size_bytes: 3 }).success);
  assert(preparedBlobSchema.safeParse(prepared).success);
  assert(permanentBlobReferenceSchema.safeParse(permanent).success);
  for (
    const source of [
      { kind: "prepared", blob: prepared },
      { kind: "existing", reference: permanent },
    ]
  ) {
    assert(
      blobRefRegistrationSchema.safeParse({
        ...permanent,
        source,
        hash: undefined,
      }).success === false,
    );
    const { hash: _hash, ...registration } = permanent;
    assert(
      blobRefRegistrationSchema.safeParse({ ...registration, source }).success,
    );
  }
  for (
    const invalid of [
      { ...prepared, hash: hash.toUpperCase() },
      { ...prepared, hash: "x".repeat(64) },
      { ...prepared, size_bytes: -1 },
      { ...prepared, size_bytes: "3" },
      { ...prepared, size_bytes: BLOB_PREPARE_MAX_BYTES + 1 },
      { ...prepared, preparation: "" },
    ]
  ) assert(!preparedBlobSchema.safeParse(invalid).success);
  assert(
    !permanentBlobReferenceSchema.safeParse({
      ...permanent,
      registered_seq: 42,
    }).success,
  );
  assert(
    !permanentBlobReferenceSchema.safeParse({
      ...permanent,
      registered_seq: "042",
    }).success,
  );
  assert(
    !blobRefRegistrationSchema.safeParse({
      ...permanent,
      source: { kind: "hash", hash },
    }).success,
  );
});

Deno.test("platform/blob-store#R3 platform/blob-store#R5 platform/blob-store#R7: read 입력은 owner·고정 판·field·바이트 구간만 받는다", () => {
  assertEquals(blobReadInputSchema.parse(input), input);
  for (
    const invalid of [
      { ...input, hash },
      { ...input, path: "/private/blob" },
      { ...input, version: owner },
      { ...input, offset_bytes: -1 },
      { ...input, length_bytes: 1.5 },
      { ...input, length_bytes: "3" },
      { ...input, owner_kind: "" },
      { ...input, field: "" },
    ]
  ) assert(!blobReadInputSchema.safeParse(invalid).success);
  assert(
    blobReadInputSchema.safeParse({
      ...input,
      length_bytes: BLOB_READ_MAX_BYTES + 1,
    }).success,
  );
});

Deno.test("platform/blob-store#R6 platform/blob-store#R7 platform/blob-store#R11 platform/blob-store#R13: 부분·빈 blob과 부재 이유를 구별한다", () => {
  assertEquals(
    blobReadResultSchema.parse({ ...read, future_output: true }),
    read,
  );
  assert(
    blobReadResultSchema.safeParse({ ...read, size_bytes: 9, truncated: true })
      .success,
  );
  assert(
    blobReadResultSchema.safeParse({
      ...read,
      size_bytes: 0,
      length_bytes: 0,
      bytes: "",
    }).success,
  );
  for (const reason of ["pruned", "missing", "corrupt"]) {
    assert(
      blobReadResultSchema.safeParse({
        status: "unavailable",
        hash,
        size_bytes: 3,
        code: "unavailable",
        reason,
      }).success,
    );
  }
  for (
    const invalid of [
      { ...read, length_bytes: 2 },
      { ...read, offset_bytes: 1 },
      { ...read, bytes: "not base64" },
      { ...read, length_bytes: BLOB_READ_MAX_BYTES + 1 },
      {
        status: "unavailable",
        hash,
        size_bytes: 3,
        code: "not_found",
        reason: "missing",
      },
      {
        status: "unavailable",
        hash,
        size_bytes: 3,
        code: "unavailable",
        reason: "deleted_everywhere",
      },
    ]
  ) assert(!blobReadResultSchema.safeParse(invalid).success);
});

Deno.test("platform/blob-store#R4 platform/blob-store#R12 platform/blob-store#R13: purpose와 blob field는 소유 concern이 typed 값으로 등록한다", () => {
  for (
    const purpose of [
      "document_file",
      "content_list",
      "format_module",
      "diagnostics",
      "series_draft",
    ]
  ) {
    assertEquals(
      defineBlobPurpose({ purpose, max_size_bytes: 1024 }).purpose,
      purpose,
    );
  }
  const field = defineBlobField({
    owner_kind: "DocumentVersion",
    field: "file",
    retention: { kind: "permanent" },
    general_read: true,
  });
  const literal: "DocumentVersion" = field.owner_kind;
  void literal;
  for (const category of BLOB_RETENTION_CATEGORIES) {
    assert(
      blobFieldDefinitionSchema.safeParse({
        ...field,
        retention: { kind: "capacity", category },
      }).success,
    );
  }
  assertThrows(() =>
    defineBlobPurpose({
      purpose: "document_file",
      max_size_bytes: BLOB_PREPARE_MAX_BYTES + 1,
    })
  );
  assertThrows(() =>
    defineBlobPurpose({ purpose: "document_file", max_size_bytes: -1 })
  );
  assert(
    !blobFieldDefinitionSchema.safeParse({
      ...field,
      retention: { kind: "capacity", category: "document_file" },
    }).success,
  );
  assert(
    !blobFieldDefinitionSchema.safeParse({
      ...field,
      retention: { kind: "capacity", category: "trace_body", max_bytes: 12 },
    }).success,
  );
  assert(
    !blobFieldDefinitionSchema.safeParse({ ...field, extra: true }).success,
  );
});

Deno.test("platform/blob-store#R9 platform/blob-store#R12 platform/blob-store#R13: blob 한도와 준비·고아 수명을 고정한다", () => {
  assertEquals(BLOB_PREPARE_MAX_BYTES, 1_073_741_824);
  assertEquals(BLOB_READ_MAX_BYTES, 262_144);
  assertEquals(BLOB_PREPARATION_TTL_MS, 600_000);
  assertEquals(BLOB_UNREFERENCED_GRACE_MS, 604_800_000);
});
