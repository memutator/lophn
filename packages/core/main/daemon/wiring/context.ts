// module wiring이 서로를 import하지 않고 값을 주고받는 길. wiring을 아는 것은 assembly.ts와 core.ts뿐이고
// wiring은 이 file(과 module·protocol)만 가져간다.
//
// 구동 순서(core.ts의 open이 이 순서로 hook을 부른다. 같은 hook은 WIRINGS 순서대로다):
//   environment → assemble → schemaSteps·schemaStepsAfterTeams → migration → dataSteps → restartOwners → operations
//   → prepare → openRuntime → records → build → API → start → ready → afterReady
// 종료 순서: closeIntake → server.stop → closeChildren → 감독 정지 → closeWork → runtime.close → stopped
import type { Clock, RandomSource, Result } from "../../../../base/mod.ts";
import type { EventDelivery } from "../../../apps/events/mod.ts";
import type { Frame, Route } from "../../../../protocol/base/mod.ts";
import type {
  AuthenticatedContext,
  SchemaStep,
} from "../../../../protocol/server/mod.ts";
import type {
  ChildMessage,
  Diagnostic,
} from "../../../../protocol/supervision/mod.ts";
import type {
  ApiServer,
  FileStreamHandler,
  HostLink,
  MemoryHandler,
  ReadHandler,
  UploadHandler,
} from "../../../server/mod.ts";
import type { ShellCapabilities } from "../../../server/control/capability.ts";
import type {
  CredentialRegistry,
  OperationPolicy,
} from "../../../server/identity/mod.ts";
import type {
  AppIntake,
  AppRewind,
  AppToolCallPath,
  AppViewSignal,
  BundleLocator,
  CallerDirectory,
  InvocationLedger,
} from "../../../apps/ports.ts";
import type { KnownSecretMatch, Writer } from "../../../storage/ledger/mod.ts";
import type { DataStep, RestartOwner } from "../../../storage/migration/mod.ts";
import type {
  BlobPrepareCall,
  BlobPrepareRelay,
  BufferGauge,
  PreparedRelayResult,
} from "../../../storage/blobs/prepare-relay.ts";
import type { BlobFieldDefinition } from "../../../../protocol/storage/mod.ts";
import type { SettingsStore } from "../../../config/mod.ts";
import type { StatusSource, Telemetry } from "../../../diagnostics/mod.ts";
import type { ComponentCheck } from "../../../diagnostics/ports.ts";
import type { Bus, GatewayFrames } from "../../../events/mod.ts";
import type { ApprovalsService } from "../../../approvals/approvals.ts";
import type {
  SettingDeclaration,
  SettingsReader,
} from "../../../../protocol/config/mod.ts";
import type {
  SecretAttachPort,
  SecretStorePort,
} from "../../../../protocol/secrets/mod.ts";
import type { createSupervisor } from "../../../supervision/responsiveness/mod.ts";
import type { createAppsControl } from "../../../apps/control.ts";
import type { AnnotationDelivery } from "../../../apps/annotations/ports.ts";
import type { AppViews } from "../../../apps/views/mod.ts";
import type { Queue } from "../../../lophn-agent/run-loop/queue.ts";
import type { HarnessHold, HostQueue } from "../../../host-queue/mod.ts";
import type { CodingRelay } from "../../../coding-relay/mod.ts";
import type { TerminalView } from "../../../terminal-view/mod.ts";
import type { PhoneLink } from "../../../remote/mod.ts";
import type { SecretStore } from "../../../secrets/mod.ts";
import type { createQuestionWaits } from "../../../lophn-agent/tools/questions/mod.ts";
import type { BodyPrepare } from "../../../lophn-agent/session/message-body.ts";
import type { LiveTurns } from "../../../lophn-agent/run-loop/live-turns.ts";
import type { RewindFilesDeps } from "../../../lophn-agent/session/rewind/files.ts";
import type { createMcpAuthControl } from "../../../lophn-agent/extensions/mcp-auth-control.ts";
import type { createIssuerRequests } from "../../../lophn-agent/issuer-requests.ts";
import type { RunService } from "../../../runs/mod.ts";
import type { createWorkflowService } from "../../../workflows/mod.ts";
import type { WorkflowFlows } from "../../../workflows/ports.ts";
import type { Attention } from "../../../attention/mod.ts";
import type { MachineIdentity } from "../../../machine/mod.ts";
import type { NoticeRecorder } from "./notices.ts";
import type { Assembled } from "../registration.ts";
import type { CoreOptions } from "../core.ts";
import type { CoreRuntime } from "../runtime.ts";
import type { DataRoot } from "../../../install-and-update/mod.ts";

// core가 켜질 때 한 번, 제품 판을 data root의 마지막 판과 견준 결과다(notices wiring이 afterReady에서 낸다).
// changed: 판이 바뀐 기동(`lophn_updated` 기록을 남겼다). from: 바뀌기 전 판, 모르면(새 data root, 판을 적지 않던 옛 data root) null.
// sdksChanged: 설치된 SDK 판이 마지막 기동과 달랐다(제품 판이 같아도 true일 수 있다).
export type ProductStart = {
  version: string;
  from: string | null;
  changed: boolean;
  sdksChanged: boolean;
};
export type ProductStartListener = (
  start: ProductStart,
) => Promise<void> | void;

// worker 통로와 제품 redactor를 가져오는 단일 import 지점이다. 위치가 옮겨지면 여기 두 줄만 고친다.
export { createWorkerChannel } from "../../../supervision/responsiveness/mod.ts";
export { createProductRedactor } from "../../../../base/redaction/mod.ts";

export type Supervisor = ReturnType<typeof createSupervisor>;
export type AppsControl = Awaited<ReturnType<typeof createAppsControl>>;
export type McpAuthControl = ReturnType<typeof createMcpAuthControl>;
export type IssuerRequests = ReturnType<typeof createIssuerRequests>;
export type { BlobPrepareCall, CoreRuntime, RewindFilesDeps };

export type BlobRead = {
  deps: {
    fields: readonly BlobFieldDefinition[];
    read(
      hash: string,
      offset: number,
      length: number,
    ): Promise<Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>>;
  };
  use(read: BlobPrepareRelay["readBytes"]): void;
};

// blob 준비·읽기 중계. I/O worker로 바이트를 넘기고 준비 결과를 writer에도 알린다.
export type BlobRelay = {
  callbacks: {
    onMessage(message: ChildMessage): void;
    onFrame(frame: Frame): void;
  };
  failPending(message: string): void;
  prune(nowMs: number): void;
  live: BlobPrepareRelay["live"];
  prepare(call: BlobPrepareCall): Promise<Result<PreparedRelayResult>>;
  readBytes: BlobPrepareRelay["readBytes"];
};

// 종료 단계가 관측한 정지 조건. 세 개가 모두 참일 때만 정지 유지보수가 돈다.
export type StoppedConditions = {
  preparationsBlocked: boolean;
  commandsBlocked: boolean;
  writerStopped: boolean;
};

// platform/io child가 보내는 message·frame을 받는 쪽. 여러 wiring이 하나씩 올린다.
export type IoListener = {
  onMessage?(message: ChildMessage): void;
  onFrame?(frame: Frame): void;
  onEnd?(): void;
};
export const IO_ENDED = "I/O worker가 끝나 요청이 끝나지 못했다";

export type Built = {
  // 쓰기 앞 처리기. WIRINGS 순서로 접는다(앞이 안쪽).
  writer?: (inner: Writer) => Writer;
  memory?: Iterable<readonly [string, MemoryHandler]>;
  uploads?: Iterable<readonly [string, UploadHandler]>;
  fileStreams?: Iterable<readonly [string, FileStreamHandler]>;
  // `overlayReads` 같은 덧씌우기. runtime이 연 read 등록에 더한다.
  reads?: (reads: Map<string, ReadHandler>) => void;
};

type Wiring = {
  name: string;
  // migration에 더한다. 팀 schema보다 앞(ledger, credential)과 뒤(settings, secret). 순서가 이력이다.
  schemaSteps?: readonly SchemaStep[];
  schemaStepsAfterTeams?: readonly SchemaStep[];
  // ledger 밖 data root 파일의 모양을 바꾸는 step. 소유 concern이 낸다. id로 적용 여부를 본다.
  dataSteps?: readonly DataStep[];
  // assemble(options.teams, env)의 환경에 합쳐 넘긴다.
  environment?(ctx: WiringContext): Record<string, unknown>;
  // 기동 때 중단 작업을 점검하는 소유 concern.
  restartOwners?: readonly RestartOwner[];
  // CredentialRegistry의 operation 정책.
  operations?(
    ctx: WiringContext,
  ): readonly OperationPolicy[] | Promise<readonly OperationPolicy[]>;
  // runtime이 열리기 전에 ctx의 칸(io, registry, blobRead, statusSource 등)을 채운다.
  prepare?(ctx: WiringContext): void;
  // runtime이 열린 뒤 ledger에 기록할 core 안 machine 자격. 하나라도 실패하면 구동기가 runtime을 닫는다.
  records?(ctx: WiringContext): readonly AuthenticatedContext[];
  // runtime이 열린 뒤, API를 열기 전.
  build?(ctx: WiringContext): Result<Built> | Promise<Result<Built>>;
  // API와 platform/io가 뜬 뒤. 실패하면 구동기가 API와 runtime을 닫고 오류를 돌려준다.
  start?(ctx: WiringContext): Promise<Result<void>>;
  // ready가 참이 된 뒤.
  afterReady?(ctx: WiringContext): Promise<void>;
  // 종료 1단계: server.stop 앞. 구독·감시·worker 통로를 정리한다.
  closeIntake?(): Promise<void> | void;
  // 종료 2단계: server.stop 뒤, 감독 정지 앞.
  closeChildren?(): Promise<void> | void;
  // 종료 3단계: 감독 정지 뒤, writer 닫기 앞. timer와 진행 중 일을 마친다.
  closeWork?(): Promise<void> | void;
  // 종료 마지막: writer가 닫힌 뒤. "handled"를 돌려주면 뒤 wiring은 부르지 않는다.
  stopped?(
    ctx: WiringContext,
    conditions: StoppedConditions,
  ): Promise<"handled" | void>;
};
// wiring마다 core 한 번의 기동에 쓸 상태를 닫힘 안에 가진다.
export type WiringFactory = () => Wiring;

// 늦게 생기는 칸. 읽을 때 아직 없으면 오류가 난다. 채우는 쪽은 `provide`, 있을 때만 보려면 `peek`.
type Late = {
  assembled: Assembled;
  allRoutes: readonly Route[];
  schemaSteps: readonly SchemaStep[];
  // 이번 기동에서 migration이 적용한 step 수.
  migrationsApplied: number;
  ledgerId: string;
  // 기동이 data step 전에 낸다.
  machine: MachineIdentity;
  epoch: string;
  eventNames: readonly string[];
  operations: readonly OperationPolicy[];
  statusSource: StatusSource;
  // I/O worker의 diagnostics ingress에 한 줄 쓴다. 기한 안에 받아 적었으면 true, 못 썼으면 false다.
  diagnosticsWrite: (diagnostic: Diagnostic) => Promise<boolean>;
  blobRead: BlobRead;
  registry: CredentialRegistry;
  io: Supervisor;
  appsSupervision: Supervisor;
  runtime: CoreRuntime;
  // control `connect {client: shell}`이 발급한 capability. shell main만 받는 값 route(logins/release)가 확인한다.
  shellCapabilities: ShellCapabilities;
  knownSecrets: KnownSecretMatch;
  blobRelay: BlobRelay;
  blobBuffer: BufferGauge;
  bodyPrepare: BodyPrepare;
  prepareRelay: (call: BlobPrepareCall) => Promise<Result<PreparedRelayResult>>;
  appsControl: AppsControl;
  rewindFiles: RewindFilesDeps;
  mcpAuthControl: McpAuthControl;
  // OAuth 발급자 요청 대기열이다. provider 로그인 wiring이 내고 MCP OAuth와 provider 갱신이 같이 쓴다.
  issuerRequests: IssuerRequests;
  server: ApiServer;
  // 모든 wiring의 bytes route handler. API server와 기기 `call`(remote)이 같은 것을 쓴다.
  uploads: ReadonlyMap<string, UploadHandler>;
  fileStreams: ReadonlyMap<string, FileStreamHandler>;
  shutdown: () => Promise<void>;
  // config가 낸다. 선언 목록은 assembly.ts가 각 단위의 선언을 모아 넣는다.
  settings: SettingsReader;
  settingDeclarations: readonly SettingDeclaration[];
  // config가 낸다. 사람의 결정이 Settings 값을 고칠 때만 쓴다.
  settingsUpdate: SettingsStore["update"];
  // secrets가 낸다.
  secretStore: SecretStorePort & Pick<SecretStore, "hold" | "release">;
  secretAttach: SecretAttachPort;
  // events가 낸다.
  bus: Bus;
  // Bus 밖 frame을 연결된 Gateway client 하나에 보낸다.
  gateway: GatewayFrames;
  // approvals가 낸다. tool gate와 turn 안 request.
  approvals: ApprovalsService;
  // apps가 받는 것. callerDirectory는 apps가 lophn-agent session 표로 채우고, releases(bundleLocator)가 채운다.
  // 없으면 apps wiring이 "아직 없음"이나 대체 구현으로 돈다.
  callerDirectory: CallerDirectory;
  bundleLocator: BundleLocator;
  appViewSignal: AppViewSignal;
  // apps가 낸다. releases-problems(activation)와 workspaces-sessions(rewind)가 쓴다.
  appIntake: AppIntake;
  // 앱 tool 호출 길. runs가 앱 tool을 부른다.
  appCallPath: AppToolCallPath;
  // apps가 낸다. 앱 화면의 view 표. remote가 폰 연결이 닫힐 때 그 기기의 view를 지운다.
  appViews: AppViews;
  // apps가 낸다. 앱 event(와 core가 낼 event `lophn`)를 구독 앱에 넘긴다.
  eventDelivery: EventDelivery;
  invocationLedger: InvocationLedger;
  appRewind: AppRewind;
  // annotations가 받는 것. Router(workspaces-sessions)가 annotationDelivery를 채운다. 없으면 보내기는 unavailable이다.
  annotationDelivery: AnnotationDelivery;
  // lophn-agent runtime이 낸다. 메모리 queue 하나를 Router와 turn source가 나눠 쓴다.
  queue: Queue;
  // host-queue wiring이 낸다. core가 shell에 시킬 일(탭 열기·닫기)의 메모리 queue다. 뒤 task가 쓴다.
  hostQueue: HostQueue;
  // host-queue wiring이 낸다. shell main과의 `/host-link` 연결이다. 다른 wiring이 coding·터미널 frame을 받는다.
  hostLink: HostLink;
  // coding-relay wiring이 낸다. host가 올린 터미널 coding agent 목록과 GUI 대화 사본이다. acp·session-lifecycle·터미널 보기가 쓴다.
  codingRelay: CodingRelay;
  // terminal-view wiring이 낸다. 폰이 보는 coding session 터미널의 최신 화면과 보는 principal의 lease다.
  terminalView: TerminalView;
  // 폰이 터미널에 글을 칠 수 있는 principal인지 정한다. 기기마다의 허락을 아는 쪽이 채우고, 채워지지 않았으면 입력은 늘 forbidden이다.
  // `ctx.peek`로만 읽는다.
  terminalInputGrant: (principal: string) => boolean;
  // remote가 낸다. 기기에 `request`를 보내고 답을 기다린다. `primary()`는 기준 폰의 기기 id(없으면 null)다.
  phoneLink: {
    call: PhoneLink["call"];
    primary(): Promise<Result<string | null>>;
  };
  // harness wiring이 낸다. host-queue wiring이 `tabs/open`의 tui에서 부른다(판정과 hold).
  harnessHold: HarnessHold;
  // approvals가 낸다. 답 없는 질문의 기다림(메모리).
  questionWaits: ReturnType<typeof createQuestionWaits>;
  // session-snapshots가 낸다. agent runtime이 보낸 쓰는 중인 model 글과 도는 turn의 active를 받아 snapshot의
  // `writing`·`elapsed`를 든다.
  liveTurns: LiveTurns;
  // API server가 쓰는 쓰기 앞 처리기를 모두 접은 writer다. core 안에서 command를 내는 곳은 날 writer(runtime.writer)가 아니라
  // 이것을 써야 사람이 낸 것과 같은 층(commit 뒤 Bus, 본문 준비, queue 적용)을 지난다. 층이 다 생긴 뒤에 채워지므로 부를 때 읽는다.
  writer: Writer;
  // runs와 workflows가 낸다. jobs가 차례마다 run을 열고 instance를 시작할 때 쓴다.
  runService: RunService;
  workflowService: ReturnType<typeof createWorkflowService>;
  // flows wiring이 낸다. workflows wiring이 먼저 만들어지므로 부를 때 읽는다.
  flowHost: WorkflowFlows;
  // notices wiring이 낸다. program이 사람에게 남기는 기록을 쓴다. 다른 wiring이 부를 때 읽는다.
  noticeRecorder: NoticeRecorder;
  // attention wiring이 낸다. 기기 목록과 push 보내기를 꽂고(`bindPush`) 기기가 끊길 때 보고를 지운다(`forgetReporter`).
  attention: Attention;
};

const LATE_KEYS: Record<keyof Late, true> = {
  assembled: true,
  allRoutes: true,
  schemaSteps: true,
  migrationsApplied: true,
  ledgerId: true,
  machine: true,
  epoch: true,
  eventNames: true,
  operations: true,
  statusSource: true,
  diagnosticsWrite: true,
  blobRead: true,
  registry: true,
  io: true,
  appsSupervision: true,
  runtime: true,
  shellCapabilities: true,
  knownSecrets: true,
  blobRelay: true,
  blobBuffer: true,
  bodyPrepare: true,
  prepareRelay: true,
  appsControl: true,
  rewindFiles: true,
  mcpAuthControl: true,
  issuerRequests: true,
  server: true,
  uploads: true,
  fileStreams: true,
  shutdown: true,
  settings: true,
  settingDeclarations: true,
  settingsUpdate: true,
  secretStore: true,
  secretAttach: true,
  bus: true,
  gateway: true,
  approvals: true,
  callerDirectory: true,
  bundleLocator: true,
  appViewSignal: true,
  appIntake: true,
  appCallPath: true,
  appViews: true,
  eventDelivery: true,
  invocationLedger: true,
  appRewind: true,
  annotationDelivery: true,
  queue: true,
  hostQueue: true,
  hostLink: true,
  codingRelay: true,
  terminalView: true,
  terminalInputGrant: true,
  phoneLink: true,
  harnessHold: true,
  questionWaits: true,
  liveTurns: true,
  writer: true,
  runService: true,
  workflowService: true,
  flowHost: true,
  noticeRecorder: true,
  attention: true,
};

export type WiringContext = {
  readonly options: CoreOptions;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly root: DataRoot;
  readonly ledgerPath: string;
  // 이 process의 구조화 log·trace·metric. console.error 대신 telemetry.logger를 쓴다.
  readonly telemetry: Telemetry;
  // 구동기가 쓴다. status와 restore가 읽는다.
  ready: boolean;
  stopped: boolean;
  // platform/io child의 message를 받을 쪽. build에서 올리고 supervision이 io를 시작할 때 묶는다.
  readonly ioListeners: IoListener[];
  // 구성 요소 점검. owner마다 build에서 더하고 diagnostics가 status를 낼 때 모두 돌린다.
  readonly componentChecks: ComponentCheck[];
  // 제품 판을 견준 뒤 부를 쪽. 다른 wiring이 build·start에서 올리고 notices wiring이 afterReady에서 부른다(올린 순서대로, 하나가 던져도 나머지를 부른다).
  readonly productStartListeners: ProductStartListener[];
  readonly peek: Readonly<Partial<Late>>;
  provide<K extends keyof Late>(key: K, value: Late[K]): void;
} & Readonly<Late>;

export function createWiringContext(base: {
  options: CoreOptions;
  clock: Clock;
  random: RandomSource;
  root: DataRoot;
  ledgerPath: string;
  telemetry: Telemetry;
}): WiringContext {
  const slots: Partial<Late> = {};
  const ctx = {
    ...base,
    ready: false,
    stopped: false,
    ioListeners: [],
    componentChecks: [],
    productStartListeners: [],
    peek: slots,
    provide<K extends keyof Late>(key: K, value: Late[K]) {
      slots[key] = value;
    },
  };
  for (const key of Object.keys(LATE_KEYS) as (keyof Late)[]) {
    Object.defineProperty(ctx, key, {
      enumerable: true,
      get() {
        if (!(key in slots)) throw new Error(`wiring slot not ready: ${key}`);
        return slots[key];
      },
    });
  }
  return ctx as unknown as WiringContext;
}
