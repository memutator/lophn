// core 안의 harness-gui(터미널 `<harness> gui`·background 실행 어댑터)와 daemon-level HarnessCatalogManager를 띄운다.
// 별도 extension load·설정 없이 core 기동 시 함께 켜지고, 사람의 login shell env가 준비된 뒤 background 실행이 시작된다.
import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import {
  harnessCatalogRead,
  harnessCatalogRefresh,
} from "../../../../protocol/acp/harness-catalog.ts";
import { publishStateChanged } from "../../../../protocol/events/changes.ts";
import type { AgentWorkspace } from "../../../../protocol/lophn-agent/agent-values.ts";
import {
  appExists,
  appFolderPaths,
  appSourcePath,
} from "../../../apps/lookups.ts";
import {
  HARNESS_GUI_ADAPTERS,
  startHarnessGui,
} from "../../../harness-gui/index.ts";
import { dropExtensionsStep } from "../../../lophn-agent/agents/drop-extensions-step.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
import {
  projectExists,
  projectFolderPaths,
} from "../../../projects/lookups.ts";
import { createAcp } from "../../../terminal-agents/acp.ts";
import {
  createHarnessCatalog,
  type HarnessCatalogManager,
} from "../../../terminal-agents/harness-catalog.ts";
import { createSpawner } from "../../../terminal-agents/spawner.ts";
import type { WiringFactory } from "./context.ts";

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

function resolveCatalogCwd(
  ledgerPath: string,
  workspace: AgentWorkspace | null | undefined,
): Result<string | undefined> {
  if (workspace === undefined || workspace === null) {
    return ok(undefined);
  }
  const found = ledgerSnapshot(ledgerPath, (lookup) => {
    if (workspace.kind === "project") {
      if (!projectExists(lookup.sql, workspace.id)) return null;
      return projectFolderPaths(lookup.sql, workspace.id)[0] ?? "";
    }
    if (!appExists(lookup.sql, workspace.id)) return null;
    return (
      appSourcePath(lookup.sql, workspace.id) ??
      appFolderPaths(lookup.sql, workspace.id)[0] ??
      ""
    );
  });
  if (!found.ok) return found;
  if (found.value === null) {
    return err({ code: "not_found", message: "workspace not found" });
  }
  return ok(found.value === "" ? undefined : found.value);
}

export const harnessRunnersWiring: WiringFactory = () => {
  let spawner: ReturnType<typeof createSpawner> | undefined;
  let stopGui: (() => void) | undefined;
  let catalog: HarnessCatalogManager | undefined;
  let stopBackground: (() => Promise<void>) | undefined;

  return {
    name: "harness-runners",
    dataSteps: [dropExtensionsStep],
    build(ctx) {
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      const activeSpawner = createSpawner({
        dataRoot: ctx.root.path,
        person: ctx.personEnv,
      });
      spawner = activeSpawner;

      const acp = createAcp(
        ids,
        (handle) => ctx.terminalAgents.opened(handle),
        (handle) => ctx.terminalAgents.background.opened(handle),
      );
      stopGui = startHarnessGui({
        acp: acp.acp,
        spawn: activeSpawner.spawn,
        clock: ctx.clock,
        ids,
      });
      ctx.provide("harnessGuiTabs", () => acp.tab() ?? null);

      const activeCatalog = createHarnessCatalog({
        dataRoot: ctx.root.path,
        clock: ctx.clock,
        scopeOf: (harness) => HARNESS_GUI_ADAPTERS[harness].catalogScope,
        fetchCatalog: async (harness, options) => {
          await activeSpawner.ready();
          return HARNESS_GUI_ADAPTERS[harness].fetchCatalog({
            ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
            spawn: activeSpawner.spawn,
            signal: options.signal,
          });
        },
        onChanged: (harness) =>
          publishStateChanged(ctx.bus, ctx.clock.now(), [
            { name: "harness_catalog", id: harness },
          ]),
        log: (message) =>
          ctx.telemetry.logger.warn({
            component: "harness-catalog",
            event: "catalog_problem",
            message,
          }),
      });
      catalog = activeCatalog;
      ctx.provide("harnessCatalog", activeCatalog);
      stopBackground = () =>
        ctx.peek.terminalAgents?.background.stop() ?? Promise.resolve();

      return ok({
        memory: [
          [
            key(harnessCatalogRefresh),
            async (_who, input) => {
              const body = harnessCatalogRefresh.input.parse(input);
              const cwd = resolveCatalogCwd(ctx.ledgerPath, body.workspace);
              if (!cwd.ok) return cwd;
              const view = await activeCatalog.refresh({
                harness: body.harness,
                ...(cwd.value === undefined ? {} : { cwd: cwd.value }),
              });
              return ok(view);
            },
          ],
        ],
        reads: (reads) => {
          reads.set(key(harnessCatalogRead), async (_who, input) => {
            const body = harnessCatalogRead.input.parse(input);
            const cwd = resolveCatalogCwd(ctx.ledgerPath, body.workspace);
            if (!cwd.ok) return cwd;
            const view = await activeCatalog.read({
              harness: body.harness,
              ...(cwd.value === undefined ? {} : { cwd: cwd.value }),
              ...(body.probe === undefined ? {} : { probe: body.probe }),
            });
            return ok(view);
          });
        },
      });
    },
    async afterReady(ctx) {
      const ready = spawner?.ready();
      if (ready === undefined) return;
      void ready
        .then(() => {
          ctx.peek.terminalAgents?.background.start();
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
      catalog?.stop();
      catalog = undefined;
      await stopBackground?.();
      stopBackground = undefined;
      stopGui?.();
      stopGui = undefined;
      spawner?.stopAll();
    },
  };
};
