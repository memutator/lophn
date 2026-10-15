// core 안 apps 제어 조립. `POST /v1/apps/connect`(메모리 route)와 runtime·logs read의
// 메인 스레드 덮기, supervisor 감독 pipe의 질의 통로, app credential 발급을 한곳에서 잇는다.
// 업무 규칙은 packages/core/apps/runtime에 있고 여기는 core의 읽기·인증·감독 통로를 끼운다.
import {
  canonicalize,
  type Clock,
  createIdSource,
  err,
  type IdSource,
  ok,
  type Result,
} from "../../base/mod.ts";
import {
  appAgentConfirmProof,
  appBlueprint,
  appConnect,
  type AppConnectInput,
  type AppGrant,
  appGrantsList,
  appLogs,
  appPairConfirmPoll,
  appPairConfirmRequest,
  appPairObserve,
  appPairPrepare,
  appRecordStarted,
  appRecordStopped,
  appRecordUnavailable,
  appRuntime,
  appViewClosed,
  type AppViewClosedInput,
  invocationAcceptConfirm,
  type InvocationAcceptConfirmInput,
  invocationRecordDenied,
  invocationRecordFinished,
  invocationRecordStarted,
  packagesGuideBody,
  previewsGet,
  previewsStart,
  previewsStop,
  releaseCancelPreparation,
  releaseCompleteActivation,
  releaseFailActivation,
  releasePreparation,
  releasePrepareBundle,
  releaseRecordBackup,
  releaseRecordDataChange,
  releaseRecordDataRestore,
  releasesGet,
} from "../../protocol/apps/mod.ts";
import {
  observeException,
  reportProblem,
} from "../../protocol/problems/mod.ts";
import type {
  AuthenticatedContext,
  RequestContext,
} from "../../protocol/server/mod.ts";
import {
  applyApprovedAction,
  approvalsGet,
  createApprovalRequest,
} from "../../protocol/approvals/mod.ts";
import type { KindLaunchSpec } from "../../protocol/supervision/mod.ts";
import type { MemoryHandler, ReadHandler } from "../server/mod.ts";
import {
  type AppCredentialIssuer,
  createAppCredentialIssuer,
  type CredentialRegistry,
  type OperationPolicy,
} from "../server/identity/mod.ts";
import {
  createTargetAuthorizer,
  openConnection,
} from "../storage/ledger/mod.ts";
import { existingAcceptance } from "./invocations/confirm.ts";
import { loadApp } from "./registration/mod.ts";
import type { Writer } from "../storage/ledger/mod.ts";
import {
  loadRelease,
  loadStoredBlueprint,
  releaseDeclarations,
} from "./releases/store.ts";
import { canonicalInputHash } from "./blueprint/mod.ts";
import { activationInProgress } from "./permissions/mod.ts";
import {
  createPairPreparer,
  type PairFacts,
  type PairPreparer,
} from "./connections/prepare.ts";
import {
  type ConfirmApprovals,
  type ConfirmTargets,
  createPairConfirmer,
  type PairConfirmer,
} from "./connections/confirm-request.ts";
import type { ConfirmAcceptances } from "./connections/confirm.ts";
import {
  type AppConnector,
  type ConnectFacts,
  createAppConnector,
  type ProcessSource,
} from "./runtime/connect.ts";
import type { DesiredApp } from "./runtime/supervisor/mod.ts";
import { type CoreSigner, createCoreSigner } from "./runtime/signing.ts";
import { allSlotSockets } from "./runtime/processes/mod.ts";
import {
  createSupervisorChannel,
  createSupervisorClient,
  processSourceOf,
  runtimeObservationOf,
  type SupervisorChannel,
  type SupervisorClient,
} from "./runtime/supervisor-link.ts";
import {
  type RuntimeSources,
  withRuntimeLogs,
  withRuntimeObservation,
} from "./runtime/reads.ts";
import {
  type ActivationDriver,
  createActivationDriver,
} from "./releases/activation/assembly.ts";
import {
  createReleaseFinalizer,
  FINALIZER_OPERATIONS,
} from "./releases/finalizer.ts";
import type { BlobPrepareCall } from "../main/daemon/core.ts";
import type { PreparedRelayResult } from "../storage/blobs/prepare-relay.ts";
import { createFsPreviewArea } from "./preview/area.ts";
import { createPreviewReads } from "./preview/reads.ts";
import {
  createPreviewService,
  type PreviewBundles,
  type PreviewReleases,
  type PreviewService,
} from "./preview/service.ts";

export const APPS_SUPERVISOR_KIND = "apps/supervisor";
export const APPS_CONTROL_PRINCIPAL = "machine:apps-control";

// connect·runtime·logs가 ledger 사실을 읽는 core 내부 자격이다. 호출자의 scope로 읽지 않는다:
// 호출자 접근은 먼저 따로 판정하고, 여기서는 App 한 행과 그 앱의 grant만 읽는다.
export const APPS_CONTROL_CONTEXT: RequestContext = {
  principal: APPS_CONTROL_PRINCIPAL,
  actor: "machine",
  // approval 적용(`apply_approved_action`)은 A→B confirm의 접수를 core 안에서 확정할 때만 쓴다.
  scope: {
    operations: [
      appGrantsList.name,
      applyApprovedAction.name,
      invocationAcceptConfirm.name,
      // activation 진행(apps/releases)이 시도의 상태를 읽고 참조·결과를 확정하고 사용 불가를 남긴다.
      releasesGet.name,
      releaseRecordBackup.name,
      releaseRecordDataChange.name,
      releaseRecordDataRestore.name,
      releaseCompleteActivation.name,
      releaseFailActivation.name,
      appRecordUnavailable.name,
      // 준비한 bundle의 같은 hash app test가 통과로 기록되면 release를 확정한다(release.prepare).
      ...FINALIZER_OPERATIONS,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: APPS_CONTROL_PRINCIPAL,
};

// supervisor machine credential이 닿는 operation. 관측 사실의 기록과 제어 connection뿐이다.
const SUPERVISOR_OPERATIONS = [
  appRecordStarted.name,
  appRecordStopped.name,
  appRecordUnavailable.name,
  appConnect.name,
  // 앱 쌍 연결 준비와 confirm은 core만 쥔 서명 key로 한다. 앱 자식의 요청을 supervisor가 신원과 함께 보낸다.
  appPairPrepare.name,
  appPairConfirmRequest.name,
  appPairConfirmPoll.name,
  appPairObserve.name,
  // broker가 요청마다 현재 release 선언과 active grant를 다시 읽는다.
  appBlueprint.name,
  appGrantsList.name,
  // 앱이 broker로 보낸 invocation 기록은 이 자격이 core command로 전달한다.
  invocationRecordStarted.name,
  invocationRecordFinished.name,
  invocationRecordDenied.name,
  // activation을 진행하는 supervisor는 시도의 참조·결과를 확정하고 시도의 현재 상태를 읽는다
  // 시작은 사람 approval의 적용(`apply_approved_action`)이다.
  releaseRecordBackup.name,
  releaseRecordDataChange.name,
  releaseRecordDataRestore.name,
  releaseCompleteActivation.name,
  releaseFailActivation.name,
  releasesGet.name,
];
// 자식 앱마다 받는 app credential이 닿는 operation. 문제 보고와 process 관측뿐이다.
const APP_CHILD_OPERATIONS = [reportProblem.name, observeException.name];

// registry 상한. 이 목록에 없는 operation은 그 actor에게 발급하지 못한다.
export function appsOperationPolicies(): OperationPolicy[] {
  return [
    ...[appRecordStarted, appRecordStopped, appRecordUnavailable].map((
      route,
    ): OperationPolicy => ({
      name: route.name,
      actors: ["machine"],
      kind: "command",
    })),
    // 제어 connection은 supervisor(machine), 호출 connection은 사람·agent·coding agent가 받는다.
    {
      name: appConnect.name,
      actors: ["machine", "agent", "coding_agent"],
      kind: "command",
    },
    // problems report collector(machine)가 자기 credential의 앱 log를 읽는다.
    { name: appLogs.name, actors: ["machine"], kind: "command" },
    // supervisor(machine)의 broker가 실행 범위(선언 ∩ grant)를 읽는다. machine 자격은 command 종류만 받는다.
    { name: appBlueprint.name, actors: ["machine"], kind: "command" },
    ...[
      appPairPrepare,
      appPairConfirmRequest,
      appPairConfirmPoll,
      appPairObserve,
    ].map((
      route,
    ): OperationPolicy => ({
      name: route.name,
      actors: ["machine"],
      kind: "command",
    })),
    { name: appGrantsList.name, actors: ["machine"], kind: "command" },
    // supervisor가 앱의 invocation 후행 기록을 core에 전달한다.
    ...[
      invocationRecordStarted,
      invocationRecordFinished,
      invocationRecordDenied,
    ].map((route): OperationPolicy => ({
      name: route.name,
      actors: ["machine"],
      kind: "command",
    })),
    ...[
      releaseRecordBackup,
      releaseRecordDataChange,
      releaseRecordDataRestore,
      releaseCompleteActivation,
      releaseFailActivation,
      releasesGet,
    ].map((route): OperationPolicy => ({
      name: route.name,
      actors: ["machine"],
      kind: "command",
    })),
    // 호출한 앱 자신이 다른 앱의 confirm 호출 approval을 요청한다(요청자는 자격과 같아야 한다). core가
    // 그 요청 한 번을 위해서만 짧은 app credential을 발급한다. 앱 자식에게 주는 credential에는 없다.
    { name: createApprovalRequest.name, actors: ["app"], kind: "command" },
    // preview는 사람(전체 user 상한)과 coding agent가 연다.
    ...[previewsStart, previewsGet, previewsStop].map((
      route,
    ): OperationPolicy => ({
      name: route.name,
      actors: ["coding_agent"],
      kind: "read",
    })),
    // 안내 원문 한 field만 읽는 좁은 읽기다. coding agent에 일반 blobs/read는 열지 않는다.
    { name: packagesGuideBody.name, actors: ["coding_agent"], kind: "read" },
    { name: reportProblem.name, actors: ["app"], kind: "command" },
    { name: observeException.name, actors: ["app"], kind: "command" },
    // release 준비 접수·진행은 coding agent와 machine, 취소는 machine만 한다. 확정(release.prepare)은 아니다.
    ...[releasePrepareBundle, releasePreparation].map((
      route,
    ): OperationPolicy => ({
      name: route.name,
      actors: ["coding_agent", "machine"],
      kind: "command",
    })),
    {
      name: releaseCancelPreparation.name,
      actors: ["machine"],
      kind: "command",
    },
  ];
}

export type AppsControlDeps = {
  clock: Clock;
  ledgerPath: string;
  readers: {
    read(
      route: { resource: string; method: string },
      ctx: RequestContext,
      input: unknown,
    ): Promise<Result<unknown>>;
  };
  // credential_ref의 지금 상태. 폐기·종료된 자격은 err다.
  revalidate(credentialRef: string): Result<AuthenticatedContext>;
  // 알려진 secret까지 지운 log 줄. 안전화를 끝내지 못하면 null이다.
  redact(line: string): string | null;
  // 테스트가 supervisor 대신 프로세스 출처를 바꿔 끼운다. 제품 기동에는 없다.
  process?: ProcessSource;
  // 발급한 connection의 회수 검사 간격(ms). 기본 1000.
  sweepMs?: number;
  // A→B confirm의 approval·접수 어댑터. 없으면 confirm 준비는 unavailable이다. 대상의 고정 blueprint
  // 검사(`ConfirmTargets`)는 core가 ledger에서 읽어 제품 조립이 항상 채운다.
  confirm?: {
    approvals: ConfirmApprovals;
    accepted: ConfirmAcceptances;
    targets?: ConfirmTargets;
  };
  ids?: IdSource;
  // activation 진행과 운영 DesiredApp 맞춤. core 조립이 없으면(시험의 부분 조립) 하지 않는다.
  activation?: {
    dataRoot: string;
    command(
      ctx: RequestContext,
      envelope: {
        command: string;
        input: unknown;
        idempotency_key: string;
        compare: unknown;
        prepared: string[];
      },
    ): Promise<Result<unknown>> | undefined;
    machine(): RequestContext | undefined;
    prepareBlob(call: BlobPrepareCall): Promise<Result<PreparedRelayResult>>;
    platformPorts: () => readonly number[];
  };
  // preview(`/v1/previews/*`). disposable 영역은 data root 아래에 만든다. bundle을 여는 자리가
  // 없으면 시작은 unavailable이고 조회·종료는 그대로 된다(apps/preview).
  previews?: {
    dataRoot: string;
    bundles?: PreviewBundles;
    releases?: PreviewReleases;
    nonce?: () => string;
  };
};

export type AppsControl = {
  // 앱 시작 입력에 싣는 공개 검증 key. 서명 key는 core 시작마다 새로 만든다.
  readonly verifyKey: string;
  // core 안에서 하나뿐인 서명 key 쥠이다. AppConnection과 confirm proof를 같은 key로 서명한다.
  readonly signer: CoreSigner;
  readonly memory: ReadonlyMap<string, MemoryHandler>;
  // release 준비 접수·진행·취소. command route지만 진행이 supervisor 메모리라 ledger queue를 거치지 않는다.
  // 키는 command 이름이고 `withReleasePreparation`이 writer 앞에서 이 처리기로 돌린다.
  readonly commands: ReadonlyMap<string, MemoryHandler>;
  grantChange(
    writer: Writer,
    ctx: AuthenticatedContext,
    envelope: Parameters<Writer["command"]>[1],
  ): ReturnType<Writer["command"]>;
  // reader pool의 apps.runtime·apps.logs를 현재 관측·log로 덮는다.
  overlayReads(reads: Map<string, ReadHandler>): void;
  readonly channel: SupervisorChannel;
  readonly client: SupervisorClient;
  readonly connector: AppConnector;
  // 앱 쌍 연결 준비. 그 앱이 source이거나 target인 발급 연결을 막는 `close`도 이 서비스가 쥔다.
  readonly preparer: PairPreparer;
  // A→B confirm. approval·접수 어댑터가 없으면 null이다.
  readonly confirmer: PairConfirmer | null;
  // connect·runtime이 읽는 현재 ledger 사실(App 한 행과 active grant). 시험이 같은 읽기를 쓴다.
  readonly facts: ConnectFacts;
  // 원하는 앱 상태를 supervisor에 알린다. 마지막 상태를 기억해 supervisor가 다시 떠도
  // 같은 상태로 맞춘다(releases 조립이 활성 release를 보고 부른다).
  reconcile(desired: DesiredApp): Promise<Result<void>>;
  // activation 진행·운영 DesiredApp 맞춤. 조립이 없으면 null이다.
  readonly activation: ActivationDriver | null;
  // supervisor 감독 callback의 message. credential 요청과 진단을 처리한다.
  onSupervisorMessage(message: { type: string }): void;
  // app credential 발급을 켠다. 감독 pipe가 열린 뒤 부른다.
  useIssuer(issuer: AppCredentialIssuer): void;
  // 지금 한 번 connect 회수 검사와 supervisor 상태 맞춤을 돌린다(시험·timer가 같은 함수).
  sweep(): Promise<void>;
  // 회수 검사 timer를 켠다. core가 준비된 뒤 부른다.
  start(): void;
  stop(): void;
};

function internalError(): Result<never> {
  return err({ code: "unavailable", message: "app facts are unavailable" });
}

const GRANT_PAGES = 20;

// preview가 release로 여는 bundle이다. 없는 release·다른 앱의 release는 undefined라 같은 거절이다.
export function ledgerPreviewReleases(ledgerPath: string): PreviewReleases {
  return {
    bundleOf(app, release) {
      const opened = openConnection(ledgerPath);
      if (!opened.ok) return Promise.resolve(internalError());
      try {
        const found = loadRelease(opened.value.sql, release);
        if (!found.ok) return Promise.resolve(internalError());
        return Promise.resolve(
          ok(
            found.value === null || found.value.app !== app
              ? undefined
              : found.value.bundle_hash,
          ),
        );
      } catch {
        return Promise.resolve(internalError());
      } finally {
        opened.value.close();
      }
    },
  };
}

// confirm=true command의 입력 지문이다. 대상 release의 고정 blueprint로 계산하고 confirm 선언이 없는
// command나 선언 schema에 맞지 않는 입력은 invalid_input이다.
export function ledgerConfirmTargets(ledgerPath: string): ConfirmTargets {
  return {
    async prepare(request) {
      const opened = openConnection(ledgerPath);
      if (!opened.ok) return internalError();
      let stored;
      try {
        stored = loadStoredBlueprint(opened.value.sql, request.release);
      } catch {
        return internalError();
      } finally {
        opened.value.close();
      }
      if (!stored.ok) return internalError();
      // 다른 앱의 release나 없는 release는 없는 대상과 같다.
      if (stored.value === null || stored.value.release.app !== request.app) {
        return err({ code: "not_found", message: "app not found" });
      }
      const declared = stored.value.blueprint.commands.find((entry) =>
        entry.key === request.command
      );
      if (declared === undefined || !declared.confirm) {
        return err({
          code: "invalid_input",
          message: "the command is not a confirm command",
        });
      }
      const hashed = await canonicalInputHash(declared.input, request.input);
      if (!hashed.ok) {
        return err({
          code: "invalid_input",
          message: "the input does not match the command schema",
        });
      }
      return ok({ input_hash: hashed.value });
    },
  };
}

export async function createAppsControl(
  deps: AppsControlDeps,
): Promise<AppsControl> {
  const signer = await createCoreSigner();
  const channel = createSupervisorChannel();
  const client = createSupervisorClient(channel);
  const desired = new Map<string, DesiredApp>();
  let issuer: AppCredentialIssuer | undefined;

  const facts: ConnectFacts = {
    // App 한 행은 읽기 전용 connection으로 짧게 읽는다(app.get은 machine actor가 닿는 read가
    // 아니고, 호출자 자격으로 읽지도 않는다).
    app(id) {
      const opened = openConnection(deps.ledgerPath);
      if (!opened.ok) return Promise.resolve(internalError());
      try {
        const found = loadApp(opened.value.sql, id);
        if (!found.ok) return Promise.resolve(internalError());
        const app = found.value;
        return Promise.resolve(ok(
          app === null ? null : {
            id: app.id,
            status: app.status,
            run_enabled: app.run_enabled,
            active_release: app.active_release,
          },
        ));
      } catch {
        return Promise.resolve(internalError());
      } finally {
        opened.value.close();
      }
    },
    async grants(id) {
      const grants: AppGrant[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < GRANT_PAGES; page++) {
        const read = await deps.readers.read(
          appGrantsList,
          APPS_CONTROL_CONTEXT,
          {
            app: id,
            status: "active",
            ...(cursor === undefined ? {} : { cursor }),
          },
        );
        if (!read.ok) return internalError();
        const body = read.value as {
          grants: AppGrant[];
          next_cursor: string | null;
        };
        grants.push(...body.grants);
        if (body.next_cursor === null) return ok(grants);
        cursor = body.next_cursor;
      }
      // 끝을 못 봤으면 허락이 더 있을 수 있다. 읽은 것만으로 판단하지 않는다.
      return internalError();
    },
  };

  const connector = createAppConnector({
    clock: deps.clock,
    signer,
    process: deps.process ?? processSourceOf(client),
    facts,
    authorize: (ctx, operation, target) =>
      createTargetAuthorizer(ctx)(ctx, operation, target),
    current: (credentialRef) => deps.revalidate(credentialRef),
  });

  const sources: RuntimeSources = {
    async observation(app) {
      const observed = await client.observe(app);
      if (!observed.ok) return observed;
      return ok(
        observed.value === null ? null : runtimeObservationOf(observed.value),
      );
    },
    logs: (app, query) => client.logs(app, query),
    async app(id) {
      const found = await facts.app(id);
      return found;
    },
    redact: deps.redact,
    now: () => deps.clock.now(),
  };

  const previewService: PreviewService | undefined = deps.previews
    ? createPreviewService({
      clock: deps.clock,
      nonce: deps.previews.nonce ?? (() => crypto.randomUUID()),
      supervisor: {
        start: (launch) => client.previewStart(launch),
        observe: (app, nonce) => client.previewObserve(app, nonce),
        stop: (app, nonce) => client.previewStop(app, nonce),
      },
      area: createFsPreviewArea(deps.previews.dataRoot),
      apps: {
        async exists(app) {
          const found = await facts.app(app);
          return found.ok ? ok(found.value !== null) : found;
        },
      },
      authorize: (ctx, operation, target) =>
        createTargetAuthorizer(ctx)(ctx, operation, target),
      ...(deps.previews.bundles ? { bundles: deps.previews.bundles } : {}),
      // release → bundle 대응은 ledger의 준비된 release가 정한다. 시험이 바꿔 끼울 수 있다.
      releases: deps.previews.releases ??
        ledgerPreviewReleases(deps.ledgerPath),
    })
    : undefined;

  const connect: MemoryHandler = async (ctx, input) => {
    const connected = await connector.connect(
      ctx,
      input as AppConnectInput,
    );
    return connected;
  };

  // 앱 쌍 연결·confirm이 읽는 사실이다. connect와 같은 App 행·grant에 현재 release의 선언을 더한다.
  const pairFacts: PairFacts = {
    ...facts,
    declarations(app) {
      const opened = openConnection(deps.ledgerPath);
      if (!opened.ok) return Promise.resolve(internalError());
      try {
        const found = releaseDeclarations.get(opened.value.sql, app);
        if (!found.ok) return Promise.resolve(internalError());
        return Promise.resolve(ok(
          found.value === null ? null : {
            release: found.value.release,
            app_connections: found.value.app_connections,
          },
        ));
      } catch {
        return Promise.resolve(internalError());
      } finally {
        opened.value.close();
      }
    },
  };
  const process = deps.process ?? processSourceOf(client);
  const preparer = createPairPreparer({
    clock: deps.clock,
    signer,
    process,
    facts: pairFacts,
  });
  const confirmer = deps.confirm === undefined ? null : createPairConfirmer({
    process,
    facts: pairFacts,
    signer,
    paths: preparer.paths,
    ids: deps.ids ?? createIdSource({
      clock: deps.clock,
      random: { fill: (bytes: Uint8Array) => crypto.getRandomValues(bytes) },
    }),
    targets: deps.confirm.targets ?? ledgerConfirmTargets(deps.ledgerPath),
    approvals: deps.confirm.approvals,
    accepted: deps.confirm.accepted,
  });

  // supervisor(machine)가 앱 자식의 요청을 그 자식 연결의 신원과 함께 보낸다. 신원 주장은 서비스가
  // 현재 supervisor 관측과 맞춰 본다(옛 프로세스·교체된 release의 요청은 거절).
  const sourceOf = (value: {
    app: string;
    release: string | null;
    mode: "live" | "preview" | "test";
    process_nonce: string;
  }) => ({
    app: value.app,
    release: value.release,
    mode: value.mode,
    processNonce: value.process_nonce,
  });
  const pairUnavailable = (): Result<never> =>
    err({ code: "unavailable", message: "app confirm is not available" });
  const pairPrepare: MemoryHandler = (_ctx, input) => {
    const body = input as {
      source: Parameters<typeof sourceOf>[0];
      app: string;
      commands: string[];
      parent_invocation: string | null;
      incoming?: {
        app: string;
        release: string;
        parent_invocation: string | null;
      };
    };
    return preparer.prepare({
      source: sourceOf(body.source),
      app: body.app,
      commands: body.commands,
      parent_invocation: body.parent_invocation,
      ...(body.incoming === undefined ? {} : { incoming: body.incoming }),
    });
  };
  const pairConfirmRequest: MemoryHandler = (_ctx, input) => {
    if (confirmer === null) return Promise.resolve(pairUnavailable());
    const body = input as {
      source: Parameters<typeof sourceOf>[0];
      app: string;
      command: string;
      input?: unknown;
      target_release: string;
      target_process_nonce: string;
      parent_invocation: string | null;
    };
    return confirmer.request({
      source: sourceOf(body.source),
      app: body.app,
      command: body.command,
      ...(body.input === undefined ? {} : { input: body.input }),
      target_release: body.target_release,
      target_process_nonce: body.target_process_nonce,
      parent_invocation: body.parent_invocation,
    });
  };
  const pairObserve: MemoryHandler = (_ctx, input) => {
    const body = input as
      | {
        event: "start";
        process_nonce: string;
        invocation: string;
        caller: { kind: string };
      }
      | { event: "exit"; process_nonce: string };
    if (body.event === "start") {
      const caller = body.caller as Record<string, unknown>;
      preparer.paths.started(
        { processNonce: body.process_nonce },
        body.invocation,
        {
          kind: body.caller.kind,
          app: typeof caller.app === "string" ? caller.app : undefined,
          release: typeof caller.release === "string"
            ? caller.release
            : undefined,
          parent: caller.parent_invocation,
        },
      );
    } else {
      preparer.paths.forget(body.process_nonce);
    }
    return Promise.resolve(ok({ accepted: true as const }));
  };
  const pairConfirmPoll: MemoryHandler = (_ctx, input) => {
    if (confirmer === null) return Promise.resolve(pairUnavailable());
    const body = input as {
      source: Parameters<typeof sourceOf>[0];
      approval: string;
      wait_ms?: number;
    };
    return confirmer.poll({
      source: sourceOf(body.source),
      approval: body.approval,
      wait_ms: body.wait_ms ?? 0,
    });
  };

  // release 준비 요청. 범위 밖 앱과 없는 앱, source가 연결되지 않은 앱은 같은 거절이다.
  // 진행은 core가 아니라 supervisor 메모리에 있고 core는 요청 하나씩 전달한다(apps/releases).
  function sourcePathOf(app: string): Promise<Result<string | null>> {
    const opened = openConnection(deps.ledgerPath);
    if (!opened.ok) return Promise.resolve(internalError());
    try {
      const found = loadApp(opened.value.sql, app);
      if (!found.ok) return Promise.resolve(internalError());
      return Promise.resolve(ok(found.value?.source_path ?? null));
    } catch {
      return Promise.resolve(internalError());
    } finally {
      opened.value.close();
    }
  }
  const releaseGate = async (
    ctx: AuthenticatedContext,
    route: { name: string },
    app: string,
    absent: "forbidden" | "not_found",
  ): Promise<Result<string>> => {
    const refuse = (): Result<never> =>
      err({ code: absent, message: "app not found" });
    const allowed = createTargetAuthorizer(ctx)(ctx, route.name, { app });
    if (!allowed.ok) return refuse();
    const source = await sourcePathOf(app);
    if (!source.ok) return source;
    return source.value === null ? refuse() : ok(source.value);
  };
  const releasePrepareBundleHandler: MemoryHandler = async (ctx, input) => {
    const body = input as {
      app: string;
      commit: string;
      request_key: string;
      ticket_source?: { ticket: string; claim_seq: string };
    };
    const source = await releaseGate(
      ctx,
      releasePrepareBundle,
      body.app,
      "forbidden",
    );
    if (!source.ok) return source;
    const accepted = await client.releasePrepare({
      app: body.app,
      commit: body.commit,
      request_key: body.request_key,
      source_path: source.value,
    });
    if (accepted.ok) {
      finalizer?.watch(body.app, body.request_key, {
        commit: body.commit,
        actor: ctx.actor,
        ticket_source: body.ticket_source,
      });
    }
    return accepted;
  };
  const releasePreparationHandler: MemoryHandler = async (ctx, input) => {
    const body = input as { app: string; request_key: string };
    const source = await releaseGate(
      ctx,
      releasePreparation,
      body.app,
      "not_found",
    );
    if (!source.ok) return source;
    const read = await client.releasePreparation(body.app, body.request_key);
    if (!read.ok || finalizer === null) return read;
    // 준비가 끝났고 같은 hash의 통과한 app test가 있으면 여기서 release가 확정된다.
    const finalized = await finalizer.observe(read.value);
    if (finalized.ok) return read;
    // release.preparation이 내는 오류 코드만 쓴다. 확정이 거절한 이유(claim 변경 같은 conflict)는 숨기지 않는다.
    const { code, message } = finalized.error;
    return err({
      code: code === "forbidden" || code === "invalid_input"
        ? code
        : "unavailable",
      message,
    });
  };
  const releaseCancelHandler: MemoryHandler = async (ctx, input) => {
    const body = input as { app: string; request_key: string };
    const source = await releaseGate(
      ctx,
      releaseCancelPreparation,
      body.app,
      "forbidden",
    );
    if (!source.ok) return source;
    const cancelled = await client.releaseCancel(body.app, body.request_key);
    return cancelled.ok ? ok({ accepted: true as const }) : cancelled;
  };

  const finalizer = deps.activation === undefined
    ? null
    : createReleaseFinalizer({
      ledgerPath: deps.ledgerPath,
      dataRoot: deps.activation.dataRoot,
      command: deps.activation.command,
      machine: deps.activation.machine,
    });

  async function reconcileApp(next: DesiredApp): Promise<Result<void>> {
    desired.set(next.app, next);
    return await client.reconcile(next);
  }

  const activation: ActivationDriver | null = deps.activation === undefined
    ? null
    : createActivationDriver({
      clock: deps.clock,
      ids: deps.ids ?? createIdSource({
        clock: deps.clock,
        random: {
          fill: (bytes: Uint8Array) => crypto.getRandomValues(bytes),
        },
      }),
      ledgerPath: deps.ledgerPath,
      dataRoot: deps.activation.dataRoot,
      client,
      bound: () => channel.bound,
      facts,
      readers: deps.readers,
      command: deps.activation.command,
      machine: deps.activation.machine,
      prepareBlob: deps.activation.prepareBlob,
      platformPorts: deps.activation.platformPorts,
      reconcile: reconcileApp,
    });

  async function grantChange(
    writer: Writer,
    ctx: AuthenticatedContext,
    envelope: Parameters<Writer["command"]>[1],
  ): ReturnType<Writer["command"]> {
    if (envelope.command !== applyApprovedAction.name) {
      return writer.command(ctx, envelope);
    }
    const input = envelope.input as {
      approval?: string;
      action?: {
        command?: string;
        caller?: string;
        comparison?: { grants_seq?: string };
        input?: { value?: { app?: string; grant?: string } };
      };
    };
    const action = input.action;
    if (action?.command !== "grant.revoke" || action.caller !== "user") {
      return writer.command(ctx, envelope);
    }
    // 정확한 허락을 독립 재조회하기 전에는 다른 앱을 멈추지도 않는다. writer는 같은 action·CAS를 다시 검사한다.
    const read = await deps.readers.read(approvalsGet, ctx, {
      approval: input.approval,
    });
    if (!read.ok) return read;
    const approved = read.value as {
      request: {
        status: string;
        action: unknown;
        expires_at: string | null;
        run: string | null;
      };
      use: unknown;
    };
    const request = approved.request;
    if (
      ctx.actor !== "user" || !deps.revalidate(ctx.credential_ref).ok ||
      approved.use !== null || request.run !== null ||
      request.status !== "granted" ||
      (request.expires_at !== null &&
        Date.parse(request.expires_at) <= deps.clock.nowMs()) ||
      canonicalize(request.action) !== canonicalize(action)
    ) return writer.command(ctx, envelope);
    const app = action.input?.value?.app;
    if (
      typeof app !== "string" || activation === null ||
      deps.activation === undefined
    ) return writer.command(ctx, envelope);
    const allowed = createTargetAuthorizer(ctx)(ctx, "grant.revoke", { app });
    if (!allowed.ok) return writer.command(ctx, envelope);
    const listed = await deps.readers.read(appGrantsList, ctx, {
      app,
      limit: 200,
    });
    if (!listed.ok) return writer.command(ctx, envelope);
    const grants = listed.value as { grants: AppGrant[] };
    const grant = grants.grants.find((entry) =>
      entry.id === action.input?.value?.grant && entry.app === app &&
      entry.status === "active"
    );
    if (grant === undefined) return writer.command(ctx, envelope);
    const ledger = openConnection(deps.ledgerPath);
    if (!ledger.ok) return writer.command(ctx, envelope);
    try {
      if (activationInProgress(ledger.value.sql, app)) {
        return writer.command(ctx, envelope);
      }
    } finally {
      ledger.value.close();
    }
    const factsOf = await facts.app(app);
    if (!factsOf.ok || factsOf.value === null) {
      return writer.command(ctx, envelope);
    }
    const paused = await client.activationPause(app);
    if (!paused.ok || !paused.value) {
      return err({
        code: "unavailable",
        message:
          "process termination is not confirmed; the revoke is not complete",
      });
    }
    // pause는 OS 종료와 record_stopped를 마친 뒤 true다. action을 새 evidence로 바꾸지 않는다.
    const done = await writer.command(ctx, envelope);
    // 회수가 확정되지 않았으면 옛 desired 그대로 다시 열고, 확정됐으면 새 flag의 desired를 먼저 알린 뒤 연다.
    // 새 desired를 알리지 못하면 붙든 채 두고(옛 flag로 다시 띄우지 않는다) sweep이 이어서 맞춘다.
    if (done.ok && !(await activation.applyGrants(app))) return done;
    await client.activationResume(app);
    return done;
  }

  // 사람의 shell이 닫은 화면 view를 그 앱의 지금 live 자식에 중계한다. 앱 프로세스 nonce는
  // supervisor가 지금 쥔 자식에서 정하고 본문에서 받지 않는다. 범위 밖 앱은 없는 앱과 같다.
  // agent caller의 confirm proof. apply_approved_action이 만든 접수를 core key로 서명해 돌려준다.
  // 새 접수와 approval 사용은 여기 없다. 앱·direct caller는 이 길로 받지 않는다.
  const agentConfirmProof: MemoryHandler = async (_ctx, value) => {
    const input = value as InvocationAcceptConfirmInput;
    if (input.caller.kind !== "agent") {
      return err({
        code: "forbidden",
        message: "confirm caller is not an agent",
      });
    }
    const opened = openConnection(deps.ledgerPath);
    if (!opened.ok) {
      return err({ code: "unavailable", message: "ledger is unavailable" });
    }
    try {
      const found = existingAcceptance(opened.value.sql, input);
      if (!found.ok) return found;
      if (found.value === undefined) {
        return err({ code: "not_found", message: "acceptance not found" });
      }
      const proof = await signer.signConfirmProof(found.value.proof);
      return ok({ invocation: found.value.invocation, proof });
    } catch {
      return err({ code: "unavailable", message: "ledger is unavailable" });
    } finally {
      opened.value.close();
    }
  };

  const viewClosed: MemoryHandler = async (ctx, value) => {
    const input = value as AppViewClosedInput;
    if (!deps.revalidate(ctx.credential_ref).ok) {
      return err({ code: "unauthorized", message: "credential unavailable" });
    }
    const allowed = createTargetAuthorizer(ctx)(ctx, appViewClosed.name, {
      app: input.app,
    });
    if (!allowed.ok) {
      return err({ code: "not_found", message: "app not found" });
    }
    const relayed = await client.viewClosed(input.app, input.view_session);
    return relayed.ok ? ok({ relayed: relayed.value }) : relayed;
  };

  async function sweep(): Promise<void> {
    await connector.sweep().catch(() => 0);
    await activation?.sweep().catch(() => undefined);
    // supervisor가 다시 떠서 상태를 잃었으면 마지막으로 알린 상태로 맞춘다.
    for (const app of desired.values()) {
      if (!channel.bound) return;
      const observed = await client.observe(app.app);
      if (observed.ok && observed.value === null) {
        await client.reconcile(app).catch(() => undefined);
      }
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined;

  return {
    verifyKey: signer.verifyKey,
    signer,
    memory: new Map<string, MemoryHandler>([
      [`${appConnect.resource}/${appConnect.method}`, connect],
      [`${appViewClosed.resource}/${appViewClosed.method}`, viewClosed],
      [
        `${appAgentConfirmProof.resource}/${appAgentConfirmProof.method}`,
        agentConfirmProof,
      ],
      [`${appPairPrepare.resource}/${appPairPrepare.method}`, pairPrepare],
      [
        `${appPairConfirmRequest.resource}/${appPairConfirmRequest.method}`,
        pairConfirmRequest,
      ],
      [
        `${appPairConfirmPoll.resource}/${appPairConfirmPoll.method}`,
        pairConfirmPoll,
      ],
      [`${appPairObserve.resource}/${appPairObserve.method}`, pairObserve],
    ]),
    grantChange,
    commands: new Map<string, MemoryHandler>([
      [releasePrepareBundle.name, releasePrepareBundleHandler],
      [releasePreparation.name, releasePreparationHandler],
      [releaseCancelPreparation.name, releaseCancelHandler],
    ]),
    overlayReads(reads) {
      const runtime = reads.get(`${appRuntime.resource}/${appRuntime.method}`);
      if (runtime) {
        reads.set(
          `${appRuntime.resource}/${appRuntime.method}`,
          withRuntimeObservation(runtime, sources) as ReadHandler,
        );
      }
      const logs = reads.get(`${appLogs.resource}/${appLogs.method}`);
      if (logs) {
        reads.set(
          `${appLogs.resource}/${appLogs.method}`,
          withRuntimeLogs(logs, sources) as ReadHandler,
        );
      }
      // 등록 때 unavailable로 올린 `/v1/previews/*`를 supervisor 통로가 있는 service로 덮는다.
      if (previewService !== undefined) {
        for (const read of createPreviewReads(() => previewService)) {
          reads.set(
            `${read.route.resource}/${read.route.method}`,
            ((ctx, body) => read.handle(ctx, body as never)) as ReadHandler,
          );
        }
      }
    },
    channel,
    client,
    connector,
    preparer,
    confirmer,
    facts,
    reconcile: reconcileApp,
    activation,
    onSupervisorMessage(message) {
      if (channel.onMessage(message)) return;
      if (message.type === "app_credential_request" && issuer) {
        const request = message as unknown as { app: string };
        // 같은 앱의 이전 자식 credential은 새 자식이 받기 전에 끝낸다.
        issuer.endApp(request.app);
        void issuer.request(message).then((issued) => {
          // 거절은 답하지 않는다. supervisor가 기한 안에 못 받으면 그 시작이 실패한다.
          if (issued.ok) void channel.notify(issued.value);
        });
      }
    },
    useIssuer(next) {
      issuer = next;
    },
    sweep,
    start() {
      // 지난 실행이 남긴 preview 영역을 지운다. 그때의 preview 프로세스는 core와 함께 끝났다.
      void previewService?.discardStale().catch(() => undefined);
      if (timer !== undefined) return;
      timer = setInterval(() => void sweep(), deps.sweepMs ?? 1_000);
      Deno.unrefTimer(timer as unknown as number);
    },
    stop() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      channel.unbind();
    },
  };
}

// 발급기: supervisor 자식이 요청하는 app credential. 문제 보고와 process 관측만 닿는다.
export function appCredentialIssuer(
  registry: CredentialRegistry,
): AppCredentialIssuer {
  return createAppCredentialIssuer({
    registry,
    operations: APP_CHILD_OPERATIONS,
  });
}

// supervisor machine credential이 닿는 operation(발급 상한 안이어야 한다).
export const SUPERVISOR_CREDENTIAL_OPERATIONS = SUPERVISOR_OPERATIONS;

export function denoDir(): string {
  let configured: string | undefined;
  try {
    configured = Deno.env.get("DENO_DIR");
  } catch { /* env 권한이 없는 worker는 spec을 쓰지 않는다 */ }
  if (configured) return configured;
  const home = Deno.env.get("HOME");
  return home ? `${home}/.cache/deno` : "/tmp";
}

export function repoRoot(): string {
  return new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
}

// 앱 socket을 두는 폴더. XDG runtime 디렉터리가 있으면 거기, 없으면 사용자별 임시 폴더다
// (packages/core/apps/runtime/processes/socket-dir.ts와 같은 규칙).
export function appSocketRoot(runtimeDir?: string): string {
  const xdg = runtimeDir ?? Deno.env.get("XDG_RUNTIME_DIR");
  if (xdg !== undefined && xdg.length > 0) return `${xdg}/lophn`;
  // packaged allow-env에 TMPDIR은 없다. 없으면 기본 임시 폴더다.
  let temp = "/tmp";
  try {
    const configured = Deno.env.get("TMPDIR");
    if (configured !== undefined && configured.length > 0) temp = configured;
  } catch { /* 권한이 없으면 /tmp */ }
  return `${temp}/lophn-${Deno.uid() ?? 0}`;
}

// supervisor 실행 권한. 데이터 root와 코드·deno 캐시를 읽고 쓰기는 앱 socket 폴더뿐이다.
// core loopback에만 닿고, 실행은 설치된 Deno와 process group 종료 adapter뿐이다.
export function appSupervisorSpec(input: {
  dataRoot: string;
  apiPort: number;
  runtimeDir?: string;
}): KindLaunchSpec {
  const sockets = appSocketRoot(input.runtimeDir);
  return {
    kind: APPS_SUPERVISOR_KIND,
    entry: new URL("../main/app-supervisor/main.ts", import.meta.url).pathname,
    allow_read: [input.dataRoot, repoRoot(), denoDir(), sockets, "/proc"],
    allow_write: [sockets],
    // core loopback과 앱 socket 자리의 정확한 경로다. Deno net 허락은 unix 경로의 폴더 prefix를
    // 받지 않으므로 자리를 미리 허락한다. 가상 host는 socket 위 HTTP의 필수 통로다.
    allow_net: [
      `127.0.0.1:${input.apiPort}`,
      "lophn.invalid",
      ...allSlotSockets(sockets).map((path) => `unix:${path}`),
    ],
    allow_run: [Deno.execPath(), "/usr/bin/kill"],
    allow_sys: ["uid"],
    allow_env: [
      "LOPHN_HOME",
      "LOPHN_WORKER_KIND",
      "LOPHN_DENO",
      "HOME",
      "PATH",
      "DENO_DIR",
      "XDG_CACHE_HOME",
      "XDG_RUNTIME_DIR",
      "TMPDIR",
      "NODE_V8_COVERAGE",
    ],
    policy: "always",
    memory_limit_bytes: 256 * 1024 * 1024,
  };
}

// release 준비 command는 ledger queue 앞에서 supervisor 메모리 진행으로 돌린다(apps/releases). 나머지
// command와 Writer 동작은 그대로다.
export function withReleasePreparation(
  writer: Writer,
  commands: ReadonlyMap<string, MemoryHandler>,
  grantChange?: AppsControl["grantChange"],
): Writer {
  return {
    ...writer,
    async command(ctx, envelope) {
      const handler = commands.get(envelope.command);
      if (handler === undefined) {
        return grantChange === undefined
          ? await writer.command(ctx, envelope)
          : await grantChange(writer, ctx, envelope);
      }
      // 접수는 요청 때 검사(앱 범위·source·ticket claim)를 ledger transaction에서 먼저 지난다.
      if (envelope.command === releasePrepareBundle.name) {
        const checked = await writer.command(ctx, envelope);
        if (!checked.ok) return checked;
      }
      const handled = await handler(ctx, envelope.input);
      if (!handled.ok) return handled;
      return ok({
        result: handled.value,
        replayed: false,
        first_seq: null,
        last_seq: null,
        wake: false,
      });
    },
  };
}
