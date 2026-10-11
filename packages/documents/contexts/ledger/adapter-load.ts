// adapter의 적재다. command나 읽기 하나가 보는 행만 SQL에서 새 ContextApiState로 읽는다.
// 어떤 행을 읽을지는 route마다 LoadPlan 하나로 정한다(adapter-routes.ts).
import { ok, type Result } from "../../../base/mod.ts";
import type { ContextValue } from "../../../contracts/documents/mod.ts";
import type { Sql } from "../../../contracts/platform/mod.ts";
import type {
  BlobReference,
  BundleRow,
  ContextApiState,
} from "../api/state.ts";
import type { ContextLedgerDeps } from "./adapter.ts";
import {
  loadContext,
  loadContextBundles,
  loadContextChecks,
  loadContextEntries,
  loadContextViews,
  loadEntry,
  loadProject,
  loadProjectBundles,
  loadProjectContexts,
} from "./rows.ts";

export type LoadPlan = {
  // project 행과 그 project의 context 전부(보관된 것 포함)를 읽는다.
  project?: string;
  // 대상 context 하나. 있으면 이 context만 아래 표들을 읽고, 없으면 project의 context 전부가 대상이다.
  // null은 입력에서 대상을 찾지 못한 것이다. 아무것도 읽지 않으면 handler가 not_found를 낸다.
  context?: string | null;
  // 대상과 상관없이 이 id의 context를 읽는다(다른 project의 같은 id를 conflict로 막으려고).
  extraContext?: string;
  // 대상과 상관없이 이 id의 용어 항목을 읽는다(다른 context가 쓰는 id를 conflict로 막으려고).
  entry?: string;
  bundles?: boolean;
  checks?: boolean;
  views?: boolean;
  entries?: boolean;
  // content blob을 읽을 판. 읽지 않은 판의 content는 `{}`다.
  content?: "applied" | "active-applied" | { bundle: string };
  // derived 저장소에서 가져올 것. entities를 고르면 index 갱신 실패도 같이 가져온다.
  index?: readonly ("violations" | "entities")[];
};

export type Loaded = {
  state: ContextApiState;
  // 적재한 판의 content blob 참조. 바뀌지 않은 판은 이 참조를 그대로 쓴다.
  contentRefs: Map<string, BlobReference>;
};

type Reader = Pick<Sql, "get" | "all">;

// seq는 읽기의 as_of_seq다. command는 event를 낼 때 ledger가 정한 seq로 갱신하므로 0으로 시작한다.
export function loadState(
  sql: Reader,
  deps: Pick<ContextLedgerDeps, "blobs" | "index">,
  plan: LoadPlan,
  seq: number,
): Result<Loaded> {
  const state: ContextApiState = {
    seq,
    projects: new Map(),
    contexts: new Map(),
    bundles: new Map(),
    checks: new Map(),
    views: new Map(),
    glossary: new Map(),
    events: [],
    replays: new Map(),
    violations: new Map(),
    entities: new Map(),
    indexFailing: new Set(),
  };
  const contentRefs = new Map<string, BlobReference>();

  if (plan.project !== undefined) {
    const project = loadProject(sql, plan.project);
    if (project !== null) state.projects.set(project.id, project);
    for (const context of loadProjectContexts(sql, plan.project)) {
      state.contexts.set(context.id, context);
    }
  }
  for (const id of [plan.context, plan.extraContext]) {
    if (id == null || state.contexts.has(id)) continue;
    const context = loadContext(sql, id);
    if (context !== null) state.contexts.set(context.id, context);
  }
  if (plan.entry !== undefined) {
    const entry = loadEntry(sql, plan.entry);
    if (entry !== null) state.glossary.set(entry.id, entry);
  }

  const targets = targetsOf(plan, state);

  if (plan.bundles) {
    const stored = plan.context === undefined && plan.project !== undefined
      ? loadProjectBundles(sql, plan.project)
      : targets.flatMap((context) => loadContextBundles(sql, context.id));
    for (const { content_ref, ...summary } of stored) {
      contentRefs.set(summary.id, content_ref);
      let content: Record<string, unknown> = {};
      if (wantsContent(plan, state, summary.context, summary.id)) {
        const read = deps.blobs.read(content_ref);
        if (!read.ok) return read;
        content = read.value;
      }
      const row: BundleRow = { ...summary, content };
      state.bundles.set(row.id, row);
    }
  }
  for (const context of targets) {
    if (plan.checks) {
      for (const check of loadContextChecks(sql, context.id)) {
        state.checks.set(check.id, check);
      }
    }
    if (plan.views) {
      for (const view of loadContextViews(sql, context.id)) {
        state.views.set(view.id, view);
      }
    }
    if (plan.entries) {
      for (const entry of loadContextEntries(sql, context.id)) {
        state.glossary.set(entry.id, entry);
      }
    }
    if (plan.index?.includes("violations")) {
      state.violations.set(context.id, [...deps.index.violations(context.id)]);
    }
    if (plan.index?.includes("entities")) {
      state.entities.set(context.id, [...deps.index.entities(context.id)]);
      if (deps.index.failing(context.id)) state.indexFailing.add(context.id);
    }
  }
  return ok({ state, contentRefs });
}

function targetsOf(plan: LoadPlan, state: ContextApiState): ContextValue[] {
  if (plan.context === undefined) return [...state.contexts.values()];
  const target = plan.context === null
    ? undefined
    : state.contexts.get(plan.context);
  return target === undefined ? [] : [target];
}

function wantsContent(
  plan: LoadPlan,
  state: ContextApiState,
  context: string,
  bundle: string,
): boolean {
  const want = plan.content;
  if (want === undefined) return false;
  if (typeof want === "object") return want.bundle === bundle;
  const owner = state.contexts.get(context);
  if (owner?.applied_bundle !== bundle) return false;
  return want === "applied" || owner.status === "active";
}
