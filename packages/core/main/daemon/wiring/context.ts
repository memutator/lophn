// module wiring이 서로를 import하지 않고 값을 주고받는 길. wiring을 아는 것은 assembly.ts와 core.ts뿐이고
// wiring은 이 file(과 module·protocol)만 가져간다.
//
// 구동 순서(core.ts의 open이 이 순서로 hook을 부른다. 같은 hook은 WIRINGS 순서대로다):
//   environment → assemble → schemaSteps·schemaStepsAfterTeams → migration → restartOwners → operations
//   → prepare → openRuntime → records → build → API → start → ready → afterReady
// 종료 순서: closeIntake → server.stop → closeChildren → 감독 정지 → closeWork → runtime.close → stopped
import type { Clock, RandomSource, Result } from "../../../../base/mod.ts";
import type { Frame, Route } from "../../../../protocol/base/mod.ts";
import type {
  AuthenticatedContext,
  SchemaStep,
} from "../../../../protocol/server/mod.ts";
import type { ChildMessage } from "../../../../protocol/supervision/mod.ts";
import type {
  ApiServer,
  ApiServerOptions,
  FileStreamHandler,
  MemoryHandler,
  ReadHandler,
  UploadHandler,
} from "../../../server/mod.ts";
import type {
  CredentialRegistry,
  OperationPolicy,
} from "../../../server/identity/mod.ts";
import type { CodingCredentials } from "../../../server/identity/coding-credential-assembly.ts";
import type { KnownSecretMatch, Writer } from "../../../storage/ledger/mod.ts";
import type { RestartOwner } from "../../../storage/migration/mod.ts";
import type {
  BlobPrepareRelay,
  BufferGauge,
  PreparedRelayResult,
} from "../../../storage/blobs/prepare-relay.ts";
import type { BlobFieldDefinition } from "../../../../protocol/storage/mod.ts";
import type { StatusSource } from "../../../diagnostics/mod.ts";
import type { createSupervisor } from "../../../supervision/responsiveness/mod.ts";
import type { createAppsControl } from "../../../apps/control.ts";
import type { BodyPrepare } from "../../../lophn-agent/session/message-body.ts";
import type { RewindFilesDeps } from "../../../lophn-agent/session/rewind/files.ts";
import type { createMcpAuthControl } from "../../../lophn-agent/extensions/mcp-auth-control.ts";
import type { Assembled } from "../registration.ts";
import type { BlobPrepareCall, Core, CoreOptions } from "../core.ts";
import type { CoreRuntime } from "../runtime.ts";
import type { DataRoot } from "../../../install-and-update/mod.ts";

// 밖에서 바뀔 import 두 곳의 단일 import 지점이다. 위치가 옮겨지면 여기 한 줄만 고친다.
export { createDocumentsChannel as createWorkerChannel } from "../../../projects/file-tracking/coordinator/serving.ts";
export { createProductRedactor } from "../../../projects/outline-and-search/redactor.ts";

export type Supervisor = ReturnType<typeof createSupervisor>;
export type AppsControl = Awaited<ReturnType<typeof createAppsControl>>;
export type McpAuthControl = ReturnType<typeof createMcpAuthControl>;
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

// 종료 단계가 관측한 정지 조건. 세 개가 모두 참일 때만 정지 유지보수·restore가 돈다.
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

export type CoreExtension = Partial<
  Pick<Core, "restore" | "restorePlan" | "restoreStopped">
>;

export type Built = {
  // 쓰기 앞 처리기. WIRINGS 순서로 접는다(앞이 안쪽).
  writer?: (inner: Writer) => Writer;
  memory?: Iterable<readonly [string, MemoryHandler]>;
  uploads?: Iterable<readonly [string, UploadHandler]>;
  fileStreams?: Iterable<readonly [string, FileStreamHandler]>;
  workers?: NonNullable<ApiServerOptions["workers"]>;
  // `overlayReads` 같은 덧씌우기. runtime이 연 read 등록에 더한다.
  reads?: (reads: Map<string, ReadHandler>) => void;
  // 밖에 내놓는 Core 칸. 없으면 core.ts의 기본(restore 없음)이다.
  core?: CoreExtension;
};

export type Wiring = {
  name: string;
  // migration에 더한다. 팀 schema보다 앞(ledger, credential)과 뒤(settings, secret). 순서가 이력이다.
  schemaSteps?: readonly SchemaStep[];
  schemaStepsAfterTeams?: readonly SchemaStep[];
  // assemble(options.teams, env)과 withPlatform의 환경에 합쳐 넘긴다.
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
// wiring마다 core 한 번의 기동에 쓸 상태를 닫힘 안에 가진다(restore 뒤 같은 process에서 다시 기동한다).
export type WiringFactory = () => Wiring;

// 늦게 생기는 칸. 읽을 때 아직 없으면 오류가 난다. 채우는 쪽은 `provide`, 있을 때만 보려면 `peek`.
type Late = {
  assembled: Assembled;
  allRoutes: readonly Route[];
  schemaSteps: readonly SchemaStep[];
  ledgerId: string;
  epoch: string;
  eventNames: readonly string[];
  operations: readonly OperationPolicy[];
  statusSource: StatusSource;
  blobRead: BlobRead;
  coding: CodingCredentials;
  registry: CredentialRegistry;
  io: Supervisor;
  appsSupervision: Supervisor;
  runtime: CoreRuntime;
  knownSecrets: KnownSecretMatch;
  blobRelay: BlobRelay;
  blobBuffer: BufferGauge;
  bodyPrepare: BodyPrepare;
  prepareRelay: (
    call: BlobPrepareCall,
  ) => Promise<Result<PreparedRelayResult>>;
  appsControl: AppsControl;
  rewindFiles: RewindFilesDeps;
  mcpAuthControl: McpAuthControl;
  server: ApiServer;
  shutdown: () => Promise<void>;
};

const LATE_KEYS: Record<keyof Late, true> = {
  assembled: true,
  allRoutes: true,
  schemaSteps: true,
  ledgerId: true,
  epoch: true,
  eventNames: true,
  operations: true,
  statusSource: true,
  blobRead: true,
  coding: true,
  registry: true,
  io: true,
  appsSupervision: true,
  runtime: true,
  knownSecrets: true,
  blobRelay: true,
  blobBuffer: true,
  bodyPrepare: true,
  prepareRelay: true,
  appsControl: true,
  rewindFiles: true,
  mcpAuthControl: true,
  server: true,
  shutdown: true,
};

export type WiringContext = {
  readonly options: CoreOptions;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly root: DataRoot;
  readonly ledgerPath: string;
  // 구동기가 쓴다. status와 restore가 읽는다.
  ready: boolean;
  stopped: boolean;
  // platform/io child의 message를 받을 쪽. build에서 올리고 supervision이 io를 시작할 때 묶는다.
  readonly ioListeners: IoListener[];
  readonly peek: Readonly<Partial<Late>>;
  provide<K extends keyof Late>(key: K, value: Late[K]): void;
} & Readonly<Late>;

export function createWiringContext(base: {
  options: CoreOptions;
  clock: Clock;
  random: RandomSource;
  root: DataRoot;
  ledgerPath: string;
}): WiringContext {
  const slots: Partial<Late> = {};
  const ctx = {
    ...base,
    ready: false,
    stopped: false,
    ioListeners: [],
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
