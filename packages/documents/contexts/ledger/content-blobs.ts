// content blob 참조의 계산과 등록이다. 바이트는 호출 경계(core)가 command 앞에서 호출자 자격으로
// 준비해 두고(platform/blob-store), 여기는 파일을 쓰지 않는다. 참조 hash는 같은 정규 직렬화에서 나오므로
// 준비한 바이트와 같다. 등록은 소유 변경과 같은 transaction에서 tx.registerBlobRef가 한다.
import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  CONTEXT_CONTENT_FIELD,
  CONTEXT_CONTENT_OWNER_KIND,
  CONTEXT_CONTENT_PURPOSE,
  contextContentBytes,
} from "../../../contracts/documents/mod.ts";
import type {
  PermanentBlobReference,
  RequestContext,
  Tx,
} from "../../../contracts/platform/mod.ts";
import type { BlobReference } from "../api/state.ts";

// 값의 참조. 파일을 쓰지 않는다.
export function contentReference(value: unknown): BlobReference {
  const bytes = contextContentBytes(value);
  return {
    hash: createHash("sha256").update(bytes).digest("hex"),
    size_bytes: bytes.length,
  };
}

// 등록 오류 중 이 command들이 낼 수 있는 코드만 그대로 두고 나머지는 입력 거절로 바꾼다.
const PASSED = new Set(["invalid_input", "forbidden", "unavailable"]);

// 내용으로 주소를 정한 참조를 이 transaction에 등록한다(platform/blob-store#R4). 준비 참조는 요청 자격의
// 이름으로 있어야 한다. 이미 등록된 내용이면 새로 등록하지 않고 그 참조를 돌려준다(재전송·같은 내용).
// registered_seq는 이 transaction 시점의 마지막 event다(내용 주소라 어느 event가 처음 올렸는지는 뜻이 없다).
export function registerContextContent(
  tx: Tx,
  ctx: RequestContext,
  reference: BlobReference,
): Result<PermanentBlobReference> {
  const owner = {
    owner_kind: CONTEXT_CONTENT_OWNER_KIND,
    owner_key: reference.hash,
    field: CONTEXT_CONTENT_FIELD,
  };
  const existing = tx.sql.get(
    `SELECT registered_seq FROM blob_refs
     WHERE owner_kind = ? AND owner_key = ? AND field = ? AND hash = ?`,
    [owner.owner_kind, owner.owner_key, owner.field, reference.hash],
  );
  if (existing !== undefined) {
    return ok({
      ...owner,
      hash: reference.hash,
      registered_seq: String(existing["registered_seq"]),
    });
  }
  const head = tx.sql.get("SELECT max(seq) AS seq FROM events", []);
  if (head === undefined || head["seq"] === null || head["seq"] === undefined) {
    return err({ code: "internal", message: "the ledger has no event" });
  }
  const registered = tx.registerBlobRef({
    ...owner,
    registered_seq: String(head["seq"]),
    source: {
      kind: "prepared",
      blob: {
        preparation: reference.hash,
        principal: ctx.principal,
        purpose: CONTEXT_CONTENT_PURPOSE,
        hash: reference.hash,
        size_bytes: reference.size_bytes,
      },
    },
  });
  if (registered.ok) return registered;
  return err({
    code: PASSED.has(registered.error.code)
      ? registered.error.code
      : "invalid_input",
    message: "the context content was not prepared by the caller",
  });
}
