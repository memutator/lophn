// 앱 호출·rewind·project 목록·화면 file route의 core 쪽 얇은 처리기와, 호출 경로가 앱 module의 읽기에 기대는
// 두 port(`AppApiLookup`, `AppStates`)의 ledger 구현. 업무 규칙은 calls·invocations·rewind·screens에 있고
// 여기는 route의 credential과 입력을 그 module에 맞춰 넘기기만 한다.
import { Buffer } from "node:buffer";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  type AppApiCallInput,
  appProjects,
  type AppScreenFileInput,
  type ProjectSummary,
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
import type {
  FileStreamHandler,
  MemoryHandler,
  ReadHandler,
} from "../server/mod.ts";
import { createTargetAuthorizer, type Writer } from "../storage/ledger/mod.ts";
import { loadApp } from "./registration/mod.ts";
import { loadActiveBlueprint, loadRelease } from "./releases/store.ts";
import { type AppStates } from "./calls/mod.ts";
import { bundleCopyPath } from "./releases/mod.ts";
import { createAppRewindCommand } from "./rewind/mod.ts";
import { type ScreenFileDeps, serveScreenFile } from "./screens/mod.ts";
import type {
  AppApiCallPath,
  AppApiLookup,
  AppRewind,
  BundleLocator,
  InvocationLedger,
  ProjectDirectory,
} from "./ports.ts";

function forbidden(message: string): Result<never> {
  return err({ code: "forbidden", message });
}

// `app.call_api`. 부른 쪽 종류는 credential의 actor가 정한다(본문의 caller는 호출 경로가 맞춰 본다).
export function callApiHandler(path: AppApiCallPath): MemoryHandler {
  return (ctx, input) => {
    const actor = parseActor(ctx.actor);
    if (actor?.kind === "user" || actor?.kind === "agent") {
      return path.call(input as AppApiCallInput, { actor: actor.kind });
    }
    if (actor?.kind === "app") {
      return path.call(input as AppApiCallInput, {
        actor: "app",
        app: actor.id as Id<"app">,
      });
    }
    return Promise.resolve(forbidden("this credential cannot call an app"));
  };
}

// `app.rewind`. 사람만 한다.
export function rewindHandler(rewind: AppRewind): MemoryHandler {
  return (ctx, input) =>
    createAppRewindCommand({
      rewind,
      port: portOf(ctx),
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

// `app.projects`. 보관한 project도 싣는다.
export function projectsRead(
  projects: ProjectDirectory,
  sql: Pick<Sql, "get">,
): ReadHandler {
  return () => {
    const listed = projects.list();
    if (!listed.ok) return listed;
    return ok({
      projects: listed.value.map((project: ProjectSummary) => ({
        id: project.id,
        name: project.name,
        purpose: project.purpose,
        archived: project.archived,
      })),
      as_of_seq: headSeq(sql),
      next_cursor: null,
    });
  };
}

export const PROJECTS_READ_KEY =
  `${appProjects.resource}/${appProjects.method}`;

// `app.screen_file`. media type 형식은 `type/subtype`만 받으므로 매개변수(charset)는 뗀다.
export function screenFileStream(deps: ScreenFileDeps): FileStreamHandler {
  return async (_ctx, input) => {
    const served = await serveScreenFile(deps, input as AppScreenFileInput);
    if (!served.ok) return served;
    const { bytes, contentType } = served.value;
    return ok({
      contentType: contentType.split(";")[0].trim(),
      length: bytes.byteLength,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    });
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

// release에 고정한 blueprint의 app-api 선언. release가 null이면 지금 활성 release다.
export function appApiLookupOf(sql: Pick<Sql, "get" | "all">): AppApiLookup {
  return {
    find(app, release, api) {
      const stored = loadActiveBlueprint(sql, app, release ?? undefined);
      if (!stored.ok) return stored;
      if (stored.value === null || stored.value.release.app !== app) {
        return ok(null);
      }
      const declared = stored.value.blueprint.app_api.find((entry) =>
        entry.key === api
      );
      if (declared === undefined) return ok(null);
      return ok({
        release: stored.value.release.id as Id<"rel">,
        effect: declared.effect,
        project_scope: declared.project_scope,
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
      const { app, attestation, start_changeset: changeset } = input.data;
      if (
        typeof changeset !== "string" || changeset === "" ||
        attestation.release === null
      ) return done;
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
        project: null,
        effect: "write",
        started_at: input.data.started_at ?? deps.clock.now(),
        input_hash: null,
      });
      if (begun.ok) {
        await deps.ledger.finish(id, {
          status: "succeeded",
          finished_at: deps.clock.now(),
          summary: {},
          detail_hash: null,
          changeset: new Uint8Array(Buffer.from(changeset, "base64")),
        });
      }
      return done;
    },
  };
}

// UI bundle 사본 폴더. 운영(live) 대상은 그 release에 고정된 bundle 사본이다. preview 대상의 사본 자리는
// 이 동기 조회로는 알 수 없어 찾지 못한 것으로 답한다.
export function bundleLocatorOf(
  dataRoot: string,
  sql: Pick<Sql, "get" | "all">,
): BundleLocator {
  const states = appStatesOf(sql);
  const missing = () =>
    err({ code: "not_found" as const, message: "bundle not found" });
  return {
    dir(target) {
      if (target.mode !== "live") return missing();
      const app = target.app as Id<"app">;
      const wanted = target.release ?? (() => {
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
