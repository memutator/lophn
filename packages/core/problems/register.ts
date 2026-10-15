import type {
  ApiReadDefinition,
  CommandDefinition,
  EventVisibilityDefinition,
  ReadDefinition,
  SchemaStep,
} from "../../protocol/server/mod.ts";
import type { EventDefinition, WorkerRoute } from "../../protocol/base/mod.ts";
import type { UploadRoute } from "../../protocol/base/mod.ts";
import type {
  BlobFieldDefinition,
  defineBlobPurpose,
} from "../../protocol/storage/mod.ts";
import type { KindLaunchSpec } from "../../protocol/supervision/mod.ts";
import type { SettingDefinition } from "../../protocol/config/mod.ts";
import type {
  EventRegistration,
  ReaderRegistration,
  TxPortRegistration,
} from "../storage/ledger/mod.ts";
import type { SubscriberBinding } from "../storage/ledger/mod.ts";
import {
  problemClosed,
  problemConfirmationRecorded,
  problemObserved,
  problemOpened,
  problemReopened,
  ProblemWordingPort,
  ProblemWorkPort,
} from "../../protocol/problems/mod.ts";
import { problemWorkLookup } from "../apps/tickets/mod.ts";
import { releaseWording } from "../apps/releases/store.ts";
import { notificationsOnlyVisibility } from "../main/daemon/platform-register.ts";
import { ticketCheckFeedVisibility } from "../apps/tickets/checker/connection.ts";
import { problemsClosingVisibility } from "./closing/connection.ts";
import { testsPart } from "./tests/register.ts";
import { reportingPart } from "./reporting/register.ts";
import { reportWorkerPart } from "./reporting/worker/register.ts";
import { snapshotsPart } from "./snapshots/register.ts";
import { groupingPart, visibleToChecker } from "./grouping/register.ts";
import { repairsPart } from "./repairs/register.ts";
import type { SnapshotLogsEnvironment } from "./snapshots/mod.ts";

export { detailCollectionSetting } from "./snapshots/register.ts";

// leaf마다 자기 register.ts에서 내는 등록 조각이다. 칸은 모두 선택이다.
// 조립(이 file)은 조각을 칸마다 이어 붙인다.
export type ProblemsPart = {
  schema?: readonly SchemaStep[];
  blobFields?: readonly BlobFieldDefinition[];
  blobPurposes?: readonly ReturnType<typeof defineBlobPurpose>[];
  commands?: readonly CommandDefinition[];
  subscribers?: readonly SubscriberBinding[];
  reads?: readonly ReadDefinition[];
  apiReads?: readonly ApiReadDefinition[];
  ports?: readonly TxPortRegistration[];
  workers?: readonly KindLaunchSpec[];
  workerRoutes?: readonly WorkerRoute[];
  uploadRoutes?: readonly UploadRoute[];
  events?: readonly EventDefinition[];
  visibility?: readonly EventVisibilityDefinition<EventDefinition>[];
  // reader Worker에 붙는 read와 그 port([key, 구현] 쌍).
  readerReads?: readonly ReadDefinition[];
  readerPorts?: readonly (readonly [unknown, unknown])[];
  settings?: readonly SettingDefinition[];
  // createLedgerRegistration이 environment로 만드는 ledger snapshot 밖 read.
  ledgerApiReads?: (
    environment: ProblemsLedgerEnvironment,
  ) => ApiReadDefinition[];
};

export type ProblemsLedgerEnvironment = {
  snapshotLogs?: SnapshotLogsEnvironment;
};

type ListField =
  | "schema"
  | "blobFields"
  | "blobPurposes"
  | "commands"
  | "subscribers"
  | "reads"
  | "apiReads"
  | "ports"
  | "workers"
  | "workerRoutes"
  | "uploadRoutes"
  | "events"
  | "visibility"
  | "readerReads"
  | "readerPorts"
  | "settings";

function gather<K extends ListField>(
  parts: readonly ProblemsPart[],
  key: K,
): NonNullable<ProblemsPart[K]>[number][] {
  return parts.flatMap((part) => [...(part[key] ?? [])]) as NonNullable<
    ProblemsPart[K]
  >[number][];
}

// 순서가 뜻을 가진다. schema step은 migration 이력 순서이고 나머지도 지금 배열 순서를 따른다.
const reportParts: readonly ProblemsPart[] = [
  groupingPart,
  reportingPart,
  reportWorkerPart,
  snapshotsPart,
  repairsPart,
];

// owner definitions만 내보낸다. port 구현과 writer 조립은 core가 맡는다.
export const problemsTestDefinitions = testsPart;

export const problemsReportDefinitions = {
  schema: gather(reportParts, "schema"),
  blobFields: gather(reportParts, "blobFields"),
  blobPurposes: gather(reportParts, "blobPurposes"),
  commands: gather(reportParts, "commands"),
  subscribers: gather(reportParts, "subscribers"),
  reads: gather(reportParts, "reads"),
  apiReads: gather(reportParts, "apiReads"),
  ports: gather(reportParts, "ports"),
  workers: gather(reportParts, "workers"),
  workerRoutes: gather(reportParts, "workerRoutes"),
  uploadRoutes: gather(reportParts, "uploadRoutes"),
};

// core 조립의 settings.ts가 모으는 problems 등록 항목이다.
export const problemsDefinitions = {
  settings: gather(reportParts, "settings"),
};

export function createLedgerRegistration(
  environment: ProblemsLedgerEnvironment = {},
) {
  return {
    apiReads: reportParts.flatMap((part) =>
      part.ledgerApiReads?.(environment) ?? []
    ),
  };
}

// event 정의와 공개 정책. reader Worker가 모든 팀 module의 것을 모아 events/list의 registry를
// 만든다. 정책이 없는 problems event는 숨김이다.
export function createEventRegistration(): EventRegistration {
  const parts = [testsPart, repairsPart, groupingPart];
  return {
    events: gather(parts, "events"),
    visibility: [
      ...gather([testsPart], "visibility"),
      // notifications 계기다. notifications 구독자에게만 연다.
      notificationsOnlyVisibility(problemOpened),
      // 닫힘·재발은 보고된 ticket의 남은 조건을 다시 비교하는 신호이기도 하다.
      visibleToChecker(notificationsOnlyVisibility(problemReopened)),
      visibleToChecker(notificationsOnlyVisibility(problemClosed)),
      // 사람의 not_fixed 결정은 checker feed에게만 연다(human_confirmation fail 신호).
      ticketCheckFeedVisibility(problemConfirmationRecorded),
      // 같은 문제의 새 live 보고는 `problems.closing` 반응기의 재평가 신호다.
      // 다른 자격은 정책이 없을 때와 똑같이 못 본다.
      problemsClosingVisibility(problemObserved),
    ],
  };
}

// reader Worker가 이 모듈을 import해 read를 reader 풀에 붙인다(#142).
// 실행 port는 없다. reader Worker는 read마다 그 read를 등록한 module의 port만 넘기므로, 문제 상세
//가 읽는 지금 수리 ticket 사실은 ticket 표 owner(coding-agent)의 구현을 여기서
// `ProblemWorkPort`로, 테스트 사실은 tests leaf 구현을 `ProblemTestPort`로(tests/register.ts) 등록한다.
// 목록·상세 문구는 보고 당시 release 선언이다. 구현은 apps/releases이고,
// apps reader에만 두면 이 read가 port를 못 봐 선언 문구가 fallback이 된다.
export function createReaderRegistration(): ReaderRegistration {
  const parts = [groupingPart, reportingPart, repairsPart, testsPart];
  return {
    reads: gather(parts, "readerReads"),
    ports: new Map<unknown, unknown>([
      [ProblemWorkPort, problemWorkLookup],
      ...gather(parts, "readerPorts"),
      [ProblemWordingPort, releaseWording],
    ]),
  };
}
