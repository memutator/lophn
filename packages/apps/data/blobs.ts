// 보호 backup blob(domain-model apps/data DataBackup, apps/data#R4·R5). migration 전 backup의 SQLite byte는
// blob으로 보존하고 ledger에는 그 hash와 참조만 둔다. 일반 blob 읽기가 없는 field라 어떤 actor도 이 byte를
// 문서 blob 읽기 경로로 읽지 못한다. 준비는 supervisor의 감독 pipe(`apps/supervisor` 자식 policy)가 하고
// 등록은 `release.record_backup`이 같은 transaction에서 한다.
import {
  defineBlobField,
  defineBlobPurpose,
} from "../../contracts/platform/mod.ts";

export const BACKUP_BLOB_PURPOSE = "app_backup";
export const BACKUP_BLOB_OWNER_KIND = "release_backup";
export const BACKUP_BLOB_FIELD_NAME = "backup";

export const BACKUP_BLOB_PURPOSE_DEFINITION = defineBlobPurpose({
  purpose: BACKUP_BLOB_PURPOSE,
  max_size_bytes: 1024 * 1024 * 1024,
});

export const BACKUP_BLOB_FIELD = defineBlobField({
  owner_kind: BACKUP_BLOB_OWNER_KIND,
  field: BACKUP_BLOB_FIELD_NAME,
  retention: { kind: "permanent" },
  general_read: false,
});

// 한 activation 시도의 backup 하나다.
export function backupBlobOwnerKey(
  release: string,
  activationSeq: string,
): string {
  return `${release}:${activationSeq}`;
}
