// ticket 완료 보고의 summary blob. 내용은 준비 blob으로 저장 대상이고, 입력 contract는
// 준비 증거를 함께 싣는다(contracts#T40 선례). 영구 참조 등록은 report_completion
// command가 같은 transaction에서 한다(blob-flow의 blobref.attach와 같은 모양).
import { TICKET_SUMMARY_MAX_BYTES } from "../../../protocol/coding-agent/mod.ts";
import {
  defineBlobField,
  defineBlobPurpose,
} from "../../../protocol/platform/mod.ts";

export const TICKET_BLOB_FIELDS = [
  defineBlobField({
    owner_kind: "ticket",
    field: "summary",
    retention: { kind: "permanent" },
    general_read: false,
  }),
];

export const TICKET_BLOB_PURPOSES = [
  defineBlobPurpose({
    purpose: "ticket_summary",
    max_size_bytes: TICKET_SUMMARY_MAX_BYTES,
  }),
];
