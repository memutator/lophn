import { err } from "../../base/mod.ts";
import {
  appsSchemaSteps,
  createAppCommands,
  createAppsReads,
  lookupAppRegistration,
} from "./registration/mod.ts";
import {
  appCallTool,
  appLogViewError,
  appRegistrationLookup,
  appRewind,
  appRewindPlan,
  appRewinds,
  appScreenFile,
  appsOAuthBegin,
  appsOAuthCancel,
  appsOAuthClientSet,
  appsOAuthSignOut,
  appsOAuthState,
  appsSecretValue,
  declarationCheck,
  packagePublish,
  packagesBuiltin,
  releaseActivate,
  releasePrepare,
} from "../../protocol/apps/mod.ts";
import {
  createInvocationsReads,
  INVOCATION_BLOB_FIELDS,
  INVOCATION_BLOB_PURPOSES,
  invocationsSchemaSteps,
} from "./invocations/mod.ts";
import {
  createNoticeCommands,
  noticesListRead,
  noticesOpenRead,
  noticeSchemaSteps,
} from "./notices/mod.ts";
import { rewindSchemaSteps } from "./rewind/mod.ts";
import {
  createGrantCommands,
  createGrantsReads,
  currentFacts,
  permissionsSchemaSteps,
} from "./permissions/mod.ts";
import { createDeclarationReads } from "./declaration/reads.ts";
import {
  activationAttemptGate,
  createReleaseCommands,
} from "./releases/commands.ts";
import {
  createActivationQueueRead,
  createReleaseReads,
} from "./releases/reads.ts";
import { releasesSchemaSteps } from "./releases/schema.ts";
import { loadActiveDeclaration, releaseFacts } from "./releases/store.ts";
import { createRuntimeCommands } from "./runtime/commands.ts";
import { createRuntimeReads } from "./runtime/reads.ts";
import { PACKAGE_GUIDE_BLOB_FIELD } from "./packages/blobs.ts";
import { createSdkCommands } from "./packages/commands.ts";
import { createSdkReads } from "./packages/reads.ts";
import { sdkSchemaSteps } from "./packages/schema.ts";
import { createPreviewReads } from "./preview/reads.ts";
import { unattachedPreviewService } from "./preview/service.ts";
import { createDataCommands } from "./data/commands.ts";
import { dataSchemaSteps } from "./data/schema.ts";
import { BACKUP_BLOB_FIELD } from "./data/blobs.ts";
import { createDataRecordStore } from "./data/store.ts";
import { appIcon, appSkills } from "../../protocol/apps/declaration/read.ts";
import {
  appTrayList,
  appTraySet,
  packagesGuideBody,
} from "../../protocol/apps/mod.ts";
import type {
  ReaderRegistration,
  TxPortRegistration,
} from "../storage/ledger/mod.ts";

type LedgerRegistration = {
  blobFields?: readonly unknown[];
  apiReads?: readonly unknown[];
  schemaSteps?: readonly { id: string; sql: string }[];
  commands?: readonly unknown[];
  reads?: readonly unknown[];
  // ledger를 쓰지 않는 core 메모리 route. handler는 core 조립(wiring/apps.ts)이 붙인다.
  memoryRoutes?: readonly unknown[];
  // 큰 byte를 흘려 주는 file route. handler는 core 조립이 붙인다.
  files?: readonly unknown[];
  // 이 팀이 blob 준비 통로에서 쓰는 purpose와 상한.
  blobPurposes?: readonly unknown[];
  ports?: readonly TxPortRegistration[];
};

const unattachedGuideBodyRead = {
  route: packagesGuideBody,
  handle: () =>
    err({ code: "unavailable", message: "안내 원문 읽기가 붙어 있지 않다" }),
};

// 앱 process 같은 core 메모리를 읽는 route는 등록 때 unavailable로 올리고 core 조립
// (wiring/apps.ts)이 handler로 덮는다. reader Worker는 이 메모리를 볼 수 없다.
function unattachedRead<
  R extends
    | typeof appRewindPlan
    | typeof appRewinds
    | typeof appIcon
    | typeof appSkills,
>(route: R) {
  return {
    route,
    handle: () =>
      err({ code: "unavailable" as const, message: "읽기가 붙어 있지 않다" }),
  };
}

// owner target은 ledger가 주입한 TargetAuthorization port가 판정한다.
export function createLedgerRegistration(
  _environment?: unknown,
): LedgerRegistration {
  const commands = createAppCommands();
  const reads = createAppsReads();
  const invocationReads = createInvocationsReads();
  const sdk = createSdkCommands();
  const sdkReads = createSdkReads();
  // 기록은 command가 받은 tx의 sql에만 남긴다. DB 파일은 data worker가 연다.
  const data = createDataCommands(
    (tx) => createDataRecordStore(tx),
    activationAttemptGate,
  );
  // record_*는 supervisor의 machine 통보다. 관측 없는 Tx projection은
  // 과거 event만으로 running이라 하지 않는다.
  const runtime = createRuntimeCommands();
  const runtimeReads = createRuntimeReads();
  const notices = createNoticeCommands();
  // 앱 grant는 activation이 만들고, 사람은 거두기만 한다.
  const grants = createGrantCommands();
  const grantReads = createGrantsReads();
  // release 준비 확정과 그 읽기(list·get·compare), 고정 선언 읽기.
  const releaseCommands = createReleaseCommands();
  const releaseReads = createReleaseReads();
  const declarationReads = createDeclarationReads(loadActiveDeclaration);
  return {
    // 보호 backup blob(일반 blob 읽기 없음)과 공개 SDK 사용 안내 blob(일반 읽기 허용).
    blobFields: [
      BACKUP_BLOB_FIELD,
      PACKAGE_GUIDE_BLOB_FIELD,
      ...INVOCATION_BLOB_FIELDS,
    ],
    // `/previews/*`는 supervisor 통로가 생긴 core가 apps 제어(apps-control)에서 service로 덮는다.
    // 덮기 전과 통로가 없는 등록(harness)은 unavailable이다(apps/preview).
    apiReads: [
      ...createPreviewReads(() => unattachedPreviewService()),
      unattachedRead(appRewindPlan),
      unattachedRead(appRewinds),
      // 파일을 읽어야 해서 core 조립이 handler로 덮는다.
      unattachedRead(appIcon),
      unattachedRead(appSkills),
      // 도는 줄은 core 메모리라 core 조립(apps control)이 driver가 읽는 줄로 덮는다.
      createActivationQueueRead({
        entries: () =>
          Promise.resolve(
            err({ code: "unavailable", message: "읽기가 붙어 있지 않다" }),
          ),
      }),
      // SDK 안내 원문 읽기다. route만 선언하고 handler는 blob 바이트 통로를 가진 core 조립(runtime)이 붙인다.
      unattachedGuideBodyRead,
    ],
    schemaSteps: [
      ...appsSchemaSteps,
      ...releasesSchemaSteps,
      ...permissionsSchemaSteps,
      ...invocationsSchemaSteps,
      ...rewindSchemaSteps,
      ...sdkSchemaSteps,
      ...dataSchemaSteps,
      ...noticeSchemaSteps,
    ],
    commands: [
      commands.create,
      commands.connectSource,
      commands.archive,
      commands.unarchive,
      commands.rename,
      commands.editFolders,
      commands.setIcon,
      grants.revoke,
      notices.post,
      notices.record,
      notices.dismiss,
      notices.markRead,
      runtime.enableExecution,
      runtime.disableExecution,
      runtime.recordStarted,
      runtime.recordStopped,
      runtime.recordUnavailable,
      sdk.registerVersion,
      data.recordBackup,
      data.recordDataChange,
      data.recordDataRestore,
      releaseCommands.record,
      releaseCommands.startActivation,
      releaseCommands.completeActivation,
      releaseCommands.failActivation,
      releaseCommands.reportActivation,
      releaseCommands.activatePrevious,
      releaseCommands.askConsent,
      releaseCommands.consent,
    ],
    reads: [
      reads.list,
      reads.get,
      declarationReads.appTool,
      releaseReads.listRecords,
      releaseReads.getRecord,
      releaseReads.activationCompare,
      releaseReads.activationConsents,
      grantReads.list,
      noticesListRead,
      noticesOpenRead,
      runtimeReads.runtime,
      runtimeReads.logs,
      invocationReads.list,
      invocationReads.get,
      sdkReads.list,
      sdkReads.versions,
      sdkReads.usage,
    ],
    // 앱 호출과 rewind는 앱 process를 기다리는 core 메모리 route다. ledger queue를 거치지 않고, 기록은
    // invocations·rewind module이 자기 쓰기로 남긴다.
    memoryRoutes: [
      appCallTool,
      appTraySet,
      appTrayList,
      appRewind,
      appLogViewError,
      // handler는 wiring/apps.ts가 붙인다.
      appsSecretValue,
      appsOAuthClientSet,
      appsOAuthBegin,
      appsOAuthCancel,
      appsOAuthSignOut,
      appsOAuthState,
      declarationCheck,
      packagesBuiltin,
      packagePublish,
      // release 준비와 올리기는 supervisor 진행을 기다리는 command route라 ledger handler가 없다.
      // core가 writer 앞(`withReleasePreparation`)에서 처리하므로 route만 등록한다.
      releasePrepare,
      releaseActivate,
    ],
    // 앱 화면의 byte는 core가 UI bundle 사본에서 흘려 준다.
    files: [appScreenFile],
    blobPurposes: INVOCATION_BLOB_PURPOSES,
    // coding-agent connection의 app scope 검사와 documents의 자리 해석은 같은 Tx의
    // 존재 조회를 쓴다. TargetAuthorization은 tx.ts가 주입하므로 여기 등록하지 않는다.
    ports: [
      {
        key: appRegistrationLookup,
        create: (tx) => ({
          get: (app: string) => lookupAppRegistration(tx.sql, app),
        }),
      },
      // 현재 release의 선언 사실이다. grant·broker 읽기가 선언과 교집합을 본다
      // 준비 때 고정한 선언에서 만든 값을 읽는다.
      { key: currentFacts, create: () => releaseFacts },
    ],
  };
}

// reader Worker가 이 모듈을 import해 read를 reader 풀에 붙인다. 실행 port는 없다.
export function createReaderRegistration(): ReaderRegistration {
  const reads = createAppsReads();
  const invocations = createInvocationsReads();
  const sdkReads = createSdkReads();
  const runtimeReads = createRuntimeReads();
  const grantReads = createGrantsReads();
  const releaseReads = createReleaseReads();
  const declarationReads = createDeclarationReads(loadActiveDeclaration);
  return {
    reads: [
      reads.list,
      reads.get,
      declarationReads.appTool,
      releaseReads.listRecords,
      releaseReads.getRecord,
      releaseReads.activationCompare,
      releaseReads.activationConsents,
      grantReads.list,
      noticesListRead,
      noticesOpenRead,
      runtimeReads.runtime,
      runtimeReads.logs,
      invocations.list,
      invocations.get,
      sdkReads.list,
      sdkReads.versions,
      sdkReads.usage,
    ],
    // 선언 port의 고정 값이다. grants.list의 표시 자료가 같은 key로 읽는다.
    ports: new Map<unknown, unknown>([[currentFacts, releaseFacts]]),
  };
}
