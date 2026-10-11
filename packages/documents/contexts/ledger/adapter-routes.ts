// route마다 부를 handler와 적재 범위(LoadPlan)를 짝짓는다. 범위는 adapter.ts 머리말의 표와 같다.
import type { Result } from "../../../base/mod.ts";
import {
  bundleDiscardDraftRoute,
  bundleFinishCheckRoute,
  bundleRollbackRoute,
  bundleSaveDraftRoute,
  bundleSubmitRoute,
  contextArchiveRoute,
  contextBundlesRoute,
  contextContainingRoute,
  contextContractRoute,
  contextCreateRoute,
  contextDraftRoute,
  contextGetRoute,
  contextHandOffViolationsRoute,
  contextInputOptionsRoute,
  contextListRoute,
  contextOverviewRoute,
  contextRecordViolationsRoute,
  contextSavedViewsRoute,
  contextSearchRoute,
  contextUnarchiveRoute,
  contextViolationsRoute,
  glossaryListRoute,
  glossaryRemoveRoute,
  glossarySetRoute,
  viewDeleteRoute,
  viewSaveRoute,
  viewUpdateRoute,
} from "../../../contracts/documents/mod.ts";
import type {
  CommandRoute,
  Compare,
  Input,
  Output,
  ReadRoute,
  ReadSnapshot,
  Tx,
} from "../../../contracts/platform/mod.ts";
import type { ContextApiActor } from "../api/state.ts";
import type { ContextLedgerDeps } from "./adapter.ts";
import {
  type CommandSpec,
  type ReadSpec,
  runCommand,
  runRead,
} from "./adapter-run.ts";
import { contextOf, loadCheck } from "./rows.ts";

export type CommandEntry<R extends CommandRoute = CommandRoute> = {
  route: R;
  run(
    deps: ContextLedgerDeps,
    tx: Tx,
    actor: ContextApiActor,
    input: Input<R>,
    compare: Compare<R>,
  ): Result<Output<R>>;
};

export type ReadEntry<R extends ReadRoute = ReadRoute> = {
  route: R;
  run(
    deps: ContextLedgerDeps,
    snapshot: ReadSnapshot,
    actor: ContextApiActor,
    input: Input<R>,
  ): Result<Output<R>>;
};

const command = <R extends CommandRoute>(
  route: R,
  handler: CommandSpec<R>["handler"],
  plan: CommandSpec<R>["plan"],
): CommandEntry<R> => ({
  route,
  run: (deps, tx, actor, input, compare) =>
    runCommand({ handler, plan }, deps, tx, actor, input, compare),
});

const read = <R extends ReadRoute>(
  route: R,
  handler: ReadSpec<R>["handler"],
  plan: ReadSpec<R>["plan"],
): ReadEntry<R> => ({
  route,
  run: (deps, snapshot, actor, input) =>
    runRead({ handler, plan }, deps, snapshot, actor, input),
});

export const COMMAND_ENTRIES: readonly CommandEntry[] = [
  command(
    contextCreateRoute,
    (c) => c.contextCreate,
    (_sql, input) => ({ project: input.project, extraContext: input.id }),
  ),
  command(
    contextArchiveRoute,
    (c) => c.contextArchive,
    (_sql, input) => ({ context: input.context }),
  ),
  command(
    contextUnarchiveRoute,
    (c) => c.contextUnarchive,
    (_sql, input) => ({ context: input.context }),
  ),
  command(
    bundleSaveDraftRoute,
    (c) => c.bundleSaveDraft,
    (_sql, input) => ({ context: input.context, bundles: true }),
  ),
  command(
    bundleDiscardDraftRoute,
    (c) => c.bundleDiscardDraft,
    (sql, input) => ({
      context: contextOf(sql, "bundle", input.bundle),
      bundles: true,
    }),
  ),
  command(
    bundleSubmitRoute,
    (c) => c.bundleSubmit,
    (sql, input) => ({
      context: contextOf(sql, "bundle", input.bundle),
      bundles: true,
      checks: true,
      content: { bundle: input.bundle },
    }),
  ),
  command(
    bundleFinishCheckRoute,
    (c) => c.bundleFinishCheck,
    (sql, input) => {
      const check = loadCheck(sql, input.check);
      return {
        context: check?.context ?? null,
        bundles: true,
        checks: true,
        views: true,
        content: check === null ? undefined : { bundle: check.bundle },
      };
    },
  ),
  command(
    bundleRollbackRoute,
    (c) => c.bundleRollback,
    (_sql, input) => ({
      context: input.context,
      bundles: true,
      views: true,
      content: { bundle: input.bundle },
    }),
  ),
  command(
    viewSaveRoute,
    (c) => c.viewSave,
    (_sql, input) => ({
      context: input.context,
      bundles: true,
      views: true,
      content: "applied",
    }),
  ),
  command(
    viewUpdateRoute,
    (c) => c.viewUpdate,
    (sql, input) => ({
      context: contextOf(sql, "view", input.view),
      bundles: true,
      views: true,
      content: "applied",
    }),
  ),
  command(
    viewDeleteRoute,
    (c) => c.viewDelete,
    (sql, input) => ({
      context: contextOf(sql, "view", input.view),
      views: true,
    }),
  ),
  command(
    contextRecordViolationsRoute,
    (c) => c.recordViolations,
    (_sql, input) => ({ context: input.context, bundles: true }),
  ),
  command(
    contextHandOffViolationsRoute,
    (c) => c.handOffViolations,
    (_sql, input) => ({
      context: input.context,
      bundles: true,
      content: "applied",
      index: ["violations"],
    }),
  ),
  command(
    glossarySetRoute,
    (c) => c.glossarySet,
    (sql, input) =>
      "entry" in input
        ? { context: contextOf(sql, "entry", input.entry), entries: true }
        : { context: input.context, entries: true, entry: input.id },
  ),
  command(
    glossaryRemoveRoute,
    (c) => c.glossaryRemove,
    (sql, input) => ({
      context: contextOf(sql, "entry", input.entry),
      entries: true,
    }),
  ),
];

export const READ_ENTRIES: readonly ReadEntry[] = [
  read(
    contextListRoute,
    (r) => r.contextList,
    (_sql, input) => ({ project: input.project, bundles: true }),
  ),
  read(
    contextGetRoute,
    (r) => r.contextGet,
    (_sql, input) => ({ context: input.context, bundles: true }),
  ),
  read(
    contextOverviewRoute,
    (r) => r.contextOverview,
    (_sql, input) => ({
      context: input.context,
      bundles: true,
      content: "applied",
      index: ["violations", "entities"],
    }),
  ),
  read(
    contextContractRoute,
    (r) => r.contextContract,
    (_sql, input) => ({
      context: input.context,
      bundles: true,
      content: "applied",
    }),
  ),
  read(
    contextDraftRoute,
    (r) => r.contextDraft,
    (_sql, input) => ({
      context: input.context,
      bundles: true,
      checks: true,
      content: "in-progress",
    }),
  ),
  read(
    contextSearchRoute,
    (r) => r.contextSearch,
    (_sql, input) => ({
      context: input.context,
      bundles: true,
      content: "applied",
      index: ["entities"],
    }),
  ),
  read(
    contextInputOptionsRoute,
    (r) => r.contextInputOptions,
    (_sql, input) => ({
      context: input.context,
      bundles: true,
      content: "applied",
      index: ["entities"],
    }),
  ),
  read(
    contextViolationsRoute,
    (r) => r.contextViolations,
    (_sql, input) => ({
      context: input.context,
      index: ["violations"],
      handedOff: true,
    }),
  ),
  read(
    contextBundlesRoute,
    (r) => r.contextBundles,
    (_sql, input) => ({ context: input.context, bundles: true, checks: true }),
  ),
  read(
    contextSavedViewsRoute,
    (r) => r.contextSavedViews,
    (_sql, input) => ({
      context: input.context,
      bundles: true,
      views: true,
      content: "applied",
    }),
  ),
  read(
    contextContainingRoute,
    (r) => r.contextContaining,
    (_sql, input) => ({
      project: input.project,
      bundles: true,
      content: "active-applied",
    }),
  ),
  read(
    glossaryListRoute,
    (r) => r.glossaryList,
    (_sql, input) => ({ context: input.context, entries: true }),
  ),
];
