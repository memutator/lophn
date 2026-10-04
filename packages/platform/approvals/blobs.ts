// approval 설명 blob의 등록 field(domain model ApprovalRequest·ApprovalEffect).
// 본문은 blob-store에 있고 request 행은 hash만 담는다.

import { defineBlobField } from "../../contracts/platform/mod.ts";

const owner = "approval_request";

// 결정 화면이 읽는 설명이다. 일반 read를 허용한다. secret 원문은 넣지 않는다(R1).
export const APPROVAL_BLOB_FIELDS = [
  defineBlobField({
    owner_kind: owner,
    field: "reason",
    retention: { kind: "permanent" },
    general_read: true,
  }),
  defineBlobField({
    owner_kind: owner,
    field: "changes",
    retention: { kind: "permanent" },
    general_read: true,
  }),
  defineBlobField({
    owner_kind: owner,
    field: "external",
    retention: { kind: "permanent" },
    general_read: true,
  }),
  defineBlobField({
    owner_kind: owner,
    field: "reversibility",
    retention: { kind: "permanent" },
    general_read: true,
  }),
  defineBlobField({
    owner_kind: owner,
    field: "preserved",
    retention: { kind: "permanent" },
    general_read: true,
  }),
  defineBlobField({
    owner_kind: owner,
    field: "verification",
    retention: { kind: "permanent" },
    general_read: true,
  }),
  defineBlobField({
    owner_kind: owner,
    field: "closed_reason",
    retention: { kind: "permanent" },
    general_read: true,
  }),
] as const;

export const APPROVAL_OWNER_KIND = owner;
