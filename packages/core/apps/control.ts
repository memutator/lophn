// core 안 apps 제어 조립. runtime·logs read의 메인 스레드 덮기, supervisor 감독 pipe의 질의 통로,
// release 준비·activation 진행, app credential 발급을 한곳에서 잇는다.
// 업무 규칙은 packages/core/apps/runtime에 있고 여기는 core의 읽기·인증·감독 통로를 끼운다.
// 앱 호출(`app.call_api`)·invocation·rewind는 wiring/apps.ts가 각 module을 잇는다.
import {
  type Clock,
  createIdSource,
  err,
  type IdSource,
  ok,
  type Result,
} from "../../base/mod.ts";
import {
  activationComplete,
  activationFail,
  activationRecordBackup,
  activationRecordDataChange,
  activationRecordDataRestore,
  activationStart,
  appCallApi,
  type AppGrant,
  appGrantsList,
  appLogs,
  appProjects,
  appRecordStarted,
  appRecordStopped,
  appRecordUnavailable,
  appRuntime,
  packageRegisterVersion,
  packagesGuideBody,
  previewsGet,
  previewsStart,
  previewsStop,
  releaseCancelPreparation,
  releasePreparation,
  releasePrepareBundle,
  releasesGetRecord,
} from "../../protocol/apps/mod.ts";
import { appAppApi } from "../../protocol/apps/blueprint/read.ts";
import {
  observeException,
  problemReport,
} from "../../protocol/problems/mod.ts";
import type {
  AuthenticatedContext,
  RequestContext,
} from "../../protocol/server/mod.ts";
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
  type Writer,
} from "../storage/ledger/mod.ts";
import { INSTALL_PRINCIPAL } from "./packages/install.ts";
import { loadApp } from "./registration/mod.ts";
import { createActivationQueueRead } from "./releases/reads.ts";
import { loadRelease } from "./releases/store.ts";
import type { AppProcessLink } from "./ports.ts";
import type { DesiredApp } from "./runtime/supervisor/mod.ts";
import { type CoreSigner, createCoreSigner } from "./runtime/signing.ts";
import type { ConnectFacts } from "./runtime/connect.ts";
import { allSlotSockets } from "./runtime/processes/mod.ts";
import {
  createAppProcessLink,
  createSupervisorChannel,
  createSupervisorClient,
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

// runtime·logs·activation이 ledger 사실을 읽는 core 내부 자격이다. 호출자의 scope로 읽지 않는다:
// 호출자 접근은 먼저 따로 판정하고, 여기서는 App 한 행과 그 앱의 grant만 읽는다.
export const APPS_CONTROL_CONTEXT: RequestContext = {
  principal: APPS_CONTROL_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      appGrantsList.name,
      // activation 진행(apps/releases)이 시도의 상태를 읽고 참조·결과를 확정하고 사용 불가를 남긴다.
      releasesGetRecord.name,
      activationStart.name,
      activationRecordBackup.name,
      activationRecordDataChange.name,
      activationRecordDataRestore.name,
      activationComplete.name,
      activationFail.name,
      appRecordUnavailable.name,
      // 준비한 bundle의 같은 hash app test가 통과로 기록되면 release를 확정한다(release.prepare).
      ...FINALIZER_OPERATIONS,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: APPS_CONTROL_PRINCIPAL,
};

// package.publish가 package.register_version을 내는 core 내부 자격이다. 안내 blob을 준비한 principal과 같아야 한다.
export const PACKAGE_PUBLISH_CONTEXT: RequestContext = {
  principal: INSTALL_PRINCIPAL,
  actor: "machine",
  scope: { operations: [packageRegisterVersion.name], targets: {} },
  conditions: {},
  credential_ref: INSTALL_PRINCIPAL,
};

// supervisor machine credential이 닿는 operation. 관측 사실의 기록과 activation 진행뿐이다.
const SUPERVISOR_OPERATIONS = [
  appRecordStarted.name,
  appRecordStopped.name,
  appRecordUnavailable.name,
  // broker가 요청마다 현재 release 선언과 active grant를 다시 읽는다.
  appAppApi.name,
  appGrantsList.name,
  // activation을 진행하는 supervisor는 시도의 참조·결과를 확정하고 시도의 현재 상태를 읽는다
  // 시작은 사람 approval의 적용(`apply_approved_action`)이다.
  activationRecordBackup.name,
  activationRecordDataChange.name,
  activationRecordDataRestore.name,
  activationComplete.name,
  activationFail.name,
  releasesGetRecord.name,
];
// 자식 앱마다 받는 app credential이 닿는 operation. 다른 앱 호출, project 목록, 문제 보고, process
// 관측뿐이다. 호출·목록은 앱 process의 broker가 그 자식의 credential로 core를 부른다.
const APP_CHILD_OPERATIONS = [
  appCallApi.name,
  appProjects.name,
  problemReport.name,
  observeException.name,
];

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
    // 앱 호출은 사람(전체 user 상한)과 agent, 호출한 앱 자신(child credential)이 한다. machine은 앱 child
    // credential을 발급하는 경로의 상한이다.
    {
      name: appCallApi.name,
      actors: ["machine", "agent", "app"],
      kind: "command",
    },
    // 앱이 project 목록을 읽는다(사람은 전체 user 상한).
    { name: appProjects.name, actors: ["app"], kind: "read" },
    // problems report collector(machine)가 자기 credential의 앱 log를 읽는다.
    { name: appLogs.name, actors: ["machine"], kind: "command" },
    // supervisor(machine)의 broker가 실행 범위(선언 ∩ grant)를 읽는다. machine 자격은 command 종류만 받는다.
    { name: appAppApi.name, actors: ["machine"], kind: "command" },
    { name: appGrantsList.name, actors: ["machine"], kind: "command" },
    ...[
      activationRecordBackup,
      activationRecordDataChange,
      activationRecordDataRestore,
      activationComplete,
      activationFail,
      activationStart,
      releasesGetRecord,
    ].map((route): OperationPolicy => ({
      name: route.name,
      actors: ["machine"],
      kind: "command",
    })),
    { name: packageRegisterVersion.name, actors: ["machine"], kind: "command" },
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
    { name: problemReport.name, actors: ["app"], kind: "command" },
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

type AppsControlDeps = {
  clock: Clock;
  ledgerPath: string;
  readers: {
    read(
      route: { resource: string; method: string },
      ctx: RequestContext,
      input: unknown,
    ): Promise<Result<unknown>>;
  };
  // 알려진 secret까지 지운 log 줄. 안전화를 끝내지 못하면 null이다.
  redact(line: string): string | null;
  // supervisor 상태 맞춤 검사 간격(ms). 기본 1000.
  sweepMs?: number;
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

type AppsControl = {
  // 앱 시작 입력에 싣는 공개 검증 key. 서명 key는 core 시작마다 새로 만든다.
  readonly verifyKey: string;
  // core 안에서 하나뿐인 서명 key 쥠이다.
  readonly signer: CoreSigner;
  // release 준비 접수·진행·취소. command route지만 진행이 supervisor 메모리라 ledger queue를 거치지 않는다.
  // 키는 command 이름이고 `withReleasePreparation`이 writer 앞에서 이 처리기로 돌린다.
  readonly commands: ReadonlyMap<string, MemoryHandler>;
  // 호출자가 그 앱을 열 수 있는지 보고 연결된 source 폴더를 돌려준다. 범위 밖이거나 연결이 없으면 `absent` 코드다.
  sourceRootOf(
    ctx: AuthenticatedContext,
    route: { name: string },
    app: string,
    absent: "forbidden" | "not_found",
  ): Promise<Result<string>>;
  // reader pool의 apps.runtime·apps.logs를 현재 관측·log로 덮는다.
  overlayReads(reads: Map<string, ReadHandler>): void;
  readonly channel: SupervisorChannel;
  readonly client: SupervisorClient;
  // core가 앱 process를 부르는 길(`apps.call`·`apps.apply`).
  readonly link: AppProcessLink;
  // runtime이 읽는 현재 ledger 사실(App 한 행과 active grant).
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
  // 지금 한 번 activation 진행과 supervisor 상태 맞춤을 돌린다(시험·timer가 같은 함수).
  sweep(): Promise<void>;
  // 검사 timer를 켠다. core가 준비된 뒤 부른다.
  start(): void;
  stop(): void;
};

function internalError(): Result<never> {
  return err({ code: "unavailable", message: "app facts are unavailable" });
}

const GRANT_PAGES = 20;

// preview가 release로 여는 bundle이다. 없는 release·다른 앱의 release는 undefined라 같은 거절이다.
function ledgerPreviewReleases(ledgerPath: string): PreviewReleases {
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

export async function createAppsControl(
  deps: AppsControlDeps,
): Promise<AppsControl> {
  const signer = await createCoreSigner();
  const channel = createSupervisorChannel();
  const client = createSupervisorClient(channel);
  const link = createAppProcessLink(channel);
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
    // 준비는 언제나 맡은 ticket의 claim 아래에서 한다.
    if (body.ticket_source === undefined) {
      return err({
        code: "invalid_input",
        message: "release preparation needs the ticket source",
      });
    }
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
  function releaseIdOf(
    preparation: { app: string; bundle_hash: string | null },
  ): string | null {
    if (preparation.bundle_hash === null) return null;
    const opened = openConnection(deps.ledgerPath);
    if (!opened.ok) return null;
    try {
      const row = opened.value.sql.get(
        "SELECT id FROM releases WHERE app = ? AND bundle_hash = ?",
        [preparation.app, preparation.bundle_hash],
      );
      return row === undefined ? null : String(row.id);
    } catch {
      return null;
    } finally {
      opened.value.close();
    }
  }
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
    if (finalized.ok) {
      // 확정된 release가 있으면 그 id를 같이 준다(ticket report가 요구한다).
      return ok({ ...read.value, release: releaseIdOf(read.value) });
    }
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

  async function sweep(): Promise<void> {
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
    commands: new Map<string, MemoryHandler>([
      [releasePrepareBundle.name, releasePrepareBundleHandler],
      [releasePreparation.name, releasePreparationHandler],
      [releaseCancelPreparation.name, releaseCancelHandler],
    ]),
    sourceRootOf: releaseGate,
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
      // 등록 때 unavailable로 올린 `activations.queue`를 driver가 읽는 줄로 덮는다.
      if (activation !== null) {
        const queue = createActivationQueueRead({
          entries: (app) => activation.queueEntries(app),
        });
        reads.set(
          `${queue.route.resource}/${queue.route.method}`,
          ((ctx, body) => queue.handle(ctx, body as never)) as ReadHandler,
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
    link,
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

function denoDir(): string {
  let configured: string | undefined;
  try {
    configured = Deno.env.get("DENO_DIR");
  } catch { /* env 권한이 없는 worker는 spec을 쓰지 않는다 */ }
  if (configured) return configured;
  const home = Deno.env.get("HOME");
  return home ? `${home}/.cache/deno` : "/tmp";
}

function repoRoot(): string {
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
): Writer {
  return {
    ...writer,
    async command(ctx, envelope) {
      const handler = commands.get(envelope.command);
      if (handler === undefined) return await writer.command(ctx, envelope);
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
