import {
  type BlobFieldDefinition,
  defineBlobField,
} from "../../contracts/platform/mod.ts";

// Report가 소유한 blob field의 보존 종류(snapshots#R17). 큰 자료(첨부 이미지·로그 조각·
// stack)는 용량 상한을 넘으면 오래된 것부터 정리하는 종류이고, 보고 글·세부는 영구다.
// 문제 닫힘은 정리 계기가 아니므로 field가 닫힘 상태를 보지 않는다.
const ATTACHMENTS = new Set([
  "snapshot_stack",
  "snapshot_logs",
  "feedback_screenshot",
]);

// 로그 조각만 허용된 진단 조회로 읽는다(snapshots#R13, R16). 원문 stack은 일반
// 호출자에게 돌려주지 않고(R10), 읽기 권한은 매 조각마다 credential scope가 정한다.
const READABLE = new Set(["snapshot_logs"]);

export function reportBlobField(field: string): BlobFieldDefinition {
  return defineBlobField({
    owner_kind: "report",
    field,
    retention: ATTACHMENTS.has(field)
      ? { kind: "capacity", category: "snapshot_attachment" }
      : { kind: "permanent" },
    general_read: READABLE.has(field),
  });
}
