import {
  type UpdateNotice,
  updateNotice,
  type UpdatePackage,
} from "../../packages/platform/install-and-update/mod.ts";
import { systemClock } from "../../packages/base/clock.ts";
import { cryptoRandom } from "../../packages/base/random.ts";
import type { Clock, RandomSource, Result } from "../../packages/base/mod.ts";
import { createIdSource, err, ok } from "../../packages/base/mod.ts";
import type {
  AuthenticatedContext,
  ChildMessage,
  Frame,
  KindLaunchSpec,
  ParentMessage,
  ReadRoute,
  RequestContext,
  WorkerRequest,
} from "../../packages/contracts/platform/mod.ts";
import {
  createApprovalRequest,
  ROUTES,
} from "../../packages/contracts/platform/mod.ts";
import {
  createAppEngineerAssignment,
  providerList,
  runAppRevert,
} from "../../packages/contracts/lophn-agent/mod.ts";
import {
  type ApiServer,
  RouteRegistry,
  startApiServer,
  WORKSPACE_MEMORY_ROUTES,
} from "../../packages/platform/api/mod.ts";
import type { WorkerRouteTarget } from "../../packages/platform/responsiveness/mod.ts";
import {
  AGENT_RUNTIME_KIND,
  AGENT_RUNTIME_TASK,
  type AgentRuntimeChild,
  agentRuntimePolicies,
  providerHost,
  startAgentRuntimeChild,
} from "./agent-runtime.ts";
import { createAgentRuntimeSecrets } from "./agent-runtime-secret.ts";
import {
  CONNECTION_TEST_CONTEXT,
  withConnectionTest,
} from "./provider-connection-test.ts";
import {
  type TraceExportWriterDeps,
  withTraceExport,
} from "./agent-trace-export.ts";
import { withProviderLogin } from "./provider-oauth.ts";
import { withViewBinding } from "./view-binding.ts";
import {
  applyMigrations,
  checkRestart,
  ensureLedgerId,
  planRestore,
  RESTORE_DECISION,
  restoreBinding,
  type RestoreOutcome,
  type RestorePlan,
} from "../../packages/platform/backup-and-migration/mod.ts";
import { backupStamp } from "../../packages/platform/backup-and-migration/mod.ts";
import { type StatusSource } from "../../packages/platform/diagnostics/mod.ts";
import {
  CredentialRegistry,
  type OperationPolicy,
} from "../../packages/platform/identity/mod.ts";
import {
  acquireInstanceLock,
  type DataRoot,
  type InstanceLock,
  removeRunMetadata,
  resolveDataRoot,
  writeRunMetadata,
} from "../../packages/platform/install-and-update/mod.ts";
import {
  type KnownSecretMatch,
  LEDGER_SCHEMA_STEPS,
} from "../../packages/platform/ledger/mod.ts";
import {
  createSupervisor,
  type Spawned,
  type SpawnRequest,
} from "../../packages/platform/responsiveness/mod.ts";
import { SETTINGS_SCHEMA_STEPS } from "../../packages/platform/settings/mod.ts";
import {
  type KeychainAdapter,
  SECRET_SCHEMA_STEPS,
  SECRET_TOOL_PATHS,
} from "../../packages/platform/secrets/mod.ts";
import {
  connectionConnect,
  connectionEndChild,
  connectionEndConnection,
  connectionRegisterChild,
  ticketUploadSummary,
} from "../../packages/contracts/coding-agent/mod.ts";
import { problemsUploadFixSummary } from "../../packages/contracts/problems/mod.ts";
import { CONNECTION_SECRET_OWNER } from "../../packages/coding-agent/mod.ts";
import {
  type CodingCredentials,
  connectHandler,
  createCodingCredentials,
  endChildHandler,
  endConnectionHandler,
  registerChildHandler,
  withRevocationSweep,
} from "./coding-credential.ts";
import { codingAgentOperationPolicies } from "./coding-operations.ts";
import { productKeychain } from "./secret-store.ts";
import {
  createSecretInputRelay,
  secretInputHandler,
  type SecretInputRelay,
} from "./secret-input.ts";
import { secretInput } from "../../packages/contracts/platform/mod.ts";
import {
  type BlobPrepareRelay,
  type BufferGauge,
  createBlobPrepareRelay,
  createBufferGauge,
  type PreparedRelayResult,
} from "./blob-prepare.ts";
import {
  createPreparationRegistry,
  retentionRules,
} from "../../packages/platform/blob-store/mod.ts";
import type { BlobFieldDefinition } from "../../packages/contracts/platform/mod.ts";
import {
  type ChildBlobPrepare,
  createChildBlobPrepare,
} from "./child-blob-prepare.ts";
import { CREDENTIAL_SCHEMA } from "./credentials.ts";
import {
  type BaseVersionFor,
  documentPrepareRoute,
  relaySink,
} from "./documents-prepare.ts";
import { documentUploadHandler } from "./documents-upload.ts";
import { ticketSummaryUploadHandler } from "./ticket-summary-upload.ts";
import { fixSummaryUploadHandler } from "./problems-fix-summary-upload.ts";
import {
  type FilesRouteDeps,
  fileWorkers,
  routeDecision,
} from "./documents-files.ts";
import { formatValidateRoute } from "./documents-format-validate.ts";
import {
  documentPrepare,
  documentUpload,
  filesRead,
} from "../../packages/contracts/documents/mod.ts";
import type { VersionRow } from "../../packages/documents/versions/store.ts";
import { connectDocumentsRelaunch, workerSpecs } from "./documents.ts";
import { fileReadStreams } from "./documents-file-read.ts";
import { createFileWindows } from "./documents-file-windows.ts";
import {
  createDocumentsChannel,
  servedWorkers,
  statusMemoryVia,
  storedFileStreams,
} from "./documents-serving.ts";
import {
  FILE_PLACEMENT_ROUTE,
  OBSERVATION_BASIS_ROUTE,
  PREPARE_BASE_ROUTE,
  SEARCH_VERSION_ROUTE,
  STORED_FILE_ROUTE,
  WORKING_COPY_ROUTE,
} from "./documents-served.ts";
import { type RootsWatch, watchTrackingRoots } from "./documents-roots.ts";
import { type BasisSync, watchObservationBasis } from "./documents-basis.ts";
import { createDocumentsRespawner } from "./documents-respawn.ts";
import { CONTEXT_WORKER_OPERATIONS } from "./contexts-api.ts";
import { DOCUMENTS_FEED_CONTEXT } from "./documents-events.ts";
import { startDocumentsFeed } from "./documents-feed.ts";
import type { PlacementRead } from "../../packages/documents/file-tracking/placement-read.ts";
import {
  createPlacementReservations,
  withPlacementReservation,
} from "./documents-placement.ts";
import {
  type SearchSync,
  type SearchVersion,
  watchSearchIndex,
} from "./documents-search.ts";
import { startNotifications } from "./notifications.ts";
import { startAssignmentReactions } from "./assignment-reactions.ts";
import {
  APPROVAL_EXPIRY_CONTEXT,
  ASSIGNMENT_REACTIONS_CONTEXT,
  NOTIFICATIONS_CONTEXT,
  withPlatform,
} from "./platform.ts";
import { observeApprovals } from "../../packages/platform/approvals/mod.ts";
import {
  INVOCATION_RECOVERY_CONTEXT,
  observeInvocations,
} from "../../packages/apps/invocations/restart.ts";
import { createCopyPreviewBundles } from "../../packages/apps/releases/activation/desired.ts";
import { observeReleaseActivations } from "../../packages/apps/releases/activation/recovery.ts";
import { eventOperations } from "./event-operations.ts";
import type { InternalSubscription } from "./internal-subscription.ts";
import { createStreamer, createValidatePort } from "./documents-validate.ts";
import type { ValidatePort } from "../../packages/documents/versions/work.ts";
import { DOCUMENT_OPS } from "../../packages/documents/file-tracking/mod.ts";
import { projectTrackingRoots } from "../../packages/contracts/documents/mod.ts";
import {
  greet,
  type ParentPipe,
  shellViewLog,
  watchParent,
  writeParent,
} from "./parent.ts";
import { observeTestRequest } from "../../packages/contracts/problems/mod.ts";
import { snapshotLogsEnvironment } from "./problems-logs.ts";
import {
  registerRepairReads,
  registerSessionReads,
  REPAIR_WORKER_KIND,
  repairWorkerSpec,
} from "./repair-context.ts";
import { answerRedactRequest } from "./agent-runtime-redaction.ts";
import {
  COLLECTOR_CREDENTIAL_OPERATIONS,
  COLLECTOR_ROUTES,
  collectorOperationPolicies,
  collectorWorkers,
} from "./problems-collector.ts";
import {
  COLLECTOR_KIND,
  reportCollectorSpec,
  screenTestHost,
  TEST_RUNNER_KIND,
  testRunnerSpec,
} from "./problems-runner.ts";
import {
  startTestControl,
  type TestControl,
  testRunnerBlobPolicy,
  testRunnerPolicies,
} from "./problems-test-control.ts";
import {
  PROBLEMS_WORK_FEED_CONTEXT,
  PROBLEMS_WORK_OP,
  PROBLEMS_WORK_OPERATIONS,
  PROBLEMS_WORK_PRINCIPAL,
  problemsWorkCursor,
  problemsWorkPolicies,
  startProblemsWorkFeed,
} from "./problems-work.ts";
import {
  PROBLEMS_CLOSING_OP,
  problemsClosingCursor,
  startProblemsClosingFeed,
} from "./problems-closing.ts";
import {
  startTicketCheckFeed,
  TICKET_CHECK_FEED_CONTEXT,
  TICKET_CHECK_OP,
  TICKET_CHECKER_KIND,
  TICKET_CHECKER_OPERATIONS,
  TICKET_CHECKER_PRINCIPAL,
  ticketCheckerPolicies,
  ticketCheckerSpec,
} from "./ticket-checker.ts";
import {
  APP_REVERT_CONTEXT,
  APP_REVERT_PRINCIPAL,
  type AppRevertCaller,
  appRevertPolicies,
  createAppRevert,
} from "./app-revert.ts";
import {
  REVERT_WORKER_KIND,
  revertWorkerSpec,
  workerAppCaller,
} from "./revert-caller.ts";
import {
  appCredentialIssuer,
  APPS_CONTROL_CONTEXT,
  APPS_CONTROL_PRINCIPAL,
  APPS_SUPERVISOR_KIND,
  type AppsControl,
  appSocketRoot,
  appsOperationPolicies,
  appSupervisorSpec,
  createAppsControl,
  SUPERVISOR_CREDENTIAL_OPERATIONS,
  withReleasePreparation,
} from "./apps-control.ts";
import { createConfirmAdapters } from "./apps-confirm.ts";
import type { ProcessSource } from "../../packages/apps/runtime/connect.ts";
import type { DesiredApp } from "../../packages/apps/runtime/supervisor/mod.ts";
import type {
  PreviewBundles,
  PreviewReleases,
} from "../../packages/apps/preview/service.ts";
import { createProductRedactor } from "./documents-redactor.ts";
import {
  BOOTSTRAP_RETRY_MS,
  bootstrapBuiltinAssignments,
  noteBootstrapFailure,
  readRoleAsset,
} from "./lophn-agent-bootstrap.ts";
import type { ProductRole } from "../../packages/lophn-agent/presets/mod.ts";
import {
  createApprovalTextPreparer,
  withApprovalText,
} from "./approval-text.ts";
import { createHandoffBodyPreparer, withHandoffBody } from "./handoff-body.ts";
import { toolDocumentWorkers } from "./tool-documents.ts";
import {
  type BodyPrepare,
  createMessageBodyPreparer,
  messageBodyEnvironment,
  withMessageBody,
} from "./message-body.ts";
import {
  instructionAccess,
  instructionFilesEnvironment,
  ledgerHead,
} from "./instruction-files.ts";
import type { InstructionFiles } from "../../packages/lophn-agent/instructions/mod.ts";
import {
  createQuestionTextPreparer,
  withQuestionText,
} from "./question-text.ts";
import { assemble, type TeamModule } from "./registration.ts";
import { type CoreRuntime, openRuntime } from "./runtime.ts";
import { appExportWorkers } from "./apps-export.ts";
import { ticketClaimSweepIntervalMs } from "./tickets.ts";
import { testCredentialFront } from "./test-credentials.ts";
import {
  createMcpAuthControl,
  openMcpCallbackListener,
} from "./lophn-agent.ts";
import type { McpServerConfig } from "../../packages/contracts/lophn-agent/mod.ts";
import {
  mcpServersSetting,
  skillFoldersSetting,
} from "../../packages/contracts/lophn-agent/mod.ts";
import { settingsGet } from "../../packages/contracts/platform/mod.ts";
import { openConnection } from "../../packages/platform/ledger/mod.ts";

// 등록한 MCP server 설정의 snapshot 재료다(extensions R11). ledger 경로의 setting_choices
// 행을 readOnly로 열어 형식 검사를 지난 server 목록으로 옮긴다(credentials 열기와 별개다).
// credentials 열림이 실패해도 설정 읽기는 readOnly라 그대로 온다.
function mcpServerSnapshot(
  ledgerPath: string,
): Promise<Result<McpServerConfig[]>> {
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return Promise.resolve(opened);
  try {
    const rows = opened.value.sql.all(
      "select layer, key, value from setting_choices where key = ?",
      [mcpServersSetting.key],
    );
    if (rows.length === 0) return Promise.resolve(ok([]));
    const parsed: unknown = JSON.parse(String(rows[0]["value"]));
    const shaped = mcpServersSetting.value_type.safeParse(parsed);
    if (!shaped.success) {
      return Promise.resolve(ok([]));
    }
    return Promise.resolve(ok(shaped.data));
  } catch {
    return Promise.resolve(ok([]));
  } finally {
    opened.value.close();
  }
}

// approval 만료 정리 간격. ticket claim 정리와 같은 60초다(platform Q25).
const APPROVAL_EXPIRY_SWEEP_INTERVAL_MS = 60_000;

// 시작 순서: lock → ledger schema step → writer·reader → event 배포 → API → I/O worker 감독.
export type CoreOptions = {
  // 없으면 프로세스 환경의 LOPHN_HOME, 그것도 없으면 ~/.lophn.
  lophnHome?: string;
  home?: string;
  // 0이면 빈 port. 기본은 7431.
  port?: number;
  teams: readonly TeamModule[];
  // writer·reader가 다시 import할 팀 등록 파일. 없으면 teams 객체만 쓴다.
  teamModules?: readonly string[];
  clock?: Clock;
  // writer 시각. "fixed"(기본)면 clock의 기동 시각에 고정한다. 테스트의 결정적인
  // 시각과 blob 준비 만기 판정이 여기 있다. "system"이면 writer가 자기 system
  // clock을 쓴다. 제품 기동(main.ts)만 "system"이다.
  writerClock?: "system" | "fixed";
  random?: RandomSource;
  // Electron main이 물려 준 stdin/stdout. 테스트가 파이프를 끼운다.
  parent?: ParentPipe;
  // I/O worker 감독. 없으면 core가 platform/io를 직접 감독한다.
  supervise?: (workers: readonly KindLaunchSpec[]) => Promise<void>;
  // 테스트가 child를 띄우지 않을 때만 끈다. 제품 기동은 항상 감독한다.
  superviseIo?: boolean;
  // 테스트 harness만 true로 둔다. main.ts는 이 입구를 열지 않는다.
  testCredentials?: boolean;
  // 앱 revert 단계의 호출자를 바꾼다(lophn-agent#T48). 없으면 호출한 사람의 apps/connect 연결과 앱 direct
  // socket을 쓴다. 테스트가 실제 앱 프로세스를 띄우지 않고 앱의 호출 결과를 넣는 입구다.
  appRevertCaller?: (ctx: AuthenticatedContext) => AppRevertCaller;
  // 테스트가 준비 참조를 writer 메모리에 심는 입구. 제품 기동에는 없다.
  notePrepared?: (prepared: PreparedRelayResult, nowMs: number) => void;
  // 테스트가 정지 유지보수를 대신 실행한다. 제품 기동에는 없다. 세 정지
  // 조건이 모두 관측된 뒤에만 불리고, 실패·시간 초과는 종료를 막지 않는다.
  maintenance?: () => Promise<void>;
  // 테스트가 종료의 앞 단계(API 정지)를 실패시킨다. 제품 기동에는 없다.
  failShutdown?: () => Promise<void>;
  // 정지 유지보수 시간 제한. 없으면 30초. 테스트가 짧게 줄인다.
  maintenanceTimeoutMs?: number;
  // restore 프로세스 시간 제한. 없으면 10분. 테스트가 줄인다.
  restoreTimeoutMs?: number;
  // 내장 assignment 준비의 역할 prompt 자산과 재시도 대기(ms). 제품 기동은 소스 배치의
  // prompt 자산을 읽고 60초 뒤 한 번 다시 시도한다. 테스트가 대신한다.
  roleAsset?: (role: ProductRole) => Promise<Result<Uint8Array>>;
  bootstrapRetryMs?: number;
  // secret store가 값을 읽는 keychain adapter. 없으면 제품 adapter(Linux Secret Service)다.
  // 테스트는 fake를 주어 사람의 실제 keychain에 닿지 않게 한다.
  secretKeychain?: KeychainAdapter;
  // coding agent connection credential을 준비·읽는 keychain adapter. 없으면 coding credential 인증은
  // 꺼져 있다. 제품 main만 OS adapter를 주고 테스트는 fake를 준다(사람의 실제 keychain에 닿지 않는다).
  codingKeychain?: KeychainAdapter;
  // 설치된 보호 loader의 identity 목록. 설치 쪽이 정하기 전에는 비어 있어 child를 등록할 수 없다.
  codingLoaders?: readonly string[];
  // 테스트가 감독 child를 실제 process 대신 같은 process 안의 것으로 바꿔 끼운다(예: fake keychain을
  // 쥔 I/O worker). 제품 기동에는 없다.
  spawn?: (request: SpawnRequest) => Spawned;
  // 테스트가 worker route serving을 붙이는 입구(T8·T13 통합). 제품 기동에는 없다.
  workers?: ReadonlyMap<string, WorkerRouteTarget>;
  // 앱 supervisor(앱 프로세스 감독)를 띄운다. 제품 기동만 true다. runtimeDir은 앱 socket을 두는
  // XDG runtime 디렉터리 자리이고 없으면 core 환경의 XDG_RUNTIME_DIR·사용자별 임시 폴더다.
  appSupervisor?: boolean | { runtimeDir?: string };
  // lophn agent runtime child를 띄운다. 제품 기동만 true다. pollMs는 등록 provider 목적지가 바뀌었는지
  // 보는 주기(ms)이고 없으면 1초다. 감독(I/O)이 없으면 띄우지 않는다.
  agentRuntime?: boolean | { pollMs?: number };
  // 테스트가 supervisor 대신 프로세스 관측을 바꿔 끼운다. 제품 기동에는 없다.
  appProcess?: ProcessSource;
  // 발급한 앱 connection의 회수 검사 간격(ms). 없으면 1초. 테스트가 줄인다.
  appsSweepMs?: number;
  // preview가 준비된 bundle·release를 여는 자리(apps/preview). 없으면 preview 시작은 unavailable이다.
  appPreviews?: {
    bundles?: PreviewBundles;
    releases?: PreviewReleases;
    nonce?: () => string;
  };
  // 테스트가 documents worker에 준 hello(machine credential과 api port)를 본다. 시작과
  // 재시작마다 불린다. 제품
  // 기동에는 없다. credential은 log에 남기지 않는다.
  onDocumentsHello?: (hello: { credential: string; api_port: number }) => void;
};
export type RestoreBinding = { target: string; content: string };
export type RestoreRequest = {
  // 복원할 묶음(manifest.created_at).
  created_at: string;
  // main이 사람 확인으로 발급한 handle 참조.
  confirmation: string;
};
export type BlobPrepareCall = {
  principal: string;
  purpose: string;
  expectedHash?: string;
  bytes: ReadableStream<Uint8Array>;
};

export type Core = {
  port: number;
  epoch: string;
  dataRoot: string;
  // 부모 pipe의 종료 감시가 끝나면 resolve된다. 부모가 없으면 이미 끝난 상태다.
  done: Promise<void>;
  // 새 command 입장을 닫고 연 것을 정리한 뒤 lock을 푼다(ledger R21).
  shutdown(): Promise<void>;
  // 신뢰 main용 안내·정지 입구다. HTTP command나 자동 update 경로가 아니다.
  updateNotice(
    installedVersion: string,
    candidate: UpdatePackage,
  ): Result<UpdateNotice>;
  stopForUpdate(): Promise<Result<void>>;
  record(context: AuthenticatedContext): Promise<Result<void>>;
  // 신뢰 프로세스의 blob.prepare 호출. HTTP route가 아니다(Q6).
  // I/O worker가 설치하고 writer 메모리에 준비 참조를 남긴 뒤에 끝난다.
  prepareBlob(call: BlobPrepareCall): Promise<Result<PreparedRelayResult>>;
  // blob 준비에서 core가 바이트를 쥐고 있는 양의 관측(자식 쪽 대기열과 중계의 chunk).
  // 한도는 BLOB_RELAY_BUFFER_MAX_BYTES다. core는 큰 blob을 통째로 모으지 않는다.
  readonly blobBuffer: BufferGauge;
  // 신뢰 자식(문서 worker, report collector)의 blob 준비 요청 처리(Q6). 자식 kind의
  // supervisor callback이 onMessage·onFrame을 이 값에 넘기고, 자식이 멈추면 close한다.
  // 허용 kind는 child-blob-prepare.ts의 목록뿐이다.
  childBlobPrepare(
    kind: string,
    send: (message: ParentMessage) => Promise<boolean>,
  ): ChildBlobPrepare;
  // 원하는 앱 프로세스 상태를 apps supervisor에 알린다. 마지막 상태를 기억해 supervisor가
  // 다시 떠도 같은 상태로 맞춘다. releases 조립이 활성 release를 보고 부른다.
  reconcileApp(desired: DesiredApp): Promise<Result<void>>;
  // lophn agent runtime이 model call 직전에 사람 지침(LOPHN.md)의 확정 판을 읽는 통로다. 읽기만 있다.
  instructionFiles: InstructionFiles;
  // testCredentials일 때만 있다. apps 제어(connect 어댑터·supervisor 질의)다.
  appsControl?: AppsControl;
  // testCredentials일 때만 있다. 제품 발급이 막는 actor의 테스트 기록이다.
  acceptTestCredential?(
    context: AuthenticatedContext,
    token: string,
  ): Promise<Result<void>>;
  // testCredentials일 때만 있다. 준비 참조를 writer 메모리에 알린다.
  notePrepared?(
    prepared: PreparedRelayResult,
    nowMs: number,
  ): Promise<Result<void>>;
  // 만료 claim 정리. 60초 timer와 재시작이 같은 함수를 부른다(tickets#R13).
  sweepTicketClaims(): Promise<void>;
  // 보고된 ticket의 조건을 checker worker가 정본으로 다시 비교하게 한다. 감독 worker가 없으면
  // unavailable이다. event 구독자와 시험이 같은 함수를 부른다(coding-agent#T26).
  sweepTicketChecks(): Promise<Result<unknown>>;
  // `problems.work` 반응기가 저장된 cursor 뒤 ticket event를 따라잡게 한다. test-runner worker가 없으면
  // unavailable이다. event 구독자와 시험이 같은 함수를 부른다(problems#T19).
  sweepProblemsWork(): Promise<Result<unknown>>;
  // `problems.closing` 반응기가 저장된 cursor 뒤 closing event를 따라잡게 한다. 같은 test-runner
  // worker가 closing credential 없이 뜨면 unavailable이다(problems#T20).
  sweepProblemsClosing(): Promise<Result<unknown>>;
  // 사람이 잃을 범위를 확인한 backup 복원(platform/backup-and-migration#R13, R14). handle은
  // `restoreBinding(plan)`의 target·content에 묶인 `restore_backup` 결정이어야 한다. 확인이
  // 맞으면 새 command 입장을 닫고 모든 worker·writer를 멈춘 뒤 현재 자료를 보존하고 검증한
  // 묶음으로 ledger를 바꾼다. 끝나면 이 core는 종료한 상태다(lock 해제). 같은 data root를 다시
  // `startCore`하면 새 epoch·새 ledger_id로 시작하고 derived가 복원 ledger 기준으로 다시 만들어진다.
  // 검증·보존이 실패하면 현재 자료는 그대로이고 core는 멈춘 채 오류를 돌려준다.
  restore(request: RestoreRequest): Promise<Result<RestoreOutcome>>;
  // 고른 묶음의 복원 계획(잃을 범위)과 사람 확인에 묶는 기준. 아무것도 바꾸거나 멈추지 않는다.
  restorePlan(
    createdAt: string,
  ): Promise<Result<{ plan: RestorePlan; binding: RestoreBinding }>>;
  // 확인한 restore가 이 core를 멈췄는가. 멈췄으면 같은 data root로 다시 `startCore`해야 한다
  // (apps/core/main.ts가 한다). 복원이 실패해도 core는 이미 멈춘 뒤라 true다.
  restoreStopped(): boolean;
  // 기한에 도달한 대기 approval request의 만료 확정. 같은 timer와 재시작이 부른다(platform Q25).
  sweepApprovalExpiry(): Promise<void>;
  // 재시작 때 접수·실행 중으로 남은 invocation을 미확인으로 확정한다(기동이 한 번 부른다).
  sweepInterruptedInvocations(): Promise<void>;
  // codingKeychain이 있을 때만 있다. 사람의 연결 결정 입구가 connect를, 신뢰 감독이 registerChild를
  // 부른다(입구의 contract는 coding-agent 소유라 HTTP route는 없다).
  codingCredentials?: CodingCredentials;
  // 시작 때의 고아 정리·색인 복원이 끝나면 resolve한다. 실패해도 resolve한다(기동을 막지 않는다).
  codingCredentialsReady?: Promise<void>;
  // testCredentials일 때만 있다. core 안 documents 구독자(machine:documents-feed)의 session이다.
  // listen으로 그 session이 받는 event를 같이 들을 수 있다(documents plan Q17).
  documentsFeed?: InternalSubscription;
  // testCredentials일 때만 있다. event dispatcher에 올라 있는 session 수다. 닫힌 WebSocket
  // 연결이 session을 남기지 않는지 본다(platform/api#R5).
  eventSessions?(): number;
  // testCredentials일 때만 있다. 확인 창 handle을 writer registry에 발급한다.
  confirmation?(body: {
    action: "issue" | "close-window" | "clear";
    request?: unknown;
    windowId?: string;
  }): Promise<Result<unknown>>;
};

export async function startCore(options: CoreOptions): Promise<Result<Core>> {
  const clock = options.clock ?? systemClock;
  const random = options.random ?? cryptoRandom;
  const root = await resolveDataRoot({
    lophnHome: options.lophnHome ?? Deno.env.get("LOPHN_HOME") ?? undefined,
    home: options.home ?? Deno.env.get("HOME") ?? undefined,
  });
  if (!root.ok) return root;
  const locked = await acquireInstanceLock(root.value.run);
  if (!locked.ok) return locked;

  const opened = await open(options, root.value, locked.value, clock, random);
  if (!opened.ok) {
    // 기동이 실패하면 위치 metadata를 남기지 않고 lock을 푼다.
    await removeRunMetadata(root.value.run);
    await locked.value.release();
    return opened;
  }
  return opened;
}

async function open(
  options: CoreOptions,
  root: DataRoot,
  lock: InstanceLock,
  clock: Clock,
  random: RandomSource,
): Promise<Result<Core>> {
  // documents coordinator 요청 통로. FileStatus 조회가 이 통로로 묻는다.
  const documentsChannel = createDocumentsChannel();
  // problems report collector 요청 통로. 같은 통로 모양을 쓴다.
  const collectorChannel = createDocumentsChannel();
  // problems test runner 요청 통로. 접수된 요청 한 건을 보내고 끝맺음을 받는다. 같은
  // process의 session이 `problems.work` 깨움(problems#T19)도 받으므로 통로 하나를 나눠 쓴다.
  const runnerChannel = createDocumentsChannel();
  // ticket checker worker 요청 통로. 같은 통로 모양을 쓴다(coding-agent#T26).
  const checkerChannel = createDocumentsChannel();
  // coding-agent 수리 자료 worker 요청 통로. 같은 통로 모양을 쓴다(coding-agent#T43).
  const repairChannel = createDocumentsChannel();
  // 앱 revert 호출 worker 요청 통로. 같은 통로 모양을 쓴다(lophn-agent#T48).
  const revertChannel = createDocumentsChannel();
  // coordinator가 파일 읽기의 창으로 보내는 byte frame의 우편함(`files.read` stream).
  const fileWindows = createFileWindows();
  const ledgerPath = `${root.path}/lophn.db`;
  // writer·reader가 import하는 팀 module. 문서 worker route를 서빙하는 reader는 항상 붙는다.
  const modules = withPlatformModule(
    withDocumentsReader(options.teamModules ?? []),
  );
  const eventNames = await eventOperations(modules);
  // approvals·notifications는 contract ROUTES가 route를 고정하므로 team 조립 뒤에 한 번만 더한다.
  // 메시지 본문·질문 글·approval 설명 글을 읽는 통로. 참조 판정은 ledger snapshot, 바이트는 blob 읽기다.
  // 사람 화면이 run 본문을 볼 때 쓰는 지금의 redaction. 알려진 secret 값은 runtime이 열린 뒤에 채운다.
  // 채우기 전에 읽으면 알려진 값을 모른 채 내보내지 않도록 ready가 false다.
  const knownForBodies: { current: KnownSecretMatch | undefined } = {
    current: undefined,
  };
  const bodyRedactor = createProductRedactor({
    get ready() {
      return knownForBodies.current?.ready ?? false;
    },
    match: (text: string) => knownForBodies.current?.match(text),
  });
  const bodyEnvironment = messageBodyEnvironment({
    ledgerPath,
    read: (hash, offset, length) => blobRead.deps.read(hash, offset, length),
  });
  // 사람 지침 파일의 확정 판 읽기. runtime에는 ReadInstructionFile 하나로만 닿는다.
  const instructionFiles = instructionFilesEnvironment({
    ledgerPath,
    read: (hash, offset, length) => blobRead.deps.read(hash, offset, length),
  });
  const assembled = withPlatform(
    assemble(options.teams, {
      instructionFiles: {
        files: instructionFiles,
        permit: instructionAccess(ledgerPath),
        asOfSeq: () => ledgerHead(ledgerPath),
      },
      status: statusMemoryVia(documentsChannel),
      // problems의 GetSnapshotLogs 읽기 통로. 바이트 통로는 relay가 뜬 뒤 채워진다.
      snapshotLogs: snapshotLogsEnvironment({
        ledgerPath,
        read: (hash, offset, length) =>
          blobRead.deps.read(hash, offset, length),
      }),
      // ReadMessageBody의 참조 판정과 blob 바이트 읽기 통로.
      messageBody: bodyEnvironment,
      // ReadRunBodyView가 본문을 내보내기 전에 거치는 지금의 redaction.
      redactBody: (text: string) =>
        bodyRedactor(
          {
            concern: "lophn-agent/observability",
            revision: "1",
            scope: "run-body",
          },
          "text/plain",
          text,
        ),
    }),
    // ReadApprovalText도 같은 통로를 쓴다. backups/list·get은 데이터 root의 manifest를 읽는다.
    {
      approvalText: bodyEnvironment,
      backups: { root: root.path, ledgerPath },
    },
  );
  if (!assembled.ok) return assembled;
  // HTTP route는 writer·reader가 받는 command·read와 같은 조립에서 온다.
  // 현재 보기 relay는 팀 조립 밖 memory route다. registry에 없으면 handler가
  // 있어도 lookup이 route not found를 반환한다(shell/workspace#R9).
  // platform 기본 route와 팀 route의 resource/method가 겹치면 기동을 거절한다.
  const allRoutes = [
    ...ROUTES,
    ...WORKSPACE_MEMORY_ROUTES,
    ...assembled.value.routes,
  ];
  let routes: RouteRegistry;
  try {
    routes = new RouteRegistry(allRoutes);
  } catch {
    return err({ code: "internal", message: "route 등록이 겹친다" });
  }
  // ledger를 새로 만드는 기동인지는 migration이 파일을 만들기 전에 본다(Q12: ledger_id는
  // ledger를 만들거나 복원할 때마다 새 값이다).
  const ledgerExisted = await fileExists(ledgerPath);
  const schemaSteps = [
    ...LEDGER_SCHEMA_STEPS,
    CREDENTIAL_SCHEMA,
    ...assembled.value.schemaSteps,
    ...SETTINGS_SCHEMA_STEPS,
    ...SECRET_SCHEMA_STEPS,
  ];
  const migrated = await applyMigrations(ledgerPath, schemaSteps, {
    clock,
    recovery: { root: root.path },
  });
  if (!migrated.ok) return migrated;
  const ledgerId = await ensureLedgerId(root.path, ledgerExisted);
  if (!ledgerId.ok) return ledgerId;
  // 중단 작업 점검 → cursor 복원 치는 R11 순서다. SQLite 복구·schema 점검 뒤
  // 정상 read를 열고 전체 scan·index·큰 hash를 기다리지 않는다(R15). 소유
  // concern의 복구 command가 아직 없는 영역은 unknown 관측값과 근거를 남기고
  // 읽기 열기를 막지 않는다(R16). 점검 관측은 status에 더하지 않는다: 상태는
  // 구성 요소 관측이고 소유 concern 관측은 복구 command로 남는다.
  const restart = await checkRestart(ledgerPath, {
    clock,
    owners: [
      observeApprovals,
      observeInvocations,
      observeReleaseActivations,
    ],
  });
  if (!restart.ok) return restart;
  const epoch = hex(random, 16);
  // machine은 command kind 정책에만 닿는다(identity model operationCeiling).
  // 문서 관측 제출은 machine document.prepare(준비 route)와 document.save command다
  // (documents#T11). 준비 route도 machine이 닿도록 command kind로 올린다.
  const coding = options.codingKeychain
    ? createCodingCredentials({
      ledgerPath,
      dataRoot: root.path,
      keychain: options.codingKeychain,
      clock,
      random,
      loaders: options.codingLoaders ?? [],
    })
    : undefined;
  const baseOperations: OperationPolicy[] = [
    {
      name: "platform/status",
      actors: ["user", "machine", "app", "agent", "coding_agent"],
      kind: "read",
    },
    {
      name: "platform/health",
      actors: ["user", "machine", "app", "agent", "coding_agent"],
      kind: "read",
    },
    { name: "document.save", actors: ["machine"], kind: "command" },
    { name: "document.prepare", actors: ["machine"], kind: "command" },
    // 파일 작업 결과 기록(documents#T12). 사람 요청에 결합해 받은 worker만 쓴다.
    { name: "file.record_result", actors: ["machine"], kind: "command" },
    // context worker(machine)가 검사 결과와 위반 수를 기록한다(documents/contexts).
    ...CONTEXT_WORKER_OPERATIONS.map((name): OperationPolicy => ({
      name,
      actors: ["machine"],
      kind: "command",
    })),
    // apps 관측 기록·제어 connection·자식 앱 credential이 닿는 operation(apps#T10).
    ...appsOperationPolicies(),
    // problems report collector(machine)가 보고를 제출한다.
    ...collectorOperationPolicies(),
    // problems test runner(machine)가 요청 기록을 잇고 결과를 남긴다(problems/tests#R1, R4, R17).
    ...testRunnerPolicies(),
    // ticket checker(machine)가 판정 사실을 읽고 결과를 기록한다(coding-agent#T26).
    ...ticketCheckerPolicies(),
    // test-runner kind의 `problems.work` 반응기(machine)가 event를 읽고 문제 work를 맞춘다.
    // 같은 kind의 `problems.closing` 반응기도 CloseProblemVerified를 낸다(problems#T20).
    ...problemsWorkPolicies(),
    // 앱 revert 단계의 기록·끝내기(core 내부 machine, lophn-agent#T48).
    ...appRevertPolicies(),
    // agent runtime(machine)과 run의 agent 자격이 닿는 operation(lophn-agent/harness/run-loop).
    ...(options.agentRuntime ? agentRuntimePolicies(allRoutes) : []),
    // 팀이 공개 정책을 내놓은 event 이름. 사람 token의 operation에 들어가 owner 정책이 판단한다.
    ...eventNames.map((name): OperationPolicy => ({
      name,
      actors: ["user"],
      kind: "read",
    })),
    // 사람 token 상한. user를 허용하는 route만 올라가고 다른 actor의 상한은 그대로다.
    ...allRoutes.filter((route) => route.actors.includes("user")).map((
      route,
    ): OperationPolicy => ({
      name: route.name,
      actors: ["user"],
      kind: route.kind === "command" ? "command" : "read",
    })),
  ];
  const productRegistry = new CredentialRegistry({
    epoch,
    clock,
    random,
    ...(coding ? { external: coding.authority } : {}),
    // coding_agent 상한은 route가 선언한 actors를 따른다(blobs 제외).
    operations: [
      ...baseOperations,
      ...codingAgentOperationPolicies(allRoutes, baseOperations),
    ],
  });
  const registry = options.testCredentials
    ? testCredentialFront(productRegistry, ledgerPath)
    : productRegistry;
  const io = options.superviseIo === false ? undefined : createSupervisor({
    clock,
    denoCommand: Deno.execPath(),
    ...(options.spawn ? { spawn: options.spawn } : {}),
    env: (kind) => ({
      LOPHN_WORKER_KIND: kind,
      LOPHN_HOME: root.path,
      // deno는 이 둘 없이 캐시와 실행 파일을 못 찾는다. 그 밖 환경은 복사하지 않는다.
      ...(Deno.env.get("HOME") ? { HOME: Deno.env.get("HOME")! } : {}),
      ...(Deno.env.get("PATH") ? { PATH: Deno.env.get("PATH")! } : {}),
      ...(Deno.env.get("DENO_DIR")
        ? { DENO_DIR: Deno.env.get("DENO_DIR")! }
        : {}),
      // I/O worker의 secret-tool이 session bus를 찾는 데 필요한 주소만이다. secret 값이 아니다.
      ...(kind === "platform/io" ? sessionBusEnv() : {}),
      // test runner는 자식에 메모리 경계(systemd-run)를 걸 때 같은 session bus를 찾고, 화면 검사 host의 위치를 안다.
      ...(kind === TEST_RUNNER_KIND
        ? {
          ...sessionBusEnv(),
          ...(screenTestHost() ? { SCREEN_TEST_HOST: screenTestHost()! } : {}),
        }
        : {}),
    }),
  });
  // 앱 supervisor는 platform/io와 따로 감독한다. I/O worker 없이도 앱 감독을 띄울 수 있다.
  const appsRuntimeDir = typeof options.appSupervisor === "object"
    ? options.appSupervisor.runtimeDir
    : undefined;
  const appsSupervision = options.appSupervisor
    ? createSupervisor({
      clock,
      denoCommand: Deno.execPath(),
      env: () => ({
        LOPHN_WORKER_KIND: APPS_SUPERVISOR_KIND,
        LOPHN_HOME: root.path,
        // 앱 자식에게 넘길 deno 캐시·XDG·임시 폴더 위치뿐이다. 그 밖 환경은 복사하지 않는다.
        ...(Deno.env.get("HOME") ? { HOME: Deno.env.get("HOME")! } : {}),
        ...(Deno.env.get("PATH") ? { PATH: Deno.env.get("PATH")! } : {}),
        ...(Deno.env.get("DENO_DIR")
          ? { DENO_DIR: Deno.env.get("DENO_DIR")! }
          : {}),
        ...(Deno.env.get("XDG_CACHE_HOME")
          ? { XDG_CACHE_HOME: Deno.env.get("XDG_CACHE_HOME")! }
          : {}),
        ...((appsRuntimeDir ?? Deno.env.get("XDG_RUNTIME_DIR"))
          ? {
            XDG_RUNTIME_DIR: (appsRuntimeDir ??
              Deno.env.get("XDG_RUNTIME_DIR"))!,
          }
          : {}),
        ...(optionalEnv("TMPDIR") ? { TMPDIR: optionalEnv("TMPDIR")! } : {}),
      }),
    })
    : undefined;
  let ready = false;
  const stopPrune: {
    run?: () => void;
    bootstrap?: () => Promise<void>;
  } = {};
  // 활성 tracking root 변화를 보는 확인. documents worker를 띄운 뒤에만 있다.
  let rootsWatch: RootsWatch | undefined;
  // coordinator에 관측 근거(규칙·경로→문서 연결)를 보내는 동기화(Q15).
  let basisSync: BasisSync | undefined;
  // coordinator의 search consumer에 event와 저장 판 원문을 보내는 동기화(documents#T21).
  let searchSync: SearchSync | undefined;
  // 종료 때 documents worker의 열린 blob 준비를 닫는다.
  let closeChildBlob: (() => void) | undefined;
  // 종료 때 감독이 포기한 documents worker를 다시 띄우는 일을 멈춘다.
  let respawnStop: (() => void) | undefined;
  let closeCollectorBlob: (() => void) | undefined;
  // 종료 때 test runner의 blob 준비와 요청 기록 읽기를 닫는다.
  let closeTestRunner: (() => void) | undefined;
  let agentRuntime: AgentRuntimeChild | undefined;
  // deno-lint-ignore prefer-const
  let runtime: CoreRuntime | undefined;
  const source: StatusSource = {
    get ready() {
      return ready;
    },
    schema: LEDGER_SCHEMA_STEPS.length + assembled.value.schemaSteps.length,
    dataRoot: root.path,
    // ledger를 만들거나 복원할 때마다 새로 정한 식별(data root의 ledger-id). 내용은 노출하지 않는다.
    // derived는 출처에 이 값을 적고 다르면 버리고 다시 만든다(backup-and-migration#R14).
    ledgerId: ledgerId.value,
    components() {
      return [
        ["ledger", { available: true }],
        // unavailable 관측은 안전한 이유가 있어야 한다(healthObservationSchema).
        ["api", {
          available: ready,
          ...(ready ? {} : { reason: "API가 아직 요청을 받지 않는다" }),
        }],
        ["writer", {
          available: runtime !== undefined,
          ...(runtime ? {} : { reason: "writer가 아직 없다" }),
        }],
        ["reader", {
          available: runtime?.readers.health().every((health) =>
            health === "healthy"
          ) ?? false,
          ...(runtime ? {} : { reason: "reader가 아직 없다" }),
        }],
        ["io", ioComponent(io)],
        // 앱 supervisor를 띄우는 기동만 앱 영역의 감독 상태를 더한다.
        ...(appsSupervision
          ? [["apps", appsComponent(appsSupervision)] as const]
          : []),
      ];
    },
  };
  // 읽기 의존은 runtime보다 먼저 만들어 둔다. relay는 I/O worker가 뜬 뒤에 채운다.
  const blobRead = blobReadDeps(assembled.value);
  const openedRuntime = await openRuntime({
    ledgerPath,
    clock,
    nowMs: clock.nowMs(),
    writerClock: options.writerClock ?? "fixed",
    seed: seedOf(random),
    // 문서 worker route를 서빙하는 reader 등록은 항상 붙는다(documents-reader.ts).
    modules,
    // connection credential의 알려진 값 참조는 coding keychain이 있을 때만 읽는다. 없는 core(시험)가
    // 사람의 실제 keychain으로 그 참조를 찾지 않게 한다.
    assembled: options.codingKeychain === undefined
      ? {
        ...assembled.value,
        secretRefs: assembled.value.secretRefs.filter((source) =>
          source.owner !== CONNECTION_SECRET_OWNER
        ),
      }
      : assembled.value,
    source,
    blob: blobRead.deps,
    // 제품 기동은 OS keychain adapter, 테스트는 fake를 준다. 참조가 있을 때만 부른다. coding
    // keychain만 준 core는 같은 adapter로 connection credential 값을 읽는다.
    keychain: () =>
      options.secretKeychain ?? options.codingKeychain ?? productKeychain(),
  });
  if (!openedRuntime.ok) return openedRuntime;
  runtime = openedRuntime.value;
  knownForBodies.current = runtime.knownSecrets;
  registerRepairReads(runtime, repairChannel);
  registerSessionReads(runtime, repairChannel);
  // sweep가 expire_claim을 제출할 machine credential. 기록이 없으면 writer가
  // 만료 정리를 거절하므로 기동을 여기서 멈춘다(coding-agent/tickets#R13).
  const sweepCredential = await runtime.record({
    principal: "machine:ticket-claims",
    actor: "machine",
    scope: {
      operations: ["ExpireTicketClaim", "TicketClaimSweep"],
      targets: {},
    },
    conditions: {},
    credential_ref: "machine:ticket-claims",
  });
  if (!sweepCredential.ok) {
    await runtime.close();
    return sweepCredential;
  }
  // approval 만료 정리(machine:approval-expiry)의 자격 기록. 기록이 없으면 reader·writer가 정리를
  // 거절해 대기가 영원히 pending으로 남으므로 기동을 여기서 멈춘다(platform/approvals#R12).
  const expiryCredential = await runtime.record(APPROVAL_EXPIRY_CONTEXT);
  if (!expiryCredential.ok) {
    await runtime.close();
    return expiryCredential;
  }
  // 재시작 때 접수·실행 중 invocation을 미확인으로 확정하는 core 내부 자격의 기록이다. 기록이 없으면
  // writer가 확정을 거절해 행이 계속 남으므로 기동을 여기서 멈춘다(apps/invocations#R10).
  const recoveryCredential = await runtime.record(
    INVOCATION_RECOVERY_CONTEXT as never,
  );
  if (!recoveryCredential.ok) {
    await runtime.close();
    return recoveryCredential;
  }
  // notifications 구독자(machine:notifications)의 자격 기록. token이 없는 core 내부 자격이라
  // HTTP로는 이 principal이 될 수 없다. reader·writer는 이 ledger 기록으로 현재 자격을 본다.
  const notificationsCredential = await runtime.record(NOTIFICATIONS_CONTEXT);
  if (!notificationsCredential.ok) {
    await runtime.close();
    return notificationsCredential;
  }
  // AppCreated 반응 구독자(machine:lophn-agent-assignments)의 자격 기록. token이 없는 core 내부
  // 자격이라 HTTP로는 이 principal이 될 수 없다. reader·writer는 이 ledger 기록으로 자격을 본다.
  const assignmentsCredential = await runtime.record(
    ASSIGNMENT_REACTIONS_CONTEXT,
  );
  if (!assignmentsCredential.ok) {
    await runtime.close();
    return assignmentsCredential;
  }
  // apps 제어(connect 어댑터·runtime·logs 덮기)가 ledger 사실을 읽는 core 내부 자격 기록.
  const appsControlCredential = await runtime.record(APPS_CONTROL_CONTEXT);
  if (!appsControlCredential.ok) {
    await runtime.close();
    return appsControlCredential;
  }
  // 앱 revert 이어 실행(lophn-agent#T48)이 단계를 기록하고 끝내는 core 내부 자격 기록.
  const appRevertCredential = await runtime.record(APP_REVERT_CONTEXT);
  if (!appRevertCredential.ok) {
    await runtime.close();
    return appRevertCredential;
  }
  // 명시 연결 test(provider#R30)가 model call 기록·provider 상태를 쓰는 core 내부
  // machine 자격 기록. 기록이 없으면 StartModelCall이 거절해 test가 실패한다.
  const connectionTestCredential = await runtime.record(
    CONNECTION_TEST_CONTEXT,
  );
  if (!connectionTestCredential.ok) {
    await runtime.close();
    return connectionTestCredential;
  }
  // call 기록의 id는 core의 ULID source로 낸다(idSchema("mcl")).
  const connectionTestIds = createIdSource({ clock, random });
  const connectionTestSecrets = {
    ledgerPath,
    keychain: () =>
      options.secretKeychain ?? options.codingKeychain ?? productKeychain(),
    known: () => runtime?.knownSecrets,
    newCallId: () => connectionTestIds.newId("mcl"),
  };
  // trace export(observability#R17)의 ledger 경로와 blob 읽기 통로다. 계기 기록이 없다.
  const traceExportSecrets: TraceExportWriterDeps = {
    ledgerPath,
    readBlob: (hash, offset, length) =>
      blobRead.deps.read(hash, offset, length),
    known: () => knownSecrets,
  };
  // MCP OAuth의 시작·완료 입구다(extensions R16, shell#T31에서 넘어온 것의 route 절반).
  // 업무 규칙은 extensions의 mcp-auth에 있고(concern lophn-agent/extensions, code-map
  // 의존 규칙) 여기는 core의 memory route 입구와 snapshot 재료를 끼운다.
  // - verifier·state·access token은 memory 작업 메모리에만 산다.
  // - credential 값 보관은 보호 창의 `SetSecret`(이름 `mcp-<server>`)이 하고 설정은
  //   `sec:mcp-<server>`를 가리킨다(shell#T31 규칙). 이 입구는 그 값의 전송 callback이
  //   아니라 작업 상태만 기록한다.
  const mcpAuthControl = createMcpAuthControl({
    fetch: undefined,
    openListener: openMcpCallbackListener,
    snapshot: () => mcpServerSnapshot(ledgerPath),
    nowMs: () => clock.nowMs(),
  });
  // OAuth 로그인(provider#R12–R16, D31)의 writer queue 앞 처리기 재료다. 활성 gate는
  // 사람이 LOPHN_LIVE_PROVIDER=1로 실제 계정 확인을 시작했을 때만 열리고, 테스트가
  // 대신 준다. login 세션과 token 값은 처리기 메모리에만 있다(R6, R7).
  const providerLoginSecrets = {
    ledgerPath,
    keychain: () =>
      options.secretKeychain ?? options.codingKeychain ?? productKeychain(),
    known: () => runtime?.knownSecrets,
  };
  const knownSecrets = runtime.knownSecrets;
  const redactLine = createProductRedactor(knownSecrets);
  // 앱 쌍 confirm의 approval 요청은 approval 글 준비를 지나는 writer로 낸다(사람이 보는 글은 blob이다).
  const confirmWriter = withApprovalText(
    runtime.writer,
    createApprovalTextPreparer({
      relay: () => bodyPrepare.current,
      known: () => runtime?.knownSecrets,
    }),
  );
  // preview 자식이 loopback으로 core API에 닿지 못하게 막을 port다. API를 연 뒤에 정해진다.
  let apiPort = 0;
  const appsControl = await createAppsControl({
    clock,
    ledgerPath,
    readers: runtime.readers,
    confirm: createConfirmAdapters({
      clock,
      ledgerPath,
      command: (ctx, envelope) =>
        confirmWriter.command(ctx as never, envelope as never),
      machine: () => {
        const current = runtime?.current(APPS_CONTROL_PRINCIPAL);
        return current?.ok ? current.value : undefined;
      },
      // 호출한 앱 자신의 짧은 app credential이다. 요청 하나를 마치면 끝낸다.
      async requester(source) {
        // 앱 자격은 앱·release·process·mode에 고정된다. release가 없는 자식은 confirm을 요청하지 못한다.
        if (source.release === null) {
          return err({
            code: "forbidden",
            message: "app confirm is live only",
          });
        }
        const issued = await productRegistry.issue({
          actor: `app:${source.app}`,
          principal: `app:${source.app}`,
          scope: {
            operations: [createApprovalRequest.name],
            targets: {
              app: source.app,
              release: source.release,
              process: source.processNonce,
              mode: source.mode,
            },
          },
          conditions: {
            app: source.app,
            release: source.release,
            process: source.processNonce,
            mode: source.mode,
          },
        });
        if (!issued.ok) return issued;
        const ref = issued.value.credential_ref;
        const current = productRegistry.revalidate({ credential_ref: ref });
        if (!current.ok) return current;
        const recorded = await runtime!.record(current.value);
        if (!recorded.ok) return recorded;
        const context = runtime!.current(ref);
        if (!context.ok) return context;
        return ok({
          context: context.value,
          end: () => void productRegistry.end(ref),
        });
      },
    }),
    // coding credential은 ledger의 connection 상태가 현재 자격이다(회수는 다음 요청부터가 아니라 바로).
    revalidate: (credentialRef) =>
      coding?.current(credentialRef) ??
        registry.revalidate({ credential_ref: credentialRef }),
    redact: (line) =>
      redactLine(
        { concern: "apps/runtime", revision: "1", scope: "app-log" },
        "text/plain",
        line,
      ),
    // 봉인 bundle 사본을 여는 실제 자리다. 시험이 `appPreviews.bundles`로 바꿔 끼울 수 있다.
    activation: {
      dataRoot: root.path,
      command: (ctx, envelope) =>
        confirmWriter.command(ctx as never, envelope as never),
      machine: () => {
        const current = runtime?.current(APPS_CONTROL_PRINCIPAL);
        return current?.ok ? current.value : undefined;
      },
      prepareBlob: (call) =>
        blobRelay ? blobRelay.prepare(call) : Promise.resolve(err({
          code: "unavailable",
          message: "blob 준비 통로가 없다",
        })),
      platformPorts: () => apiPort === 0 ? [] : [apiPort],
    },
    previews: {
      dataRoot: root.path,
      bundles: createCopyPreviewBundles({
        dataRoot: root.path,
        platformPorts: () => apiPort === 0 ? [] : [apiPort],
      }),
      ...options.appPreviews,
    },
    ...(options.appProcess ? { process: options.appProcess } : {}),
    ...(options.appsSweepMs === undefined
      ? {}
      : { sweepMs: options.appsSweepMs }),
  });
  appsControl.overlayReads(runtime.reads);
  // documents 구독자(machine:documents-feed)의 자격 기록. token이 없는 core 내부 자격이라
  // HTTP로는 이 principal이 될 수 없고, reader가 이 ledger 기록으로 event 공개를 판단한다.
  const feedCredential = await runtime.record(DOCUMENTS_FEED_CONTEXT);
  if (!feedCredential.ok) {
    await runtime.close();
    return feedCredential;
  }
  // 문서 관측 제출 machine credential. 발급(greet과 같은 issue → revalidate →
  // record 규칙) 뒤 token이 documents/worker hello에 싣는다. 지우지 못한 token은
  // logs에 남기지 않는다(child.ts 계약). 발급이 실패하면 기동을 여기서 멈춘다.
  let documentsToken: string | undefined;
  if (options.superviseIo !== false) {
    const issued = await productRegistry.issue({
      actor: "machine",
      principal: "machine:documents",
      scope: {
        operations: [
          "document.prepare",
          "document.save",
          "file.record_result",
        ],
        targets: { task: "documents" },
      },
      conditions: { task: "documents", process: "documents/worker" },
    });
    if (!issued.ok) {
      await runtime.close();
      return issued;
    }
    const current = productRegistry.revalidate({
      credential_ref: issued.value.credential_ref,
    });
    if (!current.ok) {
      await runtime.close();
      return current;
    }
    const recorded = await runtime.record(current.value);
    if (!recorded.ok) {
      await runtime.close();
      return recorded;
    }
    documentsToken = issued.value.token;
  }
  // blob 준비 중계는 I/O worker가 뜬 뒤에 채워진다. 그 전에는 prepare route가
  // unavailable이다. route는 떠 있고, 바이트는 중계가 읽는 stream으로 바로 간다.
  const prepareRelay: {
    current?: (call: BlobPrepareCall) => Promise<Result<PreparedRelayResult>>;
  } = {};
  // format 검사는 원문 blob을 I/O worker에서 읽어 documents coordinator로 보낸다. 두 통로는
  // I/O worker와 coordinator가 뜬 뒤에 채워지고, 그 전에는 unavailable이다.
  // 메시지 본문 준비 통로도 I/O worker가 뜬 뒤에 채워진다. 그 전에는 unavailable이다.
  const bodyPrepare: { current?: BodyPrepare } = {};
  // 보호 입력 중계도 I/O worker가 뜬 뒤에 채워진다. 그 전에는 secrets/input이 unavailable이다.
  const secretInputRelay: { current?: SecretInputRelay } = {};
  const validateWiring: {
    readBlob?: ReturnType<typeof blobRelayFor>["readBytes"];
    sendBytes?: (channel: number, chunk: Uint8Array) => Promise<boolean>;
    live?: (
      prepared: { principal: string; purpose: string; hash: string },
      nowMs: number,
    ) => boolean;
  } = {};
  const validateDeps = {
    readBlob: (hash: string, offset: number, length: number) =>
      validateWiring.readBlob
        ? validateWiring.readBlob(hash, offset, length)
        : Promise.resolve(err({
          code: "unavailable" as const,
          message: "blob 읽기 통로가 없다",
        })),
    sendBytes: (channel: number, chunk: Uint8Array) =>
      validateWiring.sendBytes
        ? validateWiring.sendBytes(channel, chunk)
        : Promise.resolve(false),
    request: (op: string, payload: unknown, timeoutMs: number) =>
      documentsChannel.request(op, payload, timeoutMs),
  };
  // 검사와 search 추출이 같은 pipe와 channel 번호를 쓰므로 바이트 통로 하나를 나눠 쓴다.
  const coordinatorStreamer = createStreamer(validateDeps);
  const validatePort = createValidatePort(validateDeps, coordinatorStreamer);
  // 준비 route의 handle. 사람 파일 쓰기가 working copy의 판을 확정할 때 같은 조립을 쓴다.
  const prepareWorkers = documentPrepareWorkers(
    prepareRelay,
    baseVersionRead(runtime),
    requestPrincipal(runtime),
    validatePort,
  );
  const preparedRoute = prepareWorkers.get(
    `${documentPrepare.resource}/${documentPrepare.method}`,
  )!.handle;
  // 두기가 파일을 쓰기 전부터 원본 연결까지 잡는 경로. 그 사이 같은 경로의 관측 저장은 conflict다.
  const placementReservations = createPlacementReservations();
  // 요청한 credential의 자격으로 판을 준비·확정한다. 사람 파일 쓰기의 판 확정과 agent의 문서
  // tool 저장이 같은 길을 쓴다(저장 범위·기준 판 비교는 documents/versions가 정한다).
  const requestVersion = {
    prepare: (request: WorkerRequest, payload: unknown) =>
      Promise.resolve(
        preparedRoute.forward({
          ...request,
          op: documentPrepare.name,
          payload,
        }),
      ),
    save: (
      request: WorkerRequest,
      envelope: {
        command: string;
        input: unknown;
        idempotency_key: string;
        compare: unknown;
        prepared: string[];
      },
    ) => {
      const slash = request.request_id.lastIndexOf("/");
      const ctx = slash > 0
        ? runtime!.current(request.request_id.slice(0, slash))
        : undefined;
      return ctx?.ok
        ? runtime!.writer.command(ctx.value as never, envelope as never)
        : Promise.resolve(err({
          code: "unauthorized" as const,
          message: "credential이 없다",
        }));
    },
  };
  let server: ApiServer;
  try {
    server = await startApiServer({
      port: options.port,
      credentials: registry,
      clock,
      // 메시지 본문을 싣는 command는 writer 앞에서 값을 redaction해 blob으로 준비한다.
      // 질문 글(본문·이유·설명·자유 답·취소 이유)도 같은 길이다.
      // approval 설명 글(이유·변경·외부 영향·되돌림)도 같은 길이다.
      // handoff 내용(무엇·왜·제외·기대 결과)도 같은 길이다. 용어 후보·근거 변경은 writer에
      // 닿기 전에 고정 판 본문의 출현을 확인한다(documents Q8).
      // 명시 연결 test(provider#R29, R30)는 writer queue 앞에서 네트워크를 기다린다.
      // trace export(observability#R17)는 writer queue 앞에서 로컬 파일에 쓴다.
      // OAuth 로그인(provider#R12–R16, D31)도 writer queue 앞에서 listener와 network를
      // 기다린다. login 세션은 처리기 메모리에만 있다.
      writer: withRevocationSweep(
        withProviderLogin(
          withTraceExport(
            withConnectionTest(
              withReleasePreparation(
                withPlacementReservation(
                  withApprovalText(
                    withQuestionText(
                      withHandoffBody(
                        withMessageBody(
                          runtime.writer,
                          createMessageBodyPreparer({
                            relay: () => bodyPrepare.current,
                            // 알려진 secret 값도 pattern과 함께 가린다. 값을 다 모르는 동안은 막는다.
                            known: () => runtime?.knownSecrets,
                          }),
                        ),
                        createHandoffBodyPreparer({
                          relay: () => bodyPrepare.current,
                          known: () => runtime?.knownSecrets,
                        }),
                      ),
                      createQuestionTextPreparer({
                        relay: () => bodyPrepare.current,
                      }),
                    ),
                    createApprovalTextPreparer({
                      relay: () => bodyPrepare.current,
                      known: () => runtime?.knownSecrets,
                    }),
                  ),
                  placementReservations,
                ),
                appsControl.commands,
                appsControl.grantChange,
              ),
              connectionTestSecrets,
            ),
            traceExportSecrets,
          ),
          providerLoginSecrets,
        ),
        () => appsControl.connector.sweep(),
        // 회수된 connection 아래 등록된 MCP·CLI child도 바로 닫는다(platform/identity#R15).
        (connection) => coding?.authority.endConnection(connection),
      ),
      reads: runtime.reads,
      // 현재 보기 relay와 apps.connect(supervisor 메모리 관측을 읽는 제어 어댑터)다.
      memory: new Map([
        ...runtime.memory.handlers,
        ...runtime.deliveryMemory,
        ...appsControl.memory,
        // 확인한 revert의 앱 단계를 이어 실행한다(lophn-agent#T48). 실제 복원 호출은 감독
        // worker(apps/revert)가 호출자의 credential으로 하고 core는 결과를 받아 판정한다.
        [
          `${runAppRevert.resource}/${runAppRevert.method}`,
          createAppRevert({
            ledgerPath,
            caller: options.appRevertCaller ??
              ((_ctx, credential) =>
                workerAppCaller({
                  channel: revertChannel,
                  credential,
                })),
            command: (ctx, envelope) =>
              runtime?.writer.command(ctx as never, envelope as never),
            machine: () => {
              const current = runtime?.current(APP_REVERT_PRINCIPAL);
              return current?.ok ? current.value : undefined;
            },
          }),
        ] as const,
        // MCP OAuth의 시작·완료 입구다(extensions R16). handler는 등록한 http 서버의
        // oauth2 인증 방식만 잠근다. verifier·state·access token은 memory 작업
        // 메모리에만 산다(값은 응답·ledger·log 어디에도 옮기지 않는다).
        ...mcpAuthControl.handlers,
        // 사람의 연결 결정 입구. codingKeychain이 있을 때만 서고 없으면 route는 처리기 없이 남는다.
        ...(coding
          ? [
            [
              `${connectionConnect.resource}/${connectionConnect.method}`,
              connectHandler(coding, () => runtime!.writer),
            ] as const,
            // 신뢰 감독(shell main, 사람 credential)이 TUI 아래 MCP·CLI child를 등록·해제한다.
            [
              `${connectionRegisterChild.resource}/${connectionRegisterChild.method}`,
              registerChildHandler(coding),
            ] as const,
            [
              `${connectionEndChild.resource}/${connectionEndChild.method}`,
              endChildHandler(coding),
            ] as const,
            [
              `${connectionEndConnection.resource}/${connectionEndConnection.method}`,
              endConnectionHandler(coding),
            ] as const,
          ]
          : []),
      ]),
      events: runtime.events,
      subscriptions: runtime.subscriptions,
      track: (session) => runtime.track(session),
      // 확인이 필요한 file·worker route(files.delete)는 writer Worker의 registry가 한 번에
      // 검증·소비한 뒤에만 worker로 넘어간다(platform#T56, ledger#R22).
      confirmation: {
        useOnce: (use) =>
          runtime!.confirmation({
            action: "consume",
            request: { ...use, decision: routeDecision(use.decision) },
          }).then(
            (answered) => answered.ok ? ok(undefined) : answered,
          ),
      },
      // command·read·file·worker route는 같은 조립에서 온다. platform 기본 route와
      // 팀 route의 resource/method가 겹치면 RouteRegistry가 거절한다.
      registry: routes,
      // 바이트 body route. 제출 파일은 blob 준비 중계로 바로 흐른다.
      // worker route serving map. document.prepare는 제품 기동이 항상 넣고,
      // 테스트 seam(T8·T13)이 준 route를 같은 map에 더한다. resource/method가
      // 겹치면 테스트 seam이 이긴다. 둘 다 없으면 worker route는 503이다.
      uploads: new Map([[
        `${documentUpload.resource}/${documentUpload.method}`,
        documentUploadHandler(prepareRelay),
      ], [
        // ticket 완료 보고 summary: purpose는 ticket 등록값(ticket_summary)으로 고정이다.
        `${ticketUploadSummary.resource}/${ticketUploadSummary.method}`,
        ticketSummaryUploadHandler(prepareRelay),
      ], [
        // 고친 기록 summary: purpose는 problems/repairs 등록값(fix_summary)으로 고정이다.
        `${problemsUploadFixSummary.resource}/${problemsUploadFixSummary.method}`,
        fixSummaryUploadHandler(prepareRelay),
      ], [
        // 사람의 보호 입력 값: core는 해석·보관 없이 I/O worker의 keychain adapter로 흘린다.
        `${secretInput.resource}/${secretInput.method}`,
        secretInputHandler(secretInputRelay),
      ]]),
      // 큰 파일을 core 메모리에 모으지 않고 창 단위로 흘리는 file route.
      fileStreams: new Map([
        ...storedFileStreams({
          readers: runtime.readers,
          current: (ref) => runtime!.current(ref),
          readBlob: (hash, offset, length) =>
            validateWiring.readBlob
              ? validateWiring.readBlob(hash, offset, length)
              : Promise.resolve(err({
                code: "unavailable" as const,
                message: "blob 읽기 통로가 없다",
              })),
          blobReady: () => validateWiring.readBlob !== undefined,
        }),
        // 현재 디스크 파일은 헤더와 창 단위 byte frame으로 흘린다(한 JSON frame에 싣지 않는다).
        ...fileReadStreams({
          request: (op, payload, timeoutMs) =>
            documentsChannel.request(op, payload, timeoutMs),
          bound: () => documentsChannel.bound,
          windows: fileWindows,
          current: (ref) => runtime!.current(ref),
          copyCheck: (ctx, document) =>
            runtime!.readers.read(WORKING_COPY_ROUTE, ctx, {
              document,
              base_version: null,
              operation: filesRead.name,
            }) as ReturnType<FilesRouteDeps["copyCheck"]>,
        }),
      ]),
      workers: mergedWorkers(
        fileWorkers({
          request: (op, payload, timeoutMs) =>
            documentsChannel.request(op, payload, timeoutMs),
          bound: () => documentsChannel.bound,
          readBlob: (hash, offset, length) =>
            validateWiring.readBlob
              ? validateWiring.readBlob(hash, offset, length)
              : Promise.resolve(err({
                code: "unavailable" as const,
                message: "blob 읽기 통로가 없다",
              })),
          sendBytes: (channel, chunk) =>
            validateWiring.sendBytes
              ? validateWiring.sendBytes(channel, chunk)
              : Promise.resolve(false),
          principalOf: requestPrincipal(runtime),
          live: (prepared) =>
            validateWiring.live?.(prepared, clock.nowMs()) ?? false,
          stored: async (request, source) => {
            const read = await readAs(runtime!, request, STORED_FILE_ROUTE, {
              version: source.version,
              path: source.path,
            });
            // 없는 판·없는 경로·접근 밖은 reader가 같은 not_found로 답한다.
            if (!read.ok) {
              return read.error.code === "not_found" ? ok(undefined) : read;
            }
            const file = read.value as { hash: string; bytes: number };
            return ok({ hash: file.hash, bytes: file.bytes });
          },
          copyCheck: (request, document, baseVersion) =>
            readAs(runtime!, request, WORKING_COPY_ROUTE, {
              document,
              base_version: baseVersion,
              operation: request.op,
            }) as ReturnType<FilesRouteDeps["copyCheck"]>,
          version: requestVersion,
          placement: {
            read: async (request, input) => {
              const read = await readAs(
                runtime!,
                request,
                FILE_PLACEMENT_ROUTE,
                input,
              );
              return read.ok ? ok(read.value as PlacementRead) : read;
            },
            command: (request, envelope) => {
              const slash = request.request_id.lastIndexOf("/");
              const ctx = slash > 0
                ? runtime!.current(request.request_id.slice(0, slash))
                : undefined;
              return ctx?.ok
                ? runtime!.writer.command(ctx.value as never, envelope)
                : Promise.resolve(err({
                  code: "unauthorized" as const,
                  message: "credential이 없다",
                }));
            },
            reserve: (path) => placementReservations.reserve(path),
          },
          observedAt: () => new Date().toISOString(),
        }),
        mergedWorkers(
          toolDocumentWorkers({
            relay: () => prepareRelay.current,
            known: () => runtime?.knownSecrets,
            principalOf: requestPrincipal(runtime),
            version: requestVersion,
            validate: validatePort,
            available: () =>
              prepareRelay.current !== undefined &&
              validateWiring.live !== undefined &&
              validateWiring.sendBytes !== undefined,
            observedAt: () => new Date().toISOString(),
          }),
          mergedWorkers(
            formatValidateWorkers({
              validate: validatePort,
              principalOf: requestPrincipal(runtime),
              live: (prepared) =>
                validateWiring.live?.(prepared, clock.nowMs()) ?? false,
              available: () =>
                validateWiring.live !== undefined &&
                validateWiring.sendBytes !== undefined,
              observedAt: () => new Date().toISOString(),
            }),
            mergedWorkers(
              mergedWorkers(
                prepareWorkers,
                // 앱 export serving(apps/data#R13). 준비는 core graph 밖 프로세스가 한다.
                appExportWorkers({
                  dataRoot: root.path,
                  ledgerPath,
                  current: (ref) => runtime!.current(ref),
                  observedAt: () => new Date().toISOString(),
                }),
              ),
              mergedWorkers(
                servedWorkers({
                  readers: runtime.readers,
                  current: (ref) => runtime!.current(ref),
                  observedAt: () => new Date().toISOString(),
                  wakeSearch: () => void searchSync?.check(),
                  blob: {
                    read: (hash, offset, length) =>
                      validateWiring.readBlob
                        ? validateWiring.readBlob(hash, offset, length)
                        : Promise.resolve(err({
                          code: "unavailable" as const,
                          message: "blob 읽기 통로가 없다",
                        })),
                    ready: () => validateWiring.readBlob !== undefined,
                  },
                }),
                // 문제 collector route의 view 출처는 binding 검증 뒤에만 worker로 닿는다(problems#T16).
                withViewBinding(
                  mergedWorkers(
                    collectorWorkers({
                      channel: collectorChannel,
                      observation: () =>
                        io?.observation(COLLECTOR_KIND) ?? {
                          component: COLLECTOR_KIND,
                          available: false,
                          reason: "report collector 감독이 없다",
                          observed_at: clock.now(),
                        },
                      callerOf: (request) => {
                        const slash = request.request_id.lastIndexOf("/");
                        const ctx = slash > 0
                          ? runtime!.current(request.request_id.slice(0, slash))
                          : undefined;
                        return ctx?.ok
                          ? {
                            actor: ctx.value.actor,
                            conditions: ctx.value.conditions,
                          }
                          : undefined;
                      },
                      sendBytes: async (channel, chunk) =>
                        io !== undefined &&
                        (await io.sendBytes(COLLECTOR_KIND, channel, chunk)).ok,
                    }),
                    options.workers,
                  ),
                  {
                    signer: appsControl.signer,
                    nowMs: () => clock.nowMs(),
                  },
                ),
              ),
            ),
          ),
        ),
      ),
    });
  } catch {
    await runtime.close();
    return err({ code: "unavailable", message: "API를 열 수 없다" });
  }
  apiPort = server.port;
  const recorded = await writeRunMetadata(root.run, {
    apiPort: server.port,
    coreEpoch: epoch,
    startedAt: clock.now(),
  });
  if (!recorded.ok) {
    await server.stop();
    await runtime.close();
    return recorded;
  }
  if (options.supervise) {
    try {
      await options.supervise(assembled.value.workers);
    } catch {
      await server.stop();
      await runtime.close();
      return err({
        code: "unavailable",
        message: "I/O worker 감독을 시작하지 못했다",
      });
    }
  }
  const blobBuffer = createBufferGauge();
  const blobRelay = io
    ? blobRelayFor(
      io,
      clock,
      (prepared, nowMs) => runtime.notePrepared(prepared, nowMs),
      blobBuffer,
    )
    : undefined;
  if (blobRelay) {
    blobRead.use(blobRelay.readBytes);
    validateWiring.readBlob = blobRelay.readBytes;
    validateWiring.live = blobRelay.live;
    prepareRelay.current = (call) => blobRelay.prepare(call);
    bodyPrepare.current = {
      live: (prepared) => blobRelay.live(prepared, clock.nowMs()),
      prepare: (call) => blobRelay.prepare(call),
    };
  }
  // 준비 참조 수명 만기 prune. writer 메모리의 만기 판정 시각도 함께 전진한다.
  // 파일 GC는 하지 않고 메모리 참조만 떨어뜨린다.
  const timer = setInterval(() => {
    blobRelay?.prune(clock.nowMs());
    runtime?.prunePrepared(clock.nowMs());
  }, 60_000);
  // ticket claim 만료·회수 정리. 60초마다와 재시작 때 후보를 읽고 expire_claim을
  // 제출한다. timer는 표를 쓰지 않는다(coding-agent/tickets#R13).
  const claimSweep = setInterval(
    () => runtime?.sweepTicketClaims(),
    ticketClaimSweepIntervalMs,
  );
  await runtime?.sweepTicketClaims();
  // approval 만료 정리. 기한에 도달한 대기를 expired로 확정한다. 같은 간격과 재시작 때 돈다.
  const approvalSweep = setInterval(
    () => runtime?.sweepApprovalExpiry(),
    APPROVAL_EXPIRY_SWEEP_INTERVAL_MS,
  );
  await runtime?.sweepApprovalExpiry();
  // 재시작 점검이 unknown으로 본 접수·실행 중 invocation을 미확인으로 확정한다. 한 번만 돈다.
  await runtime?.sweepInterruptedInvocations();
  stopPrune.run = () => {
    clearInterval(timer);
    clearInterval(claimSweep);
    clearInterval(approvalSweep);
    rootsWatch?.stop();
  };
  // 보호 입력의 값은 I/O worker로만 간다. 준비 증거(값 없음)는 writer가 ledger에 남긴다.
  const secretRelay = io
    ? createSecretInputRelay({
      send: async (payload) => {
        const sent = await io.send("platform/io", payload);
        if (!sent.ok) throw new Error("보호 입력을 넘기지 못했다");
      },
      sendBytes: async (channel, chunk) => {
        const sent = await io.sendBytes("platform/io", channel, chunk);
        if (!sent.ok) throw new Error("보호 입력을 넘기지 못했다");
      },
      sendAbort: async (channel) => {
        await io.sendAbort("platform/io", channel);
      },
      record: (preparation) => runtime!.recordSecretPreparation(preparation),
    })
    : undefined;
  secretInputRelay.current = secretRelay;
  const startedIo = io
    ? await startPlatformIo(
      io,
      root.path,
      epoch,
      server.port,
      {
        onMessage(message) {
          blobRelay?.callbacks.onMessage(message);
          secretRelay?.accept(message);
        },
        onFrame(frame) {
          blobRelay?.callbacks.onFrame(frame);
        },
        // I/O worker가 끝나면(crash·재기동) 답을 기다리던 준비·읽기·보호 입력을 기한까지 두지 않고 끝낸다.
        onEnd() {
          const message = "I/O worker가 끝나 요청이 끝나지 못했다";
          blobRelay?.failPending(message);
          secretRelay?.failPending(message);
        },
      },
    )
    : undefined;
  if (startedIo && !startedIo.ok) {
    await server.stop();
    await runtime.close();
    return startedIo;
  }
  // documents/worker. 관측 제출 credential이 hello에 싣는다. credential이 없으면(감독이
  // 없는 harness) 띄우지 않는다: 제출 없이 관측만 반복하는 worker는 겉보기 가용이 거짓이다.
  // 띄우지 못해도 core는 계속 선다. 통로가 묶이지 않아 documents 요청은 unavailable이다.
  if (io && documentsToken) {
    validateWiring.sendBytes = (channel, chunk) =>
      io.sendBytes("documents/worker", channel, chunk).then((sent) => sent.ok);
    const documentsHello = {
      type: "hello" as const,
      core_epoch: epoch,
      process_identity: epoch,
      kind: "documents/worker" as const,
      task: "documents",
      scope: { operations: [], targets: {} },
      credential: documentsToken,
      api_port: server.port,
    };
    // worker가 hello를 받을 때마다(처음 시작과 root 변경 뒤 재시작) 알린다.
    const announceHello = () =>
      options.onDocumentsHello?.({
        credential: documentsToken,
        api_port: server.port,
      });
    announceHello();
    // 자식의 blob 준비 요청(원문 → document_file blob)은 시작마다 새 handler가 받는다.
    // 자식이 멈추면(재시작·종료) 열린 준비는 unavailable로 닫는다(platform Q6).
    // 나머지 메시지의 worker_response는 통로가 요청 id로 맞춘다.
    let childBlob: ChildBlobPrepare | undefined;
    const newBlobHandler = () =>
      createChildBlobPrepare({
        kind: "documents/worker",
        gauge: blobBuffer,
        send: (message) =>
          io.send("documents/worker", message).then((sent) => sent.ok),
        prepareBlob: (call) =>
          blobRelay ? blobRelay.prepare(call) : Promise.resolve(err({
            code: "unavailable",
            message: "blob 준비 통로가 없다",
          })),
      });
    const freshCallbacks = () => {
      childBlob?.close();
      let handler = newBlobHandler();
      childBlob = handler;
      return {
        onMessage: (message: ChildMessage) => {
          if (!handler.onMessage(message)) documentsChannel.onMessage(message);
        },
        onFrame: (frame: Frame) => {
          handler.onFrame(frame);
          fileWindows.onFrame(frame);
        },
        // coordinator가 끝났다(crash·교체·정지). 보낸 요청은 답이 오지 않으니 기한까지 두지 않고 끝내고,
        // 열린 blob 준비는 닫는다. 감독이 같은 callbacks로 다시 띄우면 새 child는 새 handler가 받는다.
        // 새 coordinator는 관측 근거가 없다. 다음 확인이 전체를 다시 보낸다.
        onEnd: () => {
          documentsChannel.failPending(
            "documents worker가 끝나 요청이 끝나지 못했다",
          );
          handler.close();
          // 이미 다른 callbacks로 바뀐 옛 child의 끝은 지금 handler를 건드리지 않는다.
          if (childBlob === handler) {
            handler = newBlobHandler();
            childBlob = handler;
          }
          basisSync?.invalidate();
        },
        // 감독이 포기했다. 한도 안에서 backoff로 다시 띄운다.
        onGiveUp: (reason: string) => documentsRespawner.giveUp(reason),
      };
    };
    closeChildBlob = () => childBlob?.close();
    const trackingRoots = async (): Promise<Result<readonly string[]>> => {
      const read = await runtime!.readers.read(
        projectTrackingRoots,
        trackingReader,
        {},
      );
      if (!read.ok) return read;
      return ok(
        (read.value as { roots: { path: string }[] }).roots.map((entry) =>
          entry.path
        ),
      );
    };
    const initial = await trackingRoots();
    const active = initial.ok ? [...new Set(initial.value)].sort() : [];
    const spec = workerSpecs(root.path, active).find((entry) =>
      entry.kind === "documents/worker"
    );
    const bindDocumentsChannel = () =>
      documentsChannel.bind((payload) =>
        io.send("documents/worker", payload).then((sent) => sent.ok)
      );
    // 감독이 포기한 coordinator를 가장 최근에 띄우려 한 spec(root 집합)으로 다시 띄운다.
    let launchedSpec = spec;
    const documentsRespawner = createDocumentsRespawner({
      respawn: async () => {
        if (!launchedSpec) return false;
        announceHello();
        const restarted = await documentsChannel.replacing(() =>
          io.updateSpec(launchedSpec!, documentsHello, freshCallbacks())
        );
        if (restarted.ok) {
          // 처음 시작이 실패했다면 통로가 아직 묶이지 않았다.
          bindDocumentsChannel();
          basisSync?.invalidate();
          void basisSync?.check();
        }
        return restarted.ok;
      },
      onExhausted: (reason) =>
        console.error(
          `documents worker를 다시 띄우지 못해 unavailable로 둔다: ${reason}`,
        ),
    });
    respawnStop = () => documentsRespawner.stop();
    const started = spec
      ? await io.start(spec, documentsHello, freshCallbacks())
      : undefined;
    if (started?.ok) bindDocumentsChannel();
    // root가 바뀌면 documents worker만 새 권한으로 다시 띄운다(file-tracking#R3).
    // 시작 읽기가 실패했으면 known은 비어 있고 다음 확인이 맞춘다.
    rootsWatch = watchTrackingRoots({
      roots: trackingRoots,
      relaunch: (previous, next) =>
        connectDocumentsRelaunch(
          {
            updateSpec: async (updated) => {
              launchedSpec = updated;
              announceHello();
              // 바꾸는 동안 이미 보낸 요청은 옛 child와 함께 사라지므로 바로 끝내고, 새 요청은
              // 새 child가 뜨기를 기다린다. 이 처리가 없으면 그 요청은 기한까지 답이 없다.
              const restarted = await documentsChannel.replacing(() =>
                io.updateSpec(updated, documentsHello, freshCallbacks())
              );
              // 새 coordinator는 근거가 없다. 다음 확인이 전체를 다시 보낸다.
              if (restarted.ok) basisSync?.invalidate();
              return { ok: restarted.ok };
            },
          },
          root.path,
          previous,
          next,
        ),
      known: active,
      retryMs: DOCUMENTS_ROOTS_RETRY_MS,
    });
    basisSync = watchObservationBasis({
      read: (input) =>
        runtime!.readers.read(OBSERVATION_BASIS_ROUTE, basisReader, input),
      push: (chunk) =>
        documentsChannel.request(
          DOCUMENT_OPS.observationBasis,
          chunk,
          DOCUMENTS_BASIS_TIMEOUT_MS,
        ),
      retryMs: DOCUMENTS_BASIS_RETRY_MS,
    });
    // 시작 근거는 worker가 뜬 직후 바로 보낸다. 닿지 못하면 다음 확인이 다시 시도한다.
    void basisSync.check();
    searchSync = watchSearchIndex({
      events: runtime.events,
      context: DOCUMENTS_FEED_CONTEXT,
      request: (op, payload, timeoutMs) =>
        documentsChannel.request(op, payload, timeoutMs),
      versionOf: async (version): Promise<Result<SearchVersion | null>> => {
        const read = await runtime!.readers.read(
          SEARCH_VERSION_ROUTE,
          searchReader,
          { version },
        );
        if (!read.ok) return read;
        return ok(
          (read.value as { version: SearchVersion | null }).version,
        );
      },
      streamer: coordinatorStreamer,
      ledgerId: ledgerId.value,
      retryMs: DOCUMENTS_SEARCH_RETRY_MS,
    });
  }
  // problems/report-collector. 문제 보고 worker route(`/v1/problems/report` 등)를 받는 상시
  // worker다. 감독이 없는 harness와 problems를 등록하지 않은 조립은 띄우지 않는다. 띄우지
  // 못해도 core는 계속 선다: 그 route는 unavailable이다. 앱 위치 주장은 요청이 싣는다.
  const collectorSpec = reportCollectorSpec({ dataRoot: root.path });
  if (
    io && collectorSpec &&
    allRoutes.some((route) => route.name === COLLECTOR_ROUTES[0].name)
  ) {
    const issued = await productRegistry.issue({
      actor: "machine",
      // 준비 참조의 주체(child-blob-prepare 정책)와 Report의 원주체가 이 값과 같아야 등록된다.
      principal: "collector",
      scope: {
        operations: [...COLLECTOR_CREDENTIAL_OPERATIONS],
        targets: { task: "problems" },
      },
      conditions: { task: "problems", process: COLLECTOR_KIND },
    });
    const current = issued.ok
      ? productRegistry.revalidate({
        credential_ref: issued.value.credential_ref,
      })
      : issued;
    const recorded = issued.ok && current.ok
      ? await runtime.record(current.value)
      : current;
    if (issued.ok && recorded.ok) {
      // collector의 blob 준비 요청(보고 text·details·stack·log)은 core.prepareBlob으로 간다.
      const handler = createChildBlobPrepare({
        kind: COLLECTOR_KIND,
        gauge: blobBuffer,
        send: (message) =>
          io.send(COLLECTOR_KIND, message).then((sent) => sent.ok),
        prepareBlob: (call) =>
          blobRelay ? blobRelay.prepare(call) : Promise.resolve(err({
            code: "unavailable",
            message: "blob 준비 통로가 없다",
          })),
      });
      closeCollectorBlob = () => handler.close();
      const started = await io.start(
        collectorSpec,
        {
          type: "hello",
          core_epoch: epoch,
          process_identity: epoch,
          kind: COLLECTOR_KIND,
          task: "problems",
          scope: { operations: [], targets: {} },
          credential: issued.value.token,
          api_port: server.port,
        },
        {
          onMessage: (message) => {
            if (!handler.onMessage(message)) {
              collectorChannel.onMessage(message);
            }
          },
          onFrame: (frame) => handler.onFrame(frame),
        },
      );
      if (started.ok) {
        collectorChannel.bind((payload) =>
          io.send(COLLECTOR_KIND, payload).then((sent) => sent.ok)
        );
      }
    }
  }
  // problems/test-runner. 접수된 RequestTest를 정확히 한 번 시작해 실제 test 자식으로 돌리고 결과를 core command로
  // 남기는 상시 worker다. 접수 기록은 core가 주기로 읽어 요청 한 건씩 보낸다. 감독이 없는 harness와 problems를
  // 등록하지 않은 조립은 띄우지 않는다. 띄우지 못해도 core는 계속 선다: 접수된 요청은 기록에 남고 시작하지 않는다.
  const runnerSpec = testRunnerSpec({
    dataRoot: root.path,
    deno: Deno.execPath(),
    screenHost: screenTestHost(),
  });
  let testControl: TestControl | undefined;
  // runner process(같은 kind 하나)의 session이 `problems.work` 깨움도 받는지. 위 시작 ok 뒤 오른다.
  let startedProblemsWork = false;
  if (
    io && runnerSpec &&
    assembled.value.commands.some((command) =>
      command.route.name === observeTestRequest.name
    )
  ) {
    const handler = createChildBlobPrepare({
      kind: TEST_RUNNER_KIND,
      gauge: blobBuffer,
      send: (message) =>
        io.send(TEST_RUNNER_KIND, message).then((sent) => sent.ok),
      prepareBlob: (call) =>
        blobRelay ? blobRelay.prepare(call) : Promise.resolve(err({
          code: "unavailable",
          message: "blob 준비 통로가 없다",
        })),
      // 준비 참조의 주체는 지금 맡은 일의 runner 주체다(결과를 쓰는 자격의 주체와 같아야 등록된다).
      policies: new Map([[
        TEST_RUNNER_KIND,
        testRunnerBlobPolicy(() =>
          testControl?.blobPrincipal() ?? "problems-test-runner"
        ),
      ]]),
    });
    // 같은 process 안의 `problems.work` 반응기(problems#T19)가 쓰는 machine credential이다.
    // 요청별 runner credential은 요청 본문으로 가므로 hello credential과 겹치지 않는다.
    const workIssued = await productRegistry.issue({
      actor: "machine",
      principal: PROBLEMS_WORK_PRINCIPAL,
      scope: {
        operations: [...PROBLEMS_WORK_OPERATIONS],
        targets: { task: "problems" },
      },
      conditions: { task: "problems", process: TEST_RUNNER_KIND },
    });
    if (!workIssued.ok) {
      handler.close();
      return err(workIssued.error);
    }
    const workCurrent = productRegistry.revalidate({
      credential_ref: workIssued.value.credential_ref,
    });
    const workRecorded = workCurrent.ok
      ? await runtime.record(workCurrent.value)
      : workCurrent;
    if (!workRecorded.ok) {
      productRegistry.revoke(workIssued.value.credential_ref);
      handler.close();
      return workRecorded;
    }
    const started = await io.start(
      runnerSpec,
      {
        type: "hello",
        core_epoch: epoch,
        process_identity: epoch,
        kind: TEST_RUNNER_KIND,
        task: "problems",
        scope: { operations: [], targets: {} },
        // `problems.work` 반응기는 hello가 준 credential로 core loopback에 닿는다. RequestTest
        // runner service의 요별 credential은 요청 본문으로 온다(요청마다 발급해 감독 pipe로 넘긴다).
        credential: workIssued.value.token,
        api_port: server.port,
      },
      {
        onMessage: (message) => {
          if (!handler.onMessage(message)) runnerChannel.onMessage(message);
        },
        onFrame: (frame) => handler.onFrame(frame),
        onEnd: () => testControl?.runnerEnded(),
      },
    );
    if (started.ok) {
      startedProblemsWork = true;
      runnerChannel.bind((payload) =>
        io.send(TEST_RUNNER_KIND, payload).then((sent) => sent.ok)
      );
      testControl = startTestControl({
        ledgerPath,
        channel: runnerChannel,
        apiPort: server.port,
        // 요청마다 credential을 발급해 ledger에 기록한다. 쓴 뒤에는 폐기한다.
        issue: async (input) => {
          const issued = await productRegistry.issue(input);
          if (!issued.ok) return issued;
          const current = productRegistry.revalidate({
            credential_ref: issued.value.credential_ref,
          });
          const recorded = current.ok
            ? await runtime.record(current.value)
            : current;
          if (!recorded.ok) {
            productRegistry.revoke(issued.value.credential_ref);
            return recorded;
          }
          return ok({
            token: issued.value.token,
            revoke: () => {
              productRegistry.revoke(issued.value.credential_ref);
            },
          });
        },
      });
      closeTestRunner = () => {
        testControl?.stop();
        handler.close();
      };
      // 구독자(machine:problems-work-feed)의 자격 기록. token이 없는 core 내부 자격이라
      // HTTP로는 이 principal이 될 수 없고, reader가 이 ledger 기록으로 구독자의 자격을 본다.
      const feedCredential = await runtime.record(PROBLEMS_WORK_FEED_CONTEXT);
      if (!feedCredential.ok) {
        await runtime.close();
        return feedCredential;
      }
    } else {
      handler.close();
    }
  }
  // coding-agent/checker. 보고된 ticket의 조건을 machine actor로 판정하는 상시 worker다. 감독이
  // 없는 harness와 record_checks를 등록하지 않은 조립은 띄우지 않는다. 띄우지 못해도 core는
  // 계속 선다: 판정이 멈출 뿐 ticket은 reported로 남는다(없는 검사를 성공으로 꾸미지 않는다).
  const checkerSpec = ticketCheckerSpec({ dataRoot: root.path });
  let ticketCheckFeed: InternalSubscription | undefined;
  if (
    io && checkerSpec &&
    allRoutes.some((route) => route.name === TICKET_CHECKER_OPERATIONS[1])
  ) {
    const issued = await productRegistry.issue({
      actor: "machine",
      principal: TICKET_CHECKER_PRINCIPAL,
      scope: {
        operations: [...TICKET_CHECKER_OPERATIONS],
        targets: { task: "coding-agent" },
      },
      conditions: { task: "coding-agent", process: TICKET_CHECKER_KIND },
    });
    const current = issued.ok
      ? productRegistry.revalidate({
        credential_ref: issued.value.credential_ref,
      })
      : issued;
    const recorded = issued.ok && current.ok
      ? await runtime.record(current.value)
      : current;
    const feedRecorded = await runtime.record(TICKET_CHECK_FEED_CONTEXT);
    if (issued.ok && recorded.ok && feedRecorded.ok) {
      const started = await io.start(
        checkerSpec,
        {
          type: "hello",
          core_epoch: epoch,
          process_identity: epoch,
          kind: TICKET_CHECKER_KIND,
          task: "coding-agent",
          scope: { operations: [], targets: {} },
          credential: issued.value.token,
          api_port: server.port,
        },
        { onMessage: (message) => checkerChannel.onMessage(message) },
      );
      if (started.ok) {
        checkerChannel.bind((payload) =>
          io.send(TICKET_CHECKER_KIND, payload).then((sent) => sent.ok)
        );
        // VerificationRecorded·ReleaseActivated·ReleaseSuperseded·TicketCompletionReported가 오면
        // worker가 정본을 다시 읽는다. 구독이 열릴 때도 한 번 깨워 닫혀 있던 동안을 따라잡는다.
        ticketCheckFeed = startTicketCheckFeed({
          runtime,
          wake: () => checkerChannel.request(TICKET_CHECK_OP, {}, 30_000),
        });
      }
    }
  }
  // problems/test-runner. `problems.work` 반응기가 도는 상시 worker다(problems#T19). ticket event를
  // 읽어 문제 work·status를 ReconcileProblemWork로 맞춘다. 감독이 없는 harness와 그 command를 등록하지
  // 않은 조립은 띄우지 않는다. 띄우지 못해도 core는 계속 선다: 문제 진행 표시가 갱신되지 않을 뿐
  // ticket 정본은 그대로다(없는 반응을 성공으로 꾸미지 않는다). runner process는 위의 RequestTest
  // runner 감독(같은 kind)이 뜨고, 그 process의 session(runner-service.ts)이 `problems.work` 깨움도
  // 받는다. 반응기 credential은 위 시작 hello에 심고, 깨움 요청은 같은 runnerChannel로 간다.
  let problemsWorkFeed: InternalSubscription | undefined;
  let problemsClosingFeed: InternalSubscription | undefined;
  if (
    io && runnerSpec &&
    allRoutes.some((route) => route.name === PROBLEMS_WORK_OPERATIONS[2]) &&
    startedProblemsWork
  ) {
    // ticket event가 오면 worker가 cursor 뒤를 따라잡는다. 구독이 열릴 때와 주기마다도 깨워
    // 재시작·worker 교체 동안의 변화를 따라잡는다.
    problemsWorkFeed = startProblemsWorkFeed({
      runtime,
      ledgerPath,
      wake: (cursor) =>
        runnerChannel.request(PROBLEMS_WORK_OP, { cursor }, 30_000),
    });
    // 같은 runner 안의 `problems.closing` 반응기는 worker의 machine credential(위 발급)로
    // cursor 뒤 closing event를 따라잡는다(problems#T20). 조건 판정은 command가 정본에서
    // 다시 한다. 이 구독자는 깨움 신호만 낸다.
    problemsClosingFeed = startProblemsClosingFeed({
      runtime,
      ledgerPath,
      wake: (cursor) =>
        runnerChannel.request(PROBLEMS_CLOSING_OP, { cursor }, 30_000),
    });
  }
  // coding-agent/worker. 수리 자료(`/v1/repair_context/*`)를 요청자 credential로 조립하는 상시 worker다.
  // 자기 credential이 없고(hello의 credential은 자리만 채운다) 요청마다 core가 요청자의 것을 싣는다.
  // 알려진 값 pipe의 `redact_request`는 여기서 답한다. 띄우지 못해도 core는 계속 서고 그 route만
  // unavailable이다.
  const repairSpec = repairWorkerSpec();
  if (
    io && repairSpec &&
    allRoutes.some((route) =>
      route.resource === "repair_context" ||
      route.resource === "coding_agent_sessions"
    )
  ) {
    const started = await io.start(
      repairSpec,
      {
        type: "hello",
        core_epoch: epoch,
        process_identity: epoch,
        kind: REPAIR_WORKER_KIND,
        task: "repair-context",
        scope: { operations: [], targets: {} },
        credential: "none",
        api_port: server.port,
      },
      {
        onMessage: (message) => {
          const answer = answerRedactRequest(message, runtime!.knownSecrets);
          if (answer) void io.send(REPAIR_WORKER_KIND, answer);
          else repairChannel.onMessage(message);
        },
      },
    );
    if (started.ok) {
      repairChannel.bind((payload) =>
        io.send(REPAIR_WORKER_KIND, payload).then((sent) => sent.ok)
      );
    }
  }
  // apps/revert. 확인한 revert의 앱 단계를 호출자의 credential로 실제로 부르는 상시 worker다
  // (lophn-agent#T48). 감독이 없는 harness는 띄우지 않는다. 띄우지 못해도 core는 계속 선다:
  // 사람의 run_apps 이어 실행이 failure로 닿지 않는다(접수는 applying으로 남는다).
  if (io) {
    const spec = revertWorkerSpec({
      socketRoot: appSocketRoot(appsRuntimeDir),
    });
    const started = await io.start(
      spec,
      {
        type: "hello",
        core_epoch: epoch,
        process_identity: epoch,
        kind: REVERT_WORKER_KIND,
        task: "apps",
        scope: { operations: [], targets: {} },
        credential: "none",
        api_port: server.port,
      },
      { onMessage: (message) => revertChannel.onMessage(message) },
    );
    if (started.ok) {
      revertChannel.bind((payload) =>
        io.send(REVERT_WORKER_KIND, payload).then((sent) => sent.ok)
      );
    }
  }
  // core 안 notifications 구독자. 계기 event를 notification으로 바꾸고 cursor를 올린다.
  const notifications = startNotifications({
    runtime,
    ledgerPath,
  });
  // core 안 assignments 반응 구독자. AppCreated마다 거두지 않은 AE assignment를 만들고 AppArchived면
  // 멈추며 cursor를 올린다(lophn-agent/assignments#R1). lophn-agent 팀이 조립에 없으면 반응할
  // command가 없으므로 열지 않는다.
  const assignmentReactions =
    assembled.value.commands.some((c) =>
        c.route.name === createAppEngineerAssignment.name
      )
      ? startAssignmentReactions({ runtime, ledgerPath })
      : undefined;
  // core 안 documents 구독자. documents event가 오면 root 집합과 관측 근거를 맞춘다. documents
  // worker가 없는 core에서도 구독은 열려 있고, 맞출 대상이 없으면 아무것도 하지 않는다.
  const documentsFeed = startDocumentsFeed({
    runtime,
    roots: () => rootsWatch,
    basis: () => basisSync,
    search: () => searchSync,
  });
  // 내장 lophn·Context Engineer assignment 준비. I/O 감독이 없는 기동은 prompt blob을
  // 준비할 수 없어 건너뛴다(lophn-agent/assignments#R2). 이미 있으면 아무것도 보내지 않는다.
  // 준비하지 못해도 core는 선다: 실패는 diagnostics 기록만 남기고(lophn이 아직 준비되지
  // 않았다는 대화 쪽 표시는 그대로), 대기 뒤 한 번 다시 시도하며 다음 기동도 다시 한다.
  const bootstrapState: {
    timer?: ReturnType<typeof setTimeout>;
    inflight?: Promise<boolean>;
    closed: boolean;
  } = { closed: false };
  const runBootstrap = (): Promise<boolean> => {
    const run = (async () => {
      let result: Result<void>;
      try {
        result = await bootstrapBuiltinAssignments({
          commands: new Set(assembled.value.commands.map((c) => c.route.name)),
          writer: runtime!.writer,
          record: (context) => runtime!.record(context),
          read: (route, context, input) =>
            runtime!.readers.read(route, context as RequestContext, input),
          asset: options.roleAsset ?? readRoleAsset,
          prepare: blobRelay ? (call) => blobRelay.prepare(call) : undefined,
          ids: createIdSource({ clock, random }),
        });
      } catch {
        result = err({ code: "internal", message: "bootstrap failed" });
      }
      if (!result.ok) {
        await noteBootstrapFailure(root.path, clock.now(), result.error.code);
      }
      return result.ok;
    })();
    bootstrapState.inflight = run;
    return run;
  };
  if (!await runBootstrap()) {
    bootstrapState.timer = setTimeout(() => {
      bootstrapState.timer = undefined;
      if (!bootstrapState.closed) void runBootstrap();
    }, options.bootstrapRetryMs ?? BOOTSTRAP_RETRY_MS);
  }
  stopPrune.bootstrap = async () => {
    bootstrapState.closed = true;
    if (bootstrapState.timer !== undefined) {
      clearTimeout(bootstrapState.timer);
    }
    await bootstrapState.inflight;
  };
  // apps/supervisor. 앱 프로세스 감독이다. machine credential과 서명 검증 공개 key를 hello에
  // 싣고, 자식 앱이 쓸 app credential은 supervisor의 요청마다 발급한다. 띄우지 못해도 core는
  // 계속 선다: connect와 runtime은 supervisor 관측이 없는 상태(unavailable)로 답한다.
  if (appsSupervision) {
    // collector는 요청 credential을 ledger 행으로 다시 읽는다. 메모리 발급만으로는
    // 선언 보고가 unauthorized가 된다.
    const childIssuer = appCredentialIssuer(productRegistry);
    appsControl.useIssuer({
      ...childIssuer,
      async request(message) {
        const issued = await childIssuer.request(message);
        if (!issued.ok) return issued;
        const current = productRegistry.revalidate({
          credential_ref: issued.value.credential_ref,
        });
        if (!current.ok) {
          childIssuer.end(issued.value.credential_ref);
          return current;
        }
        const recorded = await runtime.record(current.value);
        if (!recorded.ok) {
          childIssuer.end(issued.value.credential_ref);
          return err(recorded.error);
        }
        return issued;
      },
    });
    const issued = await productRegistry.issue({
      actor: "machine",
      principal: "machine:apps-supervisor",
      scope: {
        operations: [...SUPERVISOR_CREDENTIAL_OPERATIONS],
        targets: { task: "apps" },
      },
      conditions: { task: "apps", process: APPS_SUPERVISOR_KIND },
    });
    const current = issued.ok
      ? productRegistry.revalidate({
        credential_ref: issued.value.credential_ref,
      })
      : issued;
    const recorded = issued.ok && current.ok
      ? await runtime.record(current.value)
      : current;
    if (issued.ok && current.ok && recorded.ok) {
      const started = await appsSupervision.start(
        appSupervisorSpec({
          dataRoot: root.path,
          apiPort: server.port,
          runtimeDir: appsRuntimeDir,
        }),
        {
          type: "hello",
          core_epoch: epoch,
          process_identity: epoch,
          kind: APPS_SUPERVISOR_KIND,
          task: "apps",
          // 서명 검증 공개 key는 secret이 아니다. 감독이 supervisor를 다시 띄워도 hello가
          // 같은 key를 다시 준다.
          scope: {
            operations: [],
            targets: { task: "apps", verify_key: appsControl.verifyKey },
          },
          credential: issued.value.token,
          api_port: server.port,
        },
        {
          onMessage: (message) => appsControl.onSupervisorMessage(message),
          // supervisor child가 끝나면 답을 기다리던 질의를 기한(5초·재시작 30초)까지 두지 않고 끝낸다.
          onEnd: () =>
            appsControl.channel.failPending(
              "app supervisor가 끝나 요청이 끝나지 못했다",
            ),
        },
      );
      if (started.ok) {
        appsControl.channel.bind((payload) =>
          appsSupervision.send(APPS_SUPERVISOR_KIND, payload).then((sent) =>
            sent.ok
          )
        );
      }
    }
  }
  appsControl.start();
  // 고아 정리와 active connection 색인 복원은 기동을 기다리게 하지 않는다. 실패는 진단 log뿐이다.
  const codingReady = coding
    ? coding.start(productRegistry, (context) => runtime!.record(context))
      .catch(() => {})
    : undefined;
  ready = true;
  // agent runtime child. API가 열린 뒤에 띄워 hello 직후의 읽기가 닿는다. 띄우지 못해도 core는
  // 계속 선다: agent는 돌지 않고 사람의 요청은 접수된 채 남는다.
  if (options.agentRuntime && io) {
    // provider API key를 읽는 keychain adapter. 요청이 올 때 처음 한 번 만든다. 시험은 fake를 준다.
    let agentKeychain: KeychainAdapter | undefined;
    const agentSecretKeychain = (): KeychainAdapter =>
      agentKeychain ??= options.secretKeychain ?? options.codingKeychain ??
        productKeychain();
    const started = await startAgentRuntimeChild({
      io,
      registry: productRegistry,
      record: (context) => runtime!.record(context),
      epoch,
      dataRoot: root.path,
      apiPort: server.port,
      socketRoot: appSocketRoot(appsRuntimeDir),
      gauge: blobBuffer,
      prepareBlob: (call) =>
        blobRelay ? blobRelay.prepare(call) : Promise.resolve(err({
          code: "unavailable",
          message: "blob 준비 통로가 없다",
        })),
      read: (route, context, input) =>
        runtime!.readers.read(route, context, input),
      known: () => runtime?.knownSecrets,
      secrets: createAgentRuntimeSecrets({
        ledgerPath,
        keychain: agentSecretKeychain,
        known: () => runtime?.knownSecrets,
        process: AGENT_RUNTIME_KIND,
        task: AGENT_RUNTIME_TASK,
      }),
      readMcpServers: () => mcpServerSnapshot(ledgerPath),
      readProviders: async (context) => {
        const hosts = new Set<string>();
        let cursor: string | undefined;
        for (;;) {
          const read = await runtime!.readers.read(
            providerList,
            context,
            cursor === undefined ? {} : { cursor },
          );
          if (!read.ok) return read;
          const page = read.value as {
            providers: { endpoint: string; enabled: boolean }[];
            next_cursor?: string | null;
          };
          for (const provider of page.providers) {
            const host = provider.enabled
              ? providerHost(provider.endpoint)
              : undefined;
            if (host !== undefined) hosts.add(host);
          }
          if (page.next_cursor === null || page.next_cursor === undefined) {
            return ok([...hosts].sort());
          }
          cursor = page.next_cursor;
        }
      },
      readSkillRoots: async (context) => {
        const read = await runtime!.readers.read(settingsGet, context, {
          keys: [skillFoldersSetting.key],
        });
        if (!read.ok) return read;
        const setting = (read.value as {
          settings: { key: string; value: unknown }[];
        }).settings.find((each) => each.key === skillFoldersSetting.key);
        const shaped = skillFoldersSetting.value_type.safeParse(
          setting?.value ?? [],
        );
        return ok(shaped.success ? shaped.data : []);
      },
      ...(typeof options.agentRuntime === "object" &&
          options.agentRuntime.pollMs !== undefined
        ? { pollMs: options.agentRuntime.pollMs }
        : {}),
    });
    if (started.ok) agentRuntime = started.value;
    else console.error(`agent runtime: ${started.error.message}`);
  }
  // 부모 pipe는 호출자가 명시할 때만 연다. 터미널에서 직접 띄우면 종료는 신호가 담당한다.
  const parent = options.parent;
  const hello = parent
    ? greet(
      parent,
      registry,
      runtime,
      server.port,
      epoch,
      (scope) => productRegistry.issue(scope),
      allRoutes,
      eventNames,
    )
    : Promise.resolve(ok(undefined));
  let stopped = false;
  let normallyStopped = false;
  let shutdownRun: Promise<void> | undefined;
  // restore가 정지 단계에서 할 일과 그 결과. 한 번에 하나만 받는다.
  let restoring = false;
  let pendingRestore:
    | { created_at: string; expectedCurrentSeq: string }
    | undefined;
  let restoreResult: Result<RestoreOutcome> | undefined;
  const core: Core = {
    port: server.port,
    epoch,
    dataRoot: root.path,
    done: Promise.resolve(),
    ...(coding
      ? { codingCredentials: coding, codingCredentialsReady: codingReady }
      : {}),
    record: (context) => runtime!.record(context),
    instructionFiles,
    sweepTicketClaims: () => runtime!.sweepTicketClaims(),
    sweepTicketChecks: () =>
      checkerChannel.request(TICKET_CHECK_OP, {}, 30_000),
    sweepProblemsWork: () => {
      const cursor = problemsWorkCursor(ledgerPath);
      return cursor.ok
        ? runnerChannel.request(
          PROBLEMS_WORK_OP,
          { cursor: cursor.value },
          30_000,
        )
        : Promise.resolve(cursor);
    },
    sweepProblemsClosing: () => {
      const cursor = problemsClosingCursor(ledgerPath);
      return cursor.ok
        ? runnerChannel.request(
          PROBLEMS_CLOSING_OP,
          { cursor: cursor.value },
          30_000,
        )
        : Promise.resolve(cursor);
    },
    sweepApprovalExpiry: () => runtime!.sweepApprovalExpiry(),
    reconcileApp: (desired) => appsControl.reconcile(desired),
    sweepInterruptedInvocations: () => runtime!.sweepInterruptedInvocations(),
    ...(options.testCredentials
      ? {
        documentsFeed,
        eventSessions: () => runtime!.trackedSessions(),
        appsControl,
      }
      : {}),
    blobBuffer,
    childBlobPrepare: (kind, send) =>
      createChildBlobPrepare({
        kind,
        send,
        gauge: blobBuffer,
        prepareBlob: (call) => core.prepareBlob(call),
      }),
    prepareBlob: (call) =>
      blobRelay ? blobRelay.prepare(call) : Promise.resolve(err({
        code: "unavailable",
        message: "blob 준비 통로가 없다",
      })),
    async restorePlan(createdAt) {
      if (stopped || !ready) {
        return err({
          code: "unavailable",
          message: "core가 아직 준비되지 않았다",
        });
      }
      const planned = await planRestore(
        root.path,
        ledgerPath,
        createdAt,
        schemaSteps.length,
      );
      if (!planned.ok) return planned;
      return ok({
        plan: planned.value,
        binding: await restoreBinding(planned.value),
      });
    },
    restoreStopped: () => pendingRestore !== undefined,
    async restore(request) {
      if (stopped || restoring) {
        return err({ code: "conflict", message: "이미 멈추는 중이다" });
      }
      if (!ready) {
        return err({
          code: "unavailable",
          message: "core가 아직 준비되지 않았다",
        });
      }
      restoring = true;
      // 묶음이 복원 가능한지와 잃을 범위는 정지 전에 본다. 사람이 본 범위가 바로 이 값이다.
      const planned = await planRestore(
        root.path,
        ledgerPath,
        request.created_at,
        schemaSteps.length,
      );
      if (!planned.ok) {
        restoring = false;
        return planned;
      }
      const binding = await restoreBinding(planned.value);
      // 확인은 writer의 registry가 대상·내용·결정을 맞춰 보고 한 번에 소비한다. 맞지 않으면
      // 아무것도 멈추지 않는다.
      const used = await runtime!.confirmation({
        action: "consume",
        request: {
          ref: request.confirmation,
          decision: RESTORE_DECISION,
          binding,
        },
      });
      if (!used.ok) {
        restoring = false;
        return used;
      }
      pendingRestore = {
        created_at: request.created_at,
        expectedCurrentSeq: planned.value.current_through_seq,
      };
      await core.shutdown();
      return restoreResult ?? err({
        code: "unavailable",
        message: "복원을 시작하지 못했다",
      });
    },
    updateNotice(installedVersion, candidate) {
      return updateNotice({
        installedVersion,
        installedSchema: schemaSteps.length,
        os: Deno.build.os,
        candidate,
      });
    },
    async stopForUpdate() {
      try {
        await core.shutdown();
      } catch {
        return err({
          code: "unavailable",
          message: "정상 정지를 확인하지 못해 설치 파일 교체로 넘어갈 수 없다",
        });
      }
      return normallyStopped
        ? ok(undefined)
        : err({ code: "unavailable", message: "정상 정지가 미확인이다" });
    },
    shutdown() {
      // 같은 시각의 두 종료 요청도 실제 종료가 끝날 때까지 같은 barrier를 기다린다.
      return shutdownRun ??= (async () => {
        if (stopped) return;
        stopped = true;
        // 종료 순서(architecture 7.5): 새 command·prepare 입장 닫기 → 입장한
        // 짧은 command 확정 또는 실패 → child 정상 정지 → writer 닫기.
        // 정지 유지보수(T44)는 이 세 조건이 실제로 끝난 뒤에만 돈다. 앞 단계가
        // 예외를 던져도 metadata 정리와 lock 해제는 그대로 실행한다.
        const stoppedAt: {
          preparationsBlocked: boolean;
          commandsBlocked: boolean;
          writerStopped: boolean;
        } = {
          preparationsBlocked: false,
          commandsBlocked: false,
          writerStopped: false,
        };
        try {
          // 새 입장을 먼저 닫는다. 이미 입장한 command는 writer가 확정 또는 실패로 마친다.
          ready = false;
          documentsFeed.stop();
          ticketCheckFeed?.stop();
          problemsWorkFeed?.stop();
          problemsClosingFeed?.stop();
          // 진행 중인 notification 생성은 writer가 닫히기 전에 끝난다.
          await notifications.stop();
          // 진행 중인 assignment 반응도 writer가 닫히기 전에 끝난다.
          await assignmentReactions?.stop();
          rootsWatch?.stop();
          respawnStop?.();
          agentRuntime?.stop();
          basisSync?.stop();
          searchSync?.stop();
          closeChildBlob?.();
          closeCollectorBlob?.();
          closeTestRunner?.();
          // main 연결이 끊기면 그 main의 relay 값을 모두 disconnected로 바꾼다(T57).
          runtime?.memory.disconnect();
          // server.stop은 받은 요청이 끝나기를 기다린 뒤 listen을 닫는다. 그 뒤에야
          // 새 command 입장이 실제로 닫힌 것이다.
          await server.stop();
          if (options.failShutdown) await options.failShutdown();
          stoppedAt.commandsBlocked = ready === false;
          // 앱 supervisor가 먼저 앱 자식을 정지한다. 그 뒤 질의 통로를 닫는다.
          appsControl.stop();
          const appsStopped = appsSupervision
            ? await appsSupervision.stopAll()
            : true;
          // stop 요청과 실제 정지 확인은 다르다. unconfirmed이면 update barrier와
          // 정지 유지보수는 fail-closed로 남긴다(P11).
          const ioStopped = io ? await io.stopAll() : true;
          stoppedAt.preparationsBlocked = appsStopped && ioStopped;
          stopPrune.run?.();
          await stopPrune.bootstrap?.();
          // writer Worker와 reader 연결을 닫는다. close가 돌아온 뒤에야 writer가 멈춘 것이다.
          await runtime?.close();
          stoppedAt.writerStopped = true;
          // 세 조건이 모두 관측될 때만 유지보수를 부른다. 파일 작업과 blob_refs
          // 읽기는 core graph 밖 프로세스의 몫이다(responsiveness#R1). 관측을
          // 못 하면 건너뛰고(fail-closed), 시간 제한을 넘기면 그 프로세스만
          // 끝내고 종료를 계속한다. 실패는 diagnostics 로그만 남긴다.
          if (pendingRestore !== undefined) {
            // restore는 같은 정지 조건 위에서만 돈다. 이번 종료에는 blob GC를 하지 않는다.
            restoreResult = await runStoppedRestore({
              dataRoot: root.path,
              ledgerPath,
              request: pendingRestore,
              conditions: stoppedAt,
              supportedSchema: schemaSteps.length,
              nowIso: clock.now(),
              timeoutMs: options.restoreTimeoutMs,
            });
          } else if (
            stoppedAt.preparationsBlocked && stoppedAt.commandsBlocked &&
            stoppedAt.writerStopped
          ) {
            await runStoppedMaintenance({
              dataRoot: root.path,
              ledgerPath,
              conditions: stoppedAt,
              fields: retentionRules(assembled.value.blobFields),
              nowMs: clock.nowMs(),
              timeoutMs: options.maintenanceTimeoutMs,
              run: options.maintenance,
            });
          }
        } finally {
          try {
            await removeRunMetadata(root.run);
          } finally {
            await lock.release();
          }
        }
        normallyStopped = stoppedAt.preparationsBlocked &&
          stoppedAt.commandsBlocked && stoppedAt.writerStopped;
      })();
    },
  };
  const greeted = await hello;
  if (!greeted.ok) {
    await core.shutdown();
    return greeted;
  }
  core.done = parent
    ? watchParent(parent, () => core.shutdown(), {
      confirmation: (body) => runtime!.confirmation(body),
      reply: (message) => writeParent(parent, message),
      restore: {
        plan: (createdAt) => core.restorePlan(createdAt),
        run: (request) => core.restore(request),
        stopped: () => core.restoreStopped(),
      },
    }, shellViewLog(root.path))
    : Promise.resolve();
  const accepting = registry as CredentialRegistry & {
    acceptTestCredential?(
      context: AuthenticatedContext,
      token: string,
    ): Promise<Result<void>>;
  };
  if (options.testCredentials && runtime) {
    const noting = runtime;
    core.notePrepared = (prepared, nowMs) =>
      noting.notePrepared(prepared, nowMs);
    core.confirmation = (body) => noting.confirmation(body);
  }
  if (accepting.acceptTestCredential) {
    core.acceptTestCredential = (context, token) =>
      accepting.acceptTestCredential!(context, token);
  }
  return ok(core);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

function hex(random: RandomSource, bytes: number): string {
  const buffer = new Uint8Array(bytes);
  random.fill(buffer);
  return [...buffer].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function seedOf(random: RandomSource): number {
  const bytes = new Uint8Array(4);
  random.fill(bytes);
  return bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
}

// 정지 유지보수 프로세스(platform/blob-store#R8, R9, R10, T44). 파일 작업과
// ledger 읽기는 core graph 밖이다(responsiveness#R1). 세 정지 조건은 종료
// 순서가 실제로 끝난 뒤의 관측값이라 상수 true를 넘기지 않는다. 프로세스가
// 실패하거나 blob_refs를 읽지 못하면 아무것도 지우지 않고(fail-closed), 종료는
// 그대로 끝난다. 실패는 diagnostics 로그만 남긴다.
// 문서에 종료 전체의 시간 예산은 없다. 신뢰 child 정상 정지는 5초지만 유지보수는
// 파일 삭제를 포함하므로 그보다 길게, 디스크가 멈춰도 종료가 끝나도록 30초로 둔다.
const MAINTENANCE_TIMEOUT_MS = 30_000;

async function runStoppedMaintenance(input: {
  dataRoot: string;
  ledgerPath: string;
  conditions: {
    preparationsBlocked: boolean;
    commandsBlocked: boolean;
    writerStopped: boolean;
  };
  fields: ReturnType<typeof retentionRules>;
  nowMs: number;
  timeoutMs?: number;
  // 테스트가 프로세스를 대신한다. 제품 기동은 항상 프로세스를 띄운다.
  run?: () => Promise<void>;
}): Promise<void> {
  const signal = AbortSignal.timeout(input.timeoutMs ?? MAINTENANCE_TIMEOUT_MS);
  if (input.run) {
    try {
      // 제품 경로는 Deno.Command의 signal이 프로세스를 죽인다. 테스트가 주입한
      // 러너는 signal을 모르므로 여기서 같은 시간 제한과 경주한다.
      await Promise.race([
        input.run(),
        new Promise<never>((_resolve, reject) => {
          const fail = () => reject(new Error("maintenance_gc timeout"));
          if (signal.aborted) fail();
          else signal.addEventListener("abort", fail, { once: true });
        }),
      ]);
    } catch {
      await noteMaintenanceFailure(input.dataRoot, signal.aborted);
    }
    return;
  }
  const entry =
    new URL("../worker/platform/maintenance-entry.ts", import.meta.url)
      .pathname;
  let outcome: Deno.CommandOutput;
  try {
    outcome = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        `--allow-read=${input.dataRoot},${repoRoot()},${denoDir()}`,
        `--allow-write=${input.dataRoot}`,
        "--allow-env=LOPHN_HOME,LOPHN_MAINTENANCE,HOME,PATH",
        "--no-prompt",
        entry,
      ],
      stdin: "null",
      stdout: "null",
      stderr: "piped",
      clearEnv: true,
      signal,
      env: {
        ...(Deno.env.get("HOME") ? { HOME: Deno.env.get("HOME")! } : {}),
        ...(Deno.env.get("PATH") ? { PATH: Deno.env.get("PATH")! } : {}),
        LOPHN_HOME: input.dataRoot,
        LOPHN_MAINTENANCE: JSON.stringify({
          ledger: input.ledgerPath,
          conditions: input.conditions,
          fields: input.fields,
          nowMs: input.nowMs,
        }),
      },
    }).output();
  } catch {
    // signal이 시간을 넘기면 Deno가 그 프로세스만 죽이고 output()이 거절된다.
    await noteMaintenanceFailure(input.dataRoot, signal.aborted);
    return;
  }
  if (!outcome.success) await noteMaintenanceFailure(input.dataRoot, false);
}

// restore 프로세스 입구(apps/worker/platform/restore-entry.ts)를 띄워 정지한 data root를
// 복원한다. 파일 복사·hash·검증은 core graph 밖 프로세스의 몫이다(responsiveness#R1).
// 어떤 실패도 현재 자료를 바꾸지 않은 채 오류로 돌아온다.
const RESTORE_TIMEOUT_MS = 10 * 60_000;

async function runStoppedRestore(input: {
  dataRoot: string;
  ledgerPath: string;
  request: { created_at: string; expectedCurrentSeq: string };
  conditions: {
    preparationsBlocked: boolean;
    commandsBlocked: boolean;
    writerStopped: boolean;
  };
  supportedSchema: number;
  nowIso: string;
  timeoutMs?: number;
}): Promise<Result<RestoreOutcome>> {
  const { preparationsBlocked, commandsBlocked, writerStopped } =
    input.conditions;
  if (!(preparationsBlocked && commandsBlocked && writerStopped)) {
    return err({
      code: "unavailable",
      message: "정지를 확인하지 못해 복원하지 않았다",
    });
  }
  const stamp = backupStamp(input.nowIso);
  if (!stamp.ok) return stamp;
  const entry = new URL("../worker/platform/restore-entry.ts", import.meta.url)
    .pathname;
  let outcome: Deno.CommandOutput;
  try {
    outcome = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        `--allow-read=${input.dataRoot},${repoRoot()},${denoDir()}`,
        `--allow-write=${input.dataRoot}`,
        "--allow-env=LOPHN_HOME,LOPHN_RESTORE,HOME,PATH",
        "--no-prompt",
        entry,
      ],
      stdin: "null",
      stdout: "piped",
      stderr: "null",
      clearEnv: true,
      signal: AbortSignal.timeout(input.timeoutMs ?? RESTORE_TIMEOUT_MS),
      env: {
        ...(Deno.env.get("HOME") ? { HOME: Deno.env.get("HOME")! } : {}),
        ...(Deno.env.get("PATH") ? { PATH: Deno.env.get("PATH")! } : {}),
        LOPHN_HOME: input.dataRoot,
        LOPHN_RESTORE: JSON.stringify({
          ledger: input.ledgerPath,
          createdAt: input.request.created_at,
          expectedCurrentSeq: input.request.expectedCurrentSeq,
          stamp: stamp.value,
          supportedSchema: input.supportedSchema,
          conditions: input.conditions,
          now: input.nowIso,
        }),
      },
    }).output();
  } catch {
    return err({
      code: "unavailable",
      message:
        "복원 프로세스가 끝나지 않았다. 현재 자료는 확인 전까지 믿지 않는다",
    });
  }
  const text = new TextDecoder().decode(outcome.stdout).trim();
  try {
    const reply = JSON.parse(text.slice(text.lastIndexOf("\n") + 1)) as {
      ok?: boolean;
      value?: RestoreOutcome;
      error?: { code?: string; message?: string };
    };
    if (reply.ok === true && reply.value !== undefined) {
      return ok(reply.value);
    }
    return err({
      code: reply.error?.code === "conflict" ? "conflict" : "unavailable",
      message: reply.error?.message ?? "복원하지 못했다",
    });
  } catch {
    return err({ code: "unavailable", message: "복원 결과를 읽지 못했다" });
  }
}

// 유지보수 실패의 diagnostics 기록. 종료를 막지 않으므로 기록 실패도 삼킨다.
// 원문·경로·hash는 넣지 않고 분류만 남긴다(diagnostics#R5).
async function noteMaintenanceFailure(
  dataRoot: string,
  timedOut = false,
): Promise<void> {
  try {
    const directory = `${dataRoot}/logs`;
    try {
      await Deno.mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    const record = {
      at: new Date().toISOString(),
      component: "platform/core",
      kind: "log",
      code: "lophn_internal",
      error_type: "maintenance_gc",
      location: "apps/core/core.ts",
      message: timedOut
        ? "maintenance_gc timeout"
        : "Stopped maintenance did not run.",
    };
    await Deno.writeTextFile(
      `${directory}/maintenance.jsonl`,
      JSON.stringify(record) + "\n",
      { append: true },
    );
  } catch {
    // 기록하지 못해도 종료는 그대로 끝난다.
  }
}

// 문서 worker route를 서빙하는 reader 등록은 팀 module 목록과 무관하게 붙는다.
// approvals·notifications 등록 파일은 항상 붙는다. writer·reader Worker가 같은 module을 다시 import한다.
function withPlatformModule(modules: readonly string[]): string[] {
  const platform = new URL("./platform.ts", import.meta.url).href;
  return modules.includes(platform) ? [...modules] : [...modules, platform];
}

function withDocumentsReader(modules: readonly string[]): string[] {
  const reader = new URL("./documents-reader.ts", import.meta.url).href;
  return modules.includes(reader) ? [...modules] : [...modules, reader];
}

// 확인은 documents 구독자의 event가 깨운다(documents-feed.ts). 읽기·재시작·보내기가 실패했을
// 때만 이 대기 뒤에 다시 확인한다.
const DOCUMENTS_ROOTS_RETRY_MS = 2_000;
const DOCUMENTS_BASIS_RETRY_MS = 1_000;
const DOCUMENTS_BASIS_TIMEOUT_MS = 15_000;
const DOCUMENTS_SEARCH_RETRY_MS = 1_000;

// 관측 근거 읽기의 자격. core가 reader에 넘기는 context라 발급 자격이 아니다.
const basisReader: RequestContext = {
  principal: "machine:documents-basis",
  actor: "machine",
  scope: { operations: [OBSERVATION_BASIS_ROUTE.name], targets: {} },
  conditions: {},
  credential_ref: "machine:documents-basis",
};

// search consumer가 저장 판 행을 읽는 자격. core가 reader에 넘기는 context라 발급 자격이 아니다.
const searchReader: RequestContext = {
  principal: "machine:documents-search",
  actor: "machine",
  scope: { operations: [SEARCH_VERSION_ROUTE.name], targets: {} },
  conditions: {},
  credential_ref: "machine:documents-search",
};

// tracking root 읽기의 자격. machine만 읽는 project.tracking_roots를 core가 직접 읽는다.
// ledger credential 기록이 아니라 reader에 넘기는 context라, 발급 자격이 아니다.
const trackingReader: RequestContext = {
  principal: "machine:documents-roots",
  actor: "machine",
  scope: { operations: [projectTrackingRoots.name], targets: {} },
  conditions: {},
  credential_ref: "machine:documents-roots",
};

// packaged allow-env에 없는 이름은 없는 값이다. NotCapable로 기동을 끝내지 않는다.
function optionalEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

// I/O worker의 secret-tool이 쓰는 session bus 위치. secret 값이 아니다.
function sessionBusEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"]) {
    const value = Deno.env.get(name);
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function repoRoot(): string {
  return new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
}

function denoDir(): string {
  // 설치 묶음은 DENO_DIR로 ~/.cache/lophn/deno를 준다(install-and-update#R8).
  let configured: string | undefined;
  try {
    configured = Deno.env.get("DENO_DIR");
  } catch { /* env 권한이 없는 worker는 spec을 쓰지 않는다 */ }
  if (configured) return configured;
  const home = Deno.env.get("HOME");
  return home ? `${home}/.cache/deno` : "/tmp";
}

// platform/io는 diagnostics 입구다. 데이터 root만 읽고 네트워크는 열지 않는다.
// sys의 statfs는 blob 준비 전의 실제 디스크 여유 관측(R12)에만 쓴다. node:fs statfs는
// Deno에서 sys 권한을 요구하고 가장 좁은 값은 --allow-sys=statfs다(실측). run은 열지 않는다.
function platformIoSpec(dataRoot: string): KindLaunchSpec {
  return {
    kind: "platform/io",
    entry: new URL("./io-entry.ts", import.meta.url).pathname,
    // 데이터 root 밖은 코드와 deno 캐시만 읽는다. 쓰기는 데이터 root뿐이다.
    allow_read: [dataRoot, repoRoot(), denoDir()],
    allow_write: [dataRoot],
    allow_net: [],
    // 보호 입력의 값을 OS keychain에 두는 secret-tool만 실행한다(값은 stdin으로만 간다).
    allow_run: [...SECRET_TOOL_PATHS],
    allow_sys: ["statfs"],
    allow_env: [
      "LOPHN_HOME",
      "LOPHN_WORKER_KIND",
      "HOME",
      "PATH",
      // secret-tool이 사람의 session bus를 찾는 데만 읽는다.
      "DBUS_SESSION_BUS_ADDRESS",
      "XDG_RUNTIME_DIR",
    ],
    policy: "always",
    memory_limit_bytes: 256 * 1024 * 1024,
  };
}

// Q6 바이트 흐름. core가 relay를 만들어 I/O worker의 callback으로 넣는다.
// 준비 성공은 writer 메모리에도 알려 등록 판정이 같은 참조를 보게 한다.
// 바이트는 core가 열지 않는다. I/O worker의 blob.read가 읽고 core는 결과만 받는다.
function blobReadDeps(
  assembled: { blobFields?: readonly BlobFieldDefinition[] },
): {
  deps: {
    fields: readonly BlobFieldDefinition[];
    read(
      hash: string,
      offset: number,
      length: number,
    ): Promise<Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>>;
  };
  use(
    read: (
      hash: string,
      offset: number,
      length: number,
    ) => Promise<
      Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>
    >,
  ): void;
} {
  const reader: {
    current?: (
      hash: string,
      offset: number,
      length: number,
    ) => Promise<
      Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>
    >;
  } = {};
  return {
    deps: {
      fields: assembled.blobFields ?? [],
      read(hash, offset, length) {
        const current = reader.current;
        if (!current) {
          return Promise.resolve(err({
            code: "unavailable",
            message: "blob 읽기 통로가 없다",
          }));
        }
        return current(hash, offset, length).catch(() =>
          err({ code: "unavailable", message: "blob을 읽지 못했다" })
        );
      },
    },
    use(read) {
      reader.current = read;
    },
  };
}

function blobRelayFor(
  io: ReturnType<typeof createSupervisor>,
  clock: Clock,
  note: (
    prepared: PreparedRelayResult,
    nowMs: number,
  ) => Promise<Result<void>>,
  gauge: BufferGauge,
): {
  callbacks: {
    onMessage(message: ChildMessage): void;
    onFrame(frame: Frame): void;
  };
  failPending(message: string): void;
  prune(nowMs: number): void;
  live: BlobPrepareRelay["live"];
  prepare(call: BlobPrepareCall): Promise<Result<PreparedRelayResult>>;
  readBytes: BlobPrepareRelay["readBytes"];
} {
  const registry = createPreparationRegistry();
  const relay = createBlobPrepareRelay({
    // 해석·hash 없이 I/O worker로 넘긴다(Q6). worker가 준 credit 안에서만 보내고,
    // frame writer가 pipe backpressure를 지킨다.
    send: async (payload) => {
      const sent = await io.send("platform/io", payload);
      if (!sent.ok) throw new Error("blob 준비를 넘기지 못했다");
    },
    sendBytes: async (channel, chunk) => {
      const sent = await io.sendBytes("platform/io", channel, chunk);
      if (!sent.ok) throw new Error("blob 바이트를 넘기지 못했다");
    },
    sendEnd: async (channel) => {
      const sent = await io.sendEnd("platform/io", channel);
      if (!sent.ok) throw new Error("blob 끝을 넘기지 못했다");
    },
    sendAbort: async (channel) => {
      const sent = await io.sendAbort("platform/io", channel);
      if (!sent.ok) throw new Error("blob 중단을 넘기지 못했다");
    },
    registry,
    nowMs: () => clock.nowMs(),
    note,
    gauge,
  });
  return {
    callbacks: {
      // worker_response와 credit은 중계가 요청 id·channel로 맞춘다.
      onMessage(message) {
        relay.accept(message);
      },
      // worker가 돌려준 읽기 바이트는 JSON이 아니라 byte chunk frame이다.
      onFrame(frame) {
        relay.take(frame);
      },
    },
    failPending: (message) => relay.failPending(message),
    prune: (nowMs) => relay.prune(nowMs),
    live: (prepared, nowMs) => relay.live(prepared, nowMs),
    prepare: (call) =>
      relay.prepare(
        {
          principal: call.principal,
          purpose: call.purpose,
          expectedHash: call.expectedHash,
        },
        call.bytes,
      ).catch(() =>
        err({ code: "unavailable", message: "blob 준비를 넘기지 못했다" })
      ),
    readBytes: (hash, offset, length) => relay.readBytes(hash, offset, length),
  };
}

function startPlatformIo(
  io: ReturnType<typeof createSupervisor>,
  dataRoot: string,
  epoch: string,
  port: number,
  // blob 준비 중계. worker_response와 byte chunk 소비를 묶는다(Q6).
  blob?: {
    onMessage(message: ChildMessage): void;
    onFrame(frame: Frame): void;
    onEnd?(): void;
  },
): Promise<Result<void>> {
  return io.start(
    platformIoSpec(dataRoot),
    {
      type: "hello",
      core_epoch: epoch,
      process_identity: epoch,
      kind: "platform/io",
      task: "diagnostics",
      scope: { operations: [], targets: {} },
      credential: "platform-io",
      api_port: port,
    },
    blob ?? {
      // platform/io 응답은 core가 아직 소비하지 않는다. 감독과 상태만 본다.
      onMessage() {},
    },
  ).then((started) =>
    started.ok ? ok(undefined) : err({
      code: started.code,
      message: "platform/io worker를 시작하지 못했다",
    })
  );
}

// document.prepare worker route. blob 중계가 뜨면 준비된다. format 검사와 기준 판
// 읽기는 그 소유 연결이 아직 없어 unavailable로 답한다. 목록 hash와 blob은 같은
// stream에서 만든다.
// 제품 route와 테스트 seam route를 한 map으로 모은다. 같은 key는 나중 것이 이긴다.
function mergedWorkers(
  base: ReadonlyMap<string, WorkerRouteTarget>,
  extra: ReadonlyMap<string, WorkerRouteTarget> | undefined,
): ReadonlyMap<string, WorkerRouteTarget> {
  return new Map([...base, ...(extra ?? [])]);
}

function documentPrepareWorkers(
  relay: {
    current?: (call: BlobPrepareCall) => Promise<Result<PreparedRelayResult>>;
  },
  loadBaseVersion: BaseVersionFor,
  principalOf: (request: WorkerRequest) => string | undefined,
  validateFiles: ValidatePort,
): ReadonlyMap<string, WorkerRouteTarget> {
  const route = documentPrepareRoute({
    sink: (request) =>
      relaySink((bytes) => {
        const prepare = relay.current;
        if (!prepare) {
          return Promise.resolve(err({
            code: "unavailable",
            message: "blob 준비 중계가 아직 없다",
          }));
        }
        // 준비 참조의 주체는 이 요청의 자격이다. 저장 command가 같은 자격으로 등록한다.
        const principal = principalOf(request);
        if (principal === undefined) {
          return Promise.resolve(err({
            code: "unauthorized",
            message: "credential이 없다",
          }));
        }
        return prepare({
          principal,
          purpose: "document_files",
          bytes,
        });
      }),
    available: () => relay.current !== undefined,
    observedAt: () => new Date().toISOString(),
    // format 검사는 coordinator의 format runner가 한다. 원문 blob은 I/O worker에서 읽어
    // 감독 pipe로 넘긴다(documents-validate.ts).
    validateFiles,
    loadBaseVersion,
  });
  return new Map([[route.key, { handle: route.handle }]]);
}

// 파일 bytes 검사 route(`/v1/formats/validate`). 준비 route와 같은 검사 통로를 쓴다.
function formatValidateWorkers(
  deps: Parameters<typeof formatValidateRoute>[0],
): ReadonlyMap<string, WorkerRouteTarget> {
  const route = formatValidateRoute(deps);
  return new Map([[route.key, { handle: route.handle }]]);
}

// 요청 credential의 현재 principal. 폐기·만료된 자격은 없다.
function requestPrincipal(
  runtime: CoreRuntime,
): (request: WorkerRequest) => string | undefined {
  return (request) => {
    const slash = request.request_id.lastIndexOf("/");
    const ref = slash > 0 ? request.request_id.slice(0, slash) : undefined;
    const ctx = ref === undefined ? undefined : runtime.current(ref);
    return ctx?.ok ? ctx.value.principal : undefined;
  };
}

// 요청 credential의 현재 context로 reader Worker의 내부 read를 연다.
async function readAs(
  runtime: CoreRuntime,
  request: WorkerRequest,
  route: ReadRoute,
  input: unknown,
): Promise<Result<unknown>> {
  const slash = request.request_id.lastIndexOf("/");
  const ref = slash > 0 ? request.request_id.slice(0, slash) : undefined;
  const ctx = ref === undefined ? undefined : runtime.current(ref);
  if (!ctx?.ok) {
    return err({ code: "unauthorized", message: "credential이 없다" });
  }
  return await runtime.readers.read(route, ctx.value, input);
}

// 기준 판 읽기. 요청 credential의 현재 context로 reader Worker의 snapshot을 읽는다.
function baseVersionRead(runtime: CoreRuntime): BaseVersionFor {
  return async (version, from) => {
    const slash = from.request_id.lastIndexOf("/");
    const ref = slash > 0 ? from.request_id.slice(0, slash) : undefined;
    const ctx = ref === undefined ? undefined : runtime.current(ref);
    if (!ctx?.ok) {
      return err({ code: "unauthorized", message: "credential이 없다" });
    }
    const read = await runtime.readers.read(PREPARE_BASE_ROUTE, ctx.value, {
      document: from.document,
      version,
    });
    if (!read.ok) return read;
    return ok(
      (read.value as { version: VersionRow | null }).version,
    );
  };
}

function appsComponent(
  supervision: ReturnType<typeof createSupervisor>,
): { available: boolean; reason?: string } {
  const observed = supervision.observation(APPS_SUPERVISOR_KIND);
  return observed.available
    ? { available: true }
    : { available: false, reason: observed.reason ?? "apps supervisor가 없다" };
}

function ioComponent(
  io: ReturnType<typeof createSupervisor> | undefined,
): { available: boolean; reason?: string } {
  if (!io) return { available: false, reason: "I/O worker 감독이 없다" };
  const observed = io.observation("platform/io");
  return observed.available
    ? { available: true }
    : { available: false, reason: observed.reason ?? "platform/io가 없다" };
}
