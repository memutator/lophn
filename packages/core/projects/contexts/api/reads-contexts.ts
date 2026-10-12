// context API 읽기: context.list·get·overview·containing.
import { err, ok } from "../../../../base/mod.ts";
import type { ContextApiReads } from "./reads.ts";
import {
  appliedBundleOf,
  checkReader,
  checkRuntimeReader,
  common,
  compareText,
  notFound,
  pageByKey,
  parseContent,
} from "./reads-common.ts";
import { sourceCovers } from "./reads-covers.ts";
import type { BundleRow, ContextApiState } from "./state.ts";

type Handlers = Pick<
  ContextApiReads,
  "contextList" | "contextGet" | "contextOverview" | "contextContaining"
>;

function summaryOf(row: BundleRow) {
  const { content: _content, ...summary } = row;
  return summary;
}

export function createContextReads(state: ContextApiState): Handlers {
  const contextList: Handlers["contextList"] = ({ actor, input }) => {
    const allowed = checkRuntimeReader(actor);
    if (!allowed.ok) return allowed;
    // project와 app 중 정확히 하나다(route 입력이 검사한다). app이면 적용된 판이 그 앱을 읽는 context만이고
    // 없는 앱은 빈 목록이다.
    const { project, app } = input;
    if (project !== undefined && !state.projects.has(project)) {
      return notFound("project", project);
    }
    const status = input.status;
    const matching = [...state.contexts.values()].filter((context) =>
      (project !== undefined
        ? context.project === project
        : app !== undefined &&
          (state.appReaders.get(context.id) ?? []).includes(app)) &&
      (status === undefined
        ? context.status !== "archived"
        : status === "all" || context.status === status)
    ).sort((a, b) =>
      Number(a.status === "archived") - Number(b.status === "archived") ||
      compareText(a.title, b.title) || compareText(a.id, b.id)
    );

    // 목록 줄마다 열린 draft와 검사 중인 판을 같이 보인다.
    const draft = new Map<string, string>();
    const checking = new Map<string, string>();
    for (const bundle of state.bundles.values()) {
      if (bundle.status === "draft") draft.set(bundle.context, bundle.id);
      if (bundle.status === "checking") {
        checking.set(bundle.context, bundle.id);
      }
    }
    const page = pageByKey(
      matching,
      (context) => [
        context.status === "archived" ? 1 : 0,
        context.title,
        context.id,
      ],
      `context.list ${project ?? `app ${app}`} ${status ?? ""}`,
      input,
    );
    if (!page.ok) return page;
    return ok({
      contexts: page.value.items.map((context) => ({
        ...context,
        applied_number: appliedBundleOf(state, context)?.number ?? null,
        draft_bundle: draft.get(context.id) ?? null,
        checking_bundle: checking.get(context.id) ?? null,
      })),
      as_of_seq: String(state.seq),
      complete: page.value.complete,
      next_cursor: page.value.next_cursor,
    });
  };

  const contextGet: Handlers["contextGet"] = ({ actor, input }) => {
    const allowed = checkRuntimeReader(actor);
    if (!allowed.ok) return allowed;
    const context = state.contexts.get(input.context);
    if (context === undefined) return notFound("context", input.context);
    const applied = appliedBundleOf(state, context);
    return ok({
      context,
      applied: applied === null ? null : summaryOf(applied),
      ...common(state),
    });
  };

  const contextOverview: Handlers["contextOverview"] = (
    { actor, input },
  ) => {
    const allowed = checkReader(actor);
    if (!allowed.ok) return allowed;
    const context = state.contexts.get(input.context);
    if (context === undefined) return notFound("context", input.context);
    const violation_count = state.violations.get(context.id)?.length ?? 0;
    const applied = appliedBundleOf(state, context);
    if (applied === null) {
      return ok({
        context,
        bundle_hash: null,
        types: [],
        violation_count,
        ...common(state),
      });
    }
    // index를 갱신하지 못했으면 빈 결과로 꾸미지 않는다.
    if (state.indexFailing.has(context.id)) {
      return err({
        code: "unavailable",
        message: `index of ${context.id} is not available`,
      });
    }
    const content = parseContent(applied);
    if (!content.ok) return content;
    const counts = new Map<string, number>();
    for (const entity of state.entities.get(context.id) ?? []) {
      counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1);
    }
    return ok({
      context,
      bundle_hash: applied.bundle_hash,
      types: content.value.contract.types.map((type) => ({
        type: type.name,
        count: counts.get(type.name) ?? 0,
      })),
      violation_count,
      ...common(state),
    });
  };

  const contextContaining: Handlers["contextContaining"] = (
    { actor, input },
  ) => {
    const allowed = checkReader(actor);
    if (!allowed.ok) return allowed;
    if (!state.projects.has(input.project)) {
      return notFound("project", input.project);
    }
    const found: { context: string; title: string; types: string[] }[] = [];
    for (const context of state.contexts.values()) {
      if (context.project !== input.project || context.status !== "active") {
        continue;
      }
      const applied = appliedBundleOf(state, context);
      if (applied === null) continue;
      const content = parseContent(applied);
      if (!content.ok) return content;
      const declared = content.value.contract.types;
      const types = declared
        .filter((type) => sourceCovers(type.source, input.path, declared))
        .map((type) => type.name);
      if (types.length > 0) {
        found.push({ context: context.id, title: context.title, types });
      }
    }
    found.sort((a, b) =>
      compareText(a.title, b.title) || compareText(a.context, b.context)
    );
    return ok({ contexts: found, ...common(state) });
  };

  return { contextList, contextGet, contextOverview, contextContaining };
}
