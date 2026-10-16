// context API 읽기: context.contract·draft와 bundle.test_draft. 적용된 판의 내용, 만드는 중인 판의 진행,
// 초안 폴더의 test를 읽는다.
import { err, ok } from "../../../../base/mod.ts";
import type { BundleSummary } from "../../../../protocol/projects/mod.ts";
import { runningReport, schemaFailure } from "../check/mod.ts";
import type { ContextApiReadDeps, ContextApiReads } from "./reads.ts";
import {
  appliedBundleOf,
  checkReader,
  checkRuntimeReader,
  common,
  currentBundleOf,
  notFound,
  parseContent,
} from "./reads-common.ts";
import type { BundleRow, ContextApiState } from "./state.ts";

type Handlers = Pick<
  ContextApiReads,
  "contextContract" | "contextDraft" | "bundleTestDraft"
>;

function summaryOf(row: BundleRow): BundleSummary {
  const { content: _content, ...summary } = row;
  return summary;
}

// 초안 폴더의 내용. 읽지 못하면 null이다.
function draftFileOf(
  deps: ContextApiReadDeps,
  project: string,
  row: BundleRow,
): Record<string, unknown> | null {
  const read = deps.drafts.read(project, row.context, row.id);
  return read.ok && typeof read.value === "object" && read.value !== null &&
      !Array.isArray(read.value)
    ? read.value as Record<string, unknown>
    : null;
}

export function createBundleReads(
  state: ContextApiState,
  deps: ContextApiReadDeps,
): Handlers {
  // 적용된 판의 내용이다. 보관된 context도 마지막으로 적용된 판을 보인다.
  const contextContract: Handlers["contextContract"] = ({ actor, input }) => {
    const allowed = checkRuntimeReader(actor);
    if (!allowed.ok) return allowed;
    const context = state.contexts.get(input.context);
    if (context === undefined) return notFound("context", input.context);
    // bundle을 지정하면 그 context의 submit된 이후 판(checking, failed, applied, superseded)이다. 판의 내용은
    // submit 뒤 바뀌지 않으므로 적용된 판이 바뀐 뒤에도 읽는다. 없는 판, 다른 context의 판, draft, discarded는
    // 없는 것과 같다.
    if (input.bundle !== undefined) {
      const row = state.bundles.get(input.bundle);
      if (
        row === undefined || row.context !== context.id ||
        row.status === "draft" || row.status === "discarded" ||
        row.bundle_hash === null
      ) return notFound("bundle", input.bundle);
      const content = parseContent(row);
      if (!content.ok) return content;
      return ok({
        context: context.id,
        bundle: row.id,
        bundle_hash: row.bundle_hash,
        content: content.value,
        ...common(state),
      });
    }
    const applied = appliedBundleOf(state, context);
    if (applied === null) {
      return ok({
        context: context.id,
        bundle: null,
        bundle_hash: null,
        content: null,
        ...common(state),
      });
    }
    const content = parseContent(applied);
    if (!content.ok) return content;
    return ok({
      context: context.id,
      bundle: applied.id,
      bundle_hash: applied.bundle_hash,
      content: content.value,
      ...common(state),
    });
  };

  // 만드는 중인 판의 진행이다. 단계는 판의 상태에서 정한다: 판이 없으면 1(읽기), draft나 failed 판이면
  // 2(초안), 검사 중이면 3(검사). 열린 초안이 있으면 적용된 판이 있는 context도 초안을 보인다.
  const contextDraft: Handlers["contextDraft"] = ({ actor, input }) => {
    const allowed = checkReader(actor);
    if (!allowed.ok) return allowed;
    const context = state.contexts.get(input.context);
    if (context === undefined) return notFound("context", input.context);
    const rows = [...state.bundles.values()].filter((row) =>
      row.context === context.id
    );
    const current = context.status === "drafting"
      ? currentBundleOf(rows)
      : rows.find((row) => row.status === "draft") ?? null;
    if (context.status !== "drafting" && current === null) {
      return ok({ context: context.id, draft: null, ...common(state) });
    }
    const draft = current === null
      ? { step: 1 as const, bundle: null, content: null, check: null }
      : {
        step: current.status === "checking" ? 3 as const : 2 as const,
        bundle: summaryOf(current),
        content: current.status === "draft"
          ? draftFileOf(deps, context.project, current)
          : current.content,
        check: current.check === null
          ? null
          : state.checks.get(current.check) ?? null,
      };
    const folder = current?.status === "draft"
      ? deps.drafts.folder(context.project, context.id, current.id)
      : null;
    return ok({
      context: context.id,
      draft: { ...draft, folder },
      ...common(state),
    });
  };

  // 초안 폴더를 test한다. 모양 검사는 여기서 끝내고, 모양이 맞으면 파일을 돌리는 격리 검사가 남아
  // running 보고를 돌려준다(context worker를 붙인 core가 그 보고를 결과로 바꾼다).
  const bundleTestDraft: Handlers["bundleTestDraft"] = ({ actor, input }) => {
    if (actor.kind !== "agent") {
      return err({ code: "forbidden", message: "only an agent tests a draft" });
    }
    const row = state.bundles.get(input.bundle);
    if (row === undefined) return notFound("bundle", input.bundle);
    const context = state.contexts.get(row.context);
    if (context === undefined) return notFound("context", row.context);
    if (!deps.canWrite(actor.actor, context.project)) {
      return err({
        code: "forbidden",
        message: "agent cannot test this draft",
      });
    }
    if (row.status !== "draft") {
      return err({ code: "conflict", message: "only a draft can be tested" });
    }
    const folder = deps.drafts.read(context.project, context.id, row.id);
    if (!folder.ok) return folder;
    const subject = { context: context.id, bundle: row.id, at: deps.now() };
    const report = schemaFailure(subject, folder.value) ??
      runningReport(subject);
    return ok({ report, ...common(state) });
  };

  return { contextContract, contextDraft, bundleTestDraft };
}
