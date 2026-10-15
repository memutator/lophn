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
import { testsPart } from "./tests/register.ts";
import { reportingPart } from "./reporting/register.ts";
import { reportWorkerPart } from "./reporting/worker/register.ts";
import { snapshotsPart } from "./snapshots/register.ts";
import { groupingPart } from "./grouping/register.ts";
import { repairsPart } from "./repairs/register.ts";
import type { SnapshotLogsEnvironment } from "./snapshots/mod.ts";

export { detailCollectionSetting } from "./snapshots/register.ts";
// core 조립이 끼우는 자리: ReleaseLookup을 받는 port key(writer ports와 reader ports에 같은 key로 끼운다)와
// apps에 넘기는 열린 문제 수 구현.
export { ReleaseLookupPort } from "./reporting/mod.ts";
export { problemCounts } from "./grouping/mod.ts";

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
  const parts = [testsPart, repairsPart];
  return {
    events: gather(parts, "events"),
    visibility: gather([testsPart], "visibility"),
  };
}

// reader Worker가 이 모듈을 import해 read를 reader 풀에 붙인다(#142).
// 문제 상세가 release를 푸는 ReleaseLookup은 core 조립이 `ReleaseLookupPort`로 끼운다.
// 테스트 사실은 tests leaf 구현을 `ProblemTestPort`로(tests/register.ts) 등록한다.
export function createReaderRegistration(): ReaderRegistration {
  const parts = [groupingPart, reportingPart, repairsPart, testsPart];
  return {
    reads: gather(parts, "readerReads"),
    ports: new Map<unknown, unknown>(gather(parts, "readerPorts")),
  };
}
