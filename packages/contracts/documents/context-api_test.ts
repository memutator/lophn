import { assert, assertEquals } from "@std/assert";
import type { z } from "zod";
import { commandRequestSchema, routePath } from "../platform/mod.ts";
import {
  bundleAppliedEvent,
  bundleCheckFailedEvent,
  bundleDiscardDraftRoute,
  bundleDraftDiscardedEvent,
  bundleDraftSavedEvent,
  bundleFinishCheckRequestSchema,
  bundleFinishCheckRoute,
  bundleRollbackRoute,
  bundleRolledBackEvent,
  bundleSaveDraftRoute,
  bundleSubmitRoute,
  bundleSubmittedEvent,
  bundleSummarySchema,
  checkReportSchema,
  CONTEXT_API_COMMAND_ROUTES,
  CONTEXT_API_EVENTS,
  CONTEXT_API_READ_ROUTES,
  CONTEXT_API_ROUTES,
  contextArchivedEvent,
  contextArchiveRoute,
  contextBundlesReadSchema,
  contextContainingReadSchema,
  contextContainingRequestSchema,
  contextContractReadSchema,
  contextContractRoute,
  contextCreatedEvent,
  contextCreateRoute,
  contextDraftReadSchema,
  contextDraftRoute,
  contextEntityReadSchema,
  contextEntityRequestSchema,
  contextEntityRoute,
  contextGetReadSchema,
  contextGetRoute,
  contextHandOffViolationsRoute,
  contextInputOptionsReadSchema,
  contextInputOptionsRequestSchema,
  contextInputOptionsRoute,
  contextListReadSchema,
  contextListRequestSchema,
  contextListRoute,
  contextOverviewReadSchema,
  contextOverviewRoute,
  contextPreviewReadSchema,
  contextPreviewRequestSchema,
  contextPreviewRoute,
  contextRecordViolationsRoute,
  contextSavedViewsReadSchema,
  contextSearchReadSchema,
  contextSearchRequestSchema,
  contextSearchRoute,
  contextSeriesNextReadSchema,
  contextSeriesNextRequestSchema,
  contextSeriesNextRoute,
  contextUnarchivedEvent,
  contextUnarchiveRoute,
  contextValueSchema,
  contextViolationsHandedOffEvent,
  contextViolationsReadSchema,
  contextViolationsRecordedEvent,
  glossaryEntryRemovedEvent,
  glossaryEntrySchema,
  glossaryEntrySetEvent,
  glossaryListReadSchema,
  glossaryListRoute,
  glossaryRemoveRoute,
  glossarySetRoute,
  savedViewCreatedEvent,
  savedViewDeletedEvent,
  savedViewUpdatedEvent,
  storedViolationSchema,
  viewDeleteRoute,
  viewSaveRoute,
  viewUpdateRoute,
  violationItemSchema,
  violationKeySchema,
  violationSchema,
} from "./context-api.ts";

const ctx = "ctx_01arz3ndektsv4rrffq69g5fav";
const cbn = "cbn_01arz3ndektsv4rrffq69g5fav";
const cbn2 = "cbn_01arz3ndektsv4rrffq69g5faw";
const chk = "chk_01arz3ndektsv4rrffq69g5fav";
const viw = "viw_01arz3ndektsv4rrffq69g5fav";
const trm = "trm_01arz3ndektsv4rrffq69g5fav";
const prj = "prj_01arz3ndektsv4rrffq69g5fav";
const app = "app_01arz3ndektsv4rrffq69g5fav";
const run = "run_01arz3ndektsv4rrffq69g5fav";
const agent = "agent:asg_01arz3ndektsv4rrffq69g5fav";
const hash = "a".repeat(64);
const hash2 = "b".repeat(64);
const at = "2026-10-12T00:00:00.000Z";
const meta = { as_of_seq: "9", complete: true, next_cursor: null };

const context = {
  id: ctx,
  project: prj,
  title: "Experiments",
  purpose: "Track experiments and findings",
  status: "active",
  applied_bundle: cbn,
  violation_mark: 0,
  revision: "5",
};
const draftBundle = {
  id: cbn,
  context: ctx,
  number: null,
  parent: null,
  bundle_hash: null,
  status: "draft",
  check: null,
  created_by: agent,
  revision: "6",
};
const appliedBundle = {
  ...draftBundle,
  number: 1,
  bundle_hash: hash,
  status: "applied",
  check: chk,
};
const finding = {
  kind: "example_mismatch",
  target: "examples/0",
  detail: "expected exp-001 first",
};
const passedCheck = {
  id: chk,
  context: ctx,
  bundle: cbn,
  status: "passed",
  snapshot_hash: hash2,
  findings: [],
  violation_count: 2,
  started_at: at,
  finished_at: at,
};
const failedCheck = {
  ...passedCheck,
  status: "failed",
  findings: [finding],
};
const view = {
  id: viw,
  context: ctx,
  name: "Running experiments",
  search: "running_experiments",
  inputs: { status: "running" },
  origin: "user",
  revision: "7",
};
const entry = {
  id: trm,
  context: ctx,
  term: "Eating out",
  meaning: "Meals bought outside the home",
  set_by: "user",
  updated_at: at,
  revision: "8",
};
const ruleViolation = {
  kind: "rule",
  rule: "Experiment.status-required",
  type: "Experiment",
  path: "eval/experiments/exp-004-nostatus.md",
  section: null,
  target: null,
};
const brokenLink = {
  kind: "broken_link",
  rule: null,
  type: "Guide",
  path: "docs/README.md",
  section: null,
  target: "docs/gone.md",
};
const stored = {
  context: ctx,
  bundle_hash: hash,
  ...ruleViolation,
  message: "Every experiment says its status",
};
const ref = {
  type: "Experiment",
  key: "001",
  path: "eval/experiments/exp-001-plan.md",
  section: null,
};

function accepts(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value);
  assert(result.success, JSON.stringify(result.error?.issues));
}
function rejects(schema: z.ZodType, value: unknown) {
  assertEquals(schema.safeParse(value).success, false);
}
function request(
  route: Parameters<typeof commandRequestSchema>[0],
  input: unknown,
  compare: unknown = {},
) {
  return commandRequestSchema(route).safeParse({
    input,
    compare,
    idempotency_key: "key-1",
    prepared: [],
  }).success;
}
function without(value: object, key: string) {
  const copy: Record<string, unknown> = { ...value };
  delete copy[key];
  return copy;
}

// deno-fmt-ignore
const commandPaths = ["/v1/contexts/create", "/v1/contexts/archive", "/v1/contexts/unarchive", "/v1/contexts/save_draft", "/v1/contexts/discard_draft", "/v1/contexts/submit_bundle", "/v1/contexts/record_check", "/v1/contexts/rollback", "/v1/contexts/save_view", "/v1/contexts/update_view", "/v1/contexts/delete_view", "/v1/contexts/record_violations", "/v1/contexts/hand_off_violations", "/v1/terms/set", "/v1/terms/remove"];
// deno-fmt-ignore
const readPaths = ["/v1/contexts/list", "/v1/contexts/get", "/v1/contexts/overview", "/v1/contexts/contract", "/v1/contexts/draft", "/v1/contexts/search", "/v1/contexts/input_options", "/v1/contexts/violations", "/v1/contexts/bundles", "/v1/contexts/saved_views", "/v1/contexts/preview", "/v1/contexts/entity", "/v1/contexts/series_next", "/v1/contexts/containing", "/v1/terms/list"];
// deno-fmt-ignore
const eventTypes = ["ContextCreated", "ContextArchived", "ContextUnarchived", "ContextBundleDraftSaved", "ContextBundleDraftDiscarded", "ContextBundleSubmitted", "ContextBundleCheckFailed", "ContextBundleApplied", "ContextBundleRolledBack", "SavedViewCreated", "SavedViewUpdated", "SavedViewDeleted", "ContextViolationsRecorded", "ContextViolationsHandedOff", "GlossaryEntrySet", "GlossaryEntryRemoved"];

Deno.test("documents/contexts#R19 [ctx-S15]: route paths, command names and event names match the domain model", () => {
  assertEquals(CONTEXT_API_COMMAND_ROUTES.map(routePath), commandPaths);
  assertEquals(CONTEXT_API_READ_ROUTES.map(routePath), readPaths);
  assertEquals(CONTEXT_API_EVENTS.map((event) => event.type), eventTypes);
  assertEquals(CONTEXT_API_COMMAND_ROUTES.map((route) => route.name), [
    "context.create",
    "context.archive",
    "context.unarchive",
    "bundle.save_draft",
    "bundle.discard_draft",
    "bundle.submit",
    "bundle.finish_check",
    "bundle.rollback",
    "view.save",
    "view.update",
    "view.delete",
    "context.record_violations",
    "context.hand_off_violations",
    "glossary.set",
    "glossary.remove",
  ]);
  assertEquals(
    new Set(CONTEXT_API_ROUTES.map(routePath)).size,
    CONTEXT_API_ROUTES.length,
  );
  assert(CONTEXT_API_COMMAND_ROUTES.every((route) => route.kind === "command"));
  assert(CONTEXT_API_READ_ROUTES.every((route) => route.kind === "read"));
});

Deno.test("documents/contexts#R27 [ctx-S15]: no route lets a coding agent in and the worker credential is machine only", () => {
  for (const route of CONTEXT_API_ROUTES) {
    assert(!route.actors.includes("coding_agent"), route.name);
    assert(!route.actors.includes("app"), route.name);
  }
  for (const route of [bundleFinishCheckRoute, contextRecordViolationsRoute]) {
    assertEquals(route.actors, ["machine"]);
  }
});

Deno.test("documents/contexts#R28 [ctx-S15]: only the Context Engineer saves and submits drafts and nobody else applies a bundle", () => {
  assertEquals(bundleSaveDraftRoute.actors, ["agent"]);
  assertEquals(bundleSubmitRoute.actors, ["agent"]);
  assertEquals(bundleDiscardDraftRoute.actors, ["user", "agent"]);
  assertEquals(bundleRollbackRoute.actors, ["user"]);
  assertEquals(contextArchiveRoute.actors, ["user"]);
  assertEquals(contextUnarchiveRoute.actors, ["user"]);
  const appliers = CONTEXT_API_COMMAND_ROUTES.filter((route) =>
    route.name === "bundle.finish_check" || route.name === "bundle.rollback"
  ).flatMap((route) => route.actors);
  assertEquals(appliers.sort(), ["machine", "user"]);
});

Deno.test("documents/contexts#R1 [ctx-S15]: context.create takes a project and rejects blank text and unknown fields", () => {
  const input = {
    id: ctx,
    project: prj,
    title: "Experiments",
    purpose: "Track experiments",
  };
  assert(request(contextCreateRoute, input));
  assert(!request(contextCreateRoute, without(input, "project")));
  assert(!request(contextCreateRoute, { ...input, title: "  " }));
  assert(!request(contextCreateRoute, { ...input, purpose: "" }));
  assert(!request(contextCreateRoute, { ...input, project: "workspace" }));
  assert(!request(contextCreateRoute, { ...input, id: cbn }));
  assert(!request(contextCreateRoute, { ...input, status: "active" }));
  // 새로 만드는 일은 비교할 revision이 없다
  assert(!request(contextCreateRoute, input, { base_revision: "1" }));
});

Deno.test("documents/contexts#R1 [ctx-S15]: a context list is scoped to one project and bounded", () => {
  accepts(contextListRequestSchema, { project: prj });
  accepts(contextListRequestSchema, {
    project: prj,
    status: "all",
    limit: 100,
  });
  rejects(contextListRequestSchema, {});
  rejects(contextListRequestSchema, { project: prj, status: "deleted" });
  rejects(contextListRequestSchema, { project: prj, limit: 0 });
  rejects(contextListRequestSchema, { project: prj, limit: 101 });
  rejects(contextListRequestSchema, { project: prj, cursor: "" });
  rejects(contextListRequestSchema, { project: prj, workspace: true });
  const item = {
    ...context,
    applied_number: 1,
    draft_bundle: null,
    checking_bundle: null,
  };
  accepts(contextListReadSchema, { ...meta, contexts: [item] });
  rejects(contextListReadSchema, {
    ...meta,
    contexts: [without(item, "project")],
  });
  rejects(contextListReadSchema, {
    ...meta,
    contexts: [{ ...item, applied_number: null }],
  });
  rejects(contextListReadSchema, {
    ...meta,
    complete: false,
    next_cursor: null,
    contexts: [item],
  });
});

Deno.test("documents/contexts#R4 [ctx-S15]: archive and unarchive need base_revision and are user only", () => {
  for (const route of [contextArchiveRoute, contextUnarchiveRoute]) {
    assert(request(route, { context: ctx }, { base_revision: "5" }));
    assert(!request(route, { context: ctx }, {}));
    assert(!request(route, { context: ctx }, { base_revision: "0" }));
    assert(!request(route, { context: ctx }, { base_revision: 5 }));
    assert(
      !request(route, { context: ctx, force: true }, { base_revision: "5" }),
    );
    assert(!request(route, { context: viw }, { base_revision: "5" }));
    assertEquals(route.actors, ["user"]);
    assertEquals(route.errors, ["not_found", "conflict", "forbidden"]);
  }
});

Deno.test("documents/contexts#R4 [ctx-S15]: a context value ties its status to the applied bundle", () => {
  accepts(contextValueSchema, context);
  accepts(contextValueSchema, {
    ...context,
    status: "drafting",
    applied_bundle: null,
  });
  accepts(contextValueSchema, { ...context, status: "archived" });
  accepts(contextValueSchema, {
    ...context,
    status: "archived",
    applied_bundle: null,
  });
  rejects(contextValueSchema, { ...context, status: "drafting" });
  rejects(contextValueSchema, { ...context, applied_bundle: null });
  rejects(contextValueSchema, { ...context, status: "paused" });
  rejects(contextValueSchema, { ...context, violation_mark: -1 });
  rejects(contextValueSchema, { ...context, items: [] });
  rejects(contextValueSchema, without(context, "violation_mark"));
});

Deno.test("documents/contexts#R22 [ctx-S15]: evidence carries paths and sections and never a document version", () => {
  accepts(violationSchema, ruleViolation);
  accepts(violationSchema, brokenLink);
  rejects(violationSchema, { ...ruleViolation, version: "ver_x" });
  rejects(violationSchema, { ...ruleViolation, document: "doc_x" });
  rejects(violationSchema, { ...ruleViolation, path: "/abs/path.md" });
  rejects(violationSchema, { ...ruleViolation, path: "../other/project.md" });
  rejects(violationSchema, { ...ruleViolation, path: "a/x\\y.md" });
  accepts(violationSchema, { ...ruleViolation, section: "질문" });
  accepts(contextSearchReadSchema, {
    ...meta,
    context: ctx,
    search: "running",
    bundle_hash: hash,
    total: 1,
    rows: [{ ref: { ...ref, path: "eval/e.md" }, cells: [] }],
  });
  rejects(contextSearchReadSchema, {
    ...meta,
    context: ctx,
    search: "running",
    bundle_hash: hash,
    total: 1,
    rows: [{
      ref: { ...ref, path: "eval/e.md", version: "ver_x" },
      cells: [],
    }],
  });
  rejects(contextSearchReadSchema, {
    ...meta,
    context: ctx,
    search: "running",
    bundle_hash: hash,
    total: 1,
    rows: [{ ref: { ...ref, path: "eval/e.md" }, cells: [], version: "ver_x" }],
  });
});

Deno.test("documents/contexts#R24 [ctx-S15]: a violation names its rule exactly when its kind is rule", () => {
  accepts(violationSchema, ruleViolation);
  accepts(violationSchema, {
    kind: "unreadable",
    rule: null,
    type: "Experiment",
    path: "eval/experiments/exp-005-badyaml.md",
    section: null,
    target: null,
  });
  accepts(violationSchema, {
    kind: "path_mismatch",
    rule: null,
    type: null,
    path: "eval/experiments/notes.md",
    section: null,
    target: null,
  });
  rejects(violationSchema, { ...ruleViolation, rule: null });
  rejects(violationSchema, { ...brokenLink, rule: "Guide.links" });
  rejects(violationSchema, { ...ruleViolation, kind: "warning" });
  rejects(violationSchema, { ...ruleViolation, type: "experiment" });
  rejects(violationSchema, without(ruleViolation, "target"));
  rejects(violationSchema, { ...ruleViolation, message: "text" });
});

Deno.test("documents/contexts#R24 [ctx-S15]: a stored violation adds the context, the detected bundle hash and a message", () => {
  accepts(storedViolationSchema, stored);
  rejects(storedViolationSchema, without(stored, "message"));
  rejects(storedViolationSchema, without(stored, "bundle_hash"));
  rejects(storedViolationSchema, without(stored, "context"));
  rejects(storedViolationSchema, { ...stored, message: " " });
  rejects(storedViolationSchema, { ...stored, bundle_hash: "xyz" });
  accepts(contextViolationsReadSchema, {
    ...meta,
    context: ctx,
    violations: [{ ...stored, handed_off: false }],
  });
  rejects(contextViolationsReadSchema, {
    ...meta,
    context: ctx,
    violations: [ruleViolation],
  });
  rejects(contextViolationsReadSchema, {
    ...meta,
    context: ctx,
    violations: Array.from(
      { length: 101 },
      () => ({ ...stored, handed_off: false }),
    ),
  });
});

Deno.test("documents/contexts#R25 [ctx-S26]: a violation item says whether it was already handed to the Context Engineer", () => {
  const item = { ...stored, handed_off: true };
  accepts(violationItemSchema, item);
  accepts(violationItemSchema, { ...stored, handed_off: false });
  rejects(violationItemSchema, stored);
  rejects(violationItemSchema, { ...item, handed_off: "yes" });
  rejects(violationItemSchema, { ...item, handed_off: null });
  rejects(violationItemSchema, { ...item, rule: null });
  rejects(violationItemSchema, { ...item, extra: 1 });
  rejects(violationItemSchema, without(item, "message"));
  accepts(contextViolationsReadSchema, {
    ...meta,
    context: ctx,
    violations: [item, { ...stored, handed_off: false }],
  });
  rejects(contextViolationsReadSchema, {
    ...meta,
    context: ctx,
    violations: [stored],
  });
});

Deno.test("documents/contexts#R19 [ctx-S15]: save_draft takes a JSON object and an optional existing draft", () => {
  const content = { schema: 1, contract: { types: [] } };
  assert(request(bundleSaveDraftRoute, { context: ctx, content }));
  assert(request(
    bundleSaveDraftRoute,
    { context: ctx, bundle: cbn, content },
    { base_revision: "6" },
  ));
  // 새 draft는 비교 기준이 없고 handler가 base_revision의 유무를 bundle과 맞춰 본다
  assert(request(bundleSaveDraftRoute, { context: ctx, content }, {}));
  assert(!request(bundleSaveDraftRoute, { context: ctx }));
  assert(!request(bundleSaveDraftRoute, { context: ctx, content: "text" }));
  assert(!request(bundleSaveDraftRoute, { context: ctx, content: [1] }));
  assert(
    !request(bundleSaveDraftRoute, { context: ctx, bundle: ctx, content }),
  );
  assert(!request(bundleSaveDraftRoute, { content }));
  assert(
    !request(bundleSaveDraftRoute, { context: ctx, content, parent: cbn2 }),
  );
  assert(
    !request(
      bundleSaveDraftRoute,
      { context: ctx, bundle: cbn, content },
      { base_revision: "x" },
    ),
  );
  assertEquals(bundleSaveDraftRoute.errors, [
    "invalid_input",
    "not_found",
    "conflict",
    "forbidden",
  ]);
});

Deno.test("documents/contexts#R19 [ctx-S15]: discard_draft needs base_revision and a bundle id", () => {
  assert(
    request(bundleDiscardDraftRoute, { bundle: cbn }, { base_revision: "6" }),
  );
  assert(!request(bundleDiscardDraftRoute, { bundle: cbn }, {}));
  assert(
    !request(bundleDiscardDraftRoute, { bundle: chk }, { base_revision: "6" }),
  );
  assert(
    !request(bundleDiscardDraftRoute, { context: ctx }, { base_revision: "6" }),
  );
  assert(
    !request(bundleDiscardDraftRoute, { bundle: cbn, extra: 1 }, {
      base_revision: "6",
    }),
  );
});

Deno.test("documents/contexts#R19 [ctx-S15]: a bundle summary has a number, hash and check once submitted and not before", () => {
  accepts(bundleSummarySchema, draftBundle);
  accepts(bundleSummarySchema, appliedBundle);
  accepts(bundleSummarySchema, { ...appliedBundle, status: "checking" });
  accepts(bundleSummarySchema, {
    ...appliedBundle,
    status: "superseded",
    parent: cbn2,
  });
  accepts(bundleSummarySchema, { ...draftBundle, status: "discarded" });
  rejects(bundleSummarySchema, { ...draftBundle, number: 1 });
  rejects(bundleSummarySchema, { ...draftBundle, status: "checking" });
  rejects(bundleSummarySchema, { ...appliedBundle, check: null });
  rejects(bundleSummarySchema, { ...appliedBundle, number: 0 });
  rejects(bundleSummarySchema, { ...appliedBundle, status: "paused" });
  rejects(bundleSummarySchema, { ...appliedBundle, content: {} });
  rejects(bundleSummarySchema, { ...appliedBundle, created_by: "someone" });
  rejects(bundleSummarySchema, without(appliedBundle, "parent"));
});

Deno.test("documents/contexts#R20 [ctx-S15]: submit takes only a bundle and fails over a bad request", () => {
  assert(request(bundleSubmitRoute, { bundle: cbn }));
  assert(!request(bundleSubmitRoute, {}));
  assert(!request(bundleSubmitRoute, { bundle: ctx }));
  assert(!request(bundleSubmitRoute, { bundle: cbn, content: {} }));
  assertEquals(bundleSubmitRoute.actors, ["agent"]);
});

Deno.test("documents/contexts#R20 [ctx-S15]: finish_check carries the exact hashes, a result and findings that follow the result", () => {
  const passed = {
    check: chk,
    result: "passed",
    bundle_hash: hash,
    snapshot_hash: hash2,
    findings: [],
    violation_count: 3,
  };
  const failed = { ...passed, result: "failed", findings: [finding] };
  accepts(bundleFinishCheckRequestSchema, passed);
  accepts(bundleFinishCheckRequestSchema, failed);
  rejects(bundleFinishCheckRequestSchema, { ...passed, findings: [finding] });
  rejects(bundleFinishCheckRequestSchema, { ...failed, findings: [] });
  rejects(bundleFinishCheckRequestSchema, { ...passed, result: "running" });
  rejects(bundleFinishCheckRequestSchema, without(passed, "violation_count"));
  rejects(bundleFinishCheckRequestSchema, without(passed, "bundle_hash"));
  rejects(bundleFinishCheckRequestSchema, without(passed, "snapshot_hash"));
  rejects(bundleFinishCheckRequestSchema, { ...passed, violation_count: -1 });
  rejects(bundleFinishCheckRequestSchema, { ...passed, bundle: cbn });
  rejects(bundleFinishCheckRequestSchema, {
    ...failed,
    findings: [{ ...finding, kind: "mystery" }],
  });
  rejects(bundleFinishCheckRequestSchema, {
    ...failed,
    findings: [{ ...finding, detail: " " }],
  });
  assert(request(bundleFinishCheckRoute, passed));
  assert(!request(bundleFinishCheckRoute, { ...passed, check: cbn }));
  assertEquals(bundleFinishCheckRoute.actors, ["machine"]);
  assertEquals(routePath(bundleFinishCheckRoute), "/v1/contexts/record_check");
});

Deno.test("documents/contexts#R20 [ctx-S15]: a check report is open while running and complete when finished", () => {
  accepts(checkReportSchema, passedCheck);
  accepts(checkReportSchema, failedCheck);
  accepts(checkReportSchema, {
    ...passedCheck,
    status: "running",
    snapshot_hash: null,
    violation_count: null,
    finished_at: null,
  });
  for (
    const kind of [
      "contract_invalid",
      "cross_project_path",
      "private_reference",
      "example_mismatch",
      "saved_view_broken",
      "aborted",
    ]
  ) {
    accepts(checkReportSchema, {
      ...failedCheck,
      findings: [{ ...finding, kind }],
    });
  }
  rejects(checkReportSchema, { ...failedCheck, findings: [] });
  rejects(checkReportSchema, { ...passedCheck, findings: [finding] });
  rejects(checkReportSchema, { ...passedCheck, finished_at: null });
  rejects(checkReportSchema, { ...passedCheck, violation_count: null });
  rejects(checkReportSchema, { ...passedCheck, snapshot_hash: null });
  rejects(checkReportSchema, {
    ...passedCheck,
    status: "running",
    finished_at: null,
  });
  rejects(checkReportSchema, { ...passedCheck, started_at: "yesterday" });
  rejects(checkReportSchema, { ...passedCheck, bundle: ctx });
});

Deno.test("documents/contexts#R21 [ctx-S15]: rollback names the context and bundle and needs base_revision", () => {
  assert(
    request(bundleRollbackRoute, { context: ctx, bundle: cbn }, {
      base_revision: "5",
    }),
  );
  assert(!request(bundleRollbackRoute, { context: ctx, bundle: cbn }, {}));
  assert(
    !request(bundleRollbackRoute, { bundle: cbn }, { base_revision: "5" }),
  );
  assert(
    !request(bundleRollbackRoute, { context: ctx }, { base_revision: "5" }),
  );
  assert(
    !request(
      bundleRollbackRoute,
      { context: ctx, bundle: cbn, recheck: true },
      {
        base_revision: "5",
      },
    ),
  );
  assertEquals(bundleRollbackRoute.actors, ["user"]);
  assertEquals(routePath(bundleRollbackRoute), "/v1/contexts/rollback");
});

Deno.test("documents/contexts#R21 [ctx-S15]: the check events keep the applied and failed outcomes apart", () => {
  const applied = {
    context: ctx,
    number: 2,
    previous_applied: cbn2,
    check: chk,
    violation_count: 0,
  };
  accepts(bundleAppliedEvent.payload, applied);
  accepts(bundleAppliedEvent.payload, { ...applied, previous_applied: null });
  rejects(bundleAppliedEvent.payload, without(applied, "check"));
  rejects(bundleAppliedEvent.payload, { ...applied, number: 0 });
  accepts(bundleCheckFailedEvent.payload, {
    context: ctx,
    number: 2,
    check: chk,
    findings: [finding],
  });
  rejects(bundleCheckFailedEvent.payload, {
    context: ctx,
    number: 2,
    check: chk,
    findings: [],
  });
  accepts(bundleRolledBackEvent.payload, {
    context: ctx,
    number: 1,
    previous_applied: cbn2,
    before_revision: "5",
  });
  rejects(bundleRolledBackEvent.payload, {
    context: ctx,
    number: 1,
    previous_applied: null,
    before_revision: "5",
  });
  accepts(bundleSubmittedEvent.payload, {
    context: ctx,
    number: 1,
    bundle_hash: hash,
    check: chk,
  });
  rejects(bundleSubmittedEvent.payload, {
    context: ctx,
    number: 1,
    check: chk,
  });
  accepts(bundleDraftSavedEvent.payload, {
    context: ctx,
    parent: null,
    content: { hash, size_bytes: 120 },
  });
  rejects(bundleDraftSavedEvent.payload, {
    context: ctx,
    parent: null,
    content: { schema: 1 },
  });
  accepts(bundleDraftDiscardedEvent.payload, { context: ctx });
  rejects(bundleDraftDiscardedEvent.payload, {});
});

Deno.test("documents/contexts#R15 [ctx-S15]: a search call carries a declared search name and inputs keyed by input names", () => {
  const call = {
    context: ctx,
    search: "experiments_for_scenario",
    inputs: { scenario: "schedule-basic", status: ["running", "done"] },
  };
  accepts(contextSearchRequestSchema, call);
  accepts(contextSearchRequestSchema, { ...call, inputs: {} });
  accepts(contextSearchRequestSchema, {
    ...call,
    inputs: { range: { from: "2026-01-01", to: null }, flag: true, n: 3 },
  });
  rejects(contextSearchRequestSchema, without(call, "inputs"));
  rejects(contextSearchRequestSchema, without(call, "search"));
  rejects(contextSearchRequestSchema, without(call, "context"));
  rejects(contextSearchRequestSchema, { ...call, search: "Experiments" });
  rejects(contextSearchRequestSchema, { ...call, inputs: ["scenario"] });
  rejects(contextSearchRequestSchema, { ...call, inputs: { Scenario: "x" } });
  rejects(contextSearchRequestSchema, { ...call, inputs: { f: () => 1 } });
  rejects(contextSearchRequestSchema, { ...call, inputs: "scenario" });
  rejects(contextSearchRequestSchema, { ...call, query: {} });
  rejects(contextSearchRequestSchema, { ...call, text: "free text" });
});

Deno.test("documents/contexts#R17 [ctx-S15]: a search continues by cursor and page_size stays within 1 to 100", () => {
  const call = { context: ctx, search: "running", inputs: {} };
  accepts(contextSearchRequestSchema, { ...call, cursor: "opaque-1" });
  accepts(contextSearchRequestSchema, { ...call, page_size: 1 });
  accepts(contextSearchRequestSchema, { ...call, page_size: 100 });
  rejects(contextSearchRequestSchema, { ...call, page_size: 0 });
  rejects(contextSearchRequestSchema, { ...call, page_size: 101 });
  rejects(contextSearchRequestSchema, { ...call, page_size: 1.5 });
  rejects(contextSearchRequestSchema, { ...call, page_size: "30" });
  rejects(contextSearchRequestSchema, { ...call, cursor: "" });
  rejects(contextSearchRequestSchema, { ...call, cursor: 3 });
  const row = {
    ref,
    cells: [
      { path: "key", value: "001", ref },
      { path: "status", value: "done", ref: null },
      { path: "scenario.title", value: "Basic", ref: null },
      { path: "count", value: 2, ref: null },
      { path: "tags", value: ["a"], ref: null },
    ],
  };
  const page = {
    context: ctx,
    search: "running",
    bundle_hash: hash,
    total: 1,
    rows: [row],
  };
  accepts(contextSearchReadSchema, { ...meta, ...page });
  accepts(contextSearchReadSchema, {
    ...meta,
    ...page,
    complete: false,
    next_cursor: "opaque-2",
  });
  rejects(contextSearchReadSchema, { ...meta, ...page, complete: false });
  rejects(contextSearchReadSchema, {
    ...meta,
    ...page,
    next_cursor: "opaque-2",
  });
  accepts(contextSearchReadSchema, {
    ...meta,
    ...page,
    rows: Array.from({ length: 100 }, () => row),
  });
  rejects(contextSearchReadSchema, {
    ...meta,
    ...page,
    rows: Array.from({ length: 101 }, () => row),
  });
});

Deno.test("documents/contexts#R16 [ctx-S15]: a result row holds the entity ref and one cell per column", () => {
  const page = (row: unknown) => ({
    ...meta,
    context: ctx,
    search: "running",
    bundle_hash: hash,
    total: 1,
    rows: [row],
  });
  const section = { ...ref, section: "질문" };
  const row = { ref: section, cells: [] };
  accepts(contextSearchReadSchema, page(row));
  accepts(contextSearchReadSchema, page({ ref, cells: [] }));
  rejects(contextSearchReadSchema, page(without(row, "ref")));
  rejects(contextSearchReadSchema, page(without(row, "cells")));
  rejects(contextSearchReadSchema, page({ ...row, ref: without(ref, "type") }));
  rejects(contextSearchReadSchema, page({ ...row, ref: without(ref, "key") }));
  rejects(contextSearchReadSchema, page({ ...row, ref: without(ref, "path") }));
  rejects(
    contextSearchReadSchema,
    page({ ...row, ref: without(ref, "section") }),
  );
  rejects(
    contextSearchReadSchema,
    page({ ...row, ref: { ...ref, path: "/abs/b.md" } }),
  );
  rejects(contextSearchReadSchema, page({ ...row, ref: { ...ref, key: "" } }));
  rejects(
    contextSearchReadSchema,
    page({ ...row, ref: { ...ref, type: "experiment" } }),
  );
  // 옛 모양(key, path, section, values)은 더 받지 않는다
  rejects(
    contextSearchReadSchema,
    page({ key: "001", path: "a/b.md", section: null, values: {} }),
  );
  rejects(contextSearchReadSchema, page({ ...row, values: {} }));
  rejects(contextSearchReadSchema, without({ ...page(row) }, "bundle_hash"));
});

Deno.test("documents/contexts#R16 [ctx-S26]: a cell carries the column path, a value and the entity ref of a key column or null", () => {
  const page = (cell: unknown) => ({
    ...meta,
    context: ctx,
    search: "running",
    bundle_hash: hash,
    total: 1,
    rows: [{ ref, cells: [cell] }],
  });
  const alias = { ...ref, type: "Scenario", key: "query-leave-still" };
  accepts(contextSearchReadSchema, page({ path: "key", value: "001", ref }));
  accepts(
    contextSearchReadSchema,
    page({ path: "scenario.key", value: alias.key, ref: alias }),
  );
  accepts(contextSearchReadSchema, page({ path: "x", value: null, ref: null }));
  accepts(
    contextSearchReadSchema,
    page({ path: "tags", value: ["a", 1, null], ref: null }),
  );
  rejects(contextSearchReadSchema, page({ path: "x", value: 1 }));
  rejects(contextSearchReadSchema, page({ value: 1, ref: null }));
  rejects(contextSearchReadSchema, page({ path: "x", ref: null }));
  rejects(contextSearchReadSchema, page({ path: "A.b", value: 1, ref: null }));
  rejects(
    contextSearchReadSchema,
    page({ path: "a.b.c", value: 1, ref: null }),
  );
  rejects(
    contextSearchReadSchema,
    page({ path: "x", value: 1, ref: null, extra: 1 }),
  );
  rejects(
    contextSearchReadSchema,
    page({ path: "x", value: 1, ref: { ...ref, version: "ver_x" } }),
  );
});

Deno.test("documents/contexts#R17 [ctx-S26]: a search page carries the total of all matching rows", () => {
  const page = {
    ...meta,
    context: ctx,
    search: "running",
    bundle_hash: hash,
    rows: [],
  };
  accepts(contextSearchReadSchema, { ...page, total: 0 });
  accepts(contextSearchReadSchema, { ...page, total: 61 });
  rejects(contextSearchReadSchema, page);
  rejects(contextSearchReadSchema, { ...page, total: -1 });
  rejects(contextSearchReadSchema, { ...page, total: 1.5 });
  rejects(contextSearchReadSchema, { ...page, total: "61" });
});

Deno.test("documents/contexts#R18 [ctx-S15]: view.save takes a declared search call with fixed inputs", () => {
  const input = {
    context: ctx,
    name: "Running experiments",
    search: "running_experiments",
    inputs: { status: "running" },
  };
  assert(request(viewSaveRoute, input));
  assert(request(viewSaveRoute, { ...input, inputs: {} }));
  assert(!request(viewSaveRoute, without(input, "inputs")));
  assert(!request(viewSaveRoute, without(input, "search")));
  assert(!request(viewSaveRoute, { ...input, name: " " }));
  assert(!request(viewSaveRoute, { ...input, search: "Not A Name" }));
  assert(!request(viewSaveRoute, { ...input, inputs: "status=running" }));
  // 일반 조건으로는 saved view를 만들 수 없다
  assert(!request(viewSaveRoute, { ...input, filter: { text: "abc" } }));
  assert(!request(viewSaveRoute, { ...input, origin: "engineer" }));
  assertEquals(viewSaveRoute.actors, ["user"]);
});

Deno.test("documents/contexts#R18 [ctx-S15]: view.update changes at least one field and view.delete names a view, both with base_revision", () => {
  assert(
    request(viewUpdateRoute, { view: viw, name: "Open" }, {
      base_revision: "7",
    }),
  );
  assert(
    request(viewUpdateRoute, { view: viw, inputs: {} }, { base_revision: "7" }),
  );
  assert(request(
    viewUpdateRoute,
    { view: viw, name: "Open", search: "open", inputs: { a: 1 } },
    { base_revision: "7" },
  ));
  assert(!request(viewUpdateRoute, { view: viw }, { base_revision: "7" }));
  assert(!request(viewUpdateRoute, { view: viw, name: "Open" }, {}));
  assert(
    !request(viewUpdateRoute, { view: viw, name: " " }, { base_revision: "7" }),
  );
  assert(
    !request(viewUpdateRoute, { view: ctx, name: "Open" }, {
      base_revision: "7",
    }),
  );
  assert(
    !request(viewUpdateRoute, { view: viw, origin: "user" }, {
      base_revision: "7",
    }),
  );
  assert(request(viewDeleteRoute, { view: viw }, { base_revision: "7" }));
  assert(!request(viewDeleteRoute, { view: viw }, {}));
  assert(
    !request(viewDeleteRoute, { view: viw, context: ctx }, {
      base_revision: "7",
    }),
  );
});

Deno.test("documents/contexts#R18 [ctx-S15]: saved view events keep the before values", () => {
  accepts(savedViewCreatedEvent.payload, {
    context: ctx,
    name: "Running",
    search: "running",
    inputs: {},
    origin: "engineer",
  });
  rejects(savedViewCreatedEvent.payload, {
    context: ctx,
    name: "Running",
    search: "running",
    inputs: {},
    origin: "agent",
  });
  accepts(savedViewUpdatedEvent.payload, {
    before: { name: "Running" },
    after: { name: "Open" },
    before_revision: "7",
  });
  rejects(savedViewUpdatedEvent.payload, {
    before: {},
    after: {},
    before_revision: "7",
  });
  rejects(savedViewUpdatedEvent.payload, {
    before: { name: "Running" },
    after: { name: "Open" },
  });
  accepts(savedViewDeletedEvent.payload, {
    before_view: view,
    before_revision: "7",
  });
  rejects(savedViewDeletedEvent.payload, {
    before_view: without(view, "origin"),
    before_revision: "7",
  });
});

Deno.test("documents/contexts#R18 [ctx-S15]: the saved view list marks a broken call and orders nothing in the schema", () => {
  accepts(contextSavedViewsReadSchema, {
    ...meta,
    context: ctx,
    views: [{ ...view, broken: false }, {
      ...view,
      id: "viw_01arz3ndektsv4rrffq69g5faw",
      broken: true,
    }],
  });
  rejects(contextSavedViewsReadSchema, {
    ...meta,
    context: ctx,
    views: [view],
  });
  rejects(contextSavedViewsReadSchema, {
    ...meta,
    context: ctx,
    views: [{ ...view, origin: "agent", broken: false }],
  });
});

Deno.test("documents/contexts#R25 [ctx-S15]: record_violations is a machine submission with a count and the detected hash", () => {
  const input = { context: ctx, count: 4, bundle_hash: hash };
  assert(request(contextRecordViolationsRoute, input));
  assert(request(contextRecordViolationsRoute, { ...input, count: 0 }));
  assert(!request(contextRecordViolationsRoute, { ...input, count: -1 }));
  assert(!request(contextRecordViolationsRoute, { ...input, count: 1.5 }));
  assert(!request(contextRecordViolationsRoute, without(input, "bundle_hash")));
  assert(!request(contextRecordViolationsRoute, without(input, "count")));
  assert(
    !request(contextRecordViolationsRoute, { ...input, violations_hash: hash }),
  );
  assertEquals(contextRecordViolationsRoute.actors, ["machine"]);
  assertEquals(contextRecordViolationsRoute.errors, [
    "not_found",
    "conflict",
    "forbidden",
  ]);
  accepts(contextViolationsRecordedEvent.payload, {
    before: 1,
    after: 4,
    bundle_hash: hash,
  });
  rejects(contextViolationsRecordedEvent.payload, { before: 1, after: 4 });
  rejects(contextViolationsRecordedEvent.payload, {
    before: -1,
    after: 4,
    bundle_hash: hash,
  });
});

Deno.test("documents/contexts#R25 [ctx-S15]: hand_off_violations hands off all, or a non-empty set of distinct violation keys", () => {
  const key = {
    kind: "rule",
    rule: "Experiment.status-required",
    path: "eval/experiments/exp-004-nostatus.md",
    section: null,
  };
  assert(request(contextHandOffViolationsRoute, { context: ctx }));
  assert(
    request(contextHandOffViolationsRoute, { context: ctx, violations: [key] }),
  );
  assert(request(contextHandOffViolationsRoute, {
    context: ctx,
    violations: [key, { ...key, path: "eval/experiments/exp-005.md" }],
  }));
  assert(
    !request(contextHandOffViolationsRoute, { context: ctx, violations: [] }),
  );
  assert(
    !request(contextHandOffViolationsRoute, {
      context: ctx,
      violations: [key, key],
    }),
  );
  assert(
    !request(contextHandOffViolationsRoute, {
      context: ctx,
      violations: [{ ...key, rule: null }],
    }),
  );
  assert(
    !request(contextHandOffViolationsRoute, {
      context: ctx,
      violations: [{ ...key, message: "why" }],
    }),
  );
  assert(
    !request(contextHandOffViolationsRoute, {
      context: ctx,
      note: "please fix",
    }),
  );
  assert(!request(contextHandOffViolationsRoute, { violations: [key] }));
  assert(
    !request(contextHandOffViolationsRoute, {
      context: ctx,
      violations: Array.from(
        { length: 201 },
        (_, index) => ({ ...key, path: `p/${index}.md` }),
      ),
    }),
  );
  assertEquals(contextHandOffViolationsRoute.actors, ["user"]);
  assertEquals(contextHandOffViolationsRoute.errors, [
    "invalid_input",
    "not_found",
    "forbidden",
  ]);
  accepts(violationKeySchema, key);
  rejects(violationKeySchema, { ...key, type: "Experiment" });
  accepts(contextViolationsHandedOffEvent.payload, {
    violations: [key],
    evidence: { hash, size_bytes: 10 },
    run,
  });
  rejects(contextViolationsHandedOffEvent.payload, {
    violations: [],
    evidence: { hash, size_bytes: 10 },
    run,
  });
  rejects(contextViolationsHandedOffEvent.payload, { violations: [key], run });
});

Deno.test("documents/contexts#R3 [ctx-S15]: draft content is a JSON object that the ledger keeps as a blob reference", () => {
  assert(
    request(bundleSaveDraftRoute, {
      context: ctx,
      content: { a: [1, "x", null, { b: true }] },
    }),
  );
  assert(!request(bundleSaveDraftRoute, { context: ctx, content: null }));
  assert(!request(bundleSaveDraftRoute, { context: ctx, content: 1 }));
  accepts(bundleDraftSavedEvent.payload, {
    context: ctx,
    parent: cbn2,
    content: { hash, size_bytes: 0 },
  });
  rejects(bundleDraftSavedEvent.payload, {
    context: ctx,
    parent: null,
    content: { hash, size_bytes: -1 },
  });
  rejects(bundleDraftSavedEvent.payload, {
    context: ctx,
    parent: null,
    content: { hash: "short", size_bytes: 1 },
  });
});

Deno.test("documents/contexts#R1 [ctx-S15]: context events carry the project, title and purpose or the revision before", () => {
  accepts(contextCreatedEvent.payload, {
    project: prj,
    title: "T",
    purpose: "P",
  });
  rejects(contextCreatedEvent.payload, { project: prj, title: "T" });
  rejects(contextCreatedEvent.payload, {
    project: ctx,
    title: "T",
    purpose: "P",
  });
  for (const event of [contextArchivedEvent, contextUnarchivedEvent]) {
    accepts(event.payload, { before_revision: "5" });
    rejects(event.payload, {});
    rejects(event.payload, { before_revision: "0" });
    accepts(event.subject, ctx);
    rejects(event.subject, cbn);
  }
});

Deno.test("documents/contexts#R19 [ctx-S15]: ids keep their prefixes apart", () => {
  accepts(bundleSummarySchema, draftBundle);
  rejects(bundleSummarySchema, { ...draftBundle, id: ctx });
  rejects(bundleSummarySchema, {
    ...draftBundle,
    id: "cbn_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  });
  rejects(bundleSummarySchema, {
    ...draftBundle,
    id: "cbn_01arz3ndektsv4rrffq69g5fa",
  });
  rejects(bundleSummarySchema, { ...draftBundle, check: cbn });
  accepts(bundleDraftSavedEvent.subject, cbn);
  rejects(bundleDraftSavedEvent.subject, chk);
});

Deno.test("documents/contexts#R23 [ctx-S15]: the overview lists counts per type and the violation count", () => {
  const overview = {
    ...meta,
    context,
    bundle_hash: hash,
    types: [{ type: "Experiment", count: 12 }, { type: "Scenario", count: 0 }],
    violation_count: 2,
  };
  accepts(contextOverviewReadSchema, overview);
  accepts(contextOverviewReadSchema, {
    ...overview,
    context: { ...context, status: "drafting", applied_bundle: null },
    bundle_hash: null,
    types: [],
    violation_count: 0,
  });
  rejects(contextOverviewReadSchema, {
    ...overview,
    types: [{ type: "experiment", count: 1 }],
  });
  rejects(contextOverviewReadSchema, {
    ...overview,
    types: [{ type: "Experiment", count: -1 }],
  });
  rejects(contextOverviewReadSchema, {
    ...overview,
    types: [{ type: "Experiment" }],
  });
  rejects(contextOverviewReadSchema, without(overview, "violation_count"));
  rejects(contextOverviewReadSchema, {
    ...overview,
    next_cursor: "more",
    complete: false,
  });
});

Deno.test("documents/contexts#R23 [ctx-S15]: get returns the context with its applied bundle summary", () => {
  accepts(contextGetReadSchema, { ...meta, context, applied: appliedBundle });
  accepts(contextGetReadSchema, {
    ...meta,
    context: { ...context, status: "drafting", applied_bundle: null },
    applied: null,
  });
  rejects(contextGetReadSchema, { ...meta, context });
  rejects(contextGetReadSchema, { ...meta, context, applied: draftBundle });
});

Deno.test("documents/contexts#R22 [ctx-S15]: the bundle history pairs a bundle with its check report", () => {
  accepts(contextBundlesReadSchema, {
    ...meta,
    context: ctx,
    bundles: [
      { bundle: draftBundle, check: null },
      { bundle: appliedBundle, check: passedCheck },
    ],
  });
  rejects(contextBundlesReadSchema, {
    ...meta,
    context: ctx,
    bundles: [{ bundle: appliedBundle }],
  });
  rejects(contextBundlesReadSchema, {
    ...meta,
    context: ctx,
    bundles: [{
      bundle: appliedBundle,
      check: { ...passedCheck, findings: [finding] },
    }],
  });
});

Deno.test("documents/contexts#R23 [ctx-S15]: containing(path) asks about one project file and lists the types that cover it", () => {
  accepts(contextContainingRequestSchema, {
    project: prj,
    path: "eval/experiments/exp-001.md",
  });
  rejects(contextContainingRequestSchema, {
    project: prj,
    path: "/abs/exp.md",
  });
  rejects(contextContainingRequestSchema, { project: prj, path: "../exp.md" });
  rejects(contextContainingRequestSchema, { project: prj });
  rejects(contextContainingRequestSchema, { path: "a.md" });
  rejects(contextContainingRequestSchema, {
    project: prj,
    path: "a.md",
    context: ctx,
  });
  accepts(contextContainingReadSchema, {
    ...meta,
    contexts: [{
      context: ctx,
      title: "Experiments",
      types: ["Experiment", "Finding"],
    }],
  });
  accepts(contextContainingReadSchema, { ...meta, contexts: [] });
  rejects(contextContainingReadSchema, {
    ...meta,
    contexts: [{ context: ctx, title: "Experiments", types: [] }],
  });
  rejects(contextContainingReadSchema, {
    ...meta,
    contexts: [{ context: ctx, title: "Experiments", types: ["experiment"] }],
  });
});

// ---------- documents/terms ----------

Deno.test("documents/terms#R1 [ctx-S15]: a glossary entry has a term, a meaning, who set it and when, and nothing else", () => {
  accepts(glossaryEntrySchema, entry);
  accepts(glossaryEntrySchema, { ...entry, set_by: "agent" });
  rejects(glossaryEntrySchema, { ...entry, set_by: "machine" });
  rejects(glossaryEntrySchema, { ...entry, status: "candidate" });
  rejects(glossaryEntrySchema, { ...entry, evidence: [] });
  rejects(glossaryEntrySchema, { ...entry, aliases: [] });
  for (const key of Object.keys(entry)) {
    rejects(glossaryEntrySchema, without(entry, key));
  }
  rejects(glossaryEntrySchema, { ...entry, id: ctx });
  rejects(glossaryEntrySchema, { ...entry, updated_at: "2026-10-12" });
});

Deno.test("documents/terms#R2 [ctx-S15]: a glossary entry belongs to one context and a set cannot move it", () => {
  assert(
    request(glossarySetRoute, {
      id: trm,
      context: ctx,
      term: "Run",
      meaning: "One trial",
    }),
  );
  assert(
    !request(glossarySetRoute, { id: trm, term: "Run", meaning: "One trial" }),
  );
  assert(
    !request(glossarySetRoute, {
      entry: trm,
      context: ctx,
      meaning: "One trial",
    }, { base_revision: "8" }),
  );
  assert(
    !request(glossarySetRoute, {
      id: trm,
      context: viw,
      term: "Run",
      meaning: "One trial",
    }),
  );
});

Deno.test("documents/terms#R3 [ctx-S15]: terms are judged by their trimmed length", () => {
  const set = (term: string) =>
    request(glossarySetRoute, { id: trm, context: ctx, term, meaning: "m" });
  assert(set("Eating out"));
  assert(set("  Eating out  "));
  assert(!set(""));
  assert(!set("   "));
  assert(!set("\n\t"));
});

Deno.test("documents/terms#R4 [ctx-S15]: term 80, meaning 1000 and entry 200 are the limits", () => {
  const set = (term: string, meaning: string) =>
    request(glossarySetRoute, { id: trm, context: ctx, term, meaning });
  assert(set("a".repeat(80), "m"));
  assert(!set("a".repeat(81), "m"));
  assert(set(`  ${"a".repeat(80)}  `, "m"));
  assert(set("t", "m".repeat(1000)));
  assert(!set("t", "m".repeat(1001)));
  assert(!set("t", ""));
  assert(!set("t", "  "));
  // 글자 수는 code point로 센다
  assert(set("😀".repeat(80), "m"));
  assert(!set("😀".repeat(81), "m"));
  accepts(glossaryListReadSchema, {
    ...meta,
    context: ctx,
    entries: Array.from({ length: 200 }, () => entry),
  });
  rejects(glossaryListReadSchema, {
    ...meta,
    context: ctx,
    entries: Array.from({ length: 201 }, () => entry),
  });
  rejects(glossaryEntrySchema, { ...entry, term: "a".repeat(81) });
  rejects(glossaryEntrySchema, { ...entry, meaning: "" });
});

Deno.test("documents/terms#R5 [ctx-S15]: glossary.set is a new entry or a change to an existing one, by user or Context Engineer", () => {
  const created = { id: trm, context: ctx, term: "Run", meaning: "One trial" };
  assert(request(glossarySetRoute, created));
  assert(
    request(glossarySetRoute, { entry: trm, term: "Run" }, {
      base_revision: "8",
    }),
  );
  assert(
    request(glossarySetRoute, { entry: trm, meaning: "Changed" }, {
      base_revision: "8",
    }),
  );
  assert(
    request(glossarySetRoute, { entry: trm, term: "run", meaning: "Changed" }, {
      base_revision: "8",
    }),
  );
  // 둘 다 비어 있거나 두 모양이 섞이면 거절
  assert(!request(glossarySetRoute, { entry: trm }, { base_revision: "8" }));
  assert(!request(glossarySetRoute, { ...created, entry: trm }));
  assert(!request(glossarySetRoute, { id: trm, context: ctx, term: "Run" }));
  assert(
    !request(glossarySetRoute, { id: trm, context: ctx, meaning: "One trial" }),
  );
  assert(!request(glossarySetRoute, { ...created, set_by: "user" }));
  assert(
    !request(glossarySetRoute, { entry: trm, term: "Run", set_by: "agent" }, {
      base_revision: "8",
    }),
  );
  assertEquals(glossarySetRoute.actors, ["user", "agent"]);
  assertEquals(glossarySetRoute.errors, [
    "invalid_input",
    "not_found",
    "conflict",
    "forbidden",
  ]);
  assertEquals(routePath(glossarySetRoute), "/v1/terms/set");
});

Deno.test("documents/terms#R6 [ctx-S15]: the Context Engineer may set and remove, and ownership is the handler's check", () => {
  assert(glossarySetRoute.actors.includes("agent"));
  assert(glossaryRemoveRoute.actors.includes("agent"));
  assert(!glossarySetRoute.actors.includes("coding_agent"));
  assert(glossarySetRoute.errors.includes("forbidden"));
  assert(glossaryRemoveRoute.errors.includes("forbidden"));
  rejects(glossaryEntrySchema, { ...entry, set_by: "coding_agent" });
});

Deno.test("documents/terms#R7 [ctx-S15]: changing or removing an entry needs base_revision", () => {
  assert(
    request(glossarySetRoute, { entry: trm, meaning: "x" }, {
      base_revision: "8",
    }),
  );
  assert(
    !request(glossarySetRoute, { entry: trm, meaning: "x" }, {
      base_revision: "0",
    }),
  );
  assert(
    !request(glossarySetRoute, { entry: trm, meaning: "x" }, {
      base_revision: 8,
    }),
  );
  // 새 항목에는 비교할 revision이 없다(handler가 거절)
  assert(
    request(glossarySetRoute, {
      id: trm,
      context: ctx,
      term: "t",
      meaning: "m",
    }, {}),
  );
  assert(request(glossaryRemoveRoute, { entry: trm }, { base_revision: "8" }));
  assert(!request(glossaryRemoveRoute, { entry: trm }, {}));
  assert(!request(glossaryRemoveRoute, { entry: ctx }, { base_revision: "8" }));
  assert(
    !request(glossaryRemoveRoute, { entry: trm, context: ctx }, {
      base_revision: "8",
    }),
  );
  assertEquals(glossaryRemoveRoute.errors, [
    "not_found",
    "conflict",
    "forbidden",
  ]);
  assertEquals(routePath(glossaryRemoveRoute), "/v1/terms/remove");
});

Deno.test("documents/terms#R8 [ctx-S15]: set and remove events record the term and who set it without the old meaning", () => {
  const set = {
    context: ctx,
    term: "Run",
    meaning: "One trial",
    set_by: "agent",
    created: true,
  };
  accepts(glossaryEntrySetEvent.payload, set);
  accepts(glossaryEntrySetEvent.payload, {
    ...set,
    set_by: "user",
    created: false,
  });
  rejects(glossaryEntrySetEvent.payload, without(set, "created"));
  rejects(glossaryEntrySetEvent.payload, { ...set, set_by: "machine" });
  accepts(glossaryEntrySetEvent.subject, trm);
  rejects(glossaryEntrySetEvent.subject, ctx);
  accepts(glossaryEntryRemovedEvent.payload, { context: ctx, term: "Run" });
  rejects(glossaryEntryRemovedEvent.payload, { context: ctx });
  rejects(glossaryEntryRemovedEvent.payload, { context: ctx, term: "" });
});

Deno.test("documents/terms#R10 [ctx-S15]: the glossary is one read of one context with no cursor and no page", () => {
  assertEquals(routePath(glossaryListRoute), "/v1/terms/list");
  assert(glossaryListRoute.input.safeParse({ context: ctx }).success);
  assert(
    !glossaryListRoute.input.safeParse({ context: ctx, cursor: "x" })
      .success,
  );
  assert(
    !glossaryListRoute.input.safeParse({ context: ctx, limit: 10 })
      .success,
  );
  assert(!glossaryListRoute.input.safeParse({}).success);
  accepts(glossaryListReadSchema, { ...meta, context: ctx, entries: [entry] });
  accepts(glossaryListReadSchema, { ...meta, context: ctx, entries: [] });
  rejects(glossaryListReadSchema, {
    ...meta,
    context: ctx,
    entries: [entry],
    complete: false,
    next_cursor: "more",
  });
  rejects(glossaryListReadSchema, {
    ...meta,
    context: ctx,
    entries: [{ ...entry, set_by: "x" }],
  });
});

Deno.test("documents/terms#R9 [ctx-S15]: archiving a context has no glossary field to touch", () => {
  rejects(contextValueSchema, { ...context, glossary: [] });
  assert(
    !request(contextArchiveRoute, { context: ctx, glossary: "keep" }, {
      base_revision: "5",
    }),
  );
});

// ---------- ctx-S26: 화면이 읽는 것 ----------

const contractContent = {
  schema: 1,
  contract: {
    types: [{
      name: "Experiment",
      summary: "One run comparing arms on scenarios",
      visibility: "public",
      source: {
        kind: "series",
        pattern: "eval/experiments/exp-{n:03}-*.md",
        order: "natural",
      },
      key: "id",
      fields: [{
        name: "id",
        from: { kind: "path", capture: "n" },
        value_type: "string",
      }],
      relations: [],
      rules: [],
    }],
  },
  searches: [],
  saved_views: [],
  examples: [],
};

Deno.test("documents/contexts#R15 [ctx-S26]: context.contract returns the applied bundle's content or nulls when none is applied", () => {
  const applied = {
    ...meta,
    context: ctx,
    bundle: cbn,
    bundle_hash: hash,
    content: contractContent,
  };
  accepts(contextContractReadSchema, applied);
  accepts(contextContractReadSchema, {
    ...meta,
    context: ctx,
    bundle: null,
    bundle_hash: null,
    content: null,
  });
  // 비어 있는 선택 목록은 기본값으로 채워져 나온다
  const parsed = contextContractReadSchema.parse({
    ...applied,
    content: {
      schema: 1,
      contract: contractContent.contract,
    },
  });
  assertEquals(parsed.content?.searches, []);
  assertEquals(parsed.content?.saved_views, []);
  assertEquals(parsed.content?.examples, []);
  rejects(contextContractReadSchema, without(applied, "content"));
  rejects(contextContractReadSchema, without(applied, "bundle_hash"));
  rejects(contextContractReadSchema, without(applied, "bundle"));
  rejects(contextContractReadSchema, { ...applied, content: {} });
  rejects(contextContractReadSchema, {
    ...applied,
    content: { ...contractContent, schema: 2 },
  });
  rejects(contextContractReadSchema, {
    ...applied,
    content: { ...contractContent, contract: { types: [] } },
  });
  rejects(contextContractReadSchema, { ...applied, bundle: "bad" });
  assertEquals(
    routePath(
      CONTEXT_API_READ_ROUTES.find((route) =>
        route.name === "context.contract"
      )!,
    ),
    "/v1/contexts/contract",
  );
  // agent runtime의 machine 자격이 list·get·contract를 읽는다(handler가 principal로 가린다).
  assertEquals(contextContractRoute.actors, ["user", "agent", "machine"]);
  accepts(contextContractRoute.input, { context: ctx });
  rejects(contextContractRoute.input, {});
  rejects(contextContractRoute.input, { context: ctx, bundle: "bad" });
  rejects(contextContractRoute.input, { context: ctx, extra: true });
});

Deno.test("documents/contexts#R15 [ctx-I56b]: context.contract takes an optional bundle id to read that submitted bundle", () => {
  accepts(contextContractRoute.input, { context: ctx, bundle: cbn });
  // 지정한 판을 읽은 결과도 같은 모양이다
  accepts(contextContractReadSchema, {
    ...meta,
    context: ctx,
    bundle: cbn2,
    bundle_hash: hash,
    content: contractContent,
  });
});

Deno.test("documents/contexts#R1 [ctx-I56b]: context.list is filtered by exactly one of project and app", () => {
  accepts(contextListRoute.input, { project: prj });
  accepts(contextListRoute.input, { app, status: "active", limit: 10 });
  rejects(contextListRoute.input, {});
  rejects(contextListRoute.input, { project: prj, app });
  rejects(contextListRoute.input, { app: "notes" });
  assertEquals(contextListRoute.actors, ["user", "agent", "machine"]);
  assertEquals(contextGetRoute.actors, ["user", "agent", "machine"]);
  // 나머지 읽기는 machine에게 열리지 않는다
  assertEquals(contextOverviewRoute.actors, ["user", "agent"]);
  assertEquals(contextSearchRoute.actors, ["user", "agent"]);
});

Deno.test("documents/contexts#R19 [ctx-S26]: context.draft returns the drafting step with the current bundle and its content, or null", () => {
  const draft = {
    step: 2,
    bundle: draftBundle,
    content: { schema: 1, contract: { types: [] } },
    check: null,
  };
  const read = { ...meta, context: ctx, draft };
  accepts(contextDraftReadSchema, read);
  accepts(contextDraftReadSchema, { ...meta, context: ctx, draft: null });
  accepts(contextDraftReadSchema, {
    ...read,
    draft: { step: 1, bundle: null, content: null, check: null },
  });
  accepts(contextDraftReadSchema, {
    ...read,
    draft: {
      step: 3,
      bundle: { ...appliedBundle, status: "checking" },
      content: draft.content,
      check: {
        ...passedCheck,
        status: "running",
        snapshot_hash: null,
        violation_count: null,
        finished_at: null,
      },
    },
  });
  accepts(contextDraftReadSchema, {
    ...read,
    draft: {
      step: 2,
      bundle: { ...appliedBundle, status: "failed" },
      content: draft.content,
      check: failedCheck,
    },
  });
  // 4단계(적용)는 없다: 적용되면 context가 active이고 draft는 null이다
  rejects(contextDraftReadSchema, { ...read, draft: { ...draft, step: 4 } });
  rejects(contextDraftReadSchema, { ...read, draft: { ...draft, step: 0 } });
  rejects(contextDraftReadSchema, { ...read, draft: { ...draft, step: "2" } });
  rejects(contextDraftReadSchema, { ...read, draft: without(draft, "step") });
  rejects(contextDraftReadSchema, { ...read, draft: without(draft, "bundle") });
  rejects(contextDraftReadSchema, {
    ...read,
    draft: without(draft, "content"),
  });
  rejects(contextDraftReadSchema, { ...read, draft: without(draft, "check") });
  rejects(contextDraftReadSchema, {
    ...read,
    draft: { ...draft, content: [] },
  });
  rejects(contextDraftReadSchema, {
    ...read,
    draft: { ...draft, content: { f: () => 1 } },
  });
  rejects(contextDraftReadSchema, { ...read, draft: { ...draft, extra: 1 } });
  rejects(contextDraftReadSchema, without(read, "draft"));
  assertEquals(contextDraftRoute.actors, ["user", "agent"]);
  accepts(contextDraftRoute.input, { context: ctx });
  rejects(contextDraftRoute.input, {});
});

Deno.test("documents/contexts#R15 [ctx-S26]: context.input_options takes a declared search input with an optional prefix and a capped limit", () => {
  const call = {
    context: ctx,
    search: "findings_about_change",
    input: "change",
  };
  accepts(contextInputOptionsRequestSchema, call);
  accepts(contextInputOptionsRequestSchema, { ...call, prefix: "" });
  accepts(contextInputOptionsRequestSchema, { ...call, prefix: "C-04" });
  accepts(contextInputOptionsRequestSchema, { ...call, limit: 1 });
  accepts(contextInputOptionsRequestSchema, { ...call, limit: 200 });
  rejects(contextInputOptionsRequestSchema, { ...call, limit: 0 });
  rejects(contextInputOptionsRequestSchema, { ...call, limit: 201 });
  rejects(contextInputOptionsRequestSchema, { ...call, limit: 1.5 });
  rejects(contextInputOptionsRequestSchema, { ...call, limit: "5" });
  rejects(contextInputOptionsRequestSchema, { ...call, prefix: 4 });
  rejects(contextInputOptionsRequestSchema, {
    ...call,
    prefix: "x".repeat(201),
  });
  rejects(contextInputOptionsRequestSchema, without(call, "context"));
  rejects(contextInputOptionsRequestSchema, without(call, "search"));
  rejects(contextInputOptionsRequestSchema, without(call, "input"));
  rejects(contextInputOptionsRequestSchema, { ...call, search: "Findings" });
  rejects(contextInputOptionsRequestSchema, { ...call, input: "Change" });
  rejects(contextInputOptionsRequestSchema, { ...call, cursor: "x" });
  assertEquals(contextInputOptionsRoute.actors, ["user", "agent"]);
});

Deno.test("documents/contexts#R15 [ctx-S26]: context.input_options returns candidates with a value and a label and says whether it was cut", () => {
  const read = {
    ...meta,
    context: ctx,
    search: "findings_about_change",
    input: "change",
    options: [
      { value: "c-049", label: "C-049 · load the world first" },
      { value: 3, label: "3" },
      { value: true, label: "true" },
    ],
    complete: true,
  };
  accepts(contextInputOptionsReadSchema, read);
  accepts(contextInputOptionsReadSchema, {
    ...read,
    options: [],
    complete: false,
  });
  rejects(contextInputOptionsReadSchema, without(read, "complete"));
  rejects(contextInputOptionsReadSchema, without(read, "options"));
  rejects(contextInputOptionsReadSchema, without(read, "input"));
  rejects(contextInputOptionsReadSchema, {
    ...read,
    options: [{ value: null, label: "x" }],
  });
  rejects(contextInputOptionsReadSchema, {
    ...read,
    options: [{ value: ["a"], label: "x" }],
  });
  rejects(contextInputOptionsReadSchema, {
    ...read,
    options: [{ value: "a", label: " " }],
  });
  rejects(contextInputOptionsReadSchema, {
    ...read,
    options: [{ value: "a" }],
  });
  rejects(contextInputOptionsReadSchema, {
    ...read,
    options: [{ value: "a", label: "a", extra: 1 }],
  });
  rejects(contextInputOptionsReadSchema, {
    ...read,
    options: Array.from({ length: 201 }, () => ({ value: "a", label: "a" })),
  });
});

// ---------- preview · entity · series_next [ctx-S21] ----------

const previewMeta = { ...meta };
const previewRead = {
  ...previewMeta,
  context: ctx,
  bundle: cbn,
  types: [{ type: "Experiment", count: 5 }, { type: "Event", count: 0 }],
  violation_count: 1,
  violations: [{
    ...without(ruleViolation, "target"),
    target: null,
    message: "m",
  }],
  findings: [],
};

Deno.test("documents/contexts#R19 [ctx-S21]: context.preview takes a context, a draft bundle and an optional cursor", () => {
  const schema = contextPreviewRequestSchema;
  accepts(schema, { context: ctx, bundle: cbn });
  accepts(schema, { context: ctx, bundle: cbn, cursor: "opaque" });
  rejects(schema, { context: ctx });
  rejects(schema, { bundle: cbn });
  rejects(schema, { context: cbn, bundle: cbn });
  rejects(schema, { context: ctx, bundle: ctx });
  rejects(schema, { context: ctx, bundle: cbn, cursor: "" });
  rejects(schema, { context: ctx, bundle: cbn, limit: 10 });
});

Deno.test("documents/contexts#R19 [ctx-S21]: a preview result carries counts in type order, a violation page and the findings", () => {
  accepts(contextPreviewReadSchema, previewRead);
  accepts(contextPreviewReadSchema, {
    ...previewRead,
    types: [],
    violation_count: 0,
    violations: [],
    findings: [finding],
  });
  accepts(contextPreviewReadSchema, {
    ...previewRead,
    complete: false,
    next_cursor: "opaque-2",
  });
  accepts(contextPreviewReadSchema, {
    ...previewRead,
    violations: Array.from({ length: 30 }, () => previewRead.violations[0]),
  });
  rejects(contextPreviewReadSchema, {
    ...previewRead,
    violations: Array.from({ length: 31 }, () => previewRead.violations[0]),
  });
  // a page is complete exactly when it has no cursor
  rejects(contextPreviewReadSchema, { ...previewRead, complete: false });
  rejects(contextPreviewReadSchema, {
    ...previewRead,
    next_cursor: "opaque-2",
  });
  rejects(contextPreviewReadSchema, without(previewRead, "bundle"));
  rejects(contextPreviewReadSchema, without(previewRead, "types"));
  rejects(contextPreviewReadSchema, without(previewRead, "violation_count"));
  rejects(contextPreviewReadSchema, without(previewRead, "findings"));
  rejects(contextPreviewReadSchema, {
    ...previewRead,
    types: [{ type: "Experiment", count: -1 }],
  });
  rejects(contextPreviewReadSchema, {
    ...previewRead,
    types: [{ type: "experiment", count: 1 }],
  });
  rejects(contextPreviewReadSchema, {
    ...previewRead,
    findings: [{ kind: "x" }],
  });
});

Deno.test("documents/contexts#R22 [ctx-S21]: a preview violation drops the stored context and bundle hash and keeps the evidence and message", () => {
  const line = previewRead.violations[0];
  accepts(contextPreviewReadSchema, previewRead);
  rejects(contextPreviewReadSchema, {
    ...previewRead,
    violations: [{ ...line, context: ctx }],
  });
  rejects(contextPreviewReadSchema, {
    ...previewRead,
    violations: [{ ...line, bundle_hash: hash }],
  });
  rejects(contextPreviewReadSchema, {
    ...previewRead,
    violations: [without(line, "message")],
  });
  rejects(contextPreviewReadSchema, {
    ...previewRead,
    violations: [{ ...line, message: " " }],
  });
  // the rule is set exactly when the kind is rule
  rejects(contextPreviewReadSchema, {
    ...previewRead,
    violations: [{ ...line, rule: null }],
  });
  rejects(contextPreviewReadSchema, {
    ...previewRead,
    violations: [{ ...line, kind: "unreadable" }],
  });
  rejects(contextPreviewReadSchema, {
    ...previewRead,
    violations: [{ ...line, path: "/abs/x.md" }],
  });
});

Deno.test("documents/contexts#R16 [ctx-S21]: context.entity takes a context, a type and a key", () => {
  const schema = contextEntityRequestSchema;
  accepts(schema, { context: ctx, type: "Experiment", key: "001" });
  rejects(schema, { context: ctx, type: "Experiment" });
  rejects(schema, { context: ctx, key: "001" });
  rejects(schema, { type: "Experiment", key: "001" });
  rejects(schema, { context: ctx, type: "experiment", key: "001" });
  rejects(schema, { context: ctx, type: "Experiment", key: " " });
  rejects(schema, { context: ctx, type: "Experiment", key: "001", extra: 1 });
});

const entityRead = {
  ...meta,
  context: ctx,
  bundle_hash: hash,
  ref,
  fields: { id: "001", status: "done", scenarios: ["a", "b"], rubric: null },
  relations: [{
    name: "runs_on",
    label: "runs on",
    targets: [{
      type: "Scenario",
      key: "a",
      path: "eval/scenarios/a.md",
      section: null,
    }],
  }, { name: "graded_by", label: "graded by", targets: [] }],
};

Deno.test("documents/contexts#R16 [ctx-S21]: an entity result holds the ref, every field and every declared relation with its targets", () => {
  accepts(contextEntityReadSchema, entityRead);
  accepts(contextEntityReadSchema, {
    ...entityRead,
    fields: {},
    relations: [],
  });
  rejects(contextEntityReadSchema, without(entityRead, "ref"));
  rejects(contextEntityReadSchema, without(entityRead, "fields"));
  rejects(contextEntityReadSchema, without(entityRead, "relations"));
  rejects(contextEntityReadSchema, without(entityRead, "bundle_hash"));
  rejects(contextEntityReadSchema, { ...entityRead, bundle_hash: "abc" });
  rejects(contextEntityReadSchema, { ...entityRead, fields: ["id"] });
  rejects(contextEntityReadSchema, {
    ...entityRead,
    relations: [{ name: "runs_on", label: "runs on" }],
  });
  rejects(contextEntityReadSchema, {
    ...entityRead,
    relations: [{ name: "Runs", label: "runs on", targets: [] }],
  });
  rejects(contextEntityReadSchema, {
    ...entityRead,
    relations: [{ name: "runs_on", label: " ", targets: [] }],
  });
  // targets are entity refs and never carry a document version
  rejects(contextEntityReadSchema, {
    ...entityRead,
    relations: [{
      name: "runs_on",
      label: "runs on",
      targets: [{ ...ref, version: "ver_x" }],
    }],
  });
  // a single read has no next page
  rejects(contextEntityReadSchema, {
    ...entityRead,
    complete: false,
    next_cursor: "opaque",
  });
});

Deno.test("documents/series#R5 [ctx-S21]: context.series_next takes a context and a type", () => {
  const schema = contextSeriesNextRequestSchema;
  accepts(schema, { context: ctx, type: "Experiment" });
  rejects(schema, { context: ctx });
  rejects(schema, { type: "Experiment" });
  rejects(schema, { context: ctx, type: "experiment" });
  rejects(schema, { context: ctx, type: "Experiment", pattern: "x-{n}.md" });
});

const seriesNextRead = {
  ...meta,
  context: ctx,
  type: "Experiment",
  pattern: "eval/experiments/exp-{n:03}-*.md",
  next: {
    key: "011",
    path: "eval/experiments/exp-011-*.md",
    from: "eval/experiments/exp-010-x.md",
    complete: false,
    taken: false,
  },
};

Deno.test("documents/series#R5 [ctx-S21]: a series next result holds the pattern and the next name with its basis", () => {
  accepts(contextSeriesNextReadSchema, seriesNextRead);
  accepts(contextSeriesNextReadSchema, {
    ...seriesNextRead,
    next: {
      key: "10",
      path: "reports/weekly-10.md",
      from: "reports/weekly-9.md",
      complete: true,
      taken: false,
    },
  });
  accepts(contextSeriesNextReadSchema, {
    ...seriesNextRead,
    next: {
      key: "10",
      path: "reports/weekly-10.md",
      from: "reports/weekly-10.md",
      complete: true,
      taken: true,
    },
  });
  rejects(contextSeriesNextReadSchema, without(seriesNextRead, "pattern"));
  rejects(contextSeriesNextReadSchema, without(seriesNextRead, "next"));
  rejects(contextSeriesNextReadSchema, { ...seriesNextRead, pattern: " " });
  rejects(contextSeriesNextReadSchema, {
    ...seriesNextRead,
    next: without(seriesNextRead.next, "taken"),
  });
  rejects(contextSeriesNextReadSchema, {
    ...seriesNextRead,
    next: { ...seriesNextRead.next, path: "/abs/exp-011.md" },
  });
});

Deno.test("documents/series#R6 [ctx-S21]: a series next result with no members is the empty suggestion and an incomplete name cannot claim to be complete", () => {
  const empty = {
    key: "",
    path: null,
    from: null,
    complete: false,
    taken: false,
  };
  accepts(contextSeriesNextReadSchema, { ...seriesNextRead, next: empty });
  // members exist but the next name cannot be computed
  accepts(contextSeriesNextReadSchema, {
    ...seriesNextRead,
    next: { ...empty, from: "weekly-2026-09-28.md" },
  });
  // key and path are empty together
  rejects(contextSeriesNextReadSchema, {
    ...seriesNextRead,
    next: { ...empty, key: "011" },
  });
  rejects(contextSeriesNextReadSchema, {
    ...seriesNextRead,
    next: { ...seriesNextRead.next, key: "" },
  });
  // a * place left in the path means it is not complete
  rejects(contextSeriesNextReadSchema, {
    ...seriesNextRead,
    next: { ...seriesNextRead.next, complete: true },
  });
  rejects(contextSeriesNextReadSchema, {
    ...seriesNextRead,
    next: { ...seriesNextRead.next, path: "eval/exp-011.md", complete: false },
  });
  rejects(contextSeriesNextReadSchema, {
    ...seriesNextRead,
    next: { ...empty, complete: true },
  });
  // taken needs a computed name
  rejects(contextSeriesNextReadSchema, {
    ...seriesNextRead,
    next: { ...empty, taken: true },
  });
});

Deno.test("documents/contexts#R27 [ctx-S21]: the three new reads are read routes open to user and lophn agent only, and all three are registered", () => {
  const routes = [
    contextPreviewRoute,
    contextEntityRoute,
    contextSeriesNextRoute,
  ];
  assertEquals(routes.map(routePath), [
    "/v1/contexts/preview",
    "/v1/contexts/entity",
    "/v1/contexts/series_next",
  ]);
  assertEquals(routes.map((route) => route.name), [
    "context.preview",
    "context.entity",
    "context.series_next",
  ]);
  for (const route of routes) {
    assertEquals(route.kind, "read");
    assertEquals(route.actors, ["user", "agent"]);
  }
  // preview is registered with the ledger-side stand-in that core overlays with the context worker
  assert(CONTEXT_API_ROUTES.includes(contextPreviewRoute as never));
  assert(CONTEXT_API_ROUTES.includes(contextEntityRoute as never));
  assert(CONTEXT_API_ROUTES.includes(contextSeriesNextRoute as never));
});
