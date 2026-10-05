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
import type {
  ReaderRegistration,
  TxPortRegistration,
} from "../../packages/platform/ledger/mod.ts";
import {
  defineBlobField,
  defineBlobPurpose,
} from "../../packages/contracts/platform/mod.ts";
import {
  getReportRead,
  getSnapshotRead,
  listReportsRead,
} from "../../packages/problems/reporting/reads.ts";
import { REPORTS_SCHEMA_STEPS } from "../../packages/problems/reporting/mod.ts";
import { SNAPSHOTS_SCHEMA_STEPS } from "../../packages/problems/snapshots/mod.ts";
import { recordReportCommand } from "../../packages/problems/reporting/commands.ts";
import { REPORT_BLOB_PURPOSES } from "../../packages/contracts/problems/mod.ts";
import type { KindLaunchSpec } from "../../packages/contracts/platform/mod.ts";
import { reportProblem, observeException } from "../../packages/contracts/problems/mod.ts";
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
  const spec = testRunnerSpec({ dataRoot: root, deno: Deno.execPath() });
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
  blobFields: REPORT_BLOB_FIELD_FIELDS.map((field) =>
    defineBlobField({
      owner_kind: "report",
      field,
      retention: { kind: "permanent" },
      general_read: false,
    })
  ),
  blobPurposes: REPORT_BLOB_PURPOSES.map((purpose) =>
    defineBlobPurpose({
      purpose,
      max_size_bytes: REPORT_SIZE[purpose],
    })
  ),
  commands: [recordReportCommand],
  reads: [listReportsRead, getReportRead, getSnapshotRead],
  ports: {} as Record<string, TxPortRegistration>,
  workers: reportCollectorWorkers(),
  // 보고 접수 worker route(T3). dispatch가 입력 형식·scope 뒤 collector로 넘긴다.
  // observe-exception도 예외 진단을 collector로 넘긴다(process 출처).
  workerRoutes: [reportProblem, observeException],
};

// reader Worker가 이 모듈을 import해 read를 reader 풀에 붙인다(#142).
// 실행 port는 없다.
export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [listReportsRead, getReportRead, getSnapshotRead],
    ports: new Map(),
  };
}
