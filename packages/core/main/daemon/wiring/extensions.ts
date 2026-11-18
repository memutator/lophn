// core 안 extension host를 띄운다. 켜진 extension만 load하고, core가 뜰 때 한 번, 설정 `extensions.*`가 바뀔 때마다 맞춘다.
// Settings › Extensions의 route(`extensions/*`)를 받고 `ctx.extensionHost`를 낸다. extension의 `ctx.core`는 HTTP를 거치지 않고
// 사람 권한의 core 안 자격으로 route handler를 부르고, tool handler의 `core`는 그 호출의 agent 자격으로 부른다.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createIdSource,
  err,
  type ErrorCode,
  ok,
  type Result,
} from "../../../../base/mod.ts";
import { RPC_JSON_MAX_BYTES } from "../../../../protocol/base/mod.ts";
import type { ExtensionContext } from "../../../../protocol/extensions/manifest.ts";
import {
  extensionsInstall,
  extensionsList,
  extensionsRemove,
  extensionsRun,
} from "../../../../protocol/extensions/routes.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { shellSettings } from "../../../config/mod.ts";
import { createExtensionHost } from "../../../extensions/host.ts";
import type { ExtensionHost } from "../../../extensions/ports.ts";
import {
  BODY_TIMEOUT_MS,
  type DispatchDeps,
  dispatchHttp,
  type MemoryHandler,
  RouteRegistry,
} from "../../../server/mod.ts";
import { installedLayout } from "../entry-layout.ts";
import type { WiringContext, WiringFactory } from "./context.ts";

// extension의 `ctx.core`가 쓰는 사람 권한의 core 안 자격이다(shell이 쥐던 사람 token과 같은 범위). 기동 때 ledger에 기록한다.
const PRINCIPAL = "machine:extensions";
const contextOf = (ctx: WiringContext): AuthenticatedContext => ({
  principal: PRINCIPAL,
  actor: "user",
  scope: {
    operations: ctx.allRoutes
      .filter((route) => route.actors.includes("user"))
      .map((route) => route.name),
    targets: {},
  },
  conditions: {},
  credential_ref: PRINCIPAL,
});

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

const platformRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
// 설치본은 설치 root의 extensions/(tools/package/main.ts가 채운다), 개발은 저장소의 bundled/다.
const bundledRoot = installedLayout(platformRoot, existsSync)
  ? join(platformRoot, "..", "extensions")
  : join(platformRoot, "packages", "core", "extensions", "bundled");

// route를 HTTP API와 같은 dispatch로 부른다. 자격 검사(actor, command scope)도 같다.
function createCaller(ctx: WiringContext) {
  let made: { routes: RouteRegistry; deps: DispatchDeps } | undefined;
  // writer와 handler 목록은 build가 다 끝난 뒤에 선다. 처음 부를 때 만든다.
  const ready = () =>
    (made ??= {
      routes: new RouteRegistry(ctx.allRoutes),
      deps: {
        credentials: ctx.registry,
        clock: ctx.clock,
        writer: ctx.writer,
        reads: ctx.runtime.reads,
        memory: ctx.runtime.memory.handlers,
        fileStreams: ctx.fileStreams,
        uploads: ctx.uploads,
        bodyTimeoutMs: BODY_TIMEOUT_MS,
        jsonMaxBytes: RPC_JSON_MAX_BYTES,
        bus: ctx.bus,
        onThrown: (thrown) =>
          ctx.telemetry.logger.error({
            component: "extensions",
            event: "handler_threw",
            message: thrown instanceof Error ? thrown.message : String(thrown),
          }),
      },
    });
  return async (
    who: AuthenticatedContext,
    token: string | undefined,
    call: { kind: string; resource: string; method: string; input: unknown },
  ): Promise<Result<unknown>> => {
    const { routes, deps } = ready();
    const entry = routes.lookup(`/${call.resource}/${call.method}`);
    if (entry === undefined || entry.route.kind !== call.kind) {
      return err({ code: "not_found", message: "route not found" });
    }
    const result = await dispatchHttp(
      new Request(`http://core/${call.resource}/${call.method}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(call.input ?? {}),
      }),
      entry,
      who,
      deps,
    );
    if (!("json" in result)) {
      return err({ code: "invalid_input", message: "not a JSON route" });
    }
    if (result.status === 200) return ok(result.json);
    const { error } = result.json as {
      error: { code: ErrorCode; message: string };
    };
    return err({ code: error.code, message: error.message });
  };
}

export const extensionsWiring: WiringFactory = () => {
  let host: ExtensionHost | undefined;
  let unsubscribe: (() => void) | undefined;
  return {
    name: "extensions",
    records: (ctx) => [contextOf(ctx)],
    build(ctx) {
      const asUser = contextOf(ctx);
      const call = createCaller(ctx);
      const log = (message: string) =>
        ctx.telemetry.logger.warn({
          component: "extensions",
          event: "extension_problem",
          message,
        });
      const require = createRequire(import.meta.url);
      const declarations = [...shellSettings, ...ctx.settingDeclarations];
      host = createExtensionHost({
        roots: [bundledRoot],
        dataRoot: ctx.root.path,
        // bundle은 CJS 한 file이다(build가 묶는다).
        load: (path) => Promise.resolve(require(path)),
        core: {
          call: (kind, resource, method, input) =>
            call(asUser, undefined, { kind, resource, method, input }),
        },
        coreAs: (credential): ExtensionContext["core"] => ({
          async call(kind, resource, method, input) {
            const who = await ctx.registry.authenticate(credential);
            if (!who.ok) return who;
            return call(who.value, credential, {
              kind,
              resource,
              method,
              input,
            });
          },
        }),
        settings: {
          get(name) {
            const declared = declarations.find((one) => one.key === name);
            return Promise.resolve(
              ok(
                declared === undefined ? undefined : ctx.settings.get(declared),
              ),
            );
          },
        },
        // 사람의 env는 terminals wiring이 prepare에서 낸다.
        person: ctx.personEnv,
        // GUI 화면이 붙는 handle은 터미널 coding agent 쪽이 쥔다.
        acpOpened: (handle) => ctx.terminalAgents.opened(handle),
        clock: ctx.clock,
        ids: createIdSource({ clock: ctx.clock, random: ctx.random }),
        log,
      });
      ctx.provide("extensionHost", host);
      const running = host;

      const list: MemoryHandler = async () => {
        await running.sync();
        return ok({ extensions: await running.list() });
      };
      const install: MemoryHandler = async (_who, body) => {
        const done = await running.install(
          extensionsInstall.input.parse(body).id,
        );
        return done.ok ? ok({}) : done;
      };
      const remove: MemoryHandler = async (_who, body) => {
        const done = await running.remove(
          extensionsRemove.input.parse(body).id,
        );
        return done.ok ? ok({}) : done;
      };
      const run: MemoryHandler = async (_who, body) => {
        const done = await running.run(extensionsRun.input.parse(body).command);
        return done.ok ? ok({}) : done;
      };
      return ok({
        reads: (reads) => {
          reads.set(key(extensionsList), list);
        },
        memory: [
          [key(extensionsInstall), install],
          [key(extensionsRemove), remove],
          [key(extensionsRun), run],
        ],
      });
    },
    async afterReady(ctx) {
      const sync = () =>
        void host!.sync().catch((cause) =>
          ctx.telemetry.logger.warn({
            component: "extensions",
            event: "sync_failed",
            message: String(cause),
          }),
        );
      unsubscribe = ctx.bus.subscribe([{ types: ["StateChanged"] }], {
        send(event) {
          const changes = (
            event.payload as { changes: { name: string; id: string | null }[] }
          ).changes;
          if (
            changes.some(
              (change) =>
                change.name === "settings" &&
                (change.id === null || change.id.startsWith("extensions.")),
            )
          ) {
            sync();
          }
        },
        close: () => undefined,
      });
      sync();
    },
    closeIntake() {
      unsubscribe?.();
      unsubscribe = undefined;
    },
    // 도는 headless turn은 harness extension이 deactivate에서 failed로 닫는다. writer가 아직 열려 있다.
    async closeWork() {
      await host?.stop();
    },
  };
};
