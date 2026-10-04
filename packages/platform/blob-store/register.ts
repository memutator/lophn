// blob 영구 참조 등록(platform/blob-store#R4). 소유 변경과 같은 ledger transaction에서
// 준비 참조의 주체·purpose·수명을 확인하고 blob_refs에 넣는다. commit 실패면 참조도 없다.

import { err, ok, type Result } from "../../base/mod.ts";
import {
  type BlobFieldDefinition,
  type BlobRefRegistration,
  blobRefRegistrationSchema,
  type PermanentBlobReference,
  permanentBlobReferenceSchema,
  type RequestContext,
  type Sql,
} from "../../contracts/platform/mod.ts";
import type { PreparationRegistry } from "./registry.ts";
import { claimedHash, fieldDefined } from "./refs.ts";

export type BlobRegistrationDeps = {
  // 준비 참조의 core 메모리 판정. 파일을 다시 hash하지 않는다.
  preparations: Pick<PreparationRegistry, "live">;
  // 소유 concern이 등록한 blob field. 보존 종류와 일반 읽기 허용이 함께 있다.
  fields: readonly BlobFieldDefinition[];
  nowMs(): number;
  // 현재 command의 자격. 준비 주체와 같아야 한다.
  current(): RequestContext | undefined;
};

export function createBlobRegistrar(
  deps: BlobRegistrationDeps,
): (
  sql: Sql,
  reference: BlobRefRegistration,
) => Result<PermanentBlobReference> {
  return (sql, reference) => registerBlobRef(sql, deps, reference);
}

export function registerBlobRef(
  sql: Sql,
  deps: BlobRegistrationDeps,
  reference: BlobRefRegistration,
): Result<PermanentBlobReference> {
  const parsed = blobRefRegistrationSchema.safeParse(reference);
  if (!parsed.success) {
    return err({
      code: "invalid_input",
      message: "blob 참조 등록이 schema와 다르다",
    });
  }
  const ctx = deps.current();
  if (ctx === undefined) {
    return err({ code: "forbidden", message: "현재 자격이 없다" });
  }
  const field = fieldDefined(
    deps.fields,
    parsed.data.owner_kind,
    parsed.data.field,
  );
  if (!field.ok) return field;
  const hash = claimedHash(parsed.data);
  if (parsed.data.source.kind === "prepared") {
    const prepared = parsed.data.source.blob;
    if (prepared.principal !== ctx.principal) {
      return err({
        code: "forbidden",
        message: "준비 참조의 주체가 현재 자격과 다르다",
      });
    }
    const live = deps.preparations.live(
      {
        hash: prepared.hash,
        principal: prepared.principal,
        purpose: prepared.purpose,
      },
      deps.nowMs(),
    );
    if (!live.ok) return live;
    if (!live.value) {
      return err({
        code: "invalid_input",
        message: "살아 있는 준비 참조가 없다",
      });
    }
  } else {
    const existing = parsed.data.source.reference;
    const allowed = sql.get(
      `select hash, size_bytes from blob_refs
       where owner_kind = ? and owner_key = ? and field = ? and hash = ?`,
      [
        existing.owner_kind,
        existing.owner_key,
        existing.field,
        existing.hash,
      ],
    );
    if (allowed === undefined) {
      return err({
        code: "forbidden",
        message: "허용된 기존 blob 참조가 없다",
      });
    }
  }
  const size = sizeOf(sql, parsed.data);
  if (!size.ok) return size;
  sql.run(
    `insert into blob_refs
       (owner_kind, owner_key, field, hash, size_bytes, registered_seq)
     values (?, ?, ?, ?, ?, ?)`,
    [
      parsed.data.owner_kind,
      parsed.data.owner_key,
      parsed.data.field,
      hash,
      size.value,
      BigInt(parsed.data.registered_seq),
    ],
  );
  const stored: PermanentBlobReference = {
    owner_kind: parsed.data.owner_kind,
    owner_key: parsed.data.owner_key,
    field: parsed.data.field,
    hash,
    registered_seq: parsed.data.registered_seq,
  };
  const checked = permanentBlobReferenceSchema.safeParse(stored);
  if (!checked.success) {
    return err({
      code: "invalid_input",
      message: "등록한 blob 참조가 schema와 다르다",
    });
  }
  return ok(checked.data);
}

// 준비 결과는 그 크기를, 기존 참조는 이미 등록된 크기를 쓴다.
function sizeOf(
  sql: Sql,
  reference: BlobRefRegistration,
): Result<number> {
  if (reference.source.kind === "prepared") {
    return ok(reference.source.blob.size_bytes);
  }
  const row = sql.get(
    `select size_bytes from blob_refs
     where owner_kind = ? and owner_key = ? and field = ? and hash = ?`,
    [
      reference.source.reference.owner_kind,
      reference.source.reference.owner_key,
      reference.source.reference.field,
      reference.source.reference.hash,
    ],
  );
  const size = row?.["size_bytes"];
  if (typeof size !== "bigint" && typeof size !== "number") {
    return err({ code: "forbidden", message: "허용된 기존 blob 참조가 없다" });
  }
  return ok(Number(size));
}
