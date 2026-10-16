// 보호 backup blob(복구본). migration 전 backup의 SQLite byte는 blob으로 보존하고 ledger에는 그 hash와
// 참조만 둔다. 일반 blob 읽기가 없는 field라 어떤 actor도 이 byte를 읽는 길이 없다. 준비는 core가 blob 준비
// 통로로 backup 파일을 흘려(purpose `app_backup`) 하고 등록은 `activation.record_backup`이 같은 transaction에서
// 한다. 앱마다 가장 최근 하나만 둔다: 새 시도의 등록과 성공한 activation이 `discardBackups`로 참조를 지운다.
import { defineBlobField } from "../../../protocol/storage/mod.ts";

export const BACKUP_BLOB_PURPOSE = "app_backup";
export const BACKUP_BLOB_OWNER_KIND = "release_backup";
export const BACKUP_BLOB_FIELD_NAME = "backup";

export const BACKUP_BLOB_FIELD = defineBlobField({
  owner_kind: BACKUP_BLOB_OWNER_KIND,
  field: BACKUP_BLOB_FIELD_NAME,
  retention: { kind: "permanent" },
  general_read: false,
});

// 한 activation 시도의 backup 하나다.
export function backupBlobOwnerKey(release: string, attempt: string): string {
  return `${release}:${attempt}`;
}
