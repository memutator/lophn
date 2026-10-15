import type { ProblemsLedgerEnvironment, ProblemsPart } from "../register.ts";
import { z } from "zod";
import { err } from "../../../base/mod.ts";
import { defineSetting } from "../../../protocol/config/mod.ts";
import {
  DETAIL_COLLECTION_SETTING_KEY,
  type SnapshotLogsEnvironment,
  snapshotLogsRead,
  SNAPSHOTS_SCHEMA_STEPS,
} from "./mod.ts";
import { snapshotViewApiRead } from "./logs-read.ts";

// 진단 상세 수집 on/off. 끄면 새 로그 같은 상세 수집만 멈추고 기존 자료의
// 정책 읽기와 필수 invocation 기록은 그대로다. collector가 매 접수마다 이 값을 읽는다.
export const detailCollectionSetting = defineSetting({
  key: DETAIL_COLLECTION_SETTING_KEY,
  owner: "problems/snapshots",
  display_name_key: "settings.problems.detail-collection.name",
  description: "Collect detailed diagnostics such as app logs for new reports.",
  value_meaning_key: "settings.problems.detail-collection.value",
  default_meaning_key: "settings.problems.detail-collection.default",
  affected_features: ["problems/snapshots", "problems/reporting"],
  risk_key: "settings.problems.detail-collection.risk",
  revert_key: "settings.problems.detail-collection.revert",
  constraints: {},
  required: false,
  layers: ["common"],
  // 이미 접수 중인 보고는 그대로 두고 다음 접수부터 바뀐다.
  apply_at: "next_call",
  apply_at_key: "settings.problems.detail-collection.apply-at",
  machine_local: false,
  default_present: true,
  default: true,
  value_type: z.boolean(),
});

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
  settings: [detailCollectionSetting],
  ledgerApiReads: (environment: ProblemsLedgerEnvironment) => [
    snapshotLogsRead(environment.snapshotLogs ?? UNATTACHED_SNAPSHOT_LOGS),
  ],
} satisfies ProblemsPart;
