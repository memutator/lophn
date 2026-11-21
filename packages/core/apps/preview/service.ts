// core 쪽 `/previews/{start,get,stop}`의 업무 규칙. preview 프로세스를
// 운영 상태와 따로 시작·관측·종료하고, App 활성 참조·run_enabled·grant·activation·운영 data를 읽기
// 외에는 건드리지 않는다. 쓰는 곳은 supervisor 통로와 core의 disposable 영역뿐이다.
// 범위 밖 앱·release는 없는 것과 같은 not_found다.

import type { z } from "zod";
import { type Clock, err, ok, type Result } from "../../../base/mod.ts";
import type {
  PreviewObservation,
  previewsGetInputSchema,
  previewsGetOutputSchema,
  previewsStartInputSchema,
  previewsStartOutputSchema,
  previewsStopInputSchema,
  previewsStopOutputSchema,
} from "../../../protocol/apps/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import {
  type CommandDeclaration,
  requiredHandlerNames,
  subscriptionHandlerName,
  type OperationDeclaration,
  type SubscriptionDeclaration,
} from "../declaration/mod.ts";
import type { PreviewArea } from "./area.ts";
import {
  type PreviewObservationWire as ObservationWire,
  PREVIEW_STARTING,
  type PreviewLaunch,
  validNonce,
} from "./model.ts";

type StartInput = z.infer<typeof previewsStartInputSchema>;
type StartOutput = z.infer<typeof previewsStartOutputSchema>;
type GetInput = z.infer<typeof previewsGetInputSchema>;
type GetOutput = z.infer<typeof previewsGetOutputSchema>;
type StopInput = z.infer<typeof previewsStopInputSchema>;
type StopOutput = z.infer<typeof previewsStopOutputSchema>;

// supervisor 통로. 운영 자식의 reconcile·record와 겹치지 않는 preview 전용 호출이다.
type PreviewSupervisor = {
  start(launch: PreviewLaunch): Promise<Result<void>>;
  observe(app: string, nonce: string): Promise<Result<ObservationWire | null>>;
  stop(app: string, nonce: string): Promise<Result<boolean>>;
};

// 봉인된 bundle 사본을 preview 시작 입력으로 바꾸는 자리다. 앱의 것이 아니거나 없으면 undefined다.
export type PreviewBundle = {
  entry: string;
  // bundle 선언의 operation과 command. preview 대상 호출이 이 선언으로 판정된다.
  operations: readonly OperationDeclaration[];
  commands: readonly CommandDeclaration[];
  // 선언이 `phone.use`로 선언한 폰 기능. preview에는 grant가 없어 이것이 그 preview가 쓸 수 있는 기능이다.
  phoneCapabilities: readonly string[];
  subscriptions: readonly SubscriptionDeclaration[];
  dataSchema: number;
  // bundle 파일 중 그 경로의 byte. fixture는 bundle 안의 파일이다.
  fixture(path: string): Promise<Uint8Array | undefined>;
};

export interface PreviewBundles {
  open(
    app: string,
    bundleHash: string,
  ): Promise<Result<PreviewBundle | undefined>>;
}

// release가 그 앱의 어느 bundle을 가리키는지. 없는 release·다른 앱의 release는 undefined다.
export interface PreviewReleases {
  bundleOf(app: string, release: string): Promise<Result<string | undefined>>;
}

type PreviewServiceDeps = {
  clock: Clock;
  nonce: () => string;
  supervisor: PreviewSupervisor;
  area: PreviewArea;
  apps: { exists(app: string): Promise<Result<boolean>> };
  // 요청 credential이 operation과 앱 대상에 닿는지 본다.
  authorize(
    ctx: AuthenticatedContext,
    operation: string,
    target: { app: string },
  ): Result<void>;
  // 없으면 시작은 unavailable이다(준비된 bundle을 열 방법이 없다).
  bundles?: PreviewBundles;
  releases?: PreviewReleases;
  // 그 앱의 preview가 생기거나 없어졌다. 화면이 previews.get을 다시 읽게 app_runtime 변경을 낸다.
  changed: (app: string) => void;
  // check가 ready를 보는 간격 사이에 기다린다. 기본은 setTimeout이다.
  wait?: (ms: number) => Promise<void>;
};

// launcher의 READY_TIMEOUT_MS(30초)보다 넉넉하다.
const CHECK_LIMIT_MS = 45_000;
const CHECK_POLL_MS = 250;

export type PreviewService = {
  start(
    ctx: AuthenticatedContext,
    input: StartInput,
  ): Promise<Result<StartOutput>>;
  get(ctx: AuthenticatedContext, input: GetInput): Promise<Result<GetOutput>>;
  stop(
    ctx: AuthenticatedContext,
    input: StopInput,
  ): Promise<Result<StopOutput>>;
  // 지난 실행이 남긴 disposable 영역을 지운다. core 시작이 한 번 부른다.
  discardStale(): Promise<void>;
  // 아래 셋은 core 안에서만 부른다. route 권한 검사(gate)를 거치지 않으므로 부르는 쪽이 앱을 정한다.
  // 봉인된 bundle을 fixture 없이 한 번 띄워 ready나 실패를 보고 닫는다(release 준비의 handler 검사).
  // 그 앱의 지금 preview는 앱마다 하나라는 규칙대로 닫힌다. supervisor에 닿지 못하는 것만 err다.
  check(
    app: string,
    bundleHash: string,
  ): Promise<Result<{ ok: true } | { ok: false; reason: string }>>;
  // 그 앱의 지금 preview. 없으면 null.
  current(app: string): Promise<Result<CurrentPreview | null>>;
  // 그 nonce가 앱의 지금 preview가 아니면 null.
  declared(
    app: string,
    process_nonce: string,
  ): Promise<Result<PreviewDeclared | null>>;
  // 그 nonce가 앱의 지금 preview면 그 preview가 연 bundle의 hash, 아니면 null. 동기라 화면 file 조회가 쓴다.
  bundleHashOf(app: string, process_nonce: string): string | null;
};

export type CurrentPreview = {
  process_nonce: string;
  ready: boolean;
  bundle_hash: string;
  operations: readonly OperationDeclaration[];
  commands: readonly CommandDeclaration[];
  phone_capabilities: readonly string[];
};

export type PreviewDeclared = {
  operations: readonly OperationDeclaration[];
  commands: readonly CommandDeclaration[];
  phone_capabilities: readonly string[];
};

function notFound(): Result<never> {
  return err({ code: "not_found", message: "preview target not found" });
}

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

// 사람과 agent가 preview를 연다. agent의 앱 범위는 credential의 operation과 앱 조건(authorize)이
// 정한다. 앱 자식과 machine은 열지 못한다.
function actorKind(actor: string): string {
  return actor.split(":", 1)[0];
}

function previewObservationOf(wire: ObservationWire): PreviewObservation {
  return {
    app: wire.app,
    release: wire.release,
    bundle_hash: wire.bundle_hash as string,
    mode: "preview",
    process_nonce: wire.process_nonce,
    // 연결 주소는 인증된 apps.connect만 받는다.
    endpoint: null,
    ready: wire.ready,
    accepting: false,
    ...(wire.ready ? {} : { reason: wire.reason ?? PREVIEW_STARTING }),
  } as PreviewObservation;
}

// supervisor에 닿지 못하는 core에 쓰는 기본 service다. 모든 호출이 unavailable이다.
export function unattachedPreviewService(): PreviewService {
  const down = () => Promise.resolve(unavailable("previews are not attached"));
  return {
    start: down,
    get: down,
    stop: down,
    discardStale: () => Promise.resolve(),
    check: down,
    current: down,
    declared: down,
    bundleHashOf: () => null,
  };
}

export function createPreviewService(deps: PreviewServiceDeps): PreviewService {
  // 이 service가 시작한 살아 있는 preview. 앱마다 하나다.
  const live = new Map<
    string,
    { nonce: string; declared: PreviewDeclared; bundle_hash: string }
  >();

  async function gate(
    ctx: AuthenticatedContext,
    operation: string,
    app: string,
  ): Promise<Result<void>> {
    const kind = actorKind(ctx.actor);
    if (kind !== "user" && kind !== "agent") {
      return err({
        code: "forbidden",
        message: "this credential cannot use previews",
      });
    }
    const allowed = deps.authorize(ctx, operation, { app });
    if (!allowed.ok) {
      return allowed.error.code === "forbidden" ||
        allowed.error.code === "not_found"
        ? notFound()
        : allowed;
    }
    const found = await deps.apps.exists(app);
    if (!found.ok) return found;
    return found.value ? ok(undefined) : notFound();
  }

  async function forget(app: string, nonce: string): Promise<void> {
    if (live.get(app)?.nonce === nonce) live.delete(app);
    await deps.area.discard(app, nonce);
    deps.changed(app);
  }

  // 같은 앱의 앞 preview를 닫고 영역을 만들어 bundle을 띄운다. start와 check가 같이 쓴다.
  async function launch(
    app: string,
    bundle: PreviewBundle,
    bundleHash: string,
    release: string | null,
    fixture: Uint8Array | null,
  ): Promise<Result<string>> {
    // 같은 앱의 이전 preview는 종료를 확인한 뒤에만 새 것을 만든다(같은 socket 자리를 쓴다).
    const previous = live.get(app);
    if (previous !== undefined) {
      const stopped = await deps.supervisor.stop(app, previous.nonce);
      if (!stopped.ok) return stopped;
      await forget(app, previous.nonce);
    }
    const nonce = deps.nonce();
    if (!validNonce(nonce)) {
      return err({ code: "internal", message: "preview nonce is invalid" });
    }
    const created = await deps.area.create(app, nonce, fixture);
    if (!created.ok) return created;
    const dataPath = created.value;
    const input: PreviewLaunch = {
      app,
      nonce,
      release,
      bundleHash,
      tools: requiredHandlerNames(bundle),
      subscribed: bundle.subscriptions.map(subscriptionHandlerName),
      dataSchema: bundle.dataSchema,
      entry: bundle.entry,
      dataPath,
    };
    const started = await deps.supervisor.start(input);
    if (!started.ok) {
      await deps.area.discard(app, nonce);
      return started;
    }
    live.set(app, {
      nonce,
      declared: {
        operations: bundle.operations,
        commands: bundle.commands,
        phone_capabilities: bundle.phoneCapabilities,
      },
      bundle_hash: bundleHash,
    });
    deps.changed(app);
    return ok(nonce);
  }

  return {
    async start(ctx, { input }) {
      const gated = await gate(ctx, "previews.start", input.app);
      if (!gated.ok) return gated;
      if (deps.bundles === undefined) {
        return unavailable("preview bundles are not attached");
      }
      if (input.release !== null) {
        if (deps.releases === undefined) {
          return unavailable("preview releases are not attached");
        }
        const owned = await deps.releases.bundleOf(input.app, input.release);
        if (!owned.ok) return owned;
        // 없는 release와 다른 앱의 release는 구별하지 않는다.
        if (owned.value === undefined) return notFound();
        if (owned.value !== input.bundle_hash) {
          return err({
            code: "conflict",
            message: "release does not point at this bundle",
          });
        }
      }
      const opened = await deps.bundles.open(input.app, input.bundle_hash);
      if (!opened.ok) return opened;
      const bundle = opened.value;
      if (bundle === undefined) return notFound();
      let fixture: Uint8Array | null = null;
      if (input.fixture !== null) {
        const found = await bundle.fixture(input.fixture);
        if (found === undefined) {
          return err({
            code: "invalid_input",
            message: "fixture is not a file of this bundle",
          });
        }
        fixture = found;
      }
      const launched = await launch(
        input.app,
        bundle,
        input.bundle_hash,
        input.release,
        fixture,
      );
      if (!launched.ok) return launched;
      return ok({ process_nonce: launched.value, ready: false });
    },
    async get(ctx, input) {
      const gated = await gate(ctx, "previews.get", input.app);
      if (!gated.ok) return gated;
      const nonce = input.process_nonce ?? live.get(input.app)?.nonce;
      if (nonce === undefined || live.get(input.app)?.nonce !== nonce) {
        return ok({ observation: null, observed_at: null });
      }
      const observed = await deps.supervisor.observe(input.app, nonce);
      if (!observed.ok) return observed;
      if (observed.value === null) {
        // supervisor가 모르는 preview(재시작)다. 영역도 이어 쓸 수 없다.
        await forget(input.app, nonce);
        return ok({ observation: null, observed_at: null });
      }
      return ok({
        observation: previewObservationOf(observed.value),
        observed_at: deps.clock.now(),
      });
    },
    async stop(ctx, input) {
      const gated = await gate(ctx, "previews.stop", input.app);
      if (!gated.ok) return gated;
      if (live.get(input.app)?.nonce !== input.process_nonce) {
        return notFound();
      }
      const stopped = await deps.supervisor.stop(
        input.app,
        input.process_nonce,
      );
      // 종료를 확인하지 못하면 영역을 지우지 않는다(자식이 아직 쓸 수 있다).
      if (!stopped.ok) return stopped;
      await forget(input.app, input.process_nonce);
      return ok({ stopped: true });
    },
    discardStale: () => deps.area.discardAll(),
    async check(app, bundleHash) {
      if (deps.bundles === undefined) {
        return unavailable("preview bundles are not attached");
      }
      const opened = await deps.bundles.open(app, bundleHash);
      if (!opened.ok) return ok({ ok: false, reason: opened.error.message });
      if (opened.value === undefined) {
        return ok({ ok: false, reason: "the prepared bundle is missing" });
      }
      const launched = await launch(app, opened.value, bundleHash, null, null);
      if (!launched.ok) return launched;
      const nonce = launched.value;
      const wait =
        deps.wait ??
        ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
      const deadline = deps.clock.nowMs() + CHECK_LIMIT_MS;
      let outcome: { ok: true } | { ok: false; reason: string } | undefined;
      while (outcome === undefined) {
        const observed = await deps.supervisor.observe(app, nonce);
        if (!observed.ok) return observed;
        if (observed.value === null) {
          outcome = { ok: false, reason: "the check process was lost" };
        } else if (observed.value.ready) {
          outcome = { ok: true };
        } else if (
          observed.value.reason !== undefined &&
          observed.value.reason.code !== PREVIEW_STARTING.code
        ) {
          outcome = { ok: false, reason: observed.value.reason.summary };
        } else if (deps.clock.nowMs() >= deadline) {
          outcome = {
            ok: false,
            reason: "the bundle did not become ready in time",
          };
        } else {
          await wait(CHECK_POLL_MS);
        }
      }
      // stop과 같은 길로 닫는다. 종료를 확인하지 못하면 영역을 지우지 않는다.
      const stopped = await deps.supervisor.stop(app, nonce);
      if (stopped.ok) await forget(app, nonce);
      return ok(outcome);
    },
    async current(app) {
      const entry = live.get(app);
      if (entry === undefined) return ok(null);
      const observed = await deps.supervisor.observe(app, entry.nonce);
      if (!observed.ok) return observed;
      if (observed.value === null) {
        await forget(app, entry.nonce);
        return ok(null);
      }
      return ok({
        process_nonce: entry.nonce,
        ready: observed.value.ready,
        bundle_hash: entry.bundle_hash,
        ...entry.declared,
      });
    },
    declared(app, process_nonce) {
      const entry = live.get(app);
      return Promise.resolve(
        ok(entry?.nonce === process_nonce ? entry.declared : null),
      );
    },
    bundleHashOf(app, process_nonce) {
      const entry = live.get(app);
      return entry?.nonce === process_nonce ? entry.bundle_hash : null;
    },
  };
}
