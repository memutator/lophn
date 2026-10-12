// approval 설명 blob의 등록 field(domain model ApprovalRequest·ApprovalEffect).
// 본문은 blob-store에 있고 request 행은 hash만 담는다.

import { APPROVAL_BLOB_OWNER_KIND } from "../../protocol/approvals/mod.ts";
import { defineBlobField } from "../../protocol/storage/mod.ts";

const owner = APPROVAL_BLOB_OWNER_KIND;

// 결정 화면이 읽는 설명이다. 일반 blob.read로는 열지 않는다: 읽는 쪽 범위(사람, machine,
// 요청한 자격)는 ReadApprovalText가 request 가시성과 같게 판정한다. 범위 밖은 없는 request와
// 같은 not_found이므로 hash만 알아도 글을 읽는 길이 없어야 한다. secret 원문은 core가 준비 전에
// 가린다.
export const APPROVAL_BLOB_FIELDS = [
  defineBlobField({
    owner_kind: owner,
    field: "reason",
    retention: { kind: "permanent" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: owner,
    field: "changes",
    retention: { kind: "permanent" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: owner,
    field: "external",
    retention: { kind: "permanent" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: owner,
    field: "reversibility",
    retention: { kind: "permanent" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: owner,
    field: "preserved",
    retention: { kind: "permanent" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: owner,
    field: "verification",
    retention: { kind: "permanent" },
    general_read: false,
  }),
  defineBlobField({
    owner_kind: owner,
    field: "closed_reason",
    retention: { kind: "permanent" },
    general_read: false,
  }),
] as const;

export const APPROVAL_OWNER_KIND = owner;
