// approval 설명 글의 저장. 글은 요청에 값으로 실려 오고 core가
// redaction을 거쳐 같은 UTF-8 bytes로 blob을 준비해 두었다. 이 파일은 그 글에서 hash와 준비
// 증거를 같은 값으로 다시 만들고 같은 transaction에서 영구 참조를 등록한다. 살아 있는 준비가
// 없으면 등록이 거절되어 request 전체가 되돌아간다.

import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../base/mod.ts";
import type { RequestContext, Tx } from "../../protocol/server/mod.ts";
import {
  APPROVAL_BLOB_OWNER_KIND,
  APPROVAL_TEXT_FIELDS,
  APPROVAL_TEXT_PURPOSE,
  type ApprovalEffect,
  type ApprovalEffectInput,
  approvalTextBytes,
} from "../../protocol/approvals/mod.ts";

export type TextBlob = {
  hash: string;
  evidence: {
    preparation: string;
    principal: string;
    purpose: string;
    hash: string;
    size_bytes: number;
  };
};

// 같은 글은 항상 같은 hash다. 준비 참조의 수명과 상관없이 값으로 정해진다.
export function textBlob(ctx: RequestContext, text: string): TextBlob {
  const bytes = approvalTextBytes(text);
  const hash = createHash("sha256").update(bytes).digest("hex");
  return {
    hash,
    evidence: {
      preparation: hash,
      principal: ctx.principal,
      purpose: APPROVAL_TEXT_PURPOSE,
      hash,
      size_bytes: bytes.length,
    },
  };
}

export type StoredApprovalText = {
  reason_blob: string;
  effect: ApprovalEffect;
  blobs: { field: string; blob: TextBlob }[];
};

export function storedText(
  ctx: RequestContext,
  input: { reason: string; effect: ApprovalEffectInput },
): StoredApprovalText {
  const reason = textBlob(ctx, input.reason);
  const changes = textBlob(ctx, input.effect.changes);
  const external = input.effect.external === null
    ? null
    : textBlob(ctx, input.effect.external);
  const reversibility = textBlob(ctx, input.effect.reversibility);
  const blobs: StoredApprovalText["blobs"] = [
    { field: APPROVAL_TEXT_FIELDS.reason, blob: reason },
    { field: APPROVAL_TEXT_FIELDS.changes, blob: changes },
    { field: APPROVAL_TEXT_FIELDS.reversibility, blob: reversibility },
  ];
  if (external !== null) {
    blobs.push({ field: APPROVAL_TEXT_FIELDS.external, blob: external });
  }
  return {
    reason_blob: reason.hash,
    effect: {
      changes_blob: changes.hash,
      external_blob: external?.hash ?? null,
      reversible: input.effect.reversible,
      reversibility_blob: reversibility.hash,
    },
    blobs,
  };
}

// 같은 (request, field, hash)는 한 번만 등록한다.
export function registerTextBlobs(
  tx: Tx,
  approval: string,
  seq: string,
  blobs: readonly { field: string; blob: TextBlob }[],
): Result<void> {
  const seen = new Set<string>();
  for (const { field, blob } of blobs) {
    const key = `${field}:${blob.hash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const registered = tx.registerBlobRef({
      owner_kind: APPROVAL_BLOB_OWNER_KIND,
      owner_key: approval,
      field,
      registered_seq: seq,
      source: { kind: "prepared", blob: blob.evidence },
    });
    if (!registered.ok) return err(registered.error);
  }
  return ok(undefined);
}
