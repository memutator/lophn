import {
  appsSchemaSteps,
  createAppCommands,
  createAppsReads,
  lookupAppRegistration,
} from "../../packages/apps/registration/mod.ts";
import { appRegistrationLookup } from "../../packages/contracts/apps/mod.ts";
import { createInvocationsCommands } from "../../packages/apps/invocations/commands.ts";
import { createInvocationsReads } from "../../packages/apps/invocations/reads.ts";
import { invocationsSchemaSteps } from "../../packages/apps/invocations/schema.ts";
import { createRuntimeCommands } from "../../packages/apps/runtime/commands.ts";
import { createRuntimeReads } from "../../packages/apps/runtime/reads.ts";
import { createSdkCommands } from "../../packages/apps/sdk/commands.ts";
import { createSdkReads } from "../../packages/apps/sdk/reads.ts";
import { sdkSchemaSteps } from "../../packages/apps/sdk/schema.ts";
import { createDataCommands } from "../../packages/apps/data/commands.ts";
import { dataSchemaSteps } from "../../packages/apps/data/schema.ts";
import { createDataRecordStore } from "../../packages/apps/data/store.ts";
import {
  type PlaceNameReservation,
  placeNameReservation,
} from "../../packages/contracts/documents/mod.ts";
import { createPlaceNameReservation } from "../../packages/documents/addressing/mod.ts";
import { releaseActivationFailed } from "../../packages/contracts/apps/mod.ts";
import type {
  EventRegistration,
  ReaderRegistration,
  TxPortRegistration,
} from "../../packages/platform/ledger/mod.ts";
import { notificationsOnlyVisibility } from "./platform.ts";

type LedgerRegistration = {
  schemaSteps?: readonly { id: string; sql: string }[];
  commands?: readonly unknown[];
  reads?: readonly unknown[];
  ports?: readonly TxPortRegistration[];
};

// owner target은 ledger가 주입한 TargetAuthorization port가 판정한다.
export function createLedgerRegistration(
  _environment?: unknown,
): LedgerRegistration {
  const commands = createAppCommands();
  const reads = createAppsReads();
  const invocations = createInvocationsCommands();
  const invocationReads = createInvocationsReads();
  const sdk = createSdkCommands();
  const sdkReads = createSdkReads();
  // 기록은 command가 받은 tx의 sql에만 남긴다. DB 파일은 data worker가 연다.
  const data = createDataCommands((tx) => createDataRecordStore(tx));
  // record_*는 supervisor의 machine 통보다. 관측 없는 Tx projection은
  // 과거 event만으로 running이라 하지 않는다(R13).
  const runtime = createRuntimeCommands();
  const runtimeReads = createRuntimeReads();
  return {
    // place_names 표는 documents 등록의 몫이다(R6, R10).
    schemaSteps: [
      ...appsSchemaSteps,
      ...invocationsSchemaSteps,
      ...sdkSchemaSteps,
      ...dataSchemaSteps,
    ],
    commands: [
      commands.create,
      commands.connectSource,
      commands.archive,
      commands.unarchive,
      invocations.recordStarted,
      invocations.recordFinished,
      invocations.recordDenied,
      runtime.enableExecution,
      runtime.disableExecution,
      runtime.recordStarted,
      runtime.recordStopped,
      runtime.recordUnavailable,
      sdk.registerVersion,
      data.recordBackup,
      data.recordDataChange,
      data.recordDataRestore,
    ],
    reads: [
      reads.list,
      reads.get,
      runtimeReads.runtime,
      runtimeReads.logs,
      invocationReads.list,
      invocationReads.get,
      sdkReads.list,
      sdkReads.versions,
      sdkReads.usage,
    ],
    // coding-agent connection의 app scope 검사와 documents의 자리 해석은 같은 Tx의
    // 존재 조회를 쓴다. TargetAuthorization은 tx.ts가 주입하므로 여기 등록하지 않는다.
    ports: [
      {
        key: appRegistrationLookup,
        create: (tx) => ({
          get: (app: string) => lookupAppRegistration(tx.sql, app),
        }),
      },
      // documents가 하나로 나눈 place 이름 공간이다(dm#C7). documents 조립도 같은
      // 구현을 등록하므로 harness 등록을 겹치지 않게 documents만 실지 등록했다.
      {
        key: placeNameReservation,
        create: (tx) => createPlaceNameReservation(tx) as PlaceNameReservation,
      },
    ],
  };
}

// release 계기 event의 공개 정책(platform/notifications#R1). notifications 구독자에게만 열고,
// 다른 apps event는 정책이 없어 계속 숨김이다.
export function createEventRegistration(): EventRegistration {
  return { visibility: [notificationsOnlyVisibility(releaseActivationFailed)] };
}

// reader Worker가 이 모듈을 import해 read를 reader 풀에 붙인다. 실행 port는 없다.
export function createReaderRegistration(): ReaderRegistration {
  const reads = createAppsReads();
  const invocations = createInvocationsReads();
  const sdkReads = createSdkReads();
  const runtimeReads = createRuntimeReads();
  return {
    reads: [
      reads.list,
      reads.get,
      runtimeReads.runtime,
      runtimeReads.logs,
      invocations.list,
      invocations.get,
      sdkReads.list,
      sdkReads.versions,
      sdkReads.usage,
    ],
    ports: new Map(),
  };
}

// public harness는 이 이름을 부른다. 제품 등록과 같은 함수다.
export function createLedgerTestRegistration(
  environment?: unknown,
): LedgerRegistration {
  return createLedgerRegistration(environment);
}
