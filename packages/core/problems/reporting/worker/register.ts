import type { ProblemsPart } from "../../register.ts";
import { err } from "../../../../base/mod.ts";
import type { ApiReadDefinition } from "../../../../protocol/server/mod.ts";
import type { KindLaunchSpec } from "../../../../protocol/supervision/mod.ts";
import { defineBlobPurpose } from "../../../../protocol/storage/mod.ts";
import {
  observeException,
  observeViewError,
  REPORT_BLOB_PURPOSES,
  reportBody,
  reportProblem,
  submitFeedback,
} from "../../../../protocol/problems/mod.ts";
import { reportBlobField } from "../../snapshots/mod.ts";
import { reportCollectorSpec } from "../../tests/runner.ts";
import { workerRoot } from "../../worker-root.ts";

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

// 보고의 사람 글·log·화면 상태만 읽는 좁은 route다. route만 선언하고 handler는 blob 바이트 통로를 가진
// core 조립(runtime)이 붙인다. 붙기 전과 통로가 없는 등록은 unavailable이다.
const unattachedReportBodyRead: ApiReadDefinition = {
  route: reportBody,
  handle: () =>
    err({ code: "unavailable", message: "본문 읽기가 붙어 있지 않다" }),
};

// report collector는 보고 접수 통로다. core loopback에만 닿고 준비 폴더만
// 읽는다. 자식 실행 권한이 없으므로 Deno 실행 파일을
// 받지 않는다.
function reportCollectorWorkers(): KindLaunchSpec[] {
  const root = workerRoot();
  if (!root) return [];
  const spec = reportCollectorSpec({ dataRoot: root });
  return spec ? [spec] : [];
}

export const reportWorkerPart = {
  blobFields: REPORT_BLOB_FIELD_FIELDS.map(reportBlobField),
  blobPurposes: REPORT_BLOB_PURPOSES.map((purpose) =>
    defineBlobPurpose({
      purpose,
      max_size_bytes: REPORT_SIZE[purpose],
    })
  ),
  apiReads: [unattachedReportBodyRead],
  workers: reportCollectorWorkers(),
  // 보고 접수 worker route. dispatch가 입력 형식·scope 뒤 collector로 넘긴다.
  // observe-exception은 예외 진단을 collector로 넘기고(process 출처),
  // observe-view-error는 view exception을 collector로 넘긴다(view 출처).
  // submit-feedback은 shell user의 제보를 collector로 넘긴다(선택한 PNG는 바이트 body).
  workerRoutes: [
    reportProblem,
    observeException,
    observeViewError,
    submitFeedback,
  ],
} satisfies ProblemsPart;
