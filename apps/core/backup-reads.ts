// settings Backup 탭이 읽는 `/v1/backups/list·get`(platform#T41 contract). 묶음은 ledger가 아니라
// 데이터 root의 `backups/<stamp>/manifest.json`이라 core가 파일로 읽는 api read다. manifest이
// 있는 folder만 내고, 만들기 중·중단된 folder는 목록에 없다(platform/backup-and-migration#R10,
// R12). as_of_seq는 읽은 때의 ledger 머리다. 묶음 내용·경로는 내지 않고 manifest만 낸다.
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  type ApiReadDefinition,
  backupsGet,
  backupsList,
} from "../../packages/protocol/platform/mod.ts";
import {
  findBackup,
  listBackups,
} from "../../packages/platform/backup-and-migration/mod.ts";
import { openConnection } from "../../packages/platform/ledger/mod.ts";

export interface BackupReadEnvironment {
  /** 데이터 root(LOPHN_HOME). */
  root: string;
  ledgerPath: string;
}

function head(ledgerPath: string): Result<string> {
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return opened;
  try {
    const row = opened.value.sql.get(
      "select coalesce(max(seq), 0) as seq from events",
      [],
    );
    return ok(String(row?.["seq"] ?? 0));
  } catch {
    return err({ code: "unavailable", message: "ledger를 읽지 못했다" });
  } finally {
    opened.value.close();
  }
}

export function backupReads(
  environment: BackupReadEnvironment,
): [
  ApiReadDefinition<typeof backupsList>,
  ApiReadDefinition<typeof backupsGet>,
] {
  return [
    {
      route: backupsList,
      async handle() {
        const asOf = head(environment.ledgerPath);
        if (!asOf.ok) return asOf;
        try {
          const { backups } = await listBackups(environment.root);
          return ok({ backups, as_of_seq: asOf.value, next_cursor: null });
        } catch {
          return err({ code: "unavailable", message: "backup을 읽지 못했다" });
        }
      },
    },
    {
      route: backupsGet,
      async handle(_ctx, input) {
        const asOf = head(environment.ledgerPath);
        if (!asOf.ok) return asOf;
        try {
          const manifest = await findBackup(environment.root, input.created_at);
          if (manifest === undefined) {
            return err({ code: "not_found", message: "backup이 없다" });
          }
          return ok({ manifest, as_of_seq: asOf.value, next_cursor: null });
        } catch {
          return err({ code: "unavailable", message: "backup을 읽지 못했다" });
        }
      },
    },
  ];
}
