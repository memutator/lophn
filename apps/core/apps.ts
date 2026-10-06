import {
  appsSchemaSteps,
  createAppCommands,
  createAppsReads,
  lookupAppRegistration,
} from "../../packages/apps/registration/mod.ts";
import {
  appConnect,
  appPairConfirmPoll,
  appPairConfirmRequest,
  appPairObserve,
  appPairPrepare,
  appRegistrationLookup,
  appViewClosed,
  releaseCancelPreparation,
  releasePreparation,
} from "../../packages/contracts/apps/mod.ts";
import { createInvocationsCommands } from "../../packages/apps/invocations/commands.ts";
import { createConfirmCommands } from "../../packages/apps/invocations/confirm.ts";
import { createInvocationsReads } from "../../packages/apps/invocations/reads.ts";
import { invocationsSchemaSteps } from "../../packages/apps/invocations/schema.ts";
import {
  createGrantCommands,
  createGrantsReads,
  createSecretAllowance,
  currentDeclarations,
  permissionsSchemaSteps,
} from "../../packages/apps/permissions/mod.ts";
import { createAutomationReads } from "../../packages/apps/automations/reads.ts";
import { createBlueprintReads } from "../../packages/apps/blueprint/reads.ts";
import {
  activationAttemptGate,
  createReleaseCommands,
} from "../../packages/apps/releases/commands.ts";
import { createReleaseReads } from "../../packages/apps/releases/reads.ts";
import { releasesSchemaSteps } from "../../packages/apps/releases/schema.ts";
import {
  loadActiveBlueprint,
  releaseDeclarations,
  releaseWording,
} from "../../packages/apps/releases/store.ts";
import { checkTicketClaim } from "../../packages/coding-agent/tickets/claims.ts";
import {
  TicketClaimCheck,
  type TicketClaimChecker,
} from "../../packages/contracts/coding-agent/mod.ts";
import {
  AppTestVerificationLookupPort,
  ProblemWordingPort,
} from "../../packages/contracts/problems/mod.ts";
import { findAppTestVerification } from "../../packages/problems/tests/app-test-lookup.ts";
import { createRuntimeCommands } from "../../packages/apps/runtime/commands.ts";
import { createRuntimeReads } from "../../packages/apps/runtime/reads.ts";
import { PACKAGE_GUIDE_BLOB_FIELD } from "../../packages/apps/sdk/blobs.ts";
import { createSdkCommands } from "../../packages/apps/sdk/commands.ts";
import { createSdkReads } from "../../packages/apps/sdk/reads.ts";
import { sdkSchemaSteps } from "../../packages/apps/sdk/schema.ts";
import { createPreviewReads } from "../../packages/apps/preview/reads.ts";
import { unattachedPreviewService } from "../../packages/apps/preview/service.ts";
import { createDataCommands } from "../../packages/apps/data/commands.ts";
import { dataSchemaSteps } from "../../packages/apps/data/schema.ts";
import { BACKUP_BLOB_FIELD } from "../../packages/apps/data/blobs.ts";
import { createDataRecordStore } from "../../packages/apps/data/store.ts";
import {
  type PlaceNameReservation,
  placeNameReservation,
} from "../../packages/contracts/documents/mod.ts";
import { createPlaceNameReservation } from "../../packages/documents/addressing/mod.ts";
import { releaseActivationFailed } from "../../packages/contracts/apps/mod.ts";
import { SecretAllowance } from "../../packages/contracts/platform/mod.ts";
import type {
  EventRegistration,
  ReaderRegistration,
  TxPortRegistration,
} from "../../packages/platform/ledger/mod.ts";
import { notificationsOnlyVisibility } from "./platform.ts";

type LedgerRegistration = {
  blobFields?: readonly unknown[];
  apiReads?: readonly unknown[];
  schemaSteps?: readonly { id: string; sql: string }[];
  commands?: readonly unknown[];
  reads?: readonly unknown[];
  // ledger를 쓰지 않는 core 메모리 route. handler는 core 조립이 apps-control의 service로 붙인다.
  memoryRoutes?: readonly unknown[];
  ports?: readonly TxPortRegistration[];
};

// owner target은 ledger가 주입한 TargetAuthorization port가 판정한다.
export function createLedgerRegistration(
  _environment?: unknown,
): LedgerRegistration {
  const commands = createAppCommands();
  const reads = createAppsReads();
  const invocations = createInvocationsCommands();
  // confirm 접수는 approval 사용과 같은 transaction에서 apply_approved_action이 부르는
  // dispatchable machine command다(platform Q28).
  const confirm = createConfirmCommands();
  const invocationReads = createInvocationsReads();
  const sdk = createSdkCommands();
  const sdkReads = createSdkReads();
  // 기록은 command가 받은 tx의 sql에만 남긴다. DB 파일은 data worker가 연다.
  const data = createDataCommands(
    (tx) => createDataRecordStore(tx),
    activationAttemptGate,
  );
  // record_*는 supervisor의 machine 통보다. 관측 없는 Tx projection은
  // 과거 event만으로 running이라 하지 않는다(R13).
  const runtime = createRuntimeCommands();
  const runtimeReads = createRuntimeReads();
  // 선언·실행 가능 여부·관측을 구분하는 read. 관측은 apps-control이 메인에서 덮는다.
  const automationReads = createAutomationReads();
  // grant 변경은 정확한 approval 적용(create)과 사람 확인(revoke)으로만 한다.
  const grants = createGrantCommands();
  const grantReads = createGrantsReads();
  // release 준비 확정과 그 읽기(list·get·compare), 고정 blueprint 읽기.
  const releaseCommands = createReleaseCommands();
  const releaseReads = createReleaseReads();
  const blueprintReads = createBlueprintReads(loadActiveBlueprint);
  return {
    // 보호 backup blob(일반 blob 읽기 없음, apps/data#R4)과 공개 SDK 사용 안내 blob(일반 읽기 허용, apps/sdk#R3).
    blobFields: [BACKUP_BLOB_FIELD, PACKAGE_GUIDE_BLOB_FIELD],
    // `/v1/previews/*`는 supervisor 통로가 생긴 core가 apps 제어(apps-control)에서 service로 덮는다.
    // 덮기 전과 통로가 없는 등록(harness)은 unavailable이다(apps/preview).
    apiReads: createPreviewReads(() => unattachedPreviewService()),
    // place_names 표는 documents 등록의 몫이다(R6, R10).
    schemaSteps: [
      ...appsSchemaSteps,
      ...releasesSchemaSteps,
      ...permissionsSchemaSteps,
      ...invocationsSchemaSteps,
      ...sdkSchemaSteps,
      ...dataSchemaSteps,
    ],
    commands: [
      commands.create,
      commands.connectSource,
      commands.archive,
      commands.unarchive,
      commands.rename,
      grants.create,
      grants.revoke,
      confirm.acceptConfirm,
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
      releaseCommands.prepare,
      releaseCommands.prepareBundle,
      releaseCommands.startActivation,
      releaseCommands.completeActivation,
      releaseCommands.failActivation,
    ],
    reads: [
      reads.list,
      reads.get,
      blueprintReads.blueprint,
      releaseReads.list,
      releaseReads.get,
      releaseReads.compare,
      grantReads.list,
      runtimeReads.runtime,
      runtimeReads.logs,
      automationReads.automations,
      invocationReads.list,
      invocationReads.get,
      sdkReads.list,
      sdkReads.versions,
      sdkReads.usage,
    ],
    // apps.connect는 supervisor의 메모리 관측과 인증 연결을 읽는 제어 어댑터라 ledger queue를
    // 거치지 않는다(apps/runtime#R9, architecture/apps 5.1). apps.view_closed도 같은 어댑터가
    // 닫힌 화면 view를 지금 live 자식에 중계할 뿐 ledger를 쓰지 않는다.
    // 앱 쌍 연결 준비·confirm·경로 장부 통보도 supervisor(machine)의 같은 제어 어댑터다.
    memoryRoutes: [
      appConnect,
      appViewClosed,
      appPairPrepare,
      appPairConfirmRequest,
      appPairConfirmPoll,
      appPairObserve,
      // release 준비 진행·취소는 command route지만 진행이 supervisor 메모리라 ledger handler가 없다.
      // core가 writer 앞(`withReleasePreparation`)에서 처리하므로 route만 등록한다.
      releasePreparation,
      releaseCancelPreparation,
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
      // 앱 secret 전송의 현재 grant 판정이다(platform/secrets#R10, apps/permissions#R14).
      {
        key: SecretAllowance,
        create: (tx) => createSecretAllowance(tx),
      },
      // 현재 release의 선언 사실이다. grant·broker·automation 읽기가 선언과 교집합을 본다
      // (apps/permissions#R2). 준비 때 고정한 blueprint에서 만든 값을 읽는다.
      { key: currentDeclarations, create: () => releaseDeclarations },
      // release 준비는 같은 bundle hash의 통과한 app test와 현재 ticket claim을 같은 transaction에서
      // 다시 확인한다(apps/releases#R5, R6). 구현은 problems·coding-agent 소유 읽기다.
      {
        key: AppTestVerificationLookupPort,
        create: (tx) => (verification: string) =>
          findAppTestVerification(tx.sql, verification),
      },
      // 보고 당시 release의 선언 code 문구다(problems#T27). problems의 문구 projection이
      // 같은 snapshot sql로 읽는다.
      { key: ProblemWordingPort, create: () => releaseWording },
      {
        key: TicketClaimCheck,
        create: (tx): TicketClaimChecker => (input) =>
          checkTicketClaim(tx, input),
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
  const automationReads = createAutomationReads();
  const grantReads = createGrantsReads();
  const releaseReads = createReleaseReads();
  const blueprintReads = createBlueprintReads(loadActiveBlueprint);
  return {
    reads: [
      reads.list,
      reads.get,
      blueprintReads.blueprint,
      releaseReads.list,
      releaseReads.get,
      releaseReads.compare,
      grantReads.list,
      runtimeReads.runtime,
      runtimeReads.logs,
      automationReads.automations,
      invocations.list,
      invocations.get,
      sdkReads.list,
      sdkReads.versions,
      sdkReads.usage,
    ],
    // 선언 port의 고정 값이다. grants.list의 표시 자료와 apps.automations가 같은 key로 읽는다.
    // 보고 당시 release의 선언 문구도 problems의 문구 projection이 같은 key로 읽는다(problems#T27).
    ports: new Map<unknown, unknown>([
      [
        currentDeclarations,
        releaseDeclarations,
      ],
      [ProblemWordingPort, releaseWording],
    ]),
  };
}

// public harness는 이 이름을 부른다. 제품 등록과 같은 함수다.
export function createLedgerTestRegistration(
  environment?: unknown,
): LedgerRegistration {
  return createLedgerRegistration(environment);
}
