import type { Sql } from "../../../protocol/server/mod.ts";

// 명단이 같은 기기의 여러 id를 작은 id 하나로 접으면(architecture `remote.md`의 "명단") 폰에서 온 sync log 줄의 기기 칸을
// 그 id로 바꾼다. 명단을 저장하는 write가 부르고 저장마다 다시 오므로 다시 해도 같다. 같은 (기기, change_id)가 이미 있는
// 줄은 그대로 둔다(그 변경은 이미 받았다).
export function foldSyncLogDevice(
  sql: Pick<Sql, "run">,
  from: string,
  to: string,
): void {
  sql.run("update or ignore app_sync_log set device = ? where device = ?", [
    to,
    from,
  ]);
}
