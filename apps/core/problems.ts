import { err } from "../../packages/base/mod.ts";
import {
  getTestRequestRead,
  getVerificationRead,
  listVerificationsRead,
  recordVerificationCommand,
  requestTestCommand,
  TEST_BLOB_FIELDS,
  TEST_BLOB_PURPOSES,
  TEST_SCHEMA_STEPS,
  testAdmissionPort,
  testEvidencePort,
  verificationRecordedVisibility,
} from "../../packages/problems/tests/mod.ts";
import {
  FIX_BLOB_FIELDS,
  FIX_BLOB_PURPOSES,
  listProblemFixesRead,
  recordProblemFixCommand,
} from "../../packages/problems/repairs/mod.ts";
import type {
  EventRegistration,
  ReaderRegistration,
  TxPortRegistration,
} from "../../packages/platform/ledger/mod.ts";
import { z } from "zod";
import {
  defineBlobPurpose,
  defineSetting,
} from "../../packages/contracts/platform/mod.ts";
import {
  getReportRead,
  getSnapshotRead,
  listReportsRead,
} from "../../packages/problems/reporting/reads.ts";
import {
  getProblemRead,
  listProblemsRead,
} from "../../packages/problems/grouping/reads.ts";
import { REPORTS_SCHEMA_STEPS } from "../../packages/problems/reporting/mod.ts";
import {
  DETAIL_COLLECTION_SETTING_KEY,
  reportBlobField,
  type SnapshotLogsEnvironment,
  snapshotLogsRead,
  SNAPSHOTS_SCHEMA_STEPS,
} from "../../packages/problems/snapshots/mod.ts";
import { recordReportCommand } from "../../packages/problems/reporting/commands.ts";
import { REPORT_BLOB_PURPOSES } from "../../packages/contracts/problems/mod.ts";
import type { KindLaunchSpec } from "../../packages/contracts/platform/mod.ts";
import {
  observeException,
  observeViewError,
  problemClosed,
  problemFixRecorded,
  problemOpened,
  problemReopened,
  reportProblem,
  submitFeedback,
  verificationRecorded,
} from "../../packages/contracts/problems/mod.ts";
import { notificationsOnlyVisibility } from "./platform.ts";
import { reportCollectorSpec, testRunnerSpec } from "./problems-runner.ts";

// owner definitions만 내보낸다. port 구현과 writer 조립은 core가 맡는다.
export const problemsTestDefinitions = {
  schema: TEST_SCHEMA_STEPS,
  blobFields: TEST_BLOB_FIELDS,
  blobPurposes: TEST_BLOB_PURPOSES,
  commands: [requestTestCommand, recordVerificationCommand],
  reads: [getTestRequestRead, getVerificationRead, listVerificationsRead],
  visibility: [verificationRecordedVisibility],
  ports: { admission: testAdmissionPort, evidence: testEvidencePort },
  workers: testRunnerWorkers(),
};

// 등록 시점 env에서 data root와 Deno 실행 파일을 좁힌다. 없으면 spec을 내지 않는다.
function workerRoot(): string | undefined {
  const lophnHome = Deno.env.get("LOPHN_HOME");
  const home = Deno.env.get("HOME");
  const root = lophnHome && lophnHome.length > 0
    ? lophnHome
    : home
    ? `${home}/.lophn`
    : undefined;
  return root && root.startsWith("/") ? root : undefined;
}

function testRunnerWorkers(): KindLaunchSpec[] {
  const root = workerRoot();
  if (!root) return [];
  const spec = testRunnerSpec({
    dataRoot: root,
    deno: Deno.execPath(),
    screenHost: Deno.env.get("SCREEN_TEST_HOST"),
  });
  return spec ? [spec] : [];
}

// report collector는 보고 접수 통로다(T3). core loopback에만 닿고 준비 폴더만
// 읽는다(architecture/problems 2.2). 자식 실행 권한이 없으므로 Deno 실행 파일을
// 받지 않는다.
function reportCollectorWorkers(): KindLaunchSpec[] {
  const root = workerRoot();
  if (!root) return [];
  const spec = reportCollectorSpec({ dataRoot: root });
  return spec ? [spec] : [];
}

// 보고 등록: record-report와 reports·snapshots ledger. read는 reader Worker가
// createReaderRegistration으로 붙인다(#142). blob purpose 상한은
// contracts/report-blobs의 항목 상한을 정의하는 몫이다.
const REPORT_SIZE = {
  report_text: 262_144,
  report_details: 262_144,
  snapshot_stack: 16_384,
  snapshot_logs: 65_536,
  feedback_state: 65_536,
  feedback_screenshot: 2_097_152,
} as const;

const REPORT_BLOB_FIELD_FIELDS = [
  "report_text",
  "report_details",
  "snapshot_stack",
  "snapshot_logs",
  "feedback_state",
  "feedback_screenshot",
];

export const problemsReportDefinitions = {
  schema: [...REPORTS_SCHEMA_STEPS, ...SNAPSHOTS_SCHEMA_STEPS],
  blobFields: [
    ...REPORT_BLOB_FIELD_FIELDS.map(reportBlobField),
    ...FIX_BLOB_FIELDS,
  ],
  blobPurposes: [
    ...REPORT_BLOB_PURPOSES.map((purpose) =>
      defineBlobPurpose({
        purpose,
        max_size_bytes: REPORT_SIZE[purpose],
      })
    ),
    ...FIX_BLOB_PURPOSES,
  ],
  commands: [recordReportCommand, recordProblemFixCommand],
  reads: [
    listProblemsRead,
    getProblemRead,
    listReportsRead,
    getReportRead,
    getSnapshotRead,
    listProblemFixesRead,
  ],
  ports: {} as Record<string, TxPortRegistration>,
  workers: reportCollectorWorkers(),
  // 보고 접수 worker route(T3, T16). dispatch가 입력 형식·scope 뒤 collector로 넘긴다.
  // observe-exception은 예외 진단을 collector로 넘기고(process 출처),
  // observe-view-error는 view exception을 collector로 넘긴다(view 출처, reporting#R5, R6).
  // submit-feedback은 shell user의 제보를 collector로 넘긴다(feedback#R1; 선택한 PNG는 바이트 body).
  workerRoutes: [
    reportProblem,
    observeException,
    observeViewError,
    submitFeedback,
  ],
};

// 진단 상세 수집 on/off(snapshots#R7). 끄면 새 로그 같은 상세 수집만 멈추고 기존 자료의
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

// core 조립의 settings.ts가 모으는 problems 등록 항목이다(platform/settings#R31).
export const problemsDefinitions = { settings: [detailCollectionSetting] };

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

export function createLedgerRegistration(
  environment: { snapshotLogs?: SnapshotLogsEnvironment } = {},
) {
  return {
    apiReads: [
      snapshotLogsRead(environment.snapshotLogs ?? UNATTACHED_SNAPSHOT_LOGS),
    ],
  };
}

// event 정의와 공개 정책. reader Worker가 모든 팀 module의 것을 모아 events/list의 registry를
// 만든다(platform/ledger#R15). 정책이 없는 problems event는 숨김이다.
export function createEventRegistration(): EventRegistration {
  return {
    events: [verificationRecorded, problemFixRecorded],
    visibility: [
      ...problemsTestDefinitions.visibility,
      // notifications 계기(platform/notifications#R1)다. notifications 구독자에게만 연다.
      notificationsOnlyVisibility(problemOpened),
      notificationsOnlyVisibility(problemReopened),
      notificationsOnlyVisibility(problemClosed),
    ],
  };
}

// reader Worker가 이 모듈을 import해 read를 reader 풀에 붙인다(#142).
// 실행 port는 없다.
export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [
      listProblemsRead,
      getProblemRead,
      listReportsRead,
      getReportRead,
      getSnapshotRead,
      listProblemFixesRead,
    ],
    ports: new Map(),
  };
}
