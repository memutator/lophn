import {
  type BlobFieldDefinition,
  defineBlobField,
} from "../../../protocol/storage/mod.ts";

// Report가 소유한 blob field다. 용량 정리 범주는 두지 않으므로 모두 영구다.
// 문제 닫힘은 정리 계기가 아니므로 field가 닫힘 상태를 보지 않는다.

// 로그 조각만 허용된 진단 조회로 읽는다. 원문 stack은 일반
// 호출자에게 돌려주지 않고, 읽기 권한은 매 조각마다 credential scope가 정한다.
const READABLE = new Set(["snapshot_logs"]);

export function reportBlobField(field: string): BlobFieldDefinition {
  return defineBlobField({
    owner_kind: "report",
    field,
    retention: { kind: "permanent" },
    general_read: READABLE.has(field),
  });
}
