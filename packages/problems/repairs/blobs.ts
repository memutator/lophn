// 고친 기록의 summary 설명 blob. 내용은 준비 blob으로 저장 대상이고, 입력 contract는
// hash만 싣는다(contracts#T40). 준비 참조 등록은 접수 내용 blob 흐름의 몫이다.
import {
  defineBlobField,
  defineBlobPurpose,
} from "../../contracts/platform/mod.ts";

export const FIX_BLOB_FIELDS = [
  defineBlobField({
    owner_kind: "problem_fix",
    field: "summary",
    retention: { kind: "permanent" },
    general_read: false,
  }),
];

export const FIX_BLOB_PURPOSES = [
  defineBlobPurpose({
    purpose: "fix_summary",
    max_size_bytes: 262_144,
  }),
];
