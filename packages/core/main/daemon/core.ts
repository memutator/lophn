import { systemClock } from "../../../base/clock.ts";
import { cryptoRandom } from "../../../base/random.ts";
import type { Clock, RandomSource, Result } from "../../../base/mod.ts";
import { createIdSource, err, ok, sha256Hex } from "../../../base/mod.ts";
import type { RequestContext } from "../../../protocol/server/mod.ts";
import { settingsGet } from "../../../protocol/config/mod.ts";
import type {
  ChildMessage,
  KindLaunchSpec,
} from "../../../protocol/supervision/mod.ts";
import type { Frame } from "../../../protocol/base/mod.ts";
import { createApprovalRequest } from "../../../protocol/approvals/mod.ts";
import { ROUTES } from "../../../protocol/registry.ts";
import { secretInput } from "../../../protocol/secrets/mod.ts";
import type { BlobFieldDefinition } from "../../../protocol/storage/mod.ts";
import {
  createAppEngineerAssignment,
  providerList,
  runAppRevert,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  type ApiServer,
  RouteRegistry,
  startApiServer,
  WORKSPACE_MEMORY_ROUTES,
} from "../../server/mod.ts";
import {
  AGENT_RUNTIME_KIND,
  AGENT_RUNTIME_TASK,
  type AgentRuntimeChild,
  agentRuntimePolicies,
  providerHost,
  startAgentRuntimeChild,
} from "../../lophn-agent/run-loop/runtime.ts";
import { createAgentRuntimeSecrets } from "../../lophn-agent/run-loop/runtime-secret.ts";
import {
  type TraceExportWriterDeps,
  withTraceExport,
} from "../../lophn-agent/observability/trace-export.ts";
import { withProviderLogin } from "../../lophn-agent/providers/login.ts";
import { withViewBinding } from "../../problems/reporting/view-binding.ts";
import {
  applyMigrations,
  checkRestart,
  ensureLedgerId,
  planRestore,
  RESTORE_DECISION,
  restoreBinding,
  type RestoreOutcome,
  type RestorePlan,
} from "../../storage/migration/mod.ts";
import { backupStamp } from "../../storage/migration/mod.ts";
import { type StatusSource } from "../../diagnostics/mod.ts";
import {
  CredentialRegistry,
  type OperationPolicy,
} from "../../server/identity/mod.ts";
import {
  acquireInstanceLock,
  type DataRoot,
  type InstanceLock,
  removeRunMetadata,
  resolveDataRoot,
  writeRunMetadata,
} from "../../install-and-update/mod.ts";
import {
  type KnownSecretMatch,
  LEDGER_SCHEMA_STEPS,
} from "../../storage/ledger/mod.ts";
import { createSupervisor } from "../../supervision/responsiveness/mod.ts";
import { SETTINGS_SCHEMA_STEPS } from "../../config/mod.ts";
import {
  type KeychainAdapter,
  randomSealedRef,
  SECRET_SCHEMA_STEPS,
  SECRET_TOOL_PATHS,
} from "../../secrets/mod.ts";
import { createMcpOAuthVault } from "../../lophn-agent/extensions/mod.ts";
import { createMcpAuthRequests } from "../../lophn-agent/extensions/mcp-auth-requests.ts";
import {
  createRewindSummaries,
  rewindSummaryTarget,
} from "../../lophn-agent/session/rewind/summary.ts";
import {
  connectionConnect,
  connectionEndChild,
  connectionEndConnection,
  connectionRegisterChild,
  ticketUploadSummary,
} from "../../../protocol/coding-agent/mod.ts";
import { problemsUploadFixSummary } from "../../../protocol/problems/mod.ts";
import {
  type CodingCredentials,
  connectHandler,
  createCodingCredentials,
  endChildHandler,
  endConnectionHandler,
  registerChildHandler,
  withRevocationSweep,
} from "../../server/identity/coding-credential-assembly.ts";
import { codingAgentOperationPolicies } from "../../apps/connections/operations.ts";
import {
  createSecretInputRelay,
  secretInputHandler,
  type SecretInputRelay,
} from "../../secrets/input-relay.ts";
import {
  type BlobPrepareRelay,
  type BufferGauge,
  createBlobPrepareRelay,
  createBufferGauge,
  type PreparedRelayResult,
} from "../../storage/blobs/prepare-relay.ts";
import {
  createPreparationRegistry,
  retentionRules,
} from "../../storage/blobs/mod.ts";
import { createChildBlobPrepare } from "../../storage/blobs/child-prepare.ts";
import { CREDENTIAL_SCHEMA } from "../../server/credentials.ts";
import { ticketSummaryUploadHandler } from "../../apps/tickets/summary-upload.ts";
import { fixSummaryUploadHandler } from "../../problems/repairs/fix-summary-upload.ts";
import {
  createDocumentsChannel,
} from "../../projects/file-tracking/coordinator/serving.ts";
import {
  CONTEXT_WORKER_OPERATIONS,
  contextWorkerCredential,
} from "../../projects/contexts/register.ts";
import {
  createContextBlobPreparer,
  withContextBlobs,
} from "../../projects/contexts/blob.ts";
import {
  type ContextsDispatchDeps,
  contextsStagingPath,
  createContextsDispatcher,
  createContextsHost,
  createContextsProcess,
} from "../../projects/contexts/connection.ts";
import {
  type ContextsWatch,
  createContextsWatch,
  denoWatchFs,
} from "../../projects/contexts/watch/service.ts";
import { startNotifications } from "../../notifications/loop.ts";
import { startAssignmentReactions } from "../../lophn-agent/assignments/reactions.ts";
import {
  ASSIGNMENT_REACTIONS_CONTEXT,
  NOTIFICATIONS_CONTEXT,
  withPlatform,
} from "./platform-register.ts";
import { observeApprovals } from "../../approvals/mod.ts";
import {
  INVOCATION_RECOVERY_CONTEXT,
  observeInvocations,
} from "../../apps/invocations/restart.ts";
import { createCopyPreviewBundles } from "../../apps/releases/activation/desired.ts";
import { observeReleaseActivations } from "../../apps/releases/activation/recovery.ts";
import { eventOperations } from "../../events/operations.ts";
import type { InternalSubscription } from "../../events/internal-subscription.ts";
import {
  contextWorkInputReadSchema,
  contextWorkInputRoute,
  contextWorkListReadSchema,
  contextWorkListRoute,
} from "../../../protocol/projects/mod.ts";
import {
  greet,
  type ParentPipe,
  shellViewLog,
  watchParent,
  writeParent,
} from "./parent.ts";
import { observeTestRequest } from "../../../protocol/problems/mod.ts";
import { snapshotLogsEnvironment } from "../../problems/snapshots/logs-read.ts";
import {
  registerRepairReads,
  registerSessionReads,
  REPAIR_WORKER_KIND,
  repairWorkerSpec,
} from "../../problems/repairs/context.ts";
import { answerRedactRequest } from "../../lophn-agent/run-loop/runtime-redaction.ts";
import {
  COLLECTOR_CREDENTIAL_OPERATIONS,
  COLLECTOR_ROUTES,
  collectorOperationPolicies,
  collectorWorkers,
} from "../../problems/reporting/collector.ts";
import {
  COLLECTOR_KIND,
  reportCollectorSpec,
  screenTestHost,
  TEST_RUNNER_KIND,
  testRunnerSpec,
} from "../../problems/tests/runner.ts";
import {
  startTestControl,
  type TestControl,
  testRunnerBlobPolicy,
  testRunnerPolicies,
} from "../../problems/tests/control.ts";
import {
  PROBLEMS_WORK_FEED_CONTEXT,
  PROBLEMS_WORK_OP,
  PROBLEMS_WORK_OPERATIONS,
  PROBLEMS_WORK_PRINCIPAL,
  problemsWorkPolicies,
  startProblemsWorkFeed,
} from "../../problems/grouping/connection.ts";
import {
  PROBLEMS_CLOSING_OP,
  startProblemsClosingFeed,
} from "../../problems/closing/connection.ts";
import {
  startTicketCheckFeed,
  TICKET_CHECK_FEED_CONTEXT,
  TICKET_CHECK_OP,
  TICKET_CHECKER_KIND,
  TICKET_CHECKER_OPERATIONS,
  TICKET_CHECKER_PRINCIPAL,
  ticketCheckerPolicies,
  ticketCheckerSpec,
} from "../../apps/tickets/checker/connection.ts";
import {
  APP_REVERT_CONTEXT,
  createAppRevert,
} from "../../apps/revert/app-steps.ts";
import {
  REVERT_WORKER_KIND,
  revertWorkerSpec,
  workerAppCaller,
} from "../../apps/revert/caller.ts";
import {
  appCredentialIssuer,
  APPS_CONTROL_CONTEXT,
  APPS_CONTROL_PRINCIPAL,
  APPS_SUPERVISOR_KIND,
  appSocketRoot,
  appsOperationPolicies,
  appSupervisorSpec,
  createAppsControl,
  SUPERVISOR_CREDENTIAL_OPERATIONS,
  withReleasePreparation,
} from "../../apps/control.ts";
import { createConfirmAdapters } from "../../apps/connections/confirm-adapters.ts";
import { createProductRedactor } from "../../projects/outline-and-search/redactor.ts";
import {
  BOOTSTRAP_RETRY_MS,
  bootstrapBuiltinAssignments,
  noteBootstrapFailure,
} from "../../lophn-agent/assignments/bootstrap.ts";
import {
  createApprovalTextPreparer,
  withApprovalText,
} from "../../approvals/text-prepare.ts";
import {
  createHandoffBodyPreparer,
  withHandoffBody,
} from "../../lophn-agent/tools/handoff/body.ts";
import { createRewindStore } from "../../lophn-agent/session/rewind/mod.ts";
import {
  amendInstall,
  ledgerSnapshot,
  REWIND_INSTALL_CONTEXT,
  withRewindFiles,
} from "../../lophn-agent/session/rewind/files.ts";
import { answeredFacts } from "../../lophn-agent/session/rewind/facts.ts";
import { projectRootOf } from "../../lophn-agent/session/rewind/root.ts";
import { reconcileRewindInstalls } from "../../lophn-agent/session/rewind/reconcile.ts";
import {
  REWIND_SWEEP_INTERVAL_MS,
  sweepRewind,
} from "../../lophn-agent/session/rewind/sweep-core.ts";
import {
  type BodyPrepare,
  createMessageBodyPreparer,
  messageBodyEnvironment,
  withMessageBody,
} from "../../lophn-agent/session/message-body.ts";
import {
  createQuestionTextPreparer,
  withQuestionText,
} from "../../lophn-agent/tools/questions/text-prepare.ts";
import { assemble, type TeamModule } from "./registration.ts";
import {
  mcpServerSnapshot,
  registeredMcpServers,
} from "../../lophn-agent/extensions/mcp-snapshot.ts";
import { type CoreRuntime, openRuntime } from "./runtime.ts";
import { appExportWorkers } from "../../apps/data/export.ts";
import { ticketClaimSweepIntervalMs } from "../../apps/tickets/register.ts";
import { agentProfileHandlers } from "../../lophn-agent/register.ts";
import {
  createMcpAuthControl,
  openMcpCallbackListener,
} from "../../lophn-agent/extensions/mcp-auth-control.ts";
import { createMcpTokenRefWriter } from "../../lophn-agent/extensions/mcp-token-ref.ts";
import {
  agentProfilesRead,
  agentProfilesUpload,
  skillFoldersSetting,
} from "../../../protocol/lophn-agent/mod.ts";

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
  random?: RandomSource;
  // Electron main이 물려 준 stdin/stdout.
  parent?: ParentPipe;
  // secret store·MCP OAuth·coding agent connection credential이 값을 읽는 keychain adapter.
  codingKeychain: KeychainAdapter;
  // 설치된 보호 loader의 identity 목록. 설치 쪽이 정하기 전에는 비어 있어 child를 등록할 수 없다.
  codingLoaders: readonly string[];
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
  // 새 command 입장을 닫고 연 것을 정리한 뒤 lock을 푼다.
  shutdown(): Promise<void>;
  // 사람이 잃을 범위를 확인한 backup 복원. handle은
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
  // (packages/core/main/daemon/main.ts가 한다). 복원이 실패해도 core는 이미 멈춘 뒤라 true다.
  restoreStopped(): boolean;
  // 사람의 연결 결정 입구가 connect를, 신뢰 감독이 registerChild를
  // 부른다(입구의 contract는 coding-agent 소유라 HTTP route는 없다).
  codingCredentials: CodingCredentials;
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
  // problems report collector 요청 통로. 같은 통로 모양을 쓴다.
  const collectorChannel = createDocumentsChannel();
  // problems test runner 요청 통로. 접수된 요청 한 건을 보내고 끝맺음을 받는다. 같은
  // process의 session이 `problems.work` 깨움도 받으므로 통로 하나를 나눠 쓴다.
  const runnerChannel = createDocumentsChannel();
  // ticket checker worker 요청 통로. 같은 통로 모양을 쓴다.
  const checkerChannel = createDocumentsChannel();
  // coding-agent 수리 자료 worker 요청 통로. 같은 통로 모양을 쓴다.
  const repairChannel = createDocumentsChannel();
  // 앱 revert 호출 worker 요청 통로. 같은 통로 모양을 쓴다(lophn-agent/revert).
  const revertChannel = createDocumentsChannel();
  const ledgerPath = `${root.path}/lophn.db`;
  const rewindStore = createRewindStore(root.path);
  // writer·reader가 import하는 팀 module. platform·instruction·rewind reader는 항상 붙는다.
  const modules = withPlatformModule(
    withInstructionReader(withRewindReader(options.teamModules ?? [])),
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
  // MCP OAuth token 보관이다. 값은 OS keychain에만 있고, 보관이 가진 참조는 알려진 값 registry에
  // 올라 model로 가는 글과 저장할 글에서 지워진다.
  const mcpVault = createMcpOAuthVault({
    keychain: () => options.codingKeychain,
    randomRef: randomSealedRef,
  });
  const assembled = withPlatform(
    assemble(options.teams, {
      mcpOAuthRefs: () => mcpVault.refs(),
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
  // 있어도 lookup이 route not found를 반환한다.
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
  // ledger를 새로 만드는 기동인지는 migration이 파일을 만들기 전에 본다(ledger_id는
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
  // 중단 작업 점검 → cursor 복원 순서다. SQLite 복구·schema 점검 뒤
  // 정상 read를 열고 전체 scan·index·큰 hash를 기다리지 않는다. 소유
  // concern의 복구 command가 아직 없는 영역은 unknown 관측값과 근거를 남기고
  // 읽기 열기를 막지 않는다. 점검 관측은 status에 더하지 않는다: 상태는
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
  // 문서 관측 제출은 machine document.prepare(준비 route)와 document.save command다.
  // 준비 route도 machine이 닿도록 command kind로 올린다.
  const coding = createCodingCredentials({
    ledgerPath,
    dataRoot: root.path,
    keychain: options.codingKeychain,
    clock,
    random,
    loaders: options.codingLoaders,
  });
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
    // 파일 작업 결과 기록. 사람 요청에 결합해 받은 worker만 쓴다.
    { name: "file.record_result", actors: ["machine"], kind: "command" },
    // context worker(machine)가 검사 결과와 위반 수를 기록한다(documents/contexts).
    ...CONTEXT_WORKER_OPERATIONS.map((name): OperationPolicy => ({
      name,
      actors: ["machine"],
      kind: "command",
    })),
    // apps 관측 기록·제어 connection·자식 앱 credential이 닿는 operation.
    ...appsOperationPolicies(),
    // problems report collector(machine)가 보고를 제출한다.
    ...collectorOperationPolicies(),
    // problems test runner(machine)가 요청 기록을 잇고 결과를 남긴다.
    ...testRunnerPolicies(),
    // ticket checker(machine)가 판정 사실을 읽고 결과를 기록한다.
    ...ticketCheckerPolicies(),
    // test-runner kind의 `problems.work` 반응기(machine)가 event를 읽고 문제 work를 맞춘다.
    // 같은 kind의 `problems.closing` 반응기도 CloseProblemVerified를 낸다.
    ...problemsWorkPolicies(),
    // agent runtime(machine)과 run의 agent 자격이 닿는 operation(lophn-agent/harness/run-loop).
    ...agentRuntimePolicies(allRoutes),
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
  const registry = new CredentialRegistry({
    epoch,
    clock,
    random,
    external: coding.authority,
    // coding_agent 상한은 route가 선언한 actors를 따른다(blobs 제외).
    operations: [
      ...baseOperations,
      ...codingAgentOperationPolicies(allRoutes, baseOperations),
    ],
  });
  const io = createSupervisor({
    clock,
    denoCommand: Deno.execPath(),
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
  // 앱 supervisor는 platform/io와 따로 감독한다.
  const appsSupervision = createSupervisor({
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
      ...(Deno.env.get("XDG_RUNTIME_DIR")
        ? { XDG_RUNTIME_DIR: Deno.env.get("XDG_RUNTIME_DIR")! }
        : {}),
      ...(optionalEnv("TMPDIR") ? { TMPDIR: optionalEnv("TMPDIR")! } : {}),
    }),
  });
  let ready = false;
  const stopPrune: {
    run?: () => void;
    bootstrap?: () => Promise<void>;
  } = {};
  // 활성 context의 계약 경로 폴더를 보고 바뀌면 index를 따라잡게 하는 감시.
  let contextsWatch: ContextsWatch | undefined;
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
    // derived는 출처에 이 값을 적고 다르면 버리고 다시 만든다.
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
        ["apps", appsComponent(appsSupervision)],
      ];
    },
  };
  // 읽기 의존은 runtime보다 먼저 만들어 둔다. relay는 I/O worker가 뜬 뒤에 채운다.
  const blobRead = blobReadDeps(assembled.value);
  const openedRuntime = await openRuntime({
    ledgerPath,
    clock,
    seed: seedOf(random),
    modules,
    assembled: assembled.value,
    source,
    blob: blobRead.deps,
    // 참조가 있을 때만 부른다. secret store와 connection credential이 같은 adapter로 값을 읽는다.
    keychain: () => options.codingKeychain,
  });
  if (!openedRuntime.ok) return openedRuntime;
  runtime = openedRuntime.value;
  knownForBodies.current = runtime.knownSecrets;
  registerRepairReads(runtime, repairChannel);
  registerSessionReads(runtime, repairChannel);
  // sweep가 expire_claim을 제출할 machine credential. 기록이 없으면 writer가
  // 만료 정리를 거절하므로 기동을 여기서 멈춘다.
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
  // 재시작 때 접수·실행 중 invocation을 미확인으로 확정하는 core 내부 자격의 기록이다. 기록이 없으면
  // writer가 확정을 거절해 행이 계속 남으므로 기동을 여기서 멈춘다.
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
  // 되돌리기 설치가 건너뛴 경로를 결과에 반영하는 core 내부 machine 자격 기록. 기록이 없으면 writer가
  // AmendRevertInstall을 거절해 복원하지 못한 파일이 복원됐다고 남으므로 기동을 여기서 멈춘다.
  const rewindInstallCredential = await runtime.record(REWIND_INSTALL_CONTEXT);
  if (!rewindInstallCredential.ok) {
    await runtime.close();
    return rewindInstallCredential;
  }
  // 앱 revert 이어 실행(lophn-agent/revert)이 단계를 기록하고 끝내는 core 내부 자격 기록.
  const appRevertCredential = await runtime.record(APP_REVERT_CONTEXT);
  if (!appRevertCredential.ok) {
    await runtime.close();
    return appRevertCredential;
  }
  // trace export의 ledger 경로와 blob 읽기 통로다. 계기 기록이 없다.
  const traceExportSecrets: TraceExportWriterDeps = {
    ledgerPath,
    readBlob: (hash, offset, length) =>
      blobRead.deps.read(hash, offset, length),
    known: () => knownSecrets,
  };
  // MCP OAuth의 시작·완료·상태·취소 입구다. 업무 규칙은 extensions의 mcp-oauth에 있고
  // (concern lophn-agent/extensions, code-map 의존 규칙) 여기는 core의 memory route 입구와 재료를 끼운다.
  // - verifier·state·token은 core 안에만 있다: 응답·ledger·event·log 어디에도 옮기지 않는다.
  // - token은 OS keychain(mcpVault)에만 두고 설정은 서버에서 정해지는 참조(`token_ref`)만 가리킨다.
  // core module graph에는 외부 fetch가 없다. 발급자(token endpoint) 호출은 대기열에 놓고 agent runtime이 가져가 대신
  // 보낸다(mcp-auth-requests.ts).
  const mcpAuthRequests = createMcpAuthRequests({
    newId: () => crypto.randomUUID(),
  });
  const mcpAuthControl = createMcpAuthControl({
    fetch: mcpAuthRequests.fetch,
    openListener: openMcpCallbackListener,
    registered: () => registeredMcpServers(ledgerPath),
    vault: mcpVault,
    nowMs: () => clock.nowMs(),
    writeTokenRef: createMcpTokenRefWriter({
      dataRoot: root.path,
      read: (route, ctx, input) =>
        runtime!.readers.read(route, ctx as never, input),
      command: (ctx, envelope) =>
        runtime!.writer.command(ctx as never, envelope as never),
    }),
    syncSecrets: () => runtime!.syncSecrets(),
  });
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
        const issued = await registry.issue({
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
        const current = registry.revalidate({ credential_ref: ref });
        if (!current.ok) return current;
        const recorded = await runtime!.record(current.value);
        if (!recorded.ok) return recorded;
        const context = runtime!.current(ref);
        if (!context.ok) return context;
        return ok({
          context: context.value,
          end: () => void registry.end(ref),
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
    // 봉인 bundle 사본을 여는 실제 자리다.
    activation: {
      dataRoot: root.path,
      command: (ctx, envelope) =>
        confirmWriter.command(ctx as never, envelope as never),
      machine: () => {
        const current = runtime?.current(APPS_CONTROL_PRINCIPAL);
        return current?.ok ? current.value : undefined;
      },
      prepareBlob: (call) => blobRelay.prepare(call),
      platformPorts: () => apiPort === 0 ? [] : [apiPort],
    },
    previews: {
      dataRoot: root.path,
      bundles: createCopyPreviewBundles({
        dataRoot: root.path,
        platformPorts: () => apiPort === 0 ? [] : [apiPort],
      }),
    },
  });
  appsControl.overlayReads(runtime.reads);
  // context index를 읽는 읽기는 읽기 전에 index를 따라잡고, bundle.submit은 검사를 worker에 보낸다.
  // 아래에서 context worker를 띄운 뒤 dispatcher가 붙는다.
  const contextsHost = createContextsHost();
  contextsHost.overlayReads(runtime.reads);
  // blob 준비 중계는 I/O worker가 뜬 뒤에 채워진다. 그 전에는 prepare route가
  // unavailable이다. route는 떠 있고, 바이트는 중계가 읽는 stream으로 바로 간다.
  const prepareRelay: {
    current?: (call: BlobPrepareCall) => Promise<Result<PreparedRelayResult>>;
  } = {};
  // 메시지 본문 준비 통로도 I/O worker가 뜬 뒤에 채워진다. 그 전에는 unavailable이다.
  const bodyPrepare: { current?: BodyPrepare } = {};
  // 되돌리기의 파일 일(관측·준비·설치)이 쓰는 통로다. 쓰기 앞 처리기와 앱 단계 이어 실행이 같이 쓴다.
  const rewindFilesDeps = {
    snapshot: <T>(read: Parameters<typeof ledgerSnapshot<T>>[1]) =>
      ledgerSnapshot(ledgerPath, read),
    rootOf: projectRootOf,
    answeredFacts,
    store: rewindStore,
    relay: () => bodyPrepare.current,
  };
  // "Summarize from here"의 요약 요청 대기열이다. 사람이 요청하면 runtime이 가져가 요약 call을 한다.
  const rewindSummaries = createRewindSummaries({
    resolve: rewindSummaryTarget(rewindFilesDeps.snapshot),
    newId: () => crypto.randomUUID(),
    now: () => clock.nowMs(),
  });
  // 보호 입력 중계도 I/O worker가 뜬 뒤에 채워진다. 그 전에는 secrets/input이 unavailable이다.
  const secretInputRelay: { current?: SecretInputRelay } = {};
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
      // 닿기 전에 고정 판 본문의 출현을 확인한다.
      // trace export는 writer queue 앞에서 로컬 파일에 쓴다.
      // OAuth 로그인도 writer queue 앞에서 listener와 network를
      // 기다린다. login 세션은 처리기 메모리에만 있다.
      writer: withRevocationSweep(
        withProviderLogin(
          withRewindFiles(
            withTraceExport(
              withReleasePreparation(
                withApprovalText(
                  withQuestionText(
                    withHandoffBody(
                      withMessageBody(
                        // context의 초안·위반 넘김 근거는 호출자 자격으로 command 앞에 준비한다.
                        withContextBlobs(
                          contextsHost.wrapWriter(runtime.writer),
                          createContextBlobPreparer({
                            relay: () => bodyPrepare.current,
                            reads: () => runtime?.reads,
                          }),
                        ),
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
                appsControl.commands,
                appsControl.grantChange,
              ),
              traceExportSecrets,
            ),
            rewindFilesDeps,
          ),
        ),
        () => appsControl.connector.sweep(),
        // 회수된 connection 아래 등록된 MCP·CLI child도 바로 닫는다.
        (connection) => coding.authority.endConnection(connection),
      ),
      reads: runtime.reads,
      // 현재 보기 relay와 apps.connect(supervisor 메모리 관측을 읽는 제어 어댑터)다.
      memory: new Map([
        ...runtime.memory.handlers,
        ...runtime.deliveryMemory,
        ...appsControl.memory,
        // 확인한 revert의 앱 단계를 이어 실행한다(lophn-agent/revert). 실제 복원 호출은 감독
        // worker(apps/revert)가 호출자의 credential으로 하고 core는 결과를 받아 판정한다.
        [
          `${runAppRevert.resource}/${runAppRevert.method}`,
          createAppRevert({
            snapshot: rewindFilesDeps.snapshot,
            rootOf: rewindFilesDeps.rootOf,
            answeredFacts: rewindFilesDeps.answeredFacts,
            store: rewindFilesDeps.store,
            caller: (_ctx, credential) =>
              workerAppCaller({
                channel: revertChannel,
                credential,
              }),
            writer: () => runtime?.writer,
          }),
        ] as const,
        // 요약 요청(사람)과 가져가기·끝내기(runtime)의 입구다.
        ...rewindSummaries.handlers,
        // MCP OAuth의 시작·완료·상태·취소 입구다. handler는 등록한 http 서버의
        // oauth2 인증 방식만 잡는다. verifier·state·token은 core 안에만 산다(값은 응답·ledger·log
        // 어디에도 옮기지 않는다).
        ...mcpAuthControl.handlers,
        ...mcpAuthRequests.handlers,
        // 사람의 연결 결정 입구.
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
      ]),
      events: runtime.events,
      subscriptions: runtime.subscriptions,
      track: (session) => runtime.track(session),
      // command·read·file·worker route는 같은 조립에서 온다. platform 기본 route와
      // 팀 route의 resource/method가 겹치면 RouteRegistry가 거절한다.
      registry: routes,
      // 바이트 body route. 제출 파일은 blob 준비 중계로 바로 흐른다.
      uploads: new Map([[
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
      ], [
        // profile 이미지 올리기: 자리·역할은 reader가 보고 파일은 core가 비동기로 쓴다.
        `${agentProfilesUpload.resource}/${agentProfilesUpload.method}`,
        agentProfileHandlers(runtime.readers, root.path).upload,
      ]]),
      // 큰 파일을 core 메모리에 모으지 않고 창 단위로 흘리는 file route.
      fileStreams: new Map([
        // profile 이미지 읽기: 정의의 profile이 가리키는 파일을 실제 형식의 Content-Type으로 흘린다.
        [
          `${agentProfilesRead.resource}/${agentProfilesRead.method}`,
          agentProfileHandlers(runtime.readers, root.path).file,
        ],
      ]),
      workers: new Map([
        // 앱 export serving. 준비는 core graph 밖 프로세스가 한다.
        ...appExportWorkers({
          dataRoot: root.path,
          ledgerPath,
          current: (ref) => runtime!.current(ref),
          observedAt: () => new Date().toISOString(),
        }),
        // 문제 collector route의 view 출처는 binding 검증 뒤에만 worker로 닿는다.
        ...withViewBinding(
          collectorWorkers({
            channel: collectorChannel,
            observation: () => io.observation(COLLECTOR_KIND),
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
              (await io.sendBytes(COLLECTOR_KIND, channel, chunk)).ok,
          }),
          {
            signer: appsControl.signer,
            nowMs: () => clock.nowMs(),
          },
        ),
      ]),
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
  const blobBuffer = createBufferGauge();
  const blobRelay = blobRelayFor(
    io,
    clock,
    (prepared, nowMs) => runtime.notePrepared(prepared, nowMs),
    blobBuffer,
  );
  blobRead.use(blobRelay.readBytes);
  prepareRelay.current = (call) => blobRelay.prepare(call);
  bodyPrepare.current = {
    live: (prepared) => blobRelay.live(prepared, clock.nowMs()),
    prepare: (call) => blobRelay.prepare(call),
  };
  // 준비 참조 수명 만기 prune. writer 메모리의 만기 판정 시각도 함께 전진한다.
  // 파일 GC는 하지 않고 메모리 참조만 떨어뜨린다.
  const timer = setInterval(() => {
    blobRelay.prune(clock.nowMs());
    runtime?.prunePrepared(clock.nowMs());
  }, 60_000);
  // ticket claim 만료·회수 정리. 60초마다와 재시작 때 후보를 읽고 expire_claim을
  // 제출한다. timer는 표를 쓰지 않는다.
  const claimSweep = setInterval(
    () => runtime?.sweepTicketClaims(),
    ticketClaimSweepIntervalMs,
  );
  await runtime?.sweepTicketClaims();
  // 설치 전에 죽어 파일이 복원되지 않은 항목을 결과에 반영한다. 한 번만 돈다.
  await reconcileRewindInstalls({
    snapshot: (read) => ledgerSnapshot(ledgerPath, read),
    rootOf: projectRootOf,
    amend: async (revert, paths) =>
      await amendInstall(
        runtime!.writer,
        revert,
        paths,
        `rewind-recover:${revert}:${await sha256Hex(paths.join("\n"))}`,
      ),
  }).catch(() => 0);
  // 되돌리기 저장소의 고아 저장물과 닫히거나 지워진 session의 디렉터리를 쓴다. 시작 때와 한 시간마다다.
  const rewindSweep = () =>
    sweepRewind({ ledgerPath, store: rewindStore, nowMs: clock.nowMs() })
      .catch(() => undefined);
  const rewindSweepTimer = setInterval(rewindSweep, REWIND_SWEEP_INTERVAL_MS);
  await rewindSweep();
  // 재시작 점검이 unknown으로 본 접수·실행 중 invocation을 미확인으로 확정한다. 한 번만 돈다.
  await runtime?.sweepInterruptedInvocations();
  stopPrune.run = () => {
    clearInterval(timer);
    clearInterval(claimSweep);
    clearInterval(rewindSweepTimer);
  };
  // 보호 입력의 값은 I/O worker로만 간다. 준비 증거(값 없음)는 writer가 ledger에 남긴다.
  const secretRelay = createSecretInputRelay({
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
  });
  secretInputRelay.current = secretRelay;
  const startedIo = await startPlatformIo(
    io,
    root.path,
    epoch,
    server.port,
    {
      onMessage(message) {
        blobRelay.callbacks.onMessage(message);
        secretRelay.accept(message);
      },
      onFrame(frame) {
        blobRelay.callbacks.onFrame(frame);
      },
      // I/O worker가 끝나면(crash·재기동) 답을 기다리던 준비·읽기·보호 입력을 기한까지 두지 않고 끝낸다.
      onEnd() {
        const message = "I/O worker가 끝나 요청이 끝나지 못했다";
        blobRelay.failPending(message);
        secretRelay.failPending(message);
      },
    },
  );
  if (!startedIo.ok) {
    await server.stop();
    await runtime.close();
    return startedIo;
  }
  // documents/contexts. index를 갱신하고 판을 검사하는 context worker(documents 2.4)다. 첫 요청에서 띄우고
  // 상주한다. 띄우지 못해도 core는 계속 선다: 읽기는 있던
  // index로 답하고(없으면 unavailable) 제출된 판은 checking으로 남는다.
  {
    const issued = await registry.issue(contextWorkerCredential());
    const current = issued.ok
      ? registry.revalidate({
        credential_ref: issued.value.credential_ref,
      })
      : issued;
    const recorded = issued.ok && current.ok
      ? await runtime.record(current.value)
      : current;
    if (issued.ok && recorded.ok) {
      const credentialRef = issued.value.credential_ref;
      const contextsChannel = createDocumentsChannel();
      const contextsProcess = createContextsProcess({
        supervisor: io,
        channel: contextsChannel,
        dataRoot: root.path,
        epoch,
        apiPort: server.port,
        prepare: async () => {
          await Deno.mkdir(`${root.path}/derived`, { recursive: true });
          await Deno.mkdir(contextsStagingPath(root.path), { recursive: true });
        },
      });
      const readContextInput: ContextsDispatchDeps["readInput"] = async (
        input,
      ) => {
        const read = await runtime!.readers.read(
          contextWorkInputRoute,
          contextsInputReader,
          input,
        );
        if (!read.ok) return read;
        const parsed = contextWorkInputReadSchema.safeParse(read.value);
        return parsed.success ? ok(parsed.data) : err({
          code: "internal" as const,
          message: "the context worker input is not valid",
        });
      };
      // 활성 context와 도는 검사의 목록. 읽을 때마다 worker가 읽을 폴더 전체를 맞춘다(빠진 폴더는 다음에
      // 다시 띄울 때 권한에서 빠진다).
      const listContextWork: NonNullable<ContextsDispatchDeps["list"]> =
        async () => {
          const read = await runtime!.readers.read(
            contextWorkListRoute,
            contextsInputReader,
            {},
          );
          if (!read.ok) return read;
          const parsed = contextWorkListReadSchema.safeParse(read.value);
          if (!parsed.success) {
            return err({
              code: "internal" as const,
              message: "the context work list is not valid",
            });
          }
          contextsProcess.retain([
            ...new Set([
              ...parsed.data.contexts.flatMap((entry) => entry.roots),
              ...parsed.data.checks.flatMap((entry) => entry.roots),
            ]),
          ]).catch((error) =>
            console.error(`context worker: ${String(error)}`)
          );
          return ok(parsed.data);
        };
      const contextsWatchHandle = createContextsWatch({
        list: listContextWork,
        readInput: readContextInput,
        catchUp: (context) => dispatcher.ensureFresh(context, { force: true }),
        watchFs: denoWatchFs,
        log: (message) => console.error(message),
      });
      contextsWatch = contextsWatchHandle;
      contextsHost.onAccepted(contextsWatchHandle.onCommand);
      const dispatcher = createContextsDispatcher({
        process: contextsProcess,
        readInput: readContextInput,
        observed: (input) => contextsWatchHandle.observe(input),
        list: listContextWork,
        command: (envelope) => {
          const ctx = runtime!.current(credentialRef);
          return ctx.ok
            ? runtime!.writer.command(ctx.value as never, envelope)
            : Promise.resolve(ctx);
        },
        nowMs: () => performance.now(),
        log: (message) => console.error(`context worker: ${message}`),
      });
      contextsHost.attach(dispatcher);
      void contextsWatchHandle.start();
      // 이전 실행에서 결과를 받지 못한 검사는 checking으로 남아 있다. 다시 보낸다.
      void dispatcher.recover();
    }
  }
  // problems/report-collector. 문제 보고 worker route(`/v1/problems/report` 등)를 받는 상시
  // worker다. problems를 등록하지 않은 조립은 띄우지 않는다. 띄우지
  // 못해도 core는 계속 선다: 그 route는 unavailable이다. 앱 위치 주장은 요청이 싣는다.
  const collectorSpec = reportCollectorSpec({ dataRoot: root.path });
  if (
    collectorSpec &&
    allRoutes.some((route) => route.name === COLLECTOR_ROUTES[0].name)
  ) {
    const issued = await registry.issue({
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
      ? registry.revalidate({
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
        prepareBlob: (call) => blobRelay.prepare(call),
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
  // 남기는 상시 worker다. 접수 기록은 core가 주기로 읽어 요청 한 건씩 보낸다. problems를
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
    runnerSpec &&
    assembled.value.commands.some((command) =>
      command.route.name === observeTestRequest.name
    )
  ) {
    const handler = createChildBlobPrepare({
      kind: TEST_RUNNER_KIND,
      gauge: blobBuffer,
      send: (message) =>
        io.send(TEST_RUNNER_KIND, message).then((sent) => sent.ok),
      prepareBlob: (call) => blobRelay.prepare(call),
      // 준비 참조의 주체는 지금 맡은 일의 runner 주체다(결과를 쓰는 자격의 주체와 같아야 등록된다).
      policies: new Map([[
        TEST_RUNNER_KIND,
        testRunnerBlobPolicy(() =>
          testControl?.blobPrincipal() ?? "problems-test-runner"
        ),
      ]]),
    });
    // 같은 process 안의 `problems.work` 반응기가 쓰는 machine credential이다.
    // 요청별 runner credential은 요청 본문으로 가므로 hello credential과 겹치지 않는다.
    const workIssued = await registry.issue({
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
    const workCurrent = registry.revalidate({
      credential_ref: workIssued.value.credential_ref,
    });
    const workRecorded = workCurrent.ok
      ? await runtime.record(workCurrent.value)
      : workCurrent;
    if (!workRecorded.ok) {
      registry.revoke(workIssued.value.credential_ref);
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
          const issued = await registry.issue(input);
          if (!issued.ok) return issued;
          const current = registry.revalidate({
            credential_ref: issued.value.credential_ref,
          });
          const recorded = current.ok
            ? await runtime.record(current.value)
            : current;
          if (!recorded.ok) {
            registry.revoke(issued.value.credential_ref);
            return recorded;
          }
          return ok({
            token: issued.value.token,
            revoke: () => {
              registry.revoke(issued.value.credential_ref);
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
  // coding-agent/checker. 보고된 ticket의 조건을 machine actor로 판정하는 상시 worker다.
  // record_checks를 등록하지 않은 조립은 띄우지 않는다. 띄우지 못해도 core는
  // 계속 선다: 판정이 멈출 뿐 ticket은 reported로 남는다(없는 검사를 성공으로 꾸미지 않는다).
  const checkerSpec = ticketCheckerSpec({ dataRoot: root.path });
  let ticketCheckFeed: InternalSubscription | undefined;
  if (
    checkerSpec &&
    allRoutes.some((route) => route.name === TICKET_CHECKER_OPERATIONS[1])
  ) {
    const issued = await registry.issue({
      actor: "machine",
      principal: TICKET_CHECKER_PRINCIPAL,
      scope: {
        operations: [...TICKET_CHECKER_OPERATIONS],
        targets: { task: "coding-agent" },
      },
      conditions: { task: "coding-agent", process: TICKET_CHECKER_KIND },
    });
    const current = issued.ok
      ? registry.revalidate({
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
  // problems/test-runner. `problems.work` 반응기가 도는 상시 worker다. ticket event를
  // 읽어 문제 work·status를 ReconcileProblemWork로 맞춘다. 그 command를 등록하지
  // 않은 조립은 띄우지 않는다. 띄우지 못해도 core는 계속 선다: 문제 진행 표시가 갱신되지 않을 뿐
  // ticket 정본은 그대로다(없는 반응을 성공으로 꾸미지 않는다). runner process는 위의 RequestTest
  // runner 감독(같은 kind)이 뜨고, 그 process의 session(runner-service.ts)이 `problems.work` 깨움도
  // 받는다. 반응기 credential은 위 시작 hello에 심고, 깨움 요청은 같은 runnerChannel로 간다.
  let problemsWorkFeed: InternalSubscription | undefined;
  let problemsClosingFeed: InternalSubscription | undefined;
  if (
    runnerSpec &&
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
    // cursor 뒤 closing event를 따라잡는다. 조건 판정은 command가 정본에서
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
    repairSpec &&
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
  // (lophn-agent/revert). 띄우지 못해도 core는 계속 선다:
  // 사람의 RunAppRevert 이어 실행이 failure로 닿지 않는다(접수는 applying으로 남는다).
  {
    const spec = revertWorkerSpec({
      socketRoot: appSocketRoot(),
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
  // 멈추며 cursor를 올린다. lophn-agent 팀이 조립에 없으면 반응할
  // command가 없으므로 열지 않는다.
  const assignmentReactions =
    assembled.value.commands.some((c) =>
        c.route.name === createAppEngineerAssignment.name
      )
      ? startAssignmentReactions({ runtime, ledgerPath })
      : undefined;
  // 내장 lophn·Context Engineer assignment 준비. 이미 있으면 아무것도
  // 보내지 않는다.
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
    }, BOOTSTRAP_RETRY_MS);
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
  {
    // collector는 요청 credential을 ledger 행으로 다시 읽는다. 메모리 발급만으로는
    // 선언 보고가 unauthorized가 된다.
    const childIssuer = appCredentialIssuer(registry);
    appsControl.useIssuer({
      ...childIssuer,
      async request(message) {
        const issued = await childIssuer.request(message);
        if (!issued.ok) return issued;
        const current = registry.revalidate({
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
    const issued = await registry.issue({
      actor: "machine",
      principal: "machine:apps-supervisor",
      scope: {
        operations: [...SUPERVISOR_CREDENTIAL_OPERATIONS],
        targets: { task: "apps" },
      },
      conditions: { task: "apps", process: APPS_SUPERVISOR_KIND },
    });
    const current = issued.ok
      ? registry.revalidate({
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
  void coding.start(registry, (context) => runtime!.record(context))
    .catch(() => {});
  ready = true;
  // agent runtime child. API가 열린 뒤에 띄워 hello 직후의 읽기가 닿는다. 띄우지 못해도 core는
  // 계속 선다: agent는 돌지 않고 사람의 요청은 접수된 채 남는다.
  {
    const started = await startAgentRuntimeChild({
      io,
      registry,
      record: (context) => runtime!.record(context),
      epoch,
      dataRoot: root.path,
      apiPort: server.port,
      socketRoot: appSocketRoot(),
      gauge: blobBuffer,
      prepareBlob: (call) => blobRelay.prepare(call),
      read: (route, context, input) =>
        runtime!.readers.read(route, context, input),
      known: () => runtime?.knownSecrets,
      secrets: createAgentRuntimeSecrets({
        ledgerPath,
        keychain: () => options.codingKeychain,
        known: () => runtime?.knownSecrets,
        process: AGENT_RUNTIME_KIND,
        task: AGENT_RUNTIME_TASK,
        mcpOAuth: mcpAuthControl.tokenUse,
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
            providers: { endpoint: string }[];
            next_cursor?: string | null;
          };
          for (const provider of page.providers) {
            const host = providerHost(provider.endpoint);
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
      (scope) => registry.issue(scope),
      allRoutes,
      eventNames,
    )
    : Promise.resolve(ok(undefined));
  let stopped = false;
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
    codingCredentials: coding,
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
    shutdown() {
      // 같은 시각의 두 종료 요청도 실제 종료가 끝날 때까지 같은 barrier를 기다린다.
      return shutdownRun ??= (async () => {
        if (stopped) return;
        stopped = true;
        // 종료 순서(architecture 7.5): 새 command·prepare 입장 닫기 → 입장한
        // 짧은 command 확정 또는 실패 → child 정상 정지 → writer 닫기.
        // 정지 유지보수는 이 세 조건이 실제로 끝난 뒤에만 돈다. 앞 단계가
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
          ticketCheckFeed?.stop();
          problemsWorkFeed?.stop();
          problemsClosingFeed?.stop();
          // 진행 중인 notification 생성은 writer가 닫히기 전에 끝난다.
          await notifications.stop();
          // 진행 중인 assignment 반응도 writer가 닫히기 전에 끝난다.
          await assignmentReactions?.stop();
          contextsWatch?.stop();
          agentRuntime?.stop();
          // 기다리는 MCP 로그인은 사람이 돌아오기를 기다리는 요청이라 서버 정지 전에 끝낸다.
          await mcpAuthControl.endAll();
          closeCollectorBlob?.();
          closeTestRunner?.();
          // main 연결이 끊기면 그 main의 relay 값을 모두 disconnected로 바꾼다.
          runtime?.memory.disconnect();
          // server.stop은 받은 요청이 끝나기를 기다린 뒤 listen을 닫는다. 그 뒤에야
          // 새 command 입장이 실제로 닫힌 것이다.
          await server.stop();
          stoppedAt.commandsBlocked = ready === false;
          // 앱 supervisor가 먼저 앱 자식을 정지한다. 그 뒤 질의 통로를 닫는다.
          appsControl.stop();
          const appsStopped = await appsSupervision.stopAll();
          // stop 요청과 실제 정지 확인은 다르다. unconfirmed이면 update barrier와
          // 정지 유지보수는 fail-closed로 남긴다.
          const ioStopped = await io.stopAll();
          stoppedAt.preparationsBlocked = appsStopped && ioStopped;
          stopPrune.run?.();
          await stopPrune.bootstrap?.();
          // writer Worker와 reader 연결을 닫는다. close가 돌아온 뒤에야 writer가 멈춘 것이다.
          await runtime?.close();
          stoppedAt.writerStopped = true;
          // 세 조건이 모두 관측될 때만 유지보수를 부른다. 파일 작업과 blob_refs
          // 읽기는 core graph 밖 프로세스의 몫이다. 관측을
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
            });
          }
        } finally {
          try {
            await removeRunMetadata(root.run);
          } finally {
            await lock.release();
          }
        }
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

// 정지 유지보수 프로세스. 파일 작업과
// ledger 읽기는 core graph 밖이다. 세 정지 조건은 종료
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
}): Promise<void> {
  const signal = AbortSignal.timeout(MAINTENANCE_TIMEOUT_MS);
  const entry = new URL(
    "../worker/maintenance-entry.ts",
    import.meta.url,
  )
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

// restore 프로세스 입구(packages/core/main/worker/restore-entry.ts)를 띄워 정지한 data root를
// 복원한다. 파일 복사·hash·검증은 core graph 밖 프로세스의 몫이다.
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
  const entry = new URL(
    "../worker/restore-entry.ts",
    import.meta.url,
  )
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
      signal: AbortSignal.timeout(RESTORE_TIMEOUT_MS),
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
// 원문·경로·hash는 넣지 않고 분류만 남긴다.
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
      location: "packages/core/main/daemon/core.ts",
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

// approvals·notifications 등록 파일은 항상 붙는다. writer·reader Worker가 같은 module을 다시 import한다.
function withPlatformModule(modules: readonly string[]): string[] {
  const platform = new URL("./platform-register.ts", import.meta.url).href;
  return modules.includes(platform) ? [...modules] : [...modules, platform];
}

// LOPHN.md와 agent 정의 본문을 파일에서 읽는 ReadInstructionFile의 reader 등록도 항상 붙는다
// (instruction-files.ts). 동기 file API는 reader Worker 안에서만 쓰므로 core가 정적으로 import하지 않는다.
// session 되돌리기 읽기(rewind-reader.ts)의 reader 등록도 항상 붙는다. preview가 지금의 파일을 동기로 읽으므로
// 동기 file API는 reader Worker 안에서만 쓰고 core가 정적으로 import하지 않는다.
function withRewindReader(modules: readonly string[]): string[] {
  const reader =
    new URL("../../lophn-agent/session/rewind/reader.ts", import.meta.url).href;
  return modules.includes(reader) ? [...modules] : [...modules, reader];
}

function withInstructionReader(modules: readonly string[]): string[] {
  const reader =
    new URL("../../lophn-agent/instructions/files.ts", import.meta.url).href;
  return modules.includes(reader) ? [...modules] : [...modules, reader];
}

// context worker 일의 입력(적용 판·검사할 후보 판)과 활성 context 목록을 reader에서 읽는 자격. core가
// reader에 넘기는 context라 발급 자격이 아니다. 둘 다 machine 전용 내부 read다.
const contextsInputReader: RequestContext = {
  principal: "machine:contexts-dispatch",
  actor: "machine",
  scope: {
    operations: [contextWorkInputRoute.name, contextWorkListRoute.name],
    targets: {},
  },
  conditions: {},
  credential_ref: "machine:contexts-dispatch",
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
  return new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
}

function denoDir(): string {
  // 설치 묶음은 DENO_DIR로 ~/.cache/lophn/deno를 준다.
  let configured: string | undefined;
  try {
    configured = Deno.env.get("DENO_DIR");
  } catch { /* env 권한이 없는 worker는 spec을 쓰지 않는다 */ }
  if (configured) return configured;
  const home = Deno.env.get("HOME");
  return home ? `${home}/.cache/deno` : "/tmp";
}

// platform/io는 diagnostics 입구다. 데이터 root만 읽고 네트워크는 열지 않는다.
// sys의 statfs는 blob 준비 전의 실제 디스크 여유 관측에만 쓴다. node:fs statfs는
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

// 바이트 흐름. core가 relay를 만들어 I/O worker의 callback으로 넣는다.
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
    // 해석·hash 없이 I/O worker로 넘긴다. worker가 준 credit 안에서만 보내고,
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
  // blob 준비 중계. worker_response와 byte chunk 소비를 묶는다.
  blob: {
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
    blob,
  ).then((started) =>
    started.ok ? ok(undefined) : err({
      code: started.code,
      message: "platform/io worker를 시작하지 못했다",
    })
  );
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
  io: ReturnType<typeof createSupervisor>,
): { available: boolean; reason?: string } {
  const observed = io.observation("platform/io");
  return observed.available
    ? { available: true }
    : { available: false, reason: observed.reason ?? "platform/io가 없다" };
}
