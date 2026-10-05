// GetSnapshotLogs가 core 안에서 읽는 통로(snapshots#R13, R16). 증거 행은 ledger를 읽기
// 전용 connection으로 짧게 열어 읽고, 바이트는 blob store의 읽기 통로로 받는다.
// core만 import한다(reader Worker와 settings 조립은 sqlite 의존을 끌어오지 않는다).
import { err, ok, type Result } from "../../packages/base/mod.ts";
import { REPORTING_LIMITS } from "../../packages/contracts/problems/mod.ts";
import { openConnection } from "../../packages/platform/ledger/mod.ts";
import {
  logsRowOf,
  type SnapshotLogsEnvironment,
} from "../../packages/problems/snapshots/mod.ts";

export type BlobBytesRead = (
  hash: string,
  offset: number,
  length: number,
) => Promise<Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>>;

export function snapshotLogsEnvironment(input: {
  ledgerPath: string;
  read: BlobBytesRead;
}): SnapshotLogsEnvironment {
  return {
    evidence(snapshot) {
      const opened = openConnection(input.ledgerPath);
      if (!opened.ok) return opened;
      try {
        const head = opened.value.sql.get(
          "select coalesce(max(seq), 0) as seq from events",
          [],
        );
        return ok(
          logsRowOf(opened.value.sql, snapshot, String(head?.["seq"] ?? 0)),
        );
      } catch {
        return err({ code: "unavailable", message: "snapshot을 읽지 못했다" });
      } finally {
        opened.value.close();
      }
    },
    async blobs(hash) {
      // 로그 조각은 log_bytes 안이라 한 번에 읽는다. 읽지 못하면 이유를 모르는 부재다.
      const read = await input.read(hash, 0, REPORTING_LIMITS.log_bytes);
      return read.ok
        ? { status: "available", bytes: read.value.bytes }
        : { status: "unavailable", reason: "missing" };
    },
  };
}
