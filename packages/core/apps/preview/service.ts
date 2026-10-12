// core 쪽 `/v1/previews/{start,get,stop}`의 업무 규칙. preview 프로세스를
// 운영 상태와 따로 시작·관측·종료하고, App 활성 참조·run_enabled·grant·activation·운영 data를 읽기
// 외에는 건드리지 않는다. 쓰는 곳은 supervisor 통로와 core의 disposable 영역뿐이다.
// 범위 밖 앱·release는 없는 것과 같은 not_found다.
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
import type { z } from "zod";
import type { FlagSet } from "../permissions/mod.ts";
import type { PreviewArea } from "./area.ts";
import {
  PREVIEW_STARTING,
  type PreviewLaunch,
  type PreviewObservationWire as ObservationWire,
  validNonce,
} from "./model.ts";

type StartInput = z.infer<typeof previewsStartInputSchema>;
type StartOutput = z.infer<typeof previewsStartOutputSchema>;
type GetInput = z.infer<typeof previewsGetInputSchema>;
type GetOutput = z.infer<typeof previewsGetOutputSchema>;
type StopInput = z.infer<typeof previewsStopInputSchema>;
type StopOutput = z.infer<typeof previewsStopOutputSchema>;

// supervisor 통로. 운영 자식의 reconcile·record와 겹치지 않는 preview 전용 호출이다.
export type PreviewSupervisor = {
  start(launch: PreviewLaunch): Promise<Result<void>>;
  observe(
    app: string,
    nonce: string,
  ): Promise<Result<ObservationWire | null>>;
  stop(app: string, nonce: string): Promise<Result<boolean>>;
};

// 봉인된 bundle 사본을 preview 시작 입력으로 바꾸는 자리다. 앱의 것이 아니거나 없으면 undefined다.
export type PreviewBundle = {
  entry: string;
  importMap: string;
  commands: readonly string[];
  screens: NonNullable<PreviewLaunch["screens"]>;
  dataSchema: number;
  // bundle 파일 중 그 hash의 byte. fixture는 bundle 안의 파일이다(domain-model apps/sdk files).
  fixture(hash: string): Promise<Uint8Array | undefined>;
  // 운영 앱과 같은 flag 계산에 disposable 영역을 data로 준 결과다.
  flags(dataPath: string): Result<FlagSet>;
};

export interface PreviewBundles {
  open(
    app: string,
    bundleHash: string,
  ): Promise<Result<PreviewBundle | undefined>>;
}

// release가 그 앱의 어느 bundle을 가리키는지. 없는 release·다른 앱의 release는 undefined다.
export interface PreviewReleases {
  bundleOf(
    app: string,
    release: string,
  ): Promise<Result<string | undefined>>;
}

export type PreviewServiceDeps = {
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
};

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
};

function notFound(): Result<never> {
  return err({ code: "not_found", message: "preview target not found" });
}

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

// 사람과 coding agent만 preview를 연다. 앱 자식·agent·machine은 열지 못한다.
function actorKind(actor: string): string {
  return actor.split(":", 1)[0];
}

export function previewObservationOf(
  wire: ObservationWire,
): PreviewObservation {
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
  };
}

export function createPreviewService(deps: PreviewServiceDeps): PreviewService {
  // 이 service가 시작한 살아 있는 preview. 앱마다 하나다.
  const live = new Map<string, string>();

  async function gate(
    ctx: AuthenticatedContext,
    operation: string,
    app: string,
  ): Promise<Result<void>> {
    const kind = actorKind(ctx.actor);
    if (kind !== "user" && kind !== "coding_agent") {
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
    if (live.get(app) === nonce) live.delete(app);
    await deps.area.discard(app, nonce);
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
      if (input.fixture_hash !== null) {
        const found = await bundle.fixture(input.fixture_hash);
        if (found === undefined) {
          return err({
            code: "invalid_input",
            message: "fixture is not a file of this bundle",
          });
        }
        fixture = found;
      }
      // 같은 앱의 이전 preview는 종료를 확인한 뒤에만 새 것을 만든다(같은 socket 자리를 쓴다).
      const previous = live.get(input.app);
      if (previous !== undefined) {
        const stopped = await deps.supervisor.stop(input.app, previous);
        if (!stopped.ok) return stopped;
        await forget(input.app, previous);
      }
      const nonce = deps.nonce();
      if (!validNonce(nonce)) {
        return err({ code: "internal", message: "preview nonce is invalid" });
      }
      const created = await deps.area.create(input.app, nonce, fixture);
      if (!created.ok) return created;
      const dataPath = created.value;
      const flags = bundle.flags(dataPath);
      if (!flags.ok) {
        await deps.area.discard(input.app, nonce);
        return flags;
      }
      const launch: PreviewLaunch = {
        app: input.app,
        nonce,
        release: input.release,
        bundleHash: input.bundle_hash,
        commands: [...bundle.commands],
        screens: { ...bundle.screens },
        dataSchema: bundle.dataSchema,
        flags: {
          args: [...flags.value.args],
          limits: [...flags.value.limits],
        },
        entry: bundle.entry,
        importMap: bundle.importMap,
        dataPath,
      };
      const started = await deps.supervisor.start(launch);
      if (!started.ok) {
        await deps.area.discard(input.app, nonce);
        return started;
      }
      live.set(input.app, nonce);
      return ok({ process_nonce: nonce, ready: false });
    },
    async get(ctx, input) {
      const gated = await gate(ctx, "previews.get", input.app);
      if (!gated.ok) return gated;
      const nonce = input.process_nonce ?? live.get(input.app);
      if (nonce === undefined || live.get(input.app) !== nonce) {
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
      if (live.get(input.app) !== input.process_nonce) return notFound();
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
  };
}
