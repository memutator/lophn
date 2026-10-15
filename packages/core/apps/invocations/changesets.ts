// changeset 보관 선언. 내용은 blob store에 두고 invocation 행에는 hash와 크기만 둔다.
// 준비(prepare)는 core가 blob 준비 통로로 하고, 영구 참조 등록은 `finish`가 행을 닫는 같은 transaction에서 한다.
import {
  defineBlobField,
  defineBlobPurpose,
} from "../../../protocol/storage/mod.ts";

const MIB = 1024 * 1024;

// 한 changeset의 상한. 넘으면 그 invocation은 changeset 없이 닫힌다(rewind에서 되돌릴 수 없음).
export const CHANGESET_MAX_BYTES = 8 * MIB;
// 한 release 안 changeset 크기의 합 상한. rewind가 되돌릴 목록을 한꺼번에 메모리에 올리므로 작게 둔다.
export const RELEASE_CHANGESET_MAX_BYTES = 128 * MIB;

export const CHANGESET_OWNER_KIND = "invocation";
export const CHANGESET_FIELD_NAME = "changeset";
export const CHANGESET_PURPOSE = "app_changeset";

export const INVOCATION_BLOB_FIELDS = [
  defineBlobField({
    owner_kind: CHANGESET_OWNER_KIND,
    field: CHANGESET_FIELD_NAME,
    retention: { kind: "permanent" },
    general_read: false,
  }),
];

export const INVOCATION_BLOB_PURPOSES = [
  defineBlobPurpose({
    purpose: CHANGESET_PURPOSE,
    max_size_bytes: CHANGESET_MAX_BYTES,
  }),
];
