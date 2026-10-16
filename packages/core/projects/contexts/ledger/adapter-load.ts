// adapter의 적재다. command나 읽기 하나가 보는 행만 SQL에서 새 ContextApiState로 읽는다.
// 어떤 행을 읽을지는 route마다 LoadPlan 하나로 정한다(adapter-routes.ts).
import { ok, type Result } from "../../../../base/mod.ts";
import {
  bundleContentSchema,
  type ContextValue,
  splitExternalRef,
} from "../../../../protocol/projects/mod.ts";
import type { Sql } from "../../../../protocol/server/mod.ts";
import { currentBundleOf } from "../api/reads-common.ts";
import { declaredRuleMessage } from "../api/violation-message.ts";
import type {
  BlobReference,
  BundleRow,
  ContextApiState,
} from "../api/state.ts";
import type { ContextLedgerDeps } from "./adapter.ts";
import {
  loadBundle,
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
import { loadAllAppData } from "./rows-app-data.ts";

export type LoadPlan = {
  // project 행과 그 project의 context 전부(보관된 것 포함)를 읽는다.
  project?: string;
  // 대상 context 하나. 있으면 이 context만 아래 표들을 읽고, 없으면 project의 context 전부가 대상이다.
  // null은 입력에서 대상을 찾지 못한 것이다. 아무것도 읽지 않으면 handler가 not_found를 낸다.
  context?: string | null;
  // 적용된 판이 이 앱(ID)을 app-data로 읽는 context 전부가 대상이다(context.list의 app 거르기). project는
  // 읽지 않는다.
  app?: string;
  // 대상과 상관없이 이 id의 context를 읽는다(다른 project의 같은 id를 conflict로 막으려고).
  extraContext?: string;
  // 대상과 상관없이 이 id의 용어 항목을 읽는다(다른 context가 쓰는 id를 conflict로 막으려고).
  entry?: string;
  bundles?: boolean;
  checks?: boolean;
  views?: boolean;
  entries?: boolean;
  // content blob을 읽을 판. 읽지 않은 판의 content는 `{}`다. in-progress는 만드는 중(drafting)인
  // context의 지금 판(draft, 없으면 검사 중인 판, 없으면 마지막 failed 판) 하나다.
  content?: "applied" | "active-applied" | "in-progress" | { bundle: string };
  // derived 저장소에서 가져올 것. entities를 고르면 index 갱신 실패도 같이 가져온다.
  index?: readonly ("violations" | "entities")[];
  // 개체 하나와 그 관계 대상 행(context.entity), 한 type의 개체(context.series_next)만 가져온다. 둘 다
  // entities처럼 index 갱신 실패도 같이 가져온다.
  entity?: { type: string; key: string };
  ofType?: string;
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
  // appIds는 plan.app을 쓰는 읽기만 필요하다. 없으면 앱을 읽는 context가 없는 것과 같다.
  deps:
    & Pick<ContextLedgerDeps, "blobs" | "index">
    & Partial<Pick<ContextLedgerDeps, "appIds">>,
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
    appReaders: new Map(),
  };
  const contentRefs = new Map<string, BlobReference>();

  if (plan.project !== undefined) {
    const project = loadProject(sql, plan.project);
    if (project !== null) state.projects.set(project.id, project);
    for (const context of loadProjectContexts(sql, plan.project)) {
      state.contexts.set(context.id, context);
    }
  }
  if (plan.app !== undefined) {
    // context_app_data는 slug를 담으므로 slug마다 앱 ID로 바꿔 그 앱을 읽는 context를 고른다.
    const ids = new Map<string, readonly string[]>();
    for (const [id, slugs] of loadAllAppData(sql)) {
      const apps = slugs.flatMap((slug) => {
        let resolved = ids.get(slug);
        if (resolved === undefined) {
          resolved = deps.appIds?.([slug]) ?? [];
          ids.set(slug, resolved);
        }
        return [...resolved];
      });
      if (!apps.includes(plan.app)) continue;
      const context = loadContext(sql, id);
      if (context === null) continue;
      state.contexts.set(context.id, context);
      state.appReaders.set(context.id, [...new Set(apps)]);
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
    const inProgress = plan.content === "in-progress"
      ? inProgressBundles(state, stored)
      : new Set<string>();
    for (const { content_ref, ...summary } of stored) {
      contentRefs.set(summary.id, content_ref);
      let content: Record<string, unknown> = {};
      if (wantsContent(plan, state, inProgress, summary.context, summary.id)) {
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
      // index가 낸 문구는 규칙 이름으로 만든 것이다. 적용된 판이 읽혔고 규칙이 message를 가지면 그 message로 바꾼다.
      const applied = context.applied_bundle === null
        ? undefined
        : state.bundles.get(context.applied_bundle);
      state.violations.set(
        context.id,
        deps.index.violations(context.id).map((violation) => ({
          ...violation,
          message: violation.kind === "rule"
            ? declaredRuleMessage(applied?.content.contract, violation.rule) ??
              violation.message
            : violation.message,
        })),
      );
    }
    if (plan.index?.includes("entities")) {
      state.entities.set(context.id, [...deps.index.entities(context.id)]);
      if (deps.index.failing(context.id)) state.indexFailing.add(context.id);
    }
    if (plan.entity !== undefined) {
      state.entities.set(context.id, [
        ...deps.index.entity(context.id, plan.entity.type, plan.entity.key),
      ]);
      if (deps.index.failing(context.id)) state.indexFailing.add(context.id);
    }
    if (plan.ofType !== undefined) {
      state.entities.set(context.id, [
        ...deps.index.ofType(context.id, plan.ofType),
      ]);
      if (deps.index.failing(context.id)) state.indexFailing.add(context.id);
    }
  }
  if (plan.entity !== undefined) {
    const crossed = loadCrossTargets(sql, deps, state, targets, plan.entity);
    if (!crossed.ok) return crossed;
  }
  return ok({ state, contentRefs });
}

// context.entity가 다른 context의 관계 대상을 읽도록, 그 개체의 `<제목>/<Type>` 관계 간선이 가리키는
// 개체 행과 그 context·적용된 판을 state에 더한다(documents/contexts "다른 context의 type 참조").
// 같은 Project의 다른 context 중 제목이 같고 active이며 적용된 판이 있는 것만 읽는다. 해석은 읽는 쪽
// (api/reads-entity.ts)이 다시 한다. 이 함수는 필요한 행만 모은다.
function loadCrossTargets(
  sql: Reader,
  deps: Pick<ContextLedgerDeps, "blobs" | "index">,
  state: ContextApiState,
  targets: readonly ContextValue[],
  entity: { type: string; key: string },
): Result<true> {
  const owner = targets[0];
  const applied = owner?.applied_bundle == null
    ? undefined
    : state.bundles.get(owner.applied_bundle);
  const content = applied === undefined
    ? undefined
    : bundleContentSchema.safeParse(applied.content);
  if (owner === undefined || !content?.success) return ok(true);
  const type = content.data.contract.types.find((candidate) =>
    candidate.name === entity.type
  );
  const row = state.entities.get(owner.id)?.find((candidate) =>
    candidate.type === entity.type && candidate.key === entity.key
  );
  if (type === undefined || row === undefined) return ok(true);

  const others = loadProjectContexts(sql, owner.project);
  for (const relation of type.relations) {
    const ref = splitExternalRef(relation.to);
    if (ref === undefined) continue;
    const target = others.find((candidate) =>
      candidate.id !== owner.id && candidate.title === ref.context &&
      candidate.status === "active" && candidate.applied_bundle !== null
    );
    if (target === undefined) continue;
    if (!state.contexts.has(target.id)) {
      const stored = loadBundle(sql, target.applied_bundle!);
      if (stored === null) continue;
      const read = deps.blobs.read(stored.content_ref);
      if (!read.ok) return read;
      const { content_ref: _, ...summary } = stored;
      state.contexts.set(target.id, target);
      state.bundles.set(stored.id, { ...summary, content: read.value });
    }
    if (deps.index.failing(target.id)) {
      state.indexFailing.add(target.id);
      continue;
    }
    const rows = state.entities.get(target.id) ?? [];
    for (const link of row.links ?? []) {
      if (link.relation !== relation.name) continue;
      const found = deps.index.entity(target.id, ref.type, link.target_key)
        .find((candidate) =>
          candidate.type === ref.type && candidate.key === link.target_key
        );
      if (found !== undefined) rows.push(found);
    }
    state.entities.set(target.id, rows);
  }
  return ok(true);
}

function targetsOf(plan: LoadPlan, state: ContextApiState): ContextValue[] {
  if (plan.context === undefined) return [...state.contexts.values()];
  const target = plan.context === null
    ? undefined
    : state.contexts.get(plan.context);
  return target === undefined ? [] : [target];
}

// 만드는 중인 context마다 지금 판 하나의 id.
function inProgressBundles(
  state: ContextApiState,
  stored: readonly {
    id: string;
    context: string;
    status: string;
    number: number | null;
  }[],
): Set<string> {
  const chosen = new Set<string>();
  for (const context of state.contexts.values()) {
    if (context.status !== "drafting") continue;
    const current = currentBundleOf(
      stored.filter((bundle) => bundle.context === context.id),
    );
    if (current !== null) chosen.add(current.id);
  }
  return chosen;
}

function wantsContent(
  plan: LoadPlan,
  state: ContextApiState,
  inProgress: ReadonlySet<string>,
  context: string,
  bundle: string,
): boolean {
  const want = plan.content;
  if (want === undefined) return false;
  if (typeof want === "object") return want.bundle === bundle;
  if (want === "in-progress") return inProgress.has(bundle);
  const owner = state.contexts.get(context);
  if (owner?.applied_bundle !== bundle) return false;
  return want === "applied" || owner.status === "active";
}
