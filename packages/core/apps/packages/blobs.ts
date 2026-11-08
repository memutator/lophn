// SDK version의 사용 안내 blob.
// 안내 원문(공개 API·type·permission·peer·예제)은 공개 catalog 자료라 일반 읽기를 허용하는 field다.
// 준비는 설치 worker가 blob 준비 통로로(purpose `sdk_guide`) 하고 등록은 `package.register_version`이 같은
// transaction에서 한다. ledger에는 실제로 보존한 byte의 hash만 둔다.
import { defineBlobField } from "../../../protocol/storage/mod.ts";

export const PACKAGE_GUIDE_BLOB_PURPOSE = "sdk_guide";
export const PACKAGE_GUIDE_BLOB_OWNER_KIND = "package_version";
export const PACKAGE_GUIDE_BLOB_FIELD_NAME = "guide";

export const PACKAGE_GUIDE_BLOB_FIELD = defineBlobField({
  owner_kind: PACKAGE_GUIDE_BLOB_OWNER_KIND,
  field: PACKAGE_GUIDE_BLOB_FIELD_NAME,
  retention: { kind: "permanent" },
  general_read: true,
});

// 설치 사본의 정본 byte(`bundleBytes`)다. 설치 사본을 잃어도 core가 이 blob으로 되살린다.
// 사본을 되살리는 core만 읽으므로 일반 읽기는 열지 않는다. 같은 owner key를 쓰고 field만 다르다.
export const PACKAGE_BUNDLE_BLOB_PURPOSE = "sdk_bundle";
export const PACKAGE_BUNDLE_BLOB_FIELD_NAME = "bundle";

export const PACKAGE_BUNDLE_BLOB_FIELD = defineBlobField({
  owner_kind: PACKAGE_GUIDE_BLOB_OWNER_KIND,
  field: PACKAGE_BUNDLE_BLOB_FIELD_NAME,
  retention: { kind: "permanent" },
  general_read: false,
});

// 한 Package version의 blob(안내·bundle)이 같이 쓰는 owner key다. 이름과 정확한 version이다.
export function packageGuideOwnerKey(name: string, version: string): string {
  return `${name}@${version}`;
}
