// adapter 시험이다. 같은 시나리오를 메모리 handler(api/)와 SQL adapter에서 돌려 결과, event, 이어 읽은 값이
// 같은지 본다. 시각은 두 쪽의 시계가 달라 "<at>"으로 바꿔 견주고, 시각 자체는 따로 시험한다.
import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  bundleDiscardDraftRoute,
  bundleFinishCheckRoute,
  bundleRollbackRoute,
  bundleSaveDraftRoute,
  bundleSubmitRoute,
  CONTEXT_API_COMMAND_ROUTES,
  CONTEXT_API_READ_ROUTES,
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
  type StoredViolation,
  viewDeleteRoute,
  viewSaveRoute,
  viewUpdateRoute,
} from "../../../contracts/documents/mod.ts";
import type {
  Compare,
  Input,
  Output,
  ReadRoute,
} from "../../../contracts/platform/mod.ts";
import type { CommandRoute } from "../../../contracts/platform/mod.ts";
import { createContextApiCommands } from "../api/commands.ts";
import { createContextApiReads } from "../api/reads.ts";
import type { ContextApiState, EntityRow } from "../api/state.ts";
import {
  actors,
  entity,
  id,
  ids,
  minimalContent,
  newState,
  optionsContent,
  testDeps,
  violation,
} from "../api/testing.ts";
import {
  CONTEXT_WORKER_OPERATIONS,
  contextLedgerCommands,
  type ContextLedgerDeps,
  contextLedgerReads,
  mapActor,
} from "./adapter.ts";
import {
  type LedgerFixture,
  ledgerFixture,
  type LedgerFixtureOptions,
  requestContext,
} from "./testing.ts";

// ---------- 같은 시나리오를 두 쪽에서 돌리는 틀 ----------

type Who = keyof typeof actors;
const WORKER_OPERATIONS = [...CONTEXT_WORKER_OPERATIONS];

const archivedProject = id("prj", 3);

type Seen = {
  type: string;
  subject: string | null;
  actor: string;
  seq: string;
  payload: unknown;
};

// 한 쪽이 시나리오에 내미는 면이다. 호출마다 transcript에 남는다.
interface Api {
  command<R extends CommandRoute>(
    route: R,
    who: Who,
    input: Input<R>,
    compare?: Compare<R>,
  ): Result<Output<R>>;
  read<R extends ReadRoute>(
    route: R,
    who: Who,
    input: Input<R>,
  ): Result<Output<R>>;
  // derived 저장소(위반, 개체)에 심는다.
  seedViolations(context: string, rows: StoredViolation[]): void;
  seedEntities(context: string, rows: EntityRow[]): void;
  seedProject(project: string, archived: boolean): void;
  readonly transcript: unknown[];
  events(): Seen[];
  // blob과 시작한 Run
  side(): unknown;
  head(): number;
}

const AT = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g;
const plain = (value: unknown) =>
  JSON.parse(JSON.stringify(value).replace(AT, "<at>"));

function memoryApi(): Api & { state: ContextApiState } {
  const state = newState();
  const t = testDeps();
  const commands = createContextApiCommands(state, t.deps);
  const reads = createContextApiReads(state, { execute: () => [] });
  const handlers: Record<string, (call: never) => Result<unknown>> = {
    [contextCreateRoute.name]: commands.contextCreate,
    [contextArchiveRoute.name]: commands.contextArchive,
    [contextUnarchiveRoute.name]: commands.contextUnarchive,
    [bundleSaveDraftRoute.name]: commands.bundleSaveDraft,
    [bundleDiscardDraftRoute.name]: commands.bundleDiscardDraft,
    [bundleSubmitRoute.name]: commands.bundleSubmit,
    [bundleFinishCheckRoute.name]: commands.bundleFinishCheck,
    [bundleRollbackRoute.name]: commands.bundleRollback,
    [viewSaveRoute.name]: commands.viewSave,
    [viewUpdateRoute.name]: commands.viewUpdate,
    [viewDeleteRoute.name]: commands.viewDelete,
    [contextRecordViolationsRoute.name]: commands.recordViolations,
    [contextHandOffViolationsRoute.name]: commands.handOffViolations,
    [glossarySetRoute.name]: commands.glossarySet,
    [glossaryRemoveRoute.name]: commands.glossaryRemove,
    "context.list": reads.contextList,
    "context.get": reads.contextGet,
    "context.overview": reads.contextOverview,
    "context.contract": reads.contextContract,
    "context.draft": reads.contextDraft,
    "context.search": reads.contextSearch,
    "context.input_options": reads.contextInputOptions,
    "context.violations": reads.contextViolations,
    "context.bundles": reads.contextBundles,
    "context.saved_views": reads.contextSavedViews,
    "context.containing": reads.contextContaining,
    "glossary.list": reads.glossaryList,
  };
  const transcript: unknown[] = [];
  let keys = 0;
  return {
    state,
    transcript,
    command(route, who, input, compare) {
      keys += 1;
      const result = handlers[route.name]!({
        actor: actors[who],
        key: `k${keys}`,
        input,
        compare: compare ?? {},
      } as never) as Result<Output<typeof route>>;
      transcript.push(plain({ call: `${route.name} by ${who}`, result }));
      return result;
    },
    read(route, who, input) {
      const result = handlers[route.name]!({
        actor: actors[who],
        input,
      } as never) as Result<Output<typeof route>>;
      transcript.push(plain({ call: `${route.name} by ${who}`, result }));
      return result;
    },
    seedViolations: (context, rows) => state.violations.set(context, rows),
    seedEntities: (context, rows) => state.entities.set(context, rows),
    seedProject: (project, archived) =>
      state.projects.set(project, { id: project, archived }),
    events: () =>
      state.events.map((event) => ({
        type: event.type,
        subject: event.subject,
        actor: event.actor,
        seq: event.seq,
        payload: plain(event.payload),
      })),
    side: () => ({
      blobs: [...t.blobs.entries()].sort(([a], [b]) => a < b ? -1 : 1),
      runs: t.runs,
    }),
    head: () => state.seq,
  };
}

type SqlApi = Api & {
  ledger: LedgerFixture;
  blobReads: string[];
};

function sqlApi(
  options: LedgerFixtureOptions = {},
  overrides: (base: ContextLedgerDeps) => Partial<ContextLedgerDeps> =
    () => ({}),
): SqlApi {
  const ledger = ledgerFixture(options);
  ledger.seedProject(ids.project);
  ledger.seedProject(ids.otherProject);
  const t = testDeps();
  const violations = new Map<string, StoredViolation[]>();
  const entities = new Map<string, EntityRow[]>();
  const blobReads: string[] = [];
  const deps: ContextLedgerDeps = {
    blobs: {
      read(reference) {
        blobReads.push(reference.hash);
        const value = t.blobs.get(reference.hash);
        return value === undefined
          ? err({ code: "internal", message: "blob is missing" })
          : ok(value as Record<string, unknown>);
      },
      put: (_tx, value) => t.deps.putBlob(value),
    },
    index: {
      violations: (context) => violations.get(context) ?? [],
      entities: (context) => entities.get(context) ?? [],
      entity: (context, type, key) =>
        (entities.get(context) ?? []).filter((row) =>
          row.type === type && row.key === key
        ),
      ofType: (context, type) =>
        (entities.get(context) ?? []).filter((row) => row.type === type),
      failing: () => false,
    },
    execute: () => [],
    hash: t.hash,
    startHandOffRun: (_tx, request) => t.deps.startHandOffRun(request),
    isContextEngineer: (assignment) => assignment === id("asg", 1),
  };
  Object.assign(deps, overrides({ ...deps }));
  const commands = new Map(
    contextLedgerCommands(deps).map((def) => [def.route.name, def]),
  );
  const reads = new Map(
    contextLedgerReads(deps).map((def) => [def.route.name, def]),
  );
  const transcript: unknown[] = [];
  const contextOf = (who: Who) =>
    requestContext(
      actors[who].actor,
      who === "worker" ? WORKER_OPERATIONS : [],
    );
  return {
    ledger,
    blobReads,
    transcript,
    command(route, who, input, compare) {
      const def = commands.get(route.name);
      if (def === undefined) throw new Error(`no command ${route.name}`);
      const ctx = contextOf(who);
      const result = ledger.transaction(
        (tx) => def.handle(tx, ctx, input as never, (compare ?? {}) as never),
        ctx.actor,
      ) as Result<Output<typeof route>>;
      transcript.push(plain({ call: `${route.name} by ${who}`, result }));
      return result;
    },
    read(route, who, input) {
      const def = reads.get(route.name);
      if (def === undefined) throw new Error(`no read ${route.name}`);
      const result = def.handle(
        ledger.snapshot(),
        contextOf(who),
        input as never,
      ) as Result<Output<typeof route>>;
      transcript.push(plain({ call: `${route.name} by ${who}`, result }));
      return result;
    },
    seedViolations: (context, rows) => violations.set(context, rows),
    seedEntities: (context, rows) => entities.set(context, rows),
    seedProject: (project, archived) =>
      ledger.seedProject(project, archived ? "archived" : "active"),
    events: () =>
      ledger.emitted.map((event) => ({
        type: event.type,
        subject: event.subject,
        actor: event.actor,
        seq: event.seq,
        payload: plain(event.payload),
      })),
    side: () => ({
      blobs: [...t.blobs.entries()].sort(([a], [b]) => a < b ? -1 : 1),
      runs: t.runs,
    }),
    head: () => ledger.head(),
  };
}

// 시나리오를 두 쪽에서 돌리고 같은지 본다. 같은 SQL 쪽을 돌려줘 더 보게 한다.
function equivalent(
  scenario: (api: Api) => void,
  options: LedgerFixtureOptions = {},
): { memory: ReturnType<typeof memoryApi>; sql: SqlApi } {
  const memory = memoryApi();
  const sql = sqlApi(options);
  try {
    scenario(memory);
    scenario(sql);
    assertEquals(sql.transcript, memory.transcript);
    assertEquals(sql.events(), memory.events());
    assertEquals(sql.side(), memory.side());
    assertEquals(sql.head(), memory.head());
    return { memory, sql };
  } catch (error) {
    sql.ledger.close();
    throw error;
  }
}

function finished(
  scenario: (api: Api) => void,
  check: (sql: SqlApi, memory: ReturnType<typeof memoryApi>) => void,
  options: LedgerFixtureOptions = {},
) {
  const { memory, sql } = equivalent(scenario, options);
  try {
    check(sql, memory);
  } finally {
    sql.ledger.close();
  }
}

// ---------- 시나리오 조각 ----------

function value<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}
const code = (result: Result<unknown>) => result.ok ? "ok" : result.error.code;
const types = (events: Seen[]) => events.map((event) => event.type);
const SNAPSHOT = "c".repeat(64);

function createContext(
  api: Api,
  overrides: { id?: string; title?: string } = {},
) {
  return value(api.command(contextCreateRoute, "user", {
    id: overrides.id ?? ids.context,
    project: ids.project,
    title: overrides.title ?? "Experiments",
    purpose: "Track experiments and findings",
  }));
}

// draft를 저장하고 낸 뒤 검사를 통과시켜 적용한다.
function applyBundle(
  api: Api,
  context: string,
  content: Record<string, unknown> = minimalContent(),
) {
  const draft = value(
    api.command(bundleSaveDraftRoute, "engineer", { context, content }),
  );
  const submitted = value(
    api.command(bundleSubmitRoute, "engineer", { bundle: draft.id }),
  );
  const result = value(api.command(bundleFinishCheckRoute, "worker", {
    check: submitted.check!,
    result: "passed",
    bundle_hash: submitted.bundle_hash!,
    snapshot_hash: SNAPSHOT,
    findings: [],
    violation_count: 0,
  }));
  return { draft, submitted, ...result };
}

const otherViews = () =>
  minimalContent({
    saved_views: [
      {
        name: "Running experiments",
        search: "experiments_by_status",
        inputs: { status: ["done"] },
      },
      {
        name: "Planned experiments",
        search: "experiments_by_status",
        inputs: { status: ["planned"] },
      },
    ],
  });

const followUp = (api: Api, context = ids.context) => {
  api.read(contextGetRoute, "user", { context });
  api.read(contextBundlesRoute, "user", { context });
  api.read(contextSavedViewsRoute, "user", { context });
  api.read(contextListRoute, "user", { project: ids.project, status: "all" });
  // 적용된 판의 content를 읽는 읽기들
  api.read(contextOverviewRoute, "user", { context });
  api.read(contextSearchRoute, "user", {
    context,
    search: "experiments_by_status",
    inputs: {},
  });
  api.read(contextContainingRoute, "user", {
    project: ids.project,
    path: "eval/experiments/exp-001-plan.md",
  });
};

// ---------- 시험 ----------

Deno.test("documents/contexts#R1 [ctx-I34a]: context.create gives the same results and ContextCreated events as the handlers, including every rejection", () => {
  finished((api) => {
    api.seedProject(archivedProject, true);
    createContext(api);
    api.command(contextCreateRoute, "user", {
      id: ids.context,
      project: ids.project,
      title: "Another title",
      purpose: "same id",
    });
    api.command(contextCreateRoute, "user", {
      id: ids.otherContext,
      project: ids.project,
      title: "  Experiments\t",
      purpose: "same title after trimming",
    });
    api.command(contextCreateRoute, "user", {
      id: ids.otherContext,
      project: ids.otherProject,
      title: "Experiments",
      purpose: "same title in another project",
    });
    api.command(contextCreateRoute, "engineer", {
      id: id("ctx", 3),
      project: ids.project,
      title: "By the engineer",
      purpose: "agent create",
    });
    api.command(contextCreateRoute, "otherAgent", {
      id: id("ctx", 4),
      project: ids.project,
      title: "Not allowed",
      purpose: "other agent",
    });
    api.command(contextCreateRoute, "codingAgent", {
      id: id("ctx", 4),
      project: ids.project,
      title: "Not allowed",
      purpose: "coding agent",
    });
    api.command(contextCreateRoute, "user", {
      id: id("ctx", 5),
      project: archivedProject,
      title: "Archived project",
      purpose: "x",
    });
    api.command(contextCreateRoute, "user", {
      id: id("ctx", 6),
      project: id("prj", 77),
      title: "Missing project",
      purpose: "x",
    });
    followUp(api);
    api.read(contextGetRoute, "user", { context: ids.missingContext });
    api.read(contextListRoute, "user", { project: id("prj", 77) });
    api.read(contextListRoute, "worker", { project: ids.project });
  }, (sql) => {
    assertEquals(types(sql.events()), [
      "ContextCreated",
      "ContextCreated",
      "ContextCreated",
    ]);
    assertEquals(sql.events().map((event) => event.seq), ["101", "102", "103"]);
    const row = sql.ledger.sql.get(
      "SELECT status, revision FROM contexts WHERE id = ?",
      [ids.context],
    );
    assertEquals(row, { status: "drafting", revision: "101" });
  });
});

Deno.test("documents/contexts#R21 [ctx-I34a]: a passed check applies the bundle, reflects its saved views and supersedes the previous applied bundle, as the handlers do", () => {
  finished((api) => {
    createContext(api);
    const first = applyBundle(api, ids.context);
    followUp(api);
    // 둘째 판: 새 draft를 열고 한 번 덮어쓴 뒤 낸다
    const draft = value(api.command(bundleSaveDraftRoute, "engineer", {
      context: ids.context,
      content: minimalContent(),
    }));
    api.command(bundleSaveDraftRoute, "engineer", {
      context: ids.context,
      bundle: draft.id,
      content: otherViews(),
    }, { base_revision: draft.revision });
    const rewritten = value(api.read(contextBundlesRoute, "user", {
      context: ids.context,
    })).bundles[0]!.bundle;
    const submitted = value(
      api.command(bundleSubmitRoute, "engineer", { bundle: draft.id }),
    );
    api.command(bundleFinishCheckRoute, "worker", {
      check: submitted.check!,
      result: "passed",
      bundle_hash: submitted.bundle_hash!,
      snapshot_hash: SNAPSHOT,
      findings: [],
      violation_count: 2,
    });
    followUp(api);
    assert(first.bundle.id !== rewritten.id);
  }, (sql) => {
    assertEquals(types(sql.events()), [
      "ContextCreated",
      "ContextBundleDraftSaved",
      "ContextBundleSubmitted",
      "ContextBundleApplied",
      "SavedViewCreated",
      "ContextBundleDraftSaved",
      "ContextBundleDraftSaved",
      "ContextBundleSubmitted",
      "ContextBundleApplied",
      "SavedViewUpdated",
      "SavedViewCreated",
    ]);
    const rows = sql.ledger.sql.all(
      "SELECT number, status FROM context_bundles ORDER BY number",
      [],
    );
    assertEquals(rows, [
      { number: 1, status: "superseded" },
      { number: 2, status: "applied" },
    ]);
    const context = sql.ledger.sql.get(
      "SELECT status, applied_bundle FROM contexts",
      [],
    )!;
    assertEquals(context.status, "active");
    assertEquals(context.applied_bundle, id("cbn", 102));
    // 적용한 판의 content blob은 hash로만 ledger에 있고 한 번만 올라간다
    assertEquals(
      sql.ledger.sql.get("SELECT count(*) AS n FROM saved_views", []),
      { n: 2 },
    );
  });
});

Deno.test("documents/contexts#R20 [ctx-I34a]: a failed check leaves the applied bundle and context untouched and records the findings", () => {
  finished((api) => {
    createContext(api);
    applyBundle(api, ids.context);
    const draft = value(api.command(bundleSaveDraftRoute, "engineer", {
      context: ids.context,
      content: otherViews(),
    }));
    const submitted = value(
      api.command(bundleSubmitRoute, "engineer", { bundle: draft.id }),
    );
    // 다른 판의 hash로는 받지 않는다
    api.command(bundleFinishCheckRoute, "worker", {
      check: submitted.check!,
      result: "failed",
      bundle_hash: "0".repeat(64),
      snapshot_hash: SNAPSHOT,
      findings: [{
        kind: "example_mismatch",
        target: "examples/0",
        detail: "x",
      }],
      violation_count: 0,
    });
    api.command(bundleFinishCheckRoute, "worker", {
      check: submitted.check!,
      result: "failed",
      bundle_hash: submitted.bundle_hash!,
      snapshot_hash: SNAPSHOT,
      findings: [
        { kind: "example_mismatch", target: "examples/0", detail: "mismatch" },
        { kind: "saved_view_broken", target: "Mine", detail: "no such search" },
      ],
      violation_count: 3,
    });
    // 같은 검사에 두 번 결과를 낼 수 없다
    api.command(bundleFinishCheckRoute, "worker", {
      check: submitted.check!,
      result: "passed",
      bundle_hash: submitted.bundle_hash!,
      snapshot_hash: SNAPSHOT,
      findings: [],
      violation_count: 0,
    });
    followUp(api);
  }, (sql) => {
    assertEquals(types(sql.events()).slice(-2), [
      "ContextBundleSubmitted",
      "ContextBundleCheckFailed",
    ]);
    assertEquals(
      sql.ledger.sql.all(
        "SELECT number, status FROM context_bundles ORDER BY number",
        [],
      ),
      [{ number: 1, status: "applied" }, { number: 2, status: "failed" }],
    );
    assertEquals(
      sql.ledger.sql.get("SELECT applied_bundle FROM contexts", [])!
        .applied_bundle,
      id("cbn", 101),
    );
    assertEquals(
      sql.ledger.sql.get(
        "SELECT status, json_array_length(findings) AS n FROM context_checks WHERE status = 'failed'",
        [],
      ),
      { status: "failed", n: 2 },
    );
  });
});

Deno.test("documents/contexts#R19 [ctx-I34a]: draft discard, submit rules and archived contexts behave as the handlers do", () => {
  finished((api) => {
    createContext(api);
    const draft = value(api.command(bundleSaveDraftRoute, "engineer", {
      context: ids.context,
      content: minimalContent(),
    }));
    // draft는 하나뿐이다
    api.command(bundleSaveDraftRoute, "engineer", {
      context: ids.context,
      content: minimalContent(),
    });
    // 새 draft에 base_revision을 보내면 안 된다
    api.command(bundleSaveDraftRoute, "engineer", {
      context: ids.context,
      content: minimalContent(),
    }, { base_revision: "1" });
    // 사람과 다른 agent는 draft를 저장하지 못한다
    api.command(bundleSaveDraftRoute, "user", {
      context: ids.context,
      content: minimalContent(),
    });
    api.command(bundleDiscardDraftRoute, "otherAgent", { bundle: draft.id }, {
      base_revision: draft.revision,
    });
    api.command(bundleDiscardDraftRoute, "user", { bundle: draft.id }, {
      base_revision: "1",
    });
    api.command(bundleDiscardDraftRoute, "user", { bundle: draft.id }, {
      base_revision: draft.revision,
    });
    // 버린 draft는 다시 버리거나 낼 수 없다
    api.command(bundleSubmitRoute, "engineer", { bundle: draft.id });
    api.command(bundleDiscardDraftRoute, "user", { bundle: draft.id }, {
      base_revision: draft.revision,
    });
    // BundleContent가 아닌 content는 낼 때 거절된다
    const broken = value(api.command(bundleSaveDraftRoute, "engineer", {
      context: ids.context,
      content: { schema: 1 },
    }));
    api.command(bundleSubmitRoute, "engineer", { bundle: broken.id });
    api.command(bundleSubmitRoute, "engineer", { bundle: id("cbn", 77) });
    api.read(contextBundlesRoute, "user", { context: ids.context });
    // 보관한 context는 draft를 받지 않는다
    const context =
      value(api.read(contextGetRoute, "user", { context: ids.context }))
        .context;
    api.command(contextArchiveRoute, "user", { context: ids.context }, {
      base_revision: context.revision,
    });
    api.command(bundleSaveDraftRoute, "engineer", {
      context: ids.context,
      content: minimalContent(),
    });
    followUp(api);
  }, (sql) => {
    assertEquals(types(sql.events()), [
      "ContextCreated",
      "ContextBundleDraftSaved",
      "ContextBundleDraftDiscarded",
      "ContextBundleDraftSaved",
      "ContextArchived",
    ]);
    assertEquals(
      sql.ledger.sql.all("SELECT status FROM context_bundles ORDER BY id", []),
      [{ status: "discarded" }, { status: "draft" }],
    );
  });
});

Deno.test("documents/contexts#R4 [ctx-I34a]: archive and unarchive compare base_revision and restore the pre-archive state", () => {
  finished((api) => {
    createContext(api);
    const drafting =
      value(api.read(contextGetRoute, "user", { context: ids.context }))
        .context;
    api.command(contextArchiveRoute, "engineer", { context: ids.context }, {
      base_revision: drafting.revision,
    });
    api.command(contextArchiveRoute, "user", { context: ids.context }, {
      base_revision: "1",
    });
    const archived = value(api.command(contextArchiveRoute, "user", {
      context: ids.context,
    }, { base_revision: drafting.revision }));
    api.command(contextArchiveRoute, "user", { context: ids.context }, {
      base_revision: archived.revision,
    });
    const back = value(api.command(contextUnarchiveRoute, "user", {
      context: ids.context,
    }, { base_revision: archived.revision }));
    assertEquals(back.status, "drafting");
    // 판이 있는 context는 active로 돌아온다. 보관 중에 적용된 판도 보관을 지킨다
    applyBundle(api, ids.context);
    const active =
      value(api.read(contextGetRoute, "user", { context: ids.context }))
        .context;
    const again = value(api.command(contextArchiveRoute, "user", {
      context: ids.context,
    }, { base_revision: active.revision }));
    api.command(contextUnarchiveRoute, "user", { context: ids.context }, {
      base_revision: again.revision,
    });
    api.command(contextArchiveRoute, "user", { context: ids.missingContext }, {
      base_revision: "1",
    });
    followUp(api);
  }, (sql) => {
    assertEquals(
      types(sql.events()).filter((t) =>
        t.startsWith("ContextArch") || t.startsWith("ContextUnarch")
      ),
      [
        "ContextArchived",
        "ContextUnarchived",
        "ContextArchived",
        "ContextUnarchived",
      ],
    );
    assertEquals(sql.ledger.sql.get("SELECT status FROM contexts", []), {
      status: "active",
    });
  });
});

Deno.test("documents/contexts#R21 [ctx-I34a]: rollback makes a superseded bundle applied again and reflects its saved views, as the handlers do", () => {
  finished((api) => {
    createContext(api);
    const first = applyBundle(api, ids.context);
    applyBundle(api, ids.context, otherViews());
    const current =
      value(api.read(contextGetRoute, "user", { context: ids.context }))
        .context;
    // 사람만, 지금 revision으로, superseded 판에 한해 되돌린다
    api.command(bundleRollbackRoute, "engineer", {
      context: ids.context,
      bundle: first.bundle.id,
    }, { base_revision: current.revision });
    api.command(bundleRollbackRoute, "user", {
      context: ids.context,
      bundle: first.bundle.id,
    }, { base_revision: "1" });
    api.command(bundleRollbackRoute, "user", {
      context: ids.context,
      bundle: current.applied_bundle!,
    }, { base_revision: current.revision });
    api.command(bundleRollbackRoute, "user", {
      context: ids.context,
      bundle: id("cbn", 77),
    }, { base_revision: current.revision });
    api.command(bundleRollbackRoute, "user", {
      context: ids.context,
      bundle: first.bundle.id,
    }, { base_revision: current.revision });
    followUp(api);
  }, (sql) => {
    assertEquals(types(sql.events()).slice(-2), [
      "ContextBundleRolledBack",
      "SavedViewUpdated",
    ]);
    assertEquals(
      sql.ledger.sql.all(
        "SELECT number, status FROM context_bundles ORDER BY number",
        [],
      ),
      [{ number: 1, status: "applied" }, { number: 2, status: "superseded" }],
    );
    // 판 번호를 새로 만들지 않는다
    assertEquals(
      sql.ledger.sql.get("SELECT max(number) AS n FROM context_bundles", []),
      { n: 2 },
    );
  });
});

Deno.test("documents/contexts#R18 [ctx-I34a]: view.save, view.update and view.delete match the handlers and write only the saved view row", () => {
  finished((api) => {
    createContext(api);
    applyBundle(api, ids.context);
    const saved = value(api.command(viewSaveRoute, "user", {
      context: ids.context,
      name: "Mine",
      search: "experiments_by_status",
      inputs: { status: ["done"] },
    }));
    api.read(contextSavedViewsRoute, "user", { context: ids.context });
    // 이름 중복, 모르는 검색, 맞지 않는 입력, 사람이 아닌 쪽
    api.command(viewSaveRoute, "user", {
      context: ids.context,
      name: " Mine ",
      search: "experiments_by_status",
      inputs: {},
    });
    api.command(viewSaveRoute, "user", {
      context: ids.context,
      name: "Other",
      search: "no_such_search",
      inputs: {},
    });
    api.command(viewSaveRoute, "user", {
      context: ids.context,
      name: "Other",
      search: "experiments_by_status",
      inputs: { nope: 1 },
    });
    api.command(viewSaveRoute, "engineer", {
      context: ids.context,
      name: "Other",
      search: "experiments_by_status",
      inputs: {},
    });
    // 판이 없는 context에는 저장하지 못한다
    createContext(api, { id: ids.otherContext, title: "Empty" });
    api.command(viewSaveRoute, "user", {
      context: ids.otherContext,
      name: "Mine",
      search: "experiments_by_status",
      inputs: {},
    });
    const renamed = value(api.command(viewUpdateRoute, "user", {
      view: saved.id,
      name: "Renamed",
      inputs: { status: ["planned"] },
    }, { base_revision: saved.revision }));
    api.command(viewUpdateRoute, "user", { view: saved.id, name: "Late" }, {
      base_revision: saved.revision,
    });
    api.command(viewUpdateRoute, "user", {
      view: saved.id,
      name: "Running experiments",
    }, {
      base_revision: renamed.revision,
    });
    api.command(viewUpdateRoute, "engineer", { view: saved.id, name: "No" }, {
      base_revision: renamed.revision,
    });
    api.command(viewUpdateRoute, "user", { view: id("viw", 77), name: "No" }, {
      base_revision: renamed.revision,
    });
    api.read(contextSavedViewsRoute, "user", { context: ids.context });
    api.command(viewDeleteRoute, "user", { view: saved.id }, {
      base_revision: "1",
    });
    api.command(viewDeleteRoute, "user", { view: saved.id }, {
      base_revision: renamed.revision,
    });
    api.command(viewDeleteRoute, "user", { view: saved.id }, {
      base_revision: renamed.revision,
    });
    followUp(api);
  }, (sql) => {
    const viewEvents = types(sql.events()).filter((t) =>
      t.startsWith("SavedView")
    );
    assertEquals(viewEvents, [
      "SavedViewCreated", // 판 적용이 반영한 engineer view
      "SavedViewCreated", // user view
      "SavedViewUpdated",
      "SavedViewDeleted",
    ]);
    assertEquals(
      sql.ledger.sql.get("SELECT count(*) AS n FROM saved_views", []),
      { n: 1 },
    );
  });
});

Deno.test("documents/contexts#R26 [ctx-I34a]: glossary.set and glossary.remove match the handlers, including who may change which entry", () => {
  finished((api) => {
    createContext(api);
    const byUser = value(api.command(glossarySetRoute, "user", {
      id: id("trm", 1),
      context: ids.context,
      term: "  Run ",
      meaning: "One trial of an arm",
    }));
    const byAgent = value(api.command(glossarySetRoute, "engineer", {
      id: id("trm", 2),
      context: ids.context,
      term: "Arm",
      meaning: "A configuration under test",
    }));
    // 다른 context의 항목 id는 쓸 수 없다. 같은 용어도 다른 context에서는 된다
    createContext(api, { id: ids.otherContext, title: "Other" });
    api.command(glossarySetRoute, "user", {
      id: id("trm", 9),
      context: ids.otherContext,
      term: "Run",
      meaning: "Same term in another context",
    });
    api.command(glossarySetRoute, "user", {
      id: id("trm", 9),
      context: ids.context,
      term: "Taken id",
      meaning: "the id belongs to the other context",
    });
    // 같은 용어(ASCII 대소문자 무시), 같은 id, 없는 context, 다른 agent, 입력 모양
    api.command(glossarySetRoute, "user", {
      id: id("trm", 3),
      context: ids.context,
      term: "RUN",
      meaning: "dup",
    });
    api.command(glossarySetRoute, "user", {
      id: id("trm", 1),
      context: ids.context,
      term: "Other",
      meaning: "dup id",
    });
    api.command(glossarySetRoute, "user", {
      id: id("trm", 3),
      context: ids.missingContext,
      term: "Other",
      meaning: "no context",
    });
    api.command(glossarySetRoute, "otherAgent", {
      id: id("trm", 3),
      context: ids.context,
      term: "Other",
      meaning: "other agent",
    });
    api.command(glossarySetRoute, "user", {
      id: id("trm", 3),
      context: ids.context,
      term: "x".repeat(81),
      meaning: "too long",
    });
    // 기존 항목: Context Engineer는 user가 정한 항목을 못 고친다
    api.command(glossarySetRoute, "engineer", {
      entry: byUser.id,
      meaning: "agent rewrite",
    }, { base_revision: byUser.revision });
    api.command(glossarySetRoute, "user", {
      entry: byAgent.id,
      meaning: "stale",
    }, { base_revision: "1" });
    api.command(glossarySetRoute, "user", {
      entry: byAgent.id,
      meaning: "no revision",
    });
    const reset = value(api.command(glossarySetRoute, "user", {
      entry: byAgent.id,
      term: "ARM",
      meaning: "A configuration under test, set by the user",
    }, { base_revision: byAgent.revision }));
    assertEquals(reset.set_by, "user");
    api.command(glossarySetRoute, "user", {
      entry: byAgent.id,
      term: "run",
    }, { base_revision: reset.revision });
    api.read(glossaryListRoute, "user", { context: ids.context });
    api.read(glossaryListRoute, "worker", { context: ids.context });
    api.command(glossaryRemoveRoute, "engineer", { entry: byAgent.id }, {
      base_revision: reset.revision,
    });
    api.command(glossaryRemoveRoute, "user", { entry: byAgent.id }, {
      base_revision: "1",
    });
    api.command(glossaryRemoveRoute, "user", { entry: byAgent.id }, {
      base_revision: reset.revision,
    });
    api.command(glossaryRemoveRoute, "user", { entry: byAgent.id }, {
      base_revision: reset.revision,
    });
    api.read(glossaryListRoute, "engineer", { context: ids.context });
  }, (sql) => {
    assertEquals(
      types(sql.events()).filter((t) => t.startsWith("Glossary")),
      [
        "GlossaryEntrySet",
        "GlossaryEntrySet",
        "GlossaryEntrySet",
        "GlossaryEntrySet",
        "GlossaryEntryRemoved",
      ],
    );
    assertEquals(
      sql.ledger.sql.all(
        "SELECT context, term, set_by FROM glossary_entries ORDER BY id",
        [],
      ),
      [
        { context: ids.context, term: "Run", set_by: "user" },
        { context: ids.otherContext, term: "Run", set_by: "user" },
      ],
    );
  });
});

Deno.test("documents/contexts#R25 [ctx-I34a]: record_violations and hand_off_violations match the handlers, with the violation list taken from the index port", () => {
  finished((api) => {
    createContext(api);
    // 판이 없는 drafting context
    api.command(contextRecordViolationsRoute, "worker", {
      context: ids.context,
      count: 1,
      bundle_hash: "a".repeat(64),
    });
    api.command(contextHandOffViolationsRoute, "user", {
      context: ids.context,
    });
    const applied = applyBundle(api, ids.context);
    const hash = applied.bundle.bundle_hash!;
    const rule = violation();
    const unreadable = violation({
      kind: "unreadable",
      rule: null,
      type: null,
      path: "eval/experiments/exp-009-broken.md",
      message: "Cannot read the frontmatter",
    });
    api.seedViolations(ids.context, [rule, unreadable]);
    // 사람과 일반 machine 자격은 기록하지 못한다
    api.command(contextRecordViolationsRoute, "user", {
      context: ids.context,
      count: 2,
      bundle_hash: hash,
    });
    api.command(contextRecordViolationsRoute, "otherMachine", {
      context: ids.context,
      count: 2,
      bundle_hash: hash,
    });
    // 같은 수, 다른 판 hash
    api.command(contextRecordViolationsRoute, "worker", {
      context: ids.context,
      count: 0,
      bundle_hash: hash,
    });
    api.command(contextRecordViolationsRoute, "worker", {
      context: ids.context,
      count: 2,
      bundle_hash: "f".repeat(64),
    });
    api.command(contextRecordViolationsRoute, "worker", {
      context: ids.context,
      count: 2,
      bundle_hash: hash,
    });
    api.command(contextRecordViolationsRoute, "worker", {
      context: ids.context,
      count: 2,
      bundle_hash: hash,
    });
    api.command(contextRecordViolationsRoute, "worker", {
      context: ids.context,
      count: 1,
      bundle_hash: hash,
    });
    api.read(contextGetRoute, "user", { context: ids.context });
    api.read(contextViolationsRoute, "user", { context: ids.context });
    // 넘기기: 전부, 일부, 없는 키, 빈 목록, 사람이 아닌 쪽
    api.command(contextHandOffViolationsRoute, "engineer", {
      context: ids.context,
    });
    api.command(contextHandOffViolationsRoute, "user", {
      context: ids.context,
    });
    api.command(contextHandOffViolationsRoute, "user", {
      context: ids.context,
      violations: [{
        kind: "unreadable",
        rule: null,
        path: unreadable.path,
        section: null,
      }],
    });
    api.command(contextHandOffViolationsRoute, "user", {
      context: ids.context,
      violations: [{
        kind: "broken_link",
        rule: null,
        path: "x.md",
        section: null,
      }],
    });
    api.seedViolations(ids.context, []);
    api.command(contextHandOffViolationsRoute, "user", {
      context: ids.context,
    });
    api.read(contextViolationsRoute, "engineer", { context: ids.context });
  }, (sql) => {
    assertEquals(
      types(sql.events()).filter((t) => t.startsWith("ContextViolations")),
      [
        "ContextViolationsRecorded",
        "ContextViolationsRecorded",
        "ContextViolationsHandedOff",
        "ContextViolationsHandedOff",
      ],
    );
    assertEquals(
      sql.ledger.sql.get("SELECT violation_mark FROM contexts", []),
      {
        violation_mark: 1,
      },
    );
  });
});

Deno.test("documents/contexts#R3 [ctx-I34a]: a rejected command performs no write statement, emits no event and leaves every table as it was", () => {
  const codes: string[][] = [];
  let probe: { before: unknown; after: unknown } | undefined;
  const snapshotOf = (ledger: LedgerFixture) => ({
    tables: ledger.dump(),
    events: ledger.emitted.length,
    writes: ledger.writes.length,
    head: ledger.head(),
  });
  finished((api) => {
    createContext(api);
    const applied = applyBundle(api, ids.context);
    value(api.command(glossarySetRoute, "user", {
      id: id("trm", 1),
      context: ids.context,
      term: "Run",
      meaning: "One trial",
    }));
    const ledger = (api as Partial<SqlApi>).ledger;
    const before = ledger && snapshotOf(ledger);
    const results = [
      api.command(contextCreateRoute, "user", {
        id: ids.otherContext,
        project: ids.project,
        title: "Experiments",
        purpose: "duplicate title",
      }),
      api.command(contextCreateRoute, "worker", {
        id: ids.otherContext,
        project: ids.project,
        title: "Forbidden",
        purpose: "x",
      }),
      api.command(contextArchiveRoute, "user", { context: ids.context }, {
        base_revision: "1",
      }),
      api.command(contextArchiveRoute, "user", {
        context: ids.missingContext,
      }, { base_revision: "1" }),
      api.command(bundleSubmitRoute, "engineer", { bundle: id("cbn", 77) }),
      api.command(bundleFinishCheckRoute, "worker", {
        check: id("chk", 77),
        result: "passed",
        bundle_hash: "a".repeat(64),
        snapshot_hash: SNAPSHOT,
        findings: [],
        violation_count: 0,
      }),
      api.command(bundleRollbackRoute, "user", {
        context: ids.context,
        bundle: applied.bundle.id,
      }, { base_revision: applied.context.revision }),
      api.command(viewSaveRoute, "user", {
        context: ids.context,
        name: "Bad",
        search: "no_such_search",
        inputs: {},
      }),
      api.command(glossarySetRoute, "user", {
        id: id("trm", 2),
        context: ids.context,
        term: "run",
        meaning: "duplicate term",
      }),
      api.command(glossaryRemoveRoute, "engineer", { entry: id("trm", 1) }, {
        base_revision: "1",
      }),
      api.command(contextHandOffViolationsRoute, "user", {
        context: ids.context,
      }),
    ];
    codes.push(results.map(code));
    if (ledger) probe = { before, after: snapshotOf(ledger) };
  }, () => {
    assertEquals(codes[0], [
      "conflict",
      "forbidden",
      "conflict",
      "not_found",
      "not_found",
      "not_found",
      "conflict",
      "invalid_input",
      "conflict",
      "forbidden",
      "invalid_input",
    ]);
    assertEquals(codes[1], codes[0]);
    // 거절된 command는 쓰기 문장을 보내지도, event를 내지도 않았다(rollback에 기대지 않는다)
    assert(probe !== undefined);
    assertEquals(probe.after, probe.before);
  });
});

Deno.test("documents/contexts#R3 [ctx-I34a]: revisions are the seqs of the events that changed the rows", () => {
  finished((api) => {
    createContext(api);
    applyBundle(api, ids.context);
    value(api.command(glossarySetRoute, "user", {
      id: id("trm", 1),
      context: ids.context,
      term: "Run",
      meaning: "One trial",
    }));
    const entry = value(
      api.read(glossaryListRoute, "user", { context: ids.context }),
    ).entries[0]!;
    value(api.command(glossarySetRoute, "user", {
      entry: entry.id,
      meaning: "Changed",
    }, { base_revision: entry.revision }));
    value(api.command(viewSaveRoute, "user", {
      context: ids.context,
      name: "Mine",
      search: "experiments_by_status",
      inputs: {},
    }));
  }, (sql) => {
    const seqOfLast = (subject: string) =>
      String(
        sql.ledger.sql.get(
          "SELECT max(seq) AS seq FROM events WHERE subject = ?",
          [subject],
        )!
          .seq,
      );
    for (const table of ["saved_views", "glossary_entries"]) {
      for (
        const row of sql.ledger.sql.all(`SELECT id, revision FROM ${table}`, [])
      ) {
        assertEquals(
          row.revision,
          seqOfLast(String(row.id)),
          `${table} ${row.id}`,
        );
      }
    }
    const head = sql.ledger.head();
    for (const table of ["contexts", "context_bundles"]) {
      for (
        const row of sql.ledger.sql.all(`SELECT id, revision FROM ${table}`, [])
      ) {
        const exists = sql.ledger.sql.get(
          "SELECT 1 AS found FROM events WHERE seq = ?",
          [Number(row.revision)],
        );
        assert(
          exists !== undefined && Number(row.revision) <= head,
          `${table} ${row.id}`,
        );
      }
    }
  });
});

Deno.test("documents/contexts#R26 [ctx-I34a]: a glossary entry's updated_at is the transaction time, the same as the time of the event that set it", () => {
  const sql = sqlApi();
  try {
    createContext(sql);
    // 앞선 transaction이 시계를 움직였어도 이번 transaction의 시각 하나가 쓰인다
    const set = value(sql.command(glossarySetRoute, "user", {
      id: id("trm", 1),
      context: ids.context,
      term: "Run",
      meaning: "One trial",
    }));
    const event = sql.ledger.sql.get(
      "SELECT at FROM events WHERE seq = ?",
      [Number(set.revision)],
    )!;
    assertEquals(set.updated_at, event.at);
    const listed = value(
      sql.read(glossaryListRoute, "user", { context: ids.context }),
    ).entries[0]!;
    assertEquals(listed.updated_at, event.at);
    assertEquals(
      sql.ledger.sql.get("SELECT updated_at FROM glossary_entries", [])!
        .updated_at,
      event.at,
    );
  } finally {
    sql.ledger.close();
  }
});

Deno.test("documents/contexts#R3 [ctx-I34a]: only the changed rows are written", () => {
  const sql = sqlApi();
  try {
    createContext(sql);
    const entry = value(sql.command(glossarySetRoute, "user", {
      id: id("trm", 1),
      context: ids.context,
      term: "Run",
      meaning: "One trial",
    }));
    const writes = () => sql.ledger.writes.length;

    // 항목 하나를 고치면 glossary_entries 한 문장뿐이다
    let mark = writes();
    value(sql.command(glossarySetRoute, "user", {
      entry: entry.id,
      meaning: "Changed",
    }, { base_revision: entry.revision }));
    let statements = sql.ledger.writes.slice(mark);
    assertEquals(statements.length, 1);
    assert(statements[0]!.includes("glossary_entries"));

    // 보관은 contexts 한 문장뿐이다
    const context =
      value(sql.read(contextGetRoute, "user", { context: ids.context }))
        .context;
    mark = writes();
    value(sql.command(contextArchiveRoute, "user", { context: ids.context }, {
      base_revision: context.revision,
    }));
    statements = sql.ledger.writes.slice(mark);
    assertEquals(statements.length, 1);
    assert(statements[0]!.includes("contexts"));

    // 읽기는 쓰지 않는다
    mark = writes();
    sql.read(contextListRoute, "user", { project: ids.project, status: "all" });
    assertEquals(writes(), mark);
  } finally {
    sql.ledger.close();
  }
});

Deno.test("documents/contexts#R19 [ctx-I34a]: bundle content blobs are read only for the commands that need them", () => {
  const sql = sqlApi();
  try {
    createContext(sql);
    const applied = applyBundle(sql, ids.context);
    const draft = value(sql.command(bundleSaveDraftRoute, "engineer", {
      context: ids.context,
      content: otherViews(),
    }));
    const reads = () => sql.blobReads.length;

    // 내용을 보지 않는 command와 읽기
    let mark = reads();
    const current =
      value(sql.read(contextGetRoute, "user", { context: ids.context }))
        .context;
    sql.read(contextBundlesRoute, "user", { context: ids.context });
    sql.read(contextListRoute, "user", { project: ids.project });
    value(sql.command(glossarySetRoute, "user", {
      id: id("trm", 1),
      context: ids.context,
      term: "Run",
      meaning: "x",
    }));
    value(sql.command(bundleDiscardDraftRoute, "user", { bundle: draft.id }, {
      base_revision: draft.revision,
    }));
    const archived = value(
      sql.command(contextArchiveRoute, "user", { context: ids.context }, {
        base_revision: current.revision,
      }),
    );
    assertEquals(reads(), mark);

    // saved view를 저장하려면 적용된 판의 선언만 읽는다
    value(
      sql.command(contextUnarchiveRoute, "user", { context: ids.context }, {
        base_revision: archived.revision,
      }),
    );
    mark = reads();
    value(sql.command(viewSaveRoute, "user", {
      context: ids.context,
      name: "Mine",
      search: "experiments_by_status",
      inputs: {},
    }));
    assertEquals(sql.blobReads.slice(mark).length, 1);
    assert(applied.bundle.id.length > 0);
  } finally {
    sql.ledger.close();
  }
});

Deno.test("documents/contexts#R3 [ctx-I34a]: events another concern emits inside the same transaction (the hand-off Run, a blob registration) take their own seqs, and the context events and row revisions get the real next seqs", () => {
  const foreign = { type: "ForeignEvent", payload: z.object({}) };
  const sql = sqlApi({}, (base) => ({
    startHandOffRun: (tx, request) => {
      const run = id("run", 500);
      tx.emit(foreign, run, {});
      assert(request.violations.length > 0);
      return run;
    },
    blobs: {
      read: (reference) => base.blobs.read(reference),
      put: (tx, value) => {
        tx.emit(foreign, "blob", {});
        return base.blobs.put(tx, value);
      },
    },
  }));
  try {
    createContext(sql);
    // save_draft: blob 등록 event가 먼저 나가고 DraftSaved가 그 다음 seq를 받는다
    const draft = value(sql.command(bundleSaveDraftRoute, "engineer", {
      context: ids.context,
      content: minimalContent(),
    }));
    const seqOf = (type: string) =>
      sql.events().filter((event) => event.type === type).map((event) =>
        event.seq
      );
    assertEquals(sql.events().map((event) => event.type), [
      "ContextCreated",
      "ForeignEvent",
      "ContextBundleDraftSaved",
    ]);
    assertEquals(seqOf("ContextBundleDraftSaved"), ["103"]);
    assertEquals(draft.revision, "103");
    assertEquals(
      sql.ledger.sql.get("SELECT revision FROM context_bundles", []),
      { revision: "103" },
    );
    // 판을 적용하고 위반을 넘긴다
    const submitted = value(
      sql.command(bundleSubmitRoute, "engineer", { bundle: draft.id }),
    );
    value(sql.command(bundleFinishCheckRoute, "worker", {
      check: submitted.check!,
      result: "passed",
      bundle_hash: submitted.bundle_hash!,
      snapshot_hash: SNAPSHOT,
      findings: [],
      violation_count: 0,
    }));
    sql.seedViolations(ids.context, [violation()]);
    const handed = sql.command(contextHandOffViolationsRoute, "user", {
      context: ids.context,
    });
    assertEquals(code(handed), "ok");
    const last = sql.events().slice(-2);
    assertEquals(last.map((event) => event.type), [
      "ForeignEvent",
      "ContextViolationsHandedOff",
    ]);
    assertEquals(Number(last[1]!.seq), Number(last[0]!.seq) + 1);
    assertEquals(Number(last[1]!.seq), sql.ledger.head());
    // 모든 행의 revision은 실제로 나간 event의 seq다
    const emitted = new Set(sql.events().map((event) => event.seq));
    for (const table of ["contexts", "context_bundles"]) {
      for (
        const row of sql.ledger.sql.all(`SELECT revision FROM ${table}`, [])
      ) {
        assert(emitted.has(String(row.revision)), `${table} ${row.revision}`);
      }
    }
    const applied = seqOf("ContextBundleApplied");
    assertEquals(
      sql.ledger.sql.get("SELECT revision FROM contexts", []),
      { revision: applied[0] },
    );
  } finally {
    sql.ledger.close();
  }
});

// ---------- ctx-S26: 화면이 읽는 것 ----------

const FAILED_CHECK = [{
  kind: "example_mismatch" as const,
  target: "examples/0",
  detail: "expected exp-001 first",
}];

// drafting context가 읽기 → 초안 → 검사 → 실패 → 다시 초안 → 적용까지 가는 동안 새 읽기들을 부른다.
function screenReads(api: Api) {
  const context = ids.context;
  const draftRead = () => api.read(contextDraftRoute, "user", { context });
  createContext(api);
  draftRead();
  api.read(contextContractRoute, "user", { context });
  const first = value(api.command(bundleSaveDraftRoute, "engineer", {
    context,
    content: { schema: 1, contract: { types: [] }, note: "unfinished" },
  }));
  draftRead();
  const content = minimalContent({ examples: [] });
  const draft = value(api.command(bundleSaveDraftRoute, "engineer", {
    context,
    bundle: first.id,
    content,
  }, { base_revision: first.revision }));
  draftRead();
  const submitted = value(
    api.command(bundleSubmitRoute, "engineer", { bundle: draft.id }),
  );
  draftRead();
  value(api.command(bundleFinishCheckRoute, "worker", {
    check: submitted.check!,
    result: "failed",
    bundle_hash: submitted.bundle_hash!,
    snapshot_hash: SNAPSHOT,
    findings: FAILED_CHECK,
    violation_count: 0,
  }));
  draftRead();
  applyBundle(api, context, optionsContent());
  draftRead();
  api.read(contextContractRoute, "user", { context });
  api.read(contextContractRoute, "engineer", { context });
  api.read(contextContractRoute, "codingAgent", { context });
  api.read(contextDraftRoute, "user", { context: ids.missingContext });
  api.read(contextContractRoute, "user", { context: ids.missingContext });

  api.seedEntities(context, [
    entity("Experiment", "003", {
      title: "Third",
      status: "weird",
      round: 10,
      tags: ["x", "y"],
    }),
    entity("Experiment", "001", {
      title: "First",
      status: "done",
      round: 2,
      tags: ["y", "a"],
    }),
    entity("Experiment", "002", { status: "running", round: 2 }),
    entity("Scenario", "s-1", { title: "Not an experiment" }),
  ]);
  const options = (input: string, extra: Record<string, unknown> = {}) =>
    api.read(contextInputOptionsRoute, "user", {
      context,
      search: "experiment_picker",
      input,
      ...extra,
    });
  options("experiment");
  options("experiment", { prefix: "fi" });
  options("experiment", { limit: 2 });
  options("status");
  options("status", { prefix: "RUN" });
  options("title");
  options("round");
  options("tag");
  options("note");
  options("window");
  options("nope");
  api.read(contextInputOptionsRoute, "user", {
    context,
    search: "nope",
    input: "status",
  });
  api.read(contextInputOptionsRoute, "codingAgent", {
    context,
    search: "experiment_picker",
    input: "status",
  });
  api.read(contextInputOptionsRoute, "user", {
    context: ids.missingContext,
    search: "experiment_picker",
    input: "status",
  });

  api.seedViolations(context, [
    violation({ path: "docs/a.md" }),
    violation({ path: "docs/b.md" }),
    violation({ path: "docs/c.md", section: "Intro" }),
  ]);
  const violations = () =>
    api.read(contextViolationsRoute, "user", { context });
  violations();
  value(api.command(contextHandOffViolationsRoute, "user", {
    context,
    violations: [
      {
        kind: "rule",
        rule: "Experiment.status-required",
        path: "docs/b.md",
        section: null,
      },
      {
        kind: "rule",
        rule: "Experiment.status-required",
        path: "docs/c.md",
        section: "Intro",
      },
    ],
  }));
  violations();
  api.read(contextViolationsRoute, "user", { context, limit: 1 });
}

Deno.test("documents/contexts#R15 [ctx-S26]: the context.contract, context.draft and context.input_options reads and the handed_off flag give the same results as the handlers", () => {
  finished(screenReads, (sql) => {
    type Logged = {
      call: string;
      result: {
        ok: boolean;
        value?: {
          draft?: { step: number } | null;
          content?: { searches: { name: string }[] } | null;
          violations?: { handed_off: boolean }[];
        };
      };
    };
    const reads = sql.transcript as Logged[];
    const of = (name: string) =>
      reads.filter((entry) => entry.call === `${name} by user`);
    // 적용 전 draft 읽기: 1 → 2 → 2 → 3 → 2(failed) → null(적용됨)
    const steps = of("context.draft").map((entry) =>
      entry.result.value?.draft?.step ?? entry.result.value?.draft ?? null
    );
    assertEquals(steps, [1, 2, 2, 3, 2, null, null]);
    const contracts = of("context.contract");
    assertEquals(contracts[0].result.value?.content, null);
    assertEquals(
      contracts[1].result.value?.content?.searches[0].name,
      "experiment_picker",
    );
    const flags = of("context.violations").map((entry) =>
      entry.result.value?.violations?.map((item) => item.handed_off)
    );
    assertEquals(flags, [[false, false, false], [false, true, true], [false]]);
  });
});

Deno.test("documents/contexts#R16 [ctx-S26]: context.search gives the total and passes the executor's refs and cells through", () => {
  const ref = {
    type: "Experiment",
    key: "001",
    path: "eval/experiments/exp-001-plan.md",
    section: null,
  };
  const rows = ["001", "002", "003"].map((key) => ({
    ref: { ...ref, key },
    cells: [{ path: "key", value: key, ref: { ...ref, key } }],
  }));
  const sql = sqlApi({}, () => ({ execute: () => rows }));
  try {
    createContext(sql);
    applyBundle(sql, ids.context);
    const read = value(sql.read(contextSearchRoute, "user", {
      context: ids.context,
      search: "experiment_by_key",
      inputs: { experiment: "001" },
    }));
    assertEquals(read.total, 3);
    assertEquals(read.rows, rows.slice(0, 2));
    assertEquals(read.complete, false);
  } finally {
    sql.ledger.close();
  }
});

Deno.test("documents/contexts#R19 [ctx-S26]: context.draft reads only the blob of the bundle in progress and context.contract only the applied one", () => {
  const sql = sqlApi();
  try {
    createContext(sql);
    const failed = value(sql.command(bundleSaveDraftRoute, "engineer", {
      context: ids.context,
      content: minimalContent(),
    }));
    const submitted = value(
      sql.command(bundleSubmitRoute, "engineer", { bundle: failed.id }),
    );
    value(sql.command(bundleFinishCheckRoute, "worker", {
      check: submitted.check!,
      result: "failed",
      bundle_hash: submitted.bundle_hash!,
      snapshot_hash: SNAPSHOT,
      findings: FAILED_CHECK,
      violation_count: 0,
    }));
    const draft = value(sql.command(bundleSaveDraftRoute, "engineer", {
      context: ids.context,
      content: optionsContent(),
    }));
    // draft가 있으면 그것만, 없으면 마지막 failed 판 하나만 읽는다
    let mark = sql.blobReads.length;
    const withDraft = value(
      sql.read(contextDraftRoute, "user", { context: ids.context }),
    );
    assertEquals(sql.blobReads.length - mark, 1);
    assertEquals(withDraft.draft?.bundle?.id, draft.id);
    assertEquals(withDraft.draft?.content, optionsContent());
    value(sql.command(bundleDiscardDraftRoute, "engineer", {
      bundle: draft.id,
    }, { base_revision: draft.revision }));
    mark = sql.blobReads.length;
    const afterFailure = value(
      sql.read(contextDraftRoute, "user", { context: ids.context }),
    );
    assertEquals(sql.blobReads.length - mark, 1);
    assertEquals(afterFailure.draft?.bundle?.id, failed.id);
    assertEquals(afterFailure.draft?.step, 2);
    assertEquals(afterFailure.draft?.check?.status, "failed");
    // 적용된 판이 없는 context의 contract는 blob을 읽지 않는다
    mark = sql.blobReads.length;
    const none = value(
      sql.read(contextContractRoute, "user", { context: ids.context }),
    );
    assertEquals(none.content, null);
    assertEquals(sql.blobReads.length - mark, 0);
    applyBundle(sql, ids.context);
    mark = sql.blobReads.length;
    value(sql.read(contextContractRoute, "user", { context: ids.context }));
    assertEquals(sql.blobReads.length - mark, 1);
    // 적용되면 draft는 null이고 content blob도 읽지 않는다
    mark = sql.blobReads.length;
    assertEquals(
      value(sql.read(contextDraftRoute, "user", { context: ids.context }))
        .draft,
      null,
    );
    assertEquals(sql.blobReads.length - mark, 0);
  } finally {
    sql.ledger.close();
  }
});

Deno.test("documents/contexts#R25 [ctx-S26]: handed_off survives in the ledger events table and ignores other contexts' hand-offs", () => {
  const sql = sqlApi();
  try {
    createContext(sql);
    applyBundle(sql, ids.context);
    createContext(sql, { id: ids.otherContext, title: "Other" });
    applyBundle(sql, ids.otherContext);
    sql.seedViolations(ids.context, [violation({ path: "docs/a.md" })]);
    sql.seedViolations(ids.otherContext, [
      violation({ path: "docs/a.md", context: ids.otherContext }),
    ]);
    value(sql.command(contextHandOffViolationsRoute, "user", {
      context: ids.otherContext,
    }));
    const flagsOf = (context: string) =>
      value(sql.read(contextViolationsRoute, "user", { context })).violations
        .map((item) => item.handed_off);
    assertEquals(flagsOf(ids.context), [false]);
    assertEquals(flagsOf(ids.otherContext), [true]);
    value(sql.command(contextHandOffViolationsRoute, "user", {
      context: ids.context,
    }));
    assertEquals(flagsOf(ids.context), [true]);
  } finally {
    sql.ledger.close();
  }
});

Deno.test("documents/contexts#R3 [ctx-I34a]: the adapter keeps no idempotency state, so a repeated create is judged again", () => {
  const sql = sqlApi();
  try {
    createContext(sql);
    const again = sql.command(contextCreateRoute, "user", {
      id: ids.context,
      project: ids.project,
      title: "Experiments",
      purpose: "Track experiments and findings",
    });
    assertEquals(code(again), "conflict");
    assertEquals(sql.events().length, 1);
  } finally {
    sql.ledger.close();
  }
});

Deno.test("documents/contexts#R3 [ctx-I34a]: every context command and read route has a definition", () => {
  const deps = {} as ContextLedgerDeps;
  assertEquals(
    contextLedgerCommands(deps).map((def) => def.route.name).sort(),
    CONTEXT_API_COMMAND_ROUTES.map((route) => route.name).sort(),
  );
  assertEquals(
    contextLedgerReads(deps).map((def) => def.route.name).sort(),
    CONTEXT_API_READ_ROUTES.map((route) => route.name).sort(),
  );
});

Deno.test("documents/contexts#R27 [ctx-I34a]: mapActor turns the platform credential into the handler's actor", () => {
  const deps = {
    isContextEngineer: (assignment: string) => assignment === id("asg", 1),
  };
  const mapped = (actor: string, operations: string[] = []) => {
    const result = mapActor(requestContext(actor, operations), deps);
    return result.ok ? result.value : result.error.code;
  };
  assertEquals(mapped("user"), { kind: "user", actor: "user" });
  assertEquals(mapped(actors.engineer.actor), actors.engineer);
  assertEquals(mapped(actors.otherAgent.actor), actors.otherAgent);
  assertEquals(mapped("machine", WORKER_OPERATIONS), actors.worker);
  assertEquals(mapped("machine", ["bundle.finish_check"]), actors.worker);
  assertEquals(mapped("machine", []), actors.otherMachine);
  assertEquals(
    mapped("machine", ["bundle.finish_check", "app.run"]),
    actors.otherMachine,
  );
  assertEquals(mapped(actors.codingAgent.actor), actors.codingAgent);
  assertEquals(mapped(`app:${id("app", 1)}`), "forbidden");
});
