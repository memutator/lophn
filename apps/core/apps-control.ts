// core 안 apps 제어 조립. `POST /v1/apps/connect`(메모리 route)와 runtime·logs read의
// 메인 스레드 덮기, supervisor 감독 pipe의 질의 통로, app credential 발급을 한곳에서 잇는다.
// 업무 규칙은 packages/apps/runtime에 있고 여기는 core의 읽기·인증·감독 통로를 끼운다.
import { type Clock, err, ok, type Result } from "../../packages/base/mod.ts";
import {
  appAutomations,
  appConnect,
  type AppConnectInput,
  appLogs,
  appRecordStarted,
  appRecordStopped,
  appRecordUnavailable,
  appRuntime,
  appViewClosed,
  type AppViewClosedInput,
  type Grant,
  grantsList,
  previewsGet,
  previewsStart,
  previewsStop,
} from "../../packages/contracts/apps/mod.ts";
import {
  observeException,
  reportProblem,
} from "../../packages/contracts/problems/mod.ts";
import type {
  AuthenticatedContext,
  KindLaunchSpec,
  RequestContext,
} from "../../packages/contracts/platform/mod.ts";
import type {
  MemoryHandler,
  ReadHandler,
} from "../../packages/platform/api/mod.ts";
import {
  type AppCredentialIssuer,
  createAppCredentialIssuer,
  type CredentialRegistry,
  type OperationPolicy,
} from "../../packages/platform/identity/mod.ts";
import {
  createTargetAuthorizer,
  openConnection,
} from "../../packages/platform/ledger/mod.ts";
import { loadApp } from "../../packages/apps/registration/mod.ts";
import { withAutomationObservation } from "../../packages/apps/automations/reads.ts";
import {
  type AppConnector,
  type ConnectFacts,
  createAppConnector,
  type ProcessSource,
} from "../../packages/apps/runtime/connect.ts";
import type { DesiredApp } from "../../packages/apps/runtime/supervisor/mod.ts";
import {
  type CoreSigner,
  createCoreSigner,
} from "../../packages/apps/runtime/signing.ts";
import { allSlotSockets } from "../../packages/apps/runtime/processes/mod.ts";
import {
  createSupervisorChannel,
  createSupervisorClient,
  processSourceOf,
  runtimeObservationOf,
  type SupervisorChannel,
  type SupervisorClient,
} from "../../packages/apps/runtime/supervisor-link.ts";
import {
  type RuntimeSources,
  withRuntimeLogs,
  withRuntimeObservation,
} from "../../packages/apps/runtime/reads.ts";
import { createFsPreviewArea } from "../../packages/apps/preview/area.ts";
import { createPreviewReads } from "../../packages/apps/preview/reads.ts";
import {
  createPreviewService,
  type PreviewBundles,
  type PreviewReleases,
  type PreviewService,
} from "../../packages/apps/preview/service.ts";

export const APPS_SUPERVISOR_KIND = "apps/supervisor";
export const APPS_CONTROL_PRINCIPAL = "machine:apps-control";

// connect·runtime·logs가 ledger 사실을 읽는 core 내부 자격이다. 호출자의 scope로 읽지 않는다:
// 호출자 접근은 먼저 따로 판정하고, 여기서는 App 한 행과 그 앱의 grant만 읽는다.
export const APPS_CONTROL_CONTEXT: RequestContext = {
  principal: APPS_CONTROL_PRINCIPAL,
  actor: "machine",
  scope: { operations: [grantsList.name], targets: {} },
  conditions: {},
  credential_ref: APPS_CONTROL_PRINCIPAL,
};

// supervisor machine credential이 닿는 operation. 관측 사실의 기록과 제어 connection뿐이다.
const SUPERVISOR_OPERATIONS = [
  appRecordStarted.name,
  appRecordStopped.name,
  appRecordUnavailable.name,
  appConnect.name,
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
    // preview는 사람(전체 user 상한)과 coding agent가 연다(apps/preview#R1).
    ...[previewsStart, previewsGet, previewsStop].map((
      route,
    ): OperationPolicy => ({
      name: route.name,
      actors: ["coding_agent"],
      kind: "read",
    })),
    { name: reportProblem.name, actors: ["app"], kind: "command" },
    { name: observeException.name, actors: ["app"], kind: "command" },
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
  // reader pool의 apps.runtime·apps.logs를 현재 관측·log로 덮는다.
  overlayReads(reads: Map<string, ReadHandler>): void;
  readonly channel: SupervisorChannel;
  readonly client: SupervisorClient;
  readonly connector: AppConnector;
  // connect·runtime이 읽는 현재 ledger 사실(App 한 행과 active grant). 시험이 같은 읽기를 쓴다.
  readonly facts: ConnectFacts;
  // 원하는 앱 상태를 supervisor에 알린다. 마지막 상태를 기억해 supervisor가 다시 떠도
  // 같은 상태로 맞춘다(releases 조립이 활성 release를 보고 부른다).
  reconcile(desired: DesiredApp): Promise<Result<void>>;
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
      const grants: Grant[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < GRANT_PAGES; page++) {
        const read = await deps.readers.read(
          grantsList,
          APPS_CONTROL_CONTEXT,
          {
            app: id,
            status: "active",
            ...(cursor === undefined ? {} : { cursor }),
          },
        );
        if (!read.ok) return internalError();
        const body = read.value as {
          grants: Grant[];
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
      ...(deps.previews.releases ? { releases: deps.previews.releases } : {}),
    })
    : undefined;

  const connect: MemoryHandler = async (ctx, input) => {
    const connected = await connector.connect(
      ctx,
      input as AppConnectInput,
    );
    return connected;
  };

  // 사람의 shell이 닫은 화면 view를 그 앱의 지금 live 자식에 중계한다. 앱 프로세스 nonce는
  // supervisor가 지금 쥔 자식에서 정하고 본문에서 받지 않는다. 범위 밖 앱은 없는 앱과 같다.
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
    memory: new Map([
      [`${appConnect.resource}/${appConnect.method}`, connect],
      [`${appViewClosed.resource}/${appViewClosed.method}`, viewClosed],
    ]),
    overlayReads(reads) {
      const runtime = reads.get(`${appRuntime.resource}/${appRuntime.method}`);
      if (runtime) {
        reads.set(
          `${appRuntime.resource}/${appRuntime.method}`,
          withRuntimeObservation(runtime, sources) as ReadHandler,
        );
      }
      const automations = reads.get(
        `${appAutomations.resource}/${appAutomations.method}`,
      );
      if (automations) {
        reads.set(
          `${appAutomations.resource}/${appAutomations.method}`,
          withAutomationObservation(automations, sources) as ReadHandler,
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
    facts,
    async reconcile(next) {
      desired.set(next.app, next);
      return await client.reconcile(next);
    },
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
  return new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
}

// 앱 socket을 두는 폴더. XDG runtime 디렉터리가 있으면 거기, 없으면 사용자별 임시 폴더다
// (packages/apps/runtime/processes/socket-dir.ts와 같은 규칙).
export function appSocketRoot(runtimeDir?: string): string {
  const xdg = runtimeDir ?? Deno.env.get("XDG_RUNTIME_DIR");
  if (xdg !== undefined && xdg.length > 0) return `${xdg}/lophn`;
  const temp = Deno.env.get("TMPDIR") ?? "/tmp";
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
    entry: new URL("../app-supervisor/main.ts", import.meta.url).pathname,
    allow_read: [input.dataRoot, repoRoot(), denoDir(), sockets, "/proc"],
    allow_write: [sockets],
    // core loopback과 앱 socket 자리의 정확한 경로다. Deno net 허락은 unix 경로의 폴더 prefix를
    // 받지 않으므로 자리를 미리 허락한다. 가상 host는 socket 위 HTTP의 필수 통로다(R8).
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
