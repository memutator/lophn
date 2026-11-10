// core 안 apps 제어 조립. runtime·logs read의 메인 스레드 덮기(logs는 log file에서 읽는다),
// supervisor 감독 pipe의 질의 통로, release 준비·activation 진행, app credential 발급을 한곳에서 잇는다.
// 업무 규칙은 packages/core/apps/runtime에 있고 여기는 core의 읽기·인증·감독 통로를 끼운다.
// 앱 호출(`app.call_tool`)·invocation·rewind는 wiring/apps.ts가 각 module을 잇는다.
import { readFile } from "node:fs/promises";

import { fileURLToPath } from "node:url";
import {
  type Clock,
  createIdSource,
  err,
  errorCode,
  type IdSource,
  ok,
  type Result,
} from "../../base/mod.ts";
import { appTools } from "../../protocol/apps/declaration/read.ts";
import {
  appSessionsList,
  appSessionsStatus,
  appSessionsStop,
} from "../../protocol/lophn-agent/session-lifecycle.ts";
import {
  type AppGrant,
  activationAskConsent,
  activationComplete,
  activationFail,
  activationRecordBackup,
  activationReport,
  activationRecordDataChange,
  activationRecordDataRestore,
  activationStart,
  appCallTool,
  noticePost,
  appTraySet,
  appEventPublish,
  appGrantsList,
  appLogFile,
  appLogPreviousFile,
  appLogs,
  appRecordStarted,
  appRecordStopped,
  appRecordUnavailable,
  appRuntime,
  appsSecretValue,
  packageRegisterVersion,
  packagesGuideBody,
  previewsGet,
  previewsStart,
  previewsStop,
  RELEASE_PREPARATION_LIMIT_MS,
  releaseActivate,
  releasePrepare,
  releaseRecord,
  releasesGetRecord,
} from "../../protocol/apps/mod.ts";
import type {
  AuthenticatedContext,
  RequestContext,
} from "../../protocol/server/mod.ts";
import type { KindLaunchSpec } from "../../protocol/supervision/mod.ts";
import {
  type AppCredentialIssuer,
  type CredentialRegistry,
  createAppCredentialIssuer,
  type OperationPolicy,
} from "../server/identity/mod.ts";
import type { MemoryHandler, ReadHandler } from "../server/mod.ts";
import type {
  BlobPrepareCall,
  PreparedRelayResult,
} from "../storage/blobs/prepare-relay.ts";
import {
  createTargetAuthorizer,
  openConnection,
  type Writer,
} from "../storage/ledger/mod.ts";
import { INSTALL_PRINCIPAL } from "./packages/install.ts";
import type { AppProcessLink } from "./ports.ts";
import { createFsPreviewArea } from "./preview/area.ts";
import { createPreviewReads } from "./preview/reads.ts";
import {
  createPreviewService,
  type PreviewBundles,
  type PreviewReleases,
  type PreviewService,
  unattachedPreviewService,
} from "./preview/service.ts";
import { loadApp } from "./registration/mod.ts";
import {
  type ActivationDriver,
  createActivationDriver,
} from "./releases/activation/assembly.ts";
import {
  dataChangesOf,
  readBundleCopy,
} from "./releases/activation/desired.ts";
import { bundleCopyPath, sealCopy } from "./releases/bundle/seal.ts";
import { gitCommandRunner } from "./releases/prepare/git-extract.ts";
import { createActivationQueueRead } from "./releases/reads.ts";
import { loadActiveRelease, loadRelease } from "./releases/store.ts";
import type { ConnectFacts } from "./runtime/connect.ts";
import {
  type RuntimeSources,
  withAppLogFile,
  withRuntimeObservation,
} from "./runtime/reads.ts";
import type { DesiredApp } from "./runtime/supervisor/mod.ts";
import {
  createAppProcessLink,
  createSupervisorChannel,
  createSupervisorClient,
  runtimeObservationOf,
  type SupervisorChannel,
  type SupervisorClient,
} from "./runtime/supervisor-link.ts";

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
      // 선언이 넓어진 release는 사람의 동의를 묻는다(동의 표). 허락한 뒤 시작은 driver가 한다.
      activationAskConsent.name,
      activationRecordBackup.name,
      activationRecordDataChange.name,
      activationRecordDataRestore.name,
      activationComplete.name,
      activationFail.name,
      // release.activate가 기다리지 않은 activation의 결과를 release를 만든 session에 알린다.
      activationReport.name,
      appRecordUnavailable.name,
      // release.prepare가 검사를 마친 봉인 사본으로 release를 확정한다.
      releaseRecord.name,
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
  appTools.name,
  appGrantsList.name,
  // activation을 진행하는 supervisor는 시도의 참조·결과를 확정하고 시도의 현재 상태를 읽는다.
  activationRecordBackup.name,
  activationRecordDataChange.name,
  activationRecordDataRestore.name,
  activationComplete.name,
  activationFail.name,
  releasesGetRecord.name,
  // 앱의 외부 요청에 붙일 secret 값을 core가 현재 grant로 다시 판정해 건넨다.
  appsSecretValue.name,
];
// 자식 앱마다 받는 app credential이 닿는 operation. 다른 앱 호출, 사람에게 알리기(notice·tray), event 발행, session 목록·상태·멈추기뿐이다.
// 호출은 앱 process의 broker가 그 자식의 credential로 core를 부른다. notice의 권한은 broker가 판정한다.
const APP_CHILD_OPERATIONS = [
  appCallTool.name,
  noticePost.name,
  appTraySet.name,
  appEventPublish.name,
  appSessionsList.name,
  appSessionsStatus.name,
  appSessionsStop.name,
];

// registry 상한. 이 목록에 없는 operation은 그 actor에게 발급하지 못한다.
export function appsOperationPolicies(): OperationPolicy[] {
  return [
    ...[appRecordStarted, appRecordStopped, appRecordUnavailable].map(
      (route): OperationPolicy => ({
        name: route.name,
        actors: ["machine"],
        kind: "command",
      }),
    ),
    // 앱 호출은 사람(전체 user 상한)과 agent, 호출한 앱 자신(child credential)이 한다. machine은 앱 child
    // credential을 발급하는 경로의 상한이다.
    {
      name: appCallTool.name,
      actors: ["machine", "agent", "app"],
      kind: "command",
    },
    { name: noticePost.name, actors: ["machine", "app"], kind: "command" },
    { name: appTraySet.name, actors: ["machine", "app"], kind: "command" },
    { name: appEventPublish.name, actors: ["machine", "app"], kind: "command" },
    ...[appSessionsList, appSessionsStatus, appSessionsStop].map(
      (route): OperationPolicy => ({
        name: route.name,
        actors: ["machine", "app"],
        kind: "command",
      }),
    ),
    // supervisor(machine)의 broker가 실행 범위(선언 ∩ grant)를 읽는다. machine 자격은 command 종류만 받는다.
    { name: appTools.name, actors: ["machine"], kind: "command" },
    { name: appGrantsList.name, actors: ["machine"], kind: "command" },
    { name: appsSecretValue.name, actors: ["machine"], kind: "command" },
    ...[
      activationRecordBackup,
      activationRecordDataChange,
      activationRecordDataRestore,
      activationComplete,
      activationFail,
      activationReport,
      activationStart,
      activationAskConsent,
      releasesGetRecord,
    ].map(
      (route): OperationPolicy => ({
        name: route.name,
        actors: ["machine"],
        kind: "command",
      }),
    ),
    { name: packageRegisterVersion.name, actors: ["machine"], kind: "command" },
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
  };
  // preview(`/previews/*`). disposable 영역은 data root 아래에 만든다. bundle을 여는 자리가
  // 없으면 시작은 unavailable이고 조회·종료는 그대로 된다(apps/preview).
  previews?: {
    dataRoot: string;
    bundles?: PreviewBundles;
    releases?: PreviewReleases;
    nonce?: () => string;
  };
};

type AppsControl = {
  // release 준비와 activation. command route지만 supervisor 메모리 진행을 기다리므로 ledger queue를 거치지 않는다.
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
  // 호출 경로가 preview 선언을 읽는다(core 안에서만 쓴다).
  readonly previews: PreviewService;
  // runtime이 읽는 현재 ledger 사실(App 한 행과 active grant).
  readonly facts: ConnectFacts;
  // 원하는 앱 상태를 supervisor에 알린다. 마지막 상태를 기억해 supervisor가 다시 떠도
  // 같은 상태로 맞춘다(releases 조립이 활성 release를 보고 부른다).
  reconcile(desired: DesiredApp): Promise<Result<void>>;
  // 지운 앱의 마지막 원하는 상태를 잊는다(sweep이 다시 알리지 않게).
  forget(app: string): void;
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

export function createAppsControl(deps: AppsControlDeps): AppsControl {
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
        return Promise.resolve(
          ok(
            app === null
              ? null
              : {
                  id: app.id,
                  status: app.status,
                  run_enabled: app.run_enabled,
                  active_release: app.active_release,
                },
          ),
        );
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
    async app(id) {
      const found = await facts.app(id);
      return found;
    },
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
        releases:
          deps.previews.releases ?? ledgerPreviewReleases(deps.ledgerPath),
      })
    : undefined;

  // 연결된 source 폴더. 없는 앱은 null이다.
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
  // release 준비가 읽는 앱의 사실과 그 앱의 active release의 data schema(없으면 null). 없는 앱은 null이다.
  function preparationFacts(app: string): Result<{
    status: string;
    source_path: string | null;
    previous_schema: number | null;
  } | null> {
    const opened = openConnection(deps.ledgerPath);
    if (!opened.ok) return internalError();
    try {
      const found = loadApp(opened.value.sql, app);
      if (!found.ok) return internalError();
      if (found.value === null) return ok(null);
      const active = loadActiveRelease(opened.value.sql, app);
      if (!active.ok) return internalError();
      return ok({
        status: found.value.status,
        source_path: found.value.source_path,
        previous_schema: active.value?.data_schema ?? null,
      });
    } catch {
      return internalError();
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
    const facts = preparationFacts(app);
    if (!facts.ok) return facts;
    if (facts.value?.status === "archived" && ctx.actor.startsWith("agent:")) {
      return refuse();
    }
    const source = await sourcePathOf(app);
    if (!source.ok) return source;
    return source.value === null ? refuse() : ok(source.value);
  };
  // 준비 중인 앱. 같은 앱의 준비 둘은 같은 `apps/<app>/staging`을 쓴다.
  const preparing = new Set<string>();
  const prepareFailed = (
    stage: "build" | "dependencies" | "migration" | "handlers" | "release",
    reason: string,
  ) => ok({ status: "failed" as const, stage, reason });
  // 앱 workspace의 session이 앱 source의 HEAD로 release를 준비한다. 순서: HEAD, build와 의존성·migration 검사(supervisor의
  // 준비 자식), 봉인, handler 검사(preview로 한 번 띄움), release 확정. 검사에 떨어진 것은 오류가 아니라
  // failed 결과다: 오류 code는 model에 고정 글만 닿아 떨어진 이유가 가려진다. release 행은 마지막 단계에서만 생긴다.
  const releasePrepareHandler: MemoryHandler = async (ctx, input) => {
    const { app } = input as { app: string };
    const missing = err({
      code: "not_found" as const,
      message: "app not found",
    });
    const allowed = createTargetAuthorizer(ctx)(ctx, releasePrepare.name, {
      app,
    });
    if (!allowed.ok) {
      return allowed.error.code === "forbidden" ? allowed : missing;
    }
    const facts = preparationFacts(app);
    if (!facts.ok) return facts;
    if (facts.value === null) return missing;
    // release 준비는 agent만 부르고 archived 앱은 agent에게 없는 앱이다.
    if (facts.value.status === "archived") return missing;
    const sourcePath = facts.value.source_path;
    if (sourcePath === null) {
      return prepareFailed("build", "the app has no source folder");
    }
    const dataRoot = deps.activation?.dataRoot ?? deps.previews?.dataRoot;
    if (
      deps.activation === undefined ||
      dataRoot === undefined ||
      previewService === undefined
    ) {
      return err({
        code: "unavailable",
        message: "release preparation is unavailable",
      });
    }
    if (preparing.has(app)) {
      return err({
        code: "conflict",
        message: "a release preparation is already running for the app",
      });
    }
    preparing.add(app);
    try {
      // agent runtime child는 git을 못 띄우므로 HEAD도 core가 읽는다.
      const head = await gitCommandRunner().run([
        "-C",
        sourcePath,
        "rev-parse",
        "HEAD",
      ]);
      const commit = head.ok ? new TextDecoder().decode(head.value).trim() : "";
      if (!/^[0-9a-f]{40}$/.test(commit)) {
        return prepareFailed(
          "build",
          "the app source has no commit; commit the code first",
        );
      }

      const requestKey = crypto.randomUUID();
      const accepted = await client.releasePrepare({
        app,
        commit,
        request_key: requestKey,
        source_path: sourcePath,
        previous_schema: facts.value.previous_schema,
      });
      if (!accepted.ok) return accepted;
      const deadline =
        deps.clock.nowMs() + RELEASE_PREPARATION_LIMIT_MS + 60_000;
      let snapshot = accepted.value;
      while (snapshot.status === "preparing") {
        if (deps.clock.nowMs() >= deadline) {
          await client.releaseCancel(app, requestKey);
          return prepareFailed(
            "build",
            "the preparation did not finish in time",
          );
        }
        await new Promise((done) => setTimeout(done, 500));
        const read = await client.releasePreparation(app, requestKey);
        if (!read.ok) return read;
        snapshot = read.value;
      }
      if (snapshot.status === "failed") {
        const failure = snapshot.failure ?? {
          stage: "build" as const,
          reason: "the preparation failed",
        };
        return prepareFailed(failure.stage, failure.reason);
      }
      if (snapshot.status !== "completed" || snapshot.bundle_hash === null) {
        return prepareFailed(
          "build",
          "the preparation was lost (the app supervisor restarted); prepare again",
        );
      }
      const bundleHash = snapshot.bundle_hash;

      // 준비 자식은 symlink를 못 만들어 사본을 열어 둔 채 끝낸다. 검사 전에 core가 봉인한다.
      const copyPath = bundleCopyPath(dataRoot, app, bundleHash);
      if (!copyPath.ok) return internalError();
      const sealed = await sealCopy(copyPath.value);
      if (!sealed.ok) {
        return err({ code: "unavailable", message: sealed.error.message });
      }

      const checked = await previewService.check(app, bundleHash);
      if (!checked.ok) return checked;
      if (!checked.value.ok) {
        return prepareFailed("handlers", checked.value.reason);
      }

      const copy = await readBundleCopy(dataRoot, app, bundleHash);
      if (!copy.ok) return copy;
      if (copy.value === undefined) {
        return err({ code: "unavailable", message: "bundle copy is missing" });
      }
      const changes = await dataChangesOf(copy.value);
      if (!changes.ok) return changes;
      let declaration: unknown;
      try {
        declaration = JSON.parse(
          await readFile(`${copy.value.root}/declaration.json`, "utf8"),
        );
      } catch {
        return err({
          code: "unavailable",
          message: "bundle declaration cannot be read",
        });
      }
      const machine = deps.activation.machine();
      if (machine === undefined) {
        return err({
          code: "unavailable",
          message: "machine credential is unavailable",
        });
      }
      const key = `release-record-${requestKey}`;
      const sent = deps.activation.command(machine, {
        command: releaseRecord.name,
        input: {
          app,
          commit,
          bundle_hash: bundleHash,
          declaration_hash: snapshot.declaration_hash,
          declaration,
          manifest: copy.value.manifest,
          data_schema: copy.value.dataSchema,
          data_changes: changes.value,
          created_by: ctx.actor,
          key,
        },
        idempotency_key: key,
        compare: {},
        prepared: [],
      });
      if (sent === undefined) {
        return err({
          code: "unavailable",
          message: "commands are unavailable",
        });
      }
      const done = await sent;
      if (!done.ok) {
        return done.error.code === "invalid_input"
          ? prepareFailed("release", done.error.message)
          : done;
      }
      const recorded = releaseRecord.output.parse(
        (done.value as { result: unknown }).result,
      );
      const { release } = recorded;
      return ok({
        status: "prepared" as const,
        release: {
          id: release.id,
          number: release.number,
          status: release.status,
          code_commit: release.code_commit,
          bundle_hash: release.bundle_hash,
          data_schema: release.data_schema,
        },
        removed_public_tools: recorded.removed_public_tools,
        removed_public_skills: recorded.removed_public_skills,
      });
    } finally {
      preparing.delete(app);
    }
  };
  // 앱 workspace의 session이 그 앱의 prepared release를 올린다. 범위 밖과 없는 release는 같은 not_found다.
  // memory 처리기는 operation을 따로 보지 않아 여기서 직접 판정한다.
  const releaseActivateHandler: MemoryHandler = async (ctx, input) => {
    if (activation === null) {
      return err({ code: "unavailable", message: "activation is unavailable" });
    }
    const id = (input as { release: string }).release;
    const opened = openConnection(deps.ledgerPath);
    if (!opened.ok) return internalError();
    let release;
    try {
      release = loadRelease(opened.value.sql, id);
    } catch {
      return internalError();
    } finally {
      opened.value.close();
    }
    if (!release.ok) return internalError();
    const missing = err({
      code: "not_found" as const,
      message: "release not found",
    });
    if (release.value === null) return missing;
    const allowed = createTargetAuthorizer(ctx)(ctx, releaseActivate.name, {
      app: release.value.app,
    });
    if (!allowed.ok) {
      return allowed.error.code === "forbidden" ? allowed : missing;
    }
    return await activation.activate(id);
  };
  async function reconcileApp(next: DesiredApp): Promise<Result<void>> {
    desired.set(next.app, next);
    return await client.reconcile(next);
  }

  const activation: ActivationDriver | null =
    deps.activation === undefined
      ? null
      : createActivationDriver({
          clock: deps.clock,
          ids:
            deps.ids ??
            createIdSource({
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
    commands: new Map<string, MemoryHandler>([
      [releasePrepare.name, releasePrepareHandler],
      [releaseActivate.name, releaseActivateHandler],
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
      const logRoot = deps.activation?.dataRoot ?? deps.previews?.dataRoot;
      // data root가 없는 부분 조립은 덮지 않는다. reader의 빈 답이 그대로 간다.
      if (logs && logRoot !== undefined) {
        reads.set(
          `${appLogs.resource}/${appLogs.method}`,
          withAppLogFile(logs, {
            read: (app) =>
              Promise.all([
                readTextOrEmpty(appLogPreviousFile(logRoot, app)),
                readTextOrEmpty(appLogFile(logRoot, app)),
              ]),
            redact: deps.redact,
          }) as ReadHandler,
        );
      }
      // 등록 때 unavailable로 올린 `activations.queue`를 driver가 읽는 줄로 덮는다.
      if (activation !== null) {
        const queue = createActivationQueueRead({
          entries: (app) => activation.queueEntries(app),
        });
        reads.set(`${queue.route.resource}/${queue.route.method}`, ((
          ctx,
          body,
        ) => queue.handle(ctx, body as never)) as ReadHandler);
      }
      // 등록 때 unavailable로 올린 `/previews/*`를 supervisor 통로가 있는 service로 덮는다.
      if (previewService !== undefined) {
        for (const read of createPreviewReads(() => previewService)) {
          reads.set(`${read.route.resource}/${read.route.method}`, ((
            ctx,
            body,
          ) => read.handle(ctx, body as never)) as ReadHandler);
        }
      }
    },
    channel,
    client,
    link,
    previews: previewService ?? unattachedPreviewService(),
    facts,
    reconcile: reconcileApp,
    forget(app) {
      desired.delete(app);
    },
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
      // sweep timer가 core 종료를 막지 않는다.
      timer.unref();
    },
    stop() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      channel.unbind();
    },
  };
}

// 발급기: supervisor 자식이 요청하는 app credential. 다른 앱 호출과 notice만 닿는다.
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

async function readTextOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (thrown) {
    if (errorCode(thrown) === "ENOENT") return "";
    throw thrown;
  }
}

export function appSupervisorSpec(): KindLaunchSpec {
  return {
    kind: APPS_SUPERVISOR_KIND,
    entry: fileURLToPath(
      new URL("../main/app-supervisor/main.ts", import.meta.url),
    ),
    policy: "always",
    memory_limit_bytes: 256 * 1024 * 1024,
  };
}

// release 준비와 activation은 supervisor 진행을 기다리므로 ledger queue 앞에서 돌린다(apps/releases). 나머지
// command와 Writer 동작은 그대로다. 준비가 남기는 ledger 쓰기(release.record)는 handler가 writer로 따로 낸다.
export function withReleasePreparation(
  writer: Writer,
  commands: ReadonlyMap<string, MemoryHandler>,
): Writer {
  return {
    ...writer,
    async command(ctx, envelope) {
      const handler = commands.get(envelope.command);
      if (handler === undefined) return await writer.command(ctx, envelope);
      const handled = await handler(ctx, envelope.input);
      if (!handled.ok) return handled;
      return ok({
        result: handled.value,
        replayed: false,
        first_seq: null,
        last_seq: null,
      });
    },
  };
}
