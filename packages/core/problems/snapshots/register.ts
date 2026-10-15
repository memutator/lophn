import type { ProblemsLedgerEnvironment, ProblemsPart } from "../register.ts";
import { err } from "../../../base/mod.ts";
import {
  type SnapshotLogsEnvironment,
  snapshotLogsRead,
  SNAPSHOTS_SCHEMA_STEPS,
} from "./mod.ts";
import { snapshotViewApiRead } from "./logs-read.ts";

// 설정 선언은 `./settings.ts`에 있다. 조립(problems/register.ts)이 이 이름으로 다시 내보내고
// platform-config의 선언 목록이 모은다.
export { detailCollectionSetting } from "./settings.ts";

// GetSnapshotLogs는 ledger snapshot 없이 바이트를 기다리는 core read다. core가 기동 때
// environment로 읽기 통로를 넣고, 넣지 않은 등록(harness)은 unavailable이다.
const UNATTACHED_SNAPSHOT_LOGS: SnapshotLogsEnvironment = {
  evidence: () =>
    err({
      code: "unavailable",
      message: "snapshot 읽기 통로가 붙어 있지 않다",
    }),
  blobs: () => Promise.resolve({ status: "unavailable", reason: "missing" }),
};

export const snapshotsPart = {
  schema: SNAPSHOTS_SCHEMA_STEPS,
  // GetSnapshot은 blob 정리 여부를 보느라 pool 밖에서 연다.
  apiReads: [snapshotViewApiRead()],
  ledgerApiReads: (environment: ProblemsLedgerEnvironment) => [
    snapshotLogsRead(environment.snapshotLogs ?? UNATTACHED_SNAPSHOT_LOGS),
  ],
} satisfies ProblemsPart;
