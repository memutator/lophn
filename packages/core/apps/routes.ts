// 앱 호출·rewind·화면 file route의 core 쪽 얇은 처리기와, 호출 경로가 앱 module의 읽기에 기대는
// 두 port(`AppToolLookup`, `AppStates`)의 ledger 구현. 업무 규칙은 calls·invocations·rewind·screens에 있고
// 여기는 route의 credential과 입력을 그 module에 맞춰 넘기기만 한다.
import { Buffer } from "node:buffer";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  type AppScreenFileInput,
  type ToolCallInput,
} from "../../protocol/apps/mod.ts";
import { parseActor } from "../../protocol/base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import {
  appRecordStarted,
  appRecordStartedInputSchema,
} from "../../protocol/apps/mod.ts";
import {
  type ReadDefinition,
  type ReadSnapshot,
  type RequestContext,
  type Sql,
  TargetAuthorization,
} from "../../protocol/server/mod.ts";
import type { IdSource } from "../../base/mod.ts";
import type { Clock } from "../../base/mod.ts";
import {
  bytesFileStream,
  type FileStreamHandler,
  type MemoryHandler,
  type ReadHandler,
} from "../server/mod.ts";
import { createTargetAuthorizer, type Writer } from "../storage/ledger/mod.ts";
import { authorizeApp, loadApp, loadApps } from "./registration/mod.ts";
import { readSdkStatus, type SdkStatusDeps } from "./sdk-status/mod.ts";
import type { PreviewService } from "./preview/mod.ts";
import { loadActiveDeclaration, loadRelease } from "./releases/store.ts";
import { type AppStates } from "./calls/mod.ts";
import { subscriptionHandlerName } from "./declaration/mod.ts";
import { bundleCopyPath } from "./releases/mod.ts";
import { createAppRewindCommand } from "./rewind/mod.ts";
import {
  type AppIconDeps,
  readAppIcon,
  type ScreenFileDeps,
  serveScreenFile,
} from "./screens/mod.ts";
import {
  type AppIcon,
  appIcon,
  appSkills,
} from "../../protocol/apps/declaration/read.ts";
import { type AppSkillsDeps, readAppSkills } from "./screens/skills.ts";
import { appPhoneScreens } from "../../protocol/apps/phone.ts";
import { type PhoneScreensDeps, readPhoneScreens } from "./phone/screens.ts";
import { appSdkStatus } from "../../protocol/apps/sdk-status.ts";
import type { SyncRecorder } from "./sync/log.ts";
import type {
  AppRewind,
  AppToolCallPath,
  AppToolLookup,
  BundleLocator,
  InvocationLedger,
} from "./ports.ts";

function forbidden(message: string): Result<never> {
  return err({ code: "forbidden", message });
}

// `app.call_tool`. 부른 쪽 종류는 credential의 actor가 정한다(본문의 caller는 호출 경로가 맞춰 본다).
export function callToolHandler(path: AppToolCallPath): MemoryHandler {
  return (ctx, input) => {
    const actor = parseActor(ctx.actor);
    if (actor?.kind === "user" || actor?.kind === "agent") {
      return path.call(input as ToolCallInput, { actor: actor.kind });
    }
    if (actor?.kind === "app") {
      return path.call(input as ToolCallInput, {
        actor: "app",
        app: actor.id as Id<"app">,
      });
    }
    return Promise.resolve(forbidden("this credential cannot call an app"));
  };
}

// `app.rewind`. 사람만 한다.
export function rewindHandler(
  rewind: AppRewind,
  sql: Pick<Sql, "get" | "all">,
): MemoryHandler {
  return (ctx, input) =>
    createAppRewindCommand({
      rewind,
      snapshot: { port: portOf(ctx), sql },
    }).handle(ctx, input as never);
}

function portOf(ctx: RequestContext): ReadSnapshot["port"] {
  const authorizer = createTargetAuthorizer(ctx);
  return ((key: unknown) => {
    if (key === TargetAuthorization) return authorizer;
    throw new Error("unregistered read port");
  }) as ReadSnapshot["port"];
}

function headSeq(sql: Pick<Sql, "get">): string {
  const row = sql.get("SELECT COALESCE(MAX(seq), 0) AS head FROM events", []);
  return String(row?.head ?? 0);
}

// reader Worker가 볼 수 없는 core 메모리(앱 process, 도는 호출)를 쓰는 read를 메인 스레드에서 돌린다.
export function mainRead(
  definition: ReadDefinition,
  sql: Pick<Sql, "get" | "all">,
): ReadHandler {
  return (ctx, input) =>
    definition.handle(
      { sql, as_of_seq: headSeq(sql), port: portOf(ctx) },
      ctx,
      input as never,
    );
}

// `app.screen_file`.
export function screenFileStream(deps: ScreenFileDeps): FileStreamHandler {
  return async (_ctx, input) => {
    const served = await serveScreenFile(deps, input as AppScreenFileInput);
    if (!served.ok) return served;
    return ok(bytesFileStream(served.value.bytes, served.value.contentType));
  };
}

// `app.icon`. 파일을 읽으므로 reader Worker가 아니라 메인 스레드 read다. 사람이 올린 icon이 선언한 icon(이미지나 lucide 이름)보다 앞선다.
export function appIconRead(
  deps: AppIconDeps & { uploaded(app: string): Result<AppIcon | null> },
): ReadHandler {
  return async (_ctx, input) => {
    const parsed = appIcon.input.safeParse(input);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid app icon input" });
    }
    const uploaded = deps.uploaded(parsed.data.app);
    if (!uploaded.ok) return uploaded;
    if (uploaded.value !== null) {
      return ok({ icon: uploaded.value, uploaded: true });
    }
    const icon = await readAppIcon(deps, parsed.data.app);
    return icon.ok ? ok({ icon: icon.value, uploaded: false }) : icon;
  };
}

// `app.skills`. 앱 slug마다 active release 선언의 public skill을 bundle 사본에서 읽는다. 파일을 읽으므로 메인 스레드 read다.
// 같은 이름의 skill을 두 앱이 내는 경우의 우선은 받는 쪽이 정한다(slug 순).
export function appSkillsRead(
  deps: AppSkillsDeps,
  sql: Pick<Sql, "get" | "all">,
): ReadHandler {
  return async (_ctx, input) => {
    const parsed = appSkills.input.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "invalid app skills input",
      });
    }
    const apps = loadApps(sql, "active");
    if (!apps.ok) return apps;
    const skills = [];
    for (const slug of [...new Set(parsed.data.apps)].sort()) {
      const app = apps.value.find((item) => item.slug === slug);
      if (app === undefined) continue;
      const active = loadActiveDeclaration(sql, app.id);
      if (!active.ok) return active;
      if (active.value === null) continue;
      const declared = active.value.declaration.skills ?? [];
      for (const skill of await readAppSkills(deps, app.id, declared)) {
        skills.push({
          app: app.id,
          slug,
          release: active.value.release.id,
          ...skill,
        });
      }
    }
    return ok({ skills });
  };
}

// `app.phone_screens`. 파일과 앱 process 관측을 읽으므로 메인 스레드 read다. 폰(사람)만 부른다.
export function phoneScreensRead(
  deps: PhoneScreensDeps,
  sql: Pick<Sql, "get" | "all">,
): ReadHandler {
  return async (_ctx, input) => {
    if (!appPhoneScreens.input.safeParse(input).success) {
      return err({
        code: "invalid_input",
        message: "invalid phone screens input",
      });
    }
    const as_of_seq = headSeq(sql);
    const read = await readPhoneScreens(deps, sql);
    return read.ok ? ok({ ...read.value, as_of_seq, next_cursor: null }) : read;
  };
}

// `app.sdk_status`. 앱 범위(app workspace의 agent는 자기 앱, 보관한 앱은 agent에게 없음)는 다른 앱 read와 같은 authorizeApp이 가른다.
// 지정한 앱이 범위 밖이면 없는 앱과 같은 not_found이고, 지정하지 않으면 범위 안의 앱만 싣는다. 파일을 읽으므로 메인 스레드 read다.
export function appSdkStatusRead(deps: SdkStatusDeps): ReadHandler {
  return async (ctx, input) => {
    const parsed = appSdkStatus.input.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "invalid app sdk status input",
      });
    }
    const snapshot = { sql: deps.sql, port: portOf(ctx) };
    const allowed = (app: string): Result<void> => {
      const loaded = loadApp(deps.sql, app);
      if (!loaded.ok) return loaded;
      if (loaded.value === null) {
        return err({ code: "not_found", message: "app not found" });
      }
      return authorizeApp(snapshot, ctx, appSdkStatus.name, {
        kind: "app",
        app: loaded.value,
      });
    };
    const found = await readSdkStatus(deps, {
      app: parsed.data.app,
      allow: (app) => allowed(app).ok,
    });
    if (!found.ok) return found;
    if (parsed.data.app !== undefined && found.value.length === 0) {
      // 없는 앱, 보관한 앱, 범위 밖 앱은 같은 답이다. 켜진 release가 없는 앱만 빈 목록이다.
      const one = loadApp(deps.sql, parsed.data.app);
      if (
        !one.ok ||
        one.value === null ||
        one.value.status !== "active" ||
        !allowed(parsed.data.app).ok
      ) {
        return err({ code: "not_found", message: "app not found" });
      }
    }
    return ok({ apps: found.value });
  };
}

// 활성 release 선언의 icon 경로. 선언에 없거나 active release가 없으면 null이다.
export function iconPathOf(
  sql: Pick<Sql, "get" | "all">,
): AppIconDeps["iconPath"] {
  return (app) => {
    const stored = loadActiveDeclaration(sql, app);
    if (!stored.ok) return stored;
    return ok(stored.value?.declaration.icon ?? null);
  };
}

// 호출 경로가 읽는 앱의 활성 release·보관 여부.
export function appStatesOf(sql: Pick<Sql, "get" | "all">): AppStates {
  return {
    activeRelease(app) {
      const found = loadApp(sql, app);
      if (!found.ok) return found;
      return ok((found.value?.active_release ?? null) as Id<"rel"> | null);
    },
    archived(app) {
      const found = loadApp(sql, app);
      if (!found.ok) return found;
      return ok(found.value?.status === "archived");
    },
  };
}

// release에 고정한 선언의 operation·command 선언. release가 null이면 지금 활성 release다.
// preview 선언은 그 preview가 띄운 bundle의 것이다. 아직 release가 없어도 찾는다.
export function appToolLookupOf(
  sql: Pick<Sql, "get" | "all">,
  previews: Pick<PreviewService, "declared">,
): AppToolLookup {
  return {
    async findPreview(app, nonce, kind, name) {
      const declared = await previews.declared(app, nonce);
      if (!declared.ok) return declared;
      const found = (
        kind === "operation"
          ? declared.value?.operations
          : declared.value?.commands
      )?.find((entry) => entry.name === name);
      return ok(found === undefined ? null : { effect: found.effect });
    },
    find(app, release, kind, name) {
      const stored = loadActiveDeclaration(sql, app, release ?? undefined);
      if (!stored.ok) return stored;
      if (stored.value === null || stored.value.release.app !== app) {
        return ok(null);
      }
      const { operations, commands, subscriptions } = stored.value.declaration;
      const releaseId = stored.value.release.id as Id<"rel">;
      if (kind === "operation") {
        const declared = operations.find((entry) => entry.name === name);
        if (declared === undefined) {
          // 구독 handler의 effect는 write로 고정한다: 앱 DB를 바꿀 수 있어 changeset을 떠 rewind 대상이 되게 한다.
          return ok(
            (subscriptions ?? []).some(
              (entry) => subscriptionHandlerName(entry) === name,
            )
              ? {
                  release: releaseId,
                  effect: "write" as const,
                  public: false,
                  subscription: true as const,
                }
              : null,
          );
        }
        return ok({
          release: releaseId,
          effect: declared.effect,
          public: false,
        });
      }
      const declared = commands.find((entry) => entry.name === name);
      if (declared === undefined) return ok(null);
      return ok({
        release: releaseId,
        effect: declared.effect,
        public: declared.public,
      });
    },
  };
}

// 앱 시작이 DB를 바꿨으면(`record_started`의 start_changeset) 그 시작을 invocation으로 남기고
// changeset을 붙인다. 이유는 이전 관측과 release가 다르면 activation, 같으면 restart다. 시작 사실의
// 기록이 먼저이고, invocation을 남기지 못해도 시작 기록은 그대로다.
export function withStartInvocation(
  inner: Writer,
  deps: {
    ledger: Pick<InvocationLedger, "begin" | "finish">;
    sql: Pick<Sql, "get">;
    clock: Clock;
    ids: IdSource;
    // sync 앱이면 시작의 변경도 그 clock(`start_hlc`)과 함께 sync log에 남는다.
    sync?: Pick<SyncRecorder, "written">;
  },
): Writer {
  function lastStartedRelease(app: string): string | null {
    const row = deps.sql.get(
      `SELECT json_extract(payload, '$.release') AS release FROM events
       WHERE subject = ? AND type = 'AppStarted' ORDER BY seq DESC LIMIT 1`,
      [app],
    );
    return row === undefined || row.release === null
      ? null
      : String(row.release);
  }
  return {
    ...inner,
    async command(ctx, envelope) {
      if (envelope.command !== appRecordStarted.name) {
        return await inner.command(ctx, envelope);
      }
      const input = appRecordStartedInputSchema.safeParse(envelope.input);
      const before = input.success ? lastStartedRelease(input.data.app) : null;
      const done = await inner.command(ctx, envelope);
      // 같은 관측의 재전송은 event가 없다. 새 시작 사실일 때만 남긴다.
      if (!done.ok || done.value.first_seq === null || !input.success) {
        return done;
      }
      const {
        app,
        attestation,
        start_changeset: changeset,
        start_hlc: hlc,
      } = input.data;
      if (
        typeof changeset !== "string" ||
        changeset === "" ||
        attestation.release === null
      )
        return done;
      const id = deps.ids.newId("inv") as Id<"inv">;
      const begun = deps.ledger.begin({
        id,
        app: app as Id<"app">,
        release: attestation.release as Id<"rel">,
        mode: "live",
        operation: {
          kind: "start",
          reason: before === attestation.release ? "restart" : "activation",
        },
        caller: null,
        effect: "write",
        started_at: input.data.started_at ?? deps.clock.now(),
        input_hash: null,
      });
      if (begun.ok) {
        const bytes = new Uint8Array(Buffer.from(changeset, "base64"));
        const finished = await deps.ledger.finish(id, {
          status: "succeeded",
          finished_at: deps.clock.now(),
          summary: {},
          detail_hash: null,
          changeset: bytes,
        });
        if (finished.ok) {
          await deps.sync?.written(finished.value, hlc ?? undefined, bytes);
        }
      }
      return done;
    },
  };
}

// UI bundle 사본 폴더. 운영(live) 대상은 그 release에 고정된 bundle 사본이다. preview 대상은 그 앱의
// 지금 preview가 연 bundle 사본이다. nonce가 지금 preview의 것이 아니면(멈춘 preview) 찾지 못한 것이다.
export function bundleLocatorOf(
  dataRoot: string,
  sql: Pick<Sql, "get" | "all">,
  previews: Pick<PreviewService, "bundleHashOf">,
): BundleLocator {
  const states = appStatesOf(sql);
  const missing = () =>
    err({ code: "not_found" as const, message: "bundle not found" });
  return {
    dir(target) {
      if (target.mode === "preview") {
        const hash = previews.bundleHashOf(target.app, target.process_nonce);
        if (hash === null) return missing();
        const path = bundleCopyPath(dataRoot, target.app, hash);
        return path.ok ? ok(path.value) : missing();
      }
      // remote target은 service가 다른 기계로 넘기므로 이 기계의 bundle을 찾지 않는다.
      if (target.mode === "remote") return missing();
      const app = target.app as Id<"app">;
      const wanted =
        target.release ??
        (() => {
          const active = states.activeRelease(app);
          return active.ok ? active.value : null;
        })();
      if (wanted === null) return missing();
      const release = loadRelease(sql, wanted);
      if (!release.ok) return release;
      if (release.value === null || release.value.app !== app) return missing();
      const path = bundleCopyPath(dataRoot, app, release.value.bundle_hash);
      return path.ok ? ok(path.value) : missing();
    },
  };
}
