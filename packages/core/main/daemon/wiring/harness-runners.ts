// core 안의 harness(headless 실행기)와 harness-gui(터미널 `<harness> gui` 어댑터)를 바로 띄운다.
// 별도 extension load·설정 없이 core 기동 시 함께 켜지고, 사람의 login shell env가 준비된 뒤 headless host가 돈다.
import { mkdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  createIdSource,
  err,
  type ErrorCode,
  ok,
  type Result,
} from "../../../../base/mod.ts";
import { RPC_JSON_MAX_BYTES } from "../../../../protocol/base/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { createHarnessHost } from "../../../harness/index.ts";
import { startHarnessGui } from "../../../harness-gui/index.ts";
import { dropExtensionsStep } from "../../../lophn-agent/agents/drop-extensions-step.ts";
import {
  BODY_TIMEOUT_MS,
  type DispatchDeps,
  dispatchHttp,
  RouteRegistry,
} from "../../../server/mod.ts";
import { createAcp } from "../../../terminal-agents/acp.ts";
import { createSpawner } from "../../../terminal-agents/spawner.ts";
import type { WiringContext, WiringFactory } from "./context.ts";

const PRINCIPAL = "machine:harness-runners";
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

function createCaller(ctx: WiringContext) {
  let made: { routes: RouteRegistry; deps: DispatchDeps } | undefined;
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
            component: "harness-runners",
            event: "handler_threw",
            message: thrown instanceof Error ? thrown.message : String(thrown),
          }),
      },
    });
  return async (
    who: AuthenticatedContext,
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
        headers: { "content-type": "application/json" },
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

async function ensureDataFolder(
  dataRoot: string,
  name: string,
): Promise<Result<string>> {
  const root = resolve(dataRoot);
  const target = resolve(root, name);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    return err({ code: "invalid_input", message: "folder escapes data root" });
  }
  try {
    await mkdir(target, { recursive: true });
    return ok(target);
  } catch (cause) {
    return err({
      code: "unavailable",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

export const harnessRunnersWiring: WiringFactory = () => {
  let spawner: ReturnType<typeof createSpawner> | undefined;
  let stopGui: (() => void) | undefined;
  let harnessHost: ReturnType<typeof createHarnessHost> | undefined;

  return {
    name: "harness-runners",
    dataSteps: [dropExtensionsStep],
    records: (ctx) => [contextOf(ctx)],
    build(ctx) {
      const asUser = contextOf(ctx);
      const call = createCaller(ctx);
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      spawner = createSpawner({
        dataRoot: ctx.root.path,
        person: ctx.personEnv,
      });
      const acp = createAcp(ids, (handle) => ctx.terminalAgents.opened(handle));
      stopGui = startHarnessGui({
        acp: acp.acp,
        spawn: spawner.spawn,
        clock: ctx.clock,
        ids,
      });
      ctx.provide("harnessGuiTabs", () => acp.tab() ?? null);

      harnessHost = createHarnessHost({
        core: {
          call: (kind, resource, method, input) =>
            call(asUser, { kind, resource, method, input }),
        },
        spawn: spawner.spawn,
        dataFolder: (name) => ensureDataFolder(ctx.root.path, name),
      });
      return ok({});
    },
    async afterReady(ctx) {
      const ready = spawner?.ready();
      if (ready === undefined) return;
      void ready
        .then(() => {
          harnessHost?.start();
        })
        .catch((cause) =>
          ctx.telemetry.logger.warn({
            component: "harness-runners",
            event: "ready_failed",
            message: String(cause),
          }),
        );
    },
    async closeWork() {
      await harnessHost?.stop();
      stopGui?.();
      stopGui = undefined;
      spawner?.stopAll();
    },
  };
};
