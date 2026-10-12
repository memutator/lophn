import { err, ok } from "../../packages/base/mod.ts";
import {
  getTestRequestRead,
  getVerificationRead,
  listVerificationsRead,
  observeTestRequestCommand,
  problemTestLookup,
  recordVerificationCommand,
  requestTestCommand,
  stageTestEvidenceCommand,
  startTestSideCommand,
  TEST_BLOB_FIELDS,
  TEST_BLOB_PURPOSES,
  TEST_SCHEMA_STEPS,
  verificationRecordedVisibility,
} from "../../packages/core/problems/tests/mod.ts";
import {
  FIX_BLOB_FIELDS,
  FIX_BLOB_PURPOSES,
  listProblemFixesRead,
  recordProblemFixCommand,
} from "../../packages/core/problems/repairs/mod.ts";
import type {
  EventDefinition,
  EventVisibilityDefinition,
} from "../../packages/protocol/platform/mod.ts";
import type {
  EventRegistration,
  ReaderRegistration,
  TxPortRegistration,
} from "../../packages/core/storage/ledger/mod.ts";
import { z } from "zod";
import {
  defineBlobPurpose,
  defineSetting,
} from "../../packages/protocol/platform/mod.ts";
import {
  getReportRead,
  getSnapshotRead,
  listReportsRead,
} from "../../packages/core/problems/reporting/reads.ts";
import {
  getProblemRead,
  linkProblemInterpretationCommand,
  listProblemsRead,
  reconcileProblemWorkCommand,
} from "../../packages/core/problems/grouping/mod.ts";
import {
  applyProblemDecisionCommand,
  closeProblemVerifiedCommand,
} from "../../packages/core/problems/closing/mod.ts";
import {
  ProblemTestPort,
  ProblemWordingPort,
  ProblemWorkPort,
} from "../../packages/protocol/problems/mod.ts";
import { problemWorkLookup } from "../../packages/coding-agent/mod.ts";
import { releaseWording } from "../../packages/core/apps/releases/store.ts";
import { REPORTS_SCHEMA_STEPS } from "../../packages/core/problems/reporting/mod.ts";
import {
  DETAIL_COLLECTION_SETTING_KEY,
  reportBlobField,
  type SnapshotLogsEnvironment,
  snapshotLogsRead,
  SNAPSHOTS_SCHEMA_STEPS,
} from "../../packages/core/problems/snapshots/mod.ts";
import { snapshotViewApiRead } from "./problems-logs.ts";
import { recordReportCommand } from "../../packages/core/problems/reporting/commands.ts";
import {
  REPORT_BLOB_PURPOSES,
  reportBody,
} from "../../packages/protocol/problems/mod.ts";
import type { KindLaunchSpec } from "../../packages/protocol/platform/mod.ts";
import {
  observeException,
  observeViewError,
  problemClosed,
  problemConfirmationRecorded,
  problemFixRecorded,
  problemInterpretationLinked,
  problemObserved,
  problemOpened,
  problemReopened,
  problemsUploadFixSummary,
  problemWorkEnded,
  problemWorkStarted,
  reportProblem,
  submitFeedback,
  verificationRecorded,
} from "../../packages/protocol/problems/mod.ts";
import { notificationsOnlyVisibility } from "./platform.ts";
import {
  isTicketCheckFeed,
  ticketCheckFeedVisibility,
} from "./ticket-checker.ts";
import {
  reportCollectorSpec,
  screenTestHost,
  testRunnerSpec,
} from "./problems-runner.ts";
import { testTxPorts } from "./problems-test-ports.ts";
import { problemsWorkSubscribers } from "./problems-work.ts";
import {
  isProblemsClosing,
  problemsClosingSubscribers,
  problemsClosingVisibility,
} from "./problems-closing.ts";

// ticket checker 구독자(machine:ticket-check-feed)도 깨움 신호로 보는 event다(coding-agent#T26,
// T45). `problems.closing` 반응기(problems#T20)도 문제 상태·활성 release를 다시 읽는 신호로 본다.
// 그 밖의 자격은 owner 정책이 그대로 판단한다.
function visibleToChecker<D extends EventDefinition>(
  owner: EventVisibilityDefinition<D>,
): EventVisibilityDefinition<D> {
  return {
    event: owner.event,
    handle: (snapshot, ctx, event) =>
      isTicketCheckFeed(ctx) || isProblemsClosing(ctx)
        ? ok(true)
        : owner.handle(snapshot, ctx, event),
  };
}

const verificationRecordedForChecker = visibleToChecker(
  verificationRecordedVisibility,
);

// owner definitions만 내보낸다. port 구현과 writer 조립은 core가 맡는다.
export const problemsTestDefinitions = {
  schema: TEST_SCHEMA_STEPS,
  blobFields: TEST_BLOB_FIELDS,
  blobPurposes: TEST_BLOB_PURPOSES,
  // 접수·결과 기록과, runner가 요청별 좁은 machine credential로만 부르는 lifecycle command다.
  commands: [
    requestTestCommand,
    recordVerificationCommand,
    observeTestRequestCommand,
    startTestSideCommand,
    stageTestEvidenceCommand,
  ],
  reads: [getTestRequestRead, getVerificationRead, listVerificationsRead],
  visibility: [verificationRecordedForChecker],
  ports: testTxPorts(),
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
    screenHost: screenTestHost(),
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

// 보고의 사람 글·log·화면 상태만 읽는 좁은 route다. route만 선언하고 handler는 blob 바이트 통로를 가진
// core 조립(runtime)이 붙인다. 붙기 전과 통로가 없는 등록은 unavailable이다.
const unattachedReportBodyRead = {
  route: reportBody,
  handle: () =>
    err({ code: "unavailable", message: "본문 읽기가 붙어 있지 않다" }),
};

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
  commands: [
    recordReportCommand,
    recordProblemFixCommand,
    reconcileProblemWorkCommand,
    linkProblemInterpretationCommand,
    closeProblemVerifiedCommand,
    applyProblemDecisionCommand,
  ],
  // `problems.work`·`problems.closing` 반응기(test-runner kind)만 자기 cursor를 올린다
  // (problems/grouping#R9, problems/closing#R5).
  subscribers: [...problemsWorkSubscribers(), ...problemsClosingSubscribers()],
  reads: [
    listProblemsRead,
    getProblemRead,
    listReportsRead,
    getReportRead,
    listProblemFixesRead,
  ],
  // GetSnapshot은 blob 정리 여부를 보느라 pool 밖에서 연다(snapshots#R17).
  apiReads: [unattachedReportBodyRead, snapshotViewApiRead()],
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
  // 고친 기록 summary의 blob 준비 route(coding-agent#T44). 바이트는 core 핸들러가 준비 중계로 흘린다.
  uploadRoutes: [problemsUploadFixSummary],
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
    events: [
      verificationRecorded,
      problemFixRecorded,
      problemWorkStarted,
      problemWorkEnded,
      problemInterpretationLinked,
    ],
    visibility: [
      ...problemsTestDefinitions.visibility,
      // notifications 계기(platform/notifications#R1)다. notifications 구독자에게만 연다.
      notificationsOnlyVisibility(problemOpened),
      // 닫힘·재발은 보고된 ticket의 남은 조건을 다시 비교하는 신호이기도 하다.
      visibleToChecker(notificationsOnlyVisibility(problemReopened)),
      visibleToChecker(notificationsOnlyVisibility(problemClosed)),
      // 사람의 not_fixed 결정은 checker feed에게만 연다(human_confirmation fail 신호).
      ticketCheckFeedVisibility(problemConfirmationRecorded),
      // 같은 문제의 새 live 보고는 `problems.closing` 반응기의 재평가 신호다(problems#T20,
      // closing#R4). 다른 자격은 정책이 없을 때와 똑같이 못 본다.
      problemsClosingVisibility(problemObserved),
    ],
  };
}

// reader Worker가 이 모듈을 import해 read를 reader 풀에 붙인다(#142).
// 실행 port는 없다. reader Worker는 read마다 그 read를 등록한 module의 port만 넘기므로, 문제 상세
// (problems#T22)가 읽는 지금 수리 ticket 사실은 ticket 표 owner(coding-agent)의 구현을 여기서
// `ProblemWorkPort`로, 테스트 사실은 tests leaf 구현을 `ProblemTestPort`로 등록한다.
// 목록·상세 문구는 보고 당시 release 선언이다(problems#T27). 구현은 apps/releases이고,
// apps reader에만 두면 이 read가 port를 못 봐 선언 문구가 fallback이 된다.
export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [
      listProblemsRead,
      getProblemRead,
      listReportsRead,
      getReportRead,
      getSnapshotRead,
      listProblemFixesRead,
      getTestRequestRead,
      getVerificationRead,
      listVerificationsRead,
    ],
    ports: new Map<unknown, unknown>([
      [ProblemWorkPort, problemWorkLookup],
      [ProblemTestPort, problemTestLookup],
      [ProblemWordingPort, releaseWording],
    ]),
  };
}
