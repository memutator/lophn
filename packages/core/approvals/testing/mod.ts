// approval ledger 시험이 함께 쓰는 값과 참조 등록. 제품 코드와 mod.ts는 import하지 않는다.
// 실제 provider와 사람 데이터 root는 열지 않는다.

import { err, ok, type Result } from "../../../base/mod.ts";
import {
  APPROVAL_BLOB_OWNER_KIND,
  APPROVAL_TEXT_FIELDS,
  APPROVAL_TEXT_PURPOSE,
  type ApprovalEffectInput,
  type BlobRefRegistration,
  blobRefRegistrationSchema,
  type PermanentBlobReference,
  type RequestContext,
  type Tx,
} from "../../../protocol/server/mod.ts";

export const REASON_TEXT = "배포 전 확인이 필요하다";

// 설명 글 값. 요청에 값으로 싣는다.
export function effectText(
  over: Partial<ApprovalEffectInput> = {},
): ApprovalEffectInput {
  return {
    changes: "release 하나를 켠다",
    external: null,
    reversible: false,
    reversibility: "켠 뒤에는 되돌리지 못한다",
    ...over,
  };
}

// platform 등록기와 같은 검사(field 정의·준비 주체·purpose)를 줄인 시험용 approval 글 참조
// 등록이다. 참조 행은 실제 blob_refs 표에 들어간다. 준비 참조가 살아 있는지는 platform
// 등록기가 보고 그 경로는 apps/core의 실제 core 시험이 본다.
export function registerApprovalTextRef(
  tx: Tx,
  ctx: RequestContext,
  reference: BlobRefRegistration,
): Result<PermanentBlobReference> {
  if (reference.owner_kind !== APPROVAL_BLOB_OWNER_KIND) {
    return err({ code: "forbidden", message: "field is not defined" });
  }
  const parsed = blobRefRegistrationSchema.safeParse(reference);
  if (!parsed.success) {
    return err({ code: "invalid_input", message: "invalid registration" });
  }
  const value = parsed.data;
  if (
    !(Object.values(APPROVAL_TEXT_FIELDS) as string[]).includes(value.field)
  ) {
    return err({ code: "forbidden", message: "field is not defined" });
  }
  if (value.source.kind !== "prepared") {
    return err({ code: "forbidden", message: "prepared blob only" });
  }
  const blob = value.source.blob;
  if (
    blob.principal !== ctx.principal || blob.purpose !== APPROVAL_TEXT_PURPOSE
  ) {
    return err({
      code: "invalid_input",
      message: "no live preparation for this principal and purpose",
    });
  }
  tx.sql.run(
    `insert into blob_refs (owner_kind, owner_key, field, hash, size_bytes,
       registered_seq) values (?, ?, ?, ?, ?, ?)`,
    [
      value.owner_kind,
      value.owner_key,
      value.field,
      blob.hash,
      blob.size_bytes,
      BigInt(value.registered_seq),
    ],
  );
  return ok({
    owner_kind: value.owner_kind,
    owner_key: value.owner_key,
    field: value.field,
    hash: blob.hash,
    registered_seq: value.registered_seq,
  });
}
