// screenshot blob 선언. 일반 읽기는 열지 않는다. coding agent는 읽는 쪽 값의 파일 경로로,
// 앱 place session과 project place session은 image.read가 annotations.get의 screenshot_path로 읽는다.
import {
  ANNOTATION_SCREENSHOT_MAX_BYTES,
  ANNOTATION_SCREENSHOT_PURPOSE,
} from "../../../protocol/apps/annotation.ts";
import {
  defineBlobField,
  defineBlobPurpose,
} from "../../../protocol/storage/mod.ts";

export const ANNOTATION_BLOB_FIELDS = [
  defineBlobField({
    owner_kind: "annotation",
    field: "screenshot",
    retention: { kind: "permanent" },
    general_read: false,
  }),
];

export const ANNOTATION_BLOB_PURPOSES = [
  defineBlobPurpose({
    purpose: ANNOTATION_SCREENSHOT_PURPOSE,
    max_size_bytes: ANNOTATION_SCREENSHOT_MAX_BYTES,
  }),
];
