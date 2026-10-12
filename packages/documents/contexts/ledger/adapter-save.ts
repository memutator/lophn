// adapter의 쓰기다. 적재했을 때의 값과 handler가 남긴 값을 표마다 견주어 달라진 행만 쓴다
// (변경 행 한도에 event 행이 든다).
import { canonicalize } from "../../../base/mod.ts";
import type { Sql } from "../../../contracts/platform/mod.ts";
import type {
  BlobReference,
  BundleRow,
  ContextApiState,
} from "../api/state.ts";
import { contentReference } from "./content-blobs.ts";
import { appDataAppsOf, saveAppData } from "./rows-app-data.ts";
import {
  deleteEntry,
  deleteView,
  saveBundle,
  saveCheck,
  saveContext,
  saveEntry,
  saveView,
} from "./rows.ts";

// handler는 행을 고치지 않고 새 값으로 바꿔 넣으므로 Map의 얕은 복사로 처음 값을 남길 수 있다.
export type Baseline = Pick<
  ContextApiState,
  "contexts" | "bundles" | "checks" | "views" | "glossary"
>;

export function baselineOf(state: ContextApiState): Baseline {
  return {
    contexts: new Map(state.contexts),
    bundles: new Map(state.bundles),
    checks: new Map(state.checks),
    views: new Map(state.views),
    glossary: new Map(state.glossary),
  };
}

// handler가 가리키는 blob을 기억한다. 같은 값은 한 참조이고, 새 판의 content_ref를 여기서 찾는다.
// 파일은 쓰지 않는다(바이트는 호출 경계가 준비했다). 참조 등록은 handler가 끝난 뒤 adapter가 한다.
export function blobUploads() {
  const uploaded = new Map<string, BlobReference>();
  return {
    put(value: unknown): BlobReference {
      const key = canonicalize(value);
      let reference = uploaded.get(key);
      if (reference === undefined) {
        reference = contentReference(value);
        uploaded.set(key, reference);
      }
      return reference;
    },
    find: (value: unknown) => uploaded.get(canonicalize(value)),
    references: (): BlobReference[] => [...uploaded.values()],
  };
}
export type BlobUploads = ReturnType<typeof blobUploads>;

function changes<T extends { id: string }>(
  before: ReadonlyMap<string, T>,
  after: ReadonlyMap<string, T>,
): { changed: T[]; removed: string[] } {
  const changed = [...after.values()].filter((row) => {
    const old = before.get(row.id);
    return old === undefined || canonicalize(old) !== canonicalize(row);
  });
  const removed = [...before.keys()].filter((id) => !after.has(id));
  return { changed, removed };
}

// 순서: 검사, 물러나는 판(applied가 아니게 된 것), applied가 된 판, context, saved view, 용어 항목,
// 지운 saved view·항목. 물러나는 판을 먼저 쓰는 까닭은 context당 applied가 하나라는 partial unique
// index가 문장마다 검사되기 때문이다. 판은 content를 읽지 않았거나 바뀌지 않았으면 적재한 참조를,
// 아니면 handler가 올린 blob의 참조를 쓴다.
export function writeChanges(
  sql: Sql,
  before: Baseline,
  after: ContextApiState,
  contentRefs: ReadonlyMap<string, BlobReference>,
  uploads: BlobUploads,
): void {
  const stored = ({ content, ...summary }: BundleRow) => {
    const unchanged = before.bundles.get(summary.id)?.content === content;
    const content_ref = unchanged
      ? contentRefs.get(summary.id)
      : uploads.find(content);
    if (content_ref === undefined) {
      throw new Error(`bundle ${summary.id} has no content blob`);
    }
    return { ...summary, content_ref };
  };

  const bundles = changes(before.bundles, after.bundles).changed;
  for (const check of changes(before.checks, after.checks).changed) {
    saveCheck(sql, check);
  }
  for (const bundle of bundles.filter((b) => b.status !== "applied")) {
    saveBundle(sql, stored(bundle));
  }
  for (const bundle of bundles.filter((b) => b.status === "applied")) {
    saveBundle(sql, stored(bundle));
  }
  for (const context of changes(before.contexts, after.contexts).changed) {
    saveContext(sql, context);
  }
  recordAppData(sql, before, after);
  const views = changes(before.views, after.views);
  for (const view of views.changed) saveView(sql, view);
  const entries = changes(before.glossary, after.glossary);
  for (const entry of entries.changed) saveEntry(sql, entry);
  for (const id of views.removed) deleteView(sql, id);
  for (const id of entries.removed) deleteEntry(sql, id);
}

// 판이 적용되면(적용·되돌리기) 그 판의 계약이 app-data source로 읽는 앱을 같은 transaction에서 다시
// 채운다. 앱 하나에 묶인 agent의 읽기 권한이 이 표만 본다. 적용된 판이 바뀌지 않았고 content도
// 같으면 그대로 둔다. 적용된 판이 바뀌었는데 content를 읽지 않았으면 틀린 값을 남기지 않고 던진다.
function recordAppData(
  sql: Sql,
  before: Baseline,
  after: ContextApiState,
): void {
  for (const context of after.contexts.values()) {
    const applied = context.applied_bundle === null
      ? undefined
      : after.bundles.get(context.applied_bundle);
    if (applied === undefined) continue;
    const swapped = before.contexts.get(context.id)?.applied_bundle !==
      context.applied_bundle;
    const rewritten = before.bundles.get(applied.id)?.content !==
      applied.content;
    if (!swapped && !rewritten) continue;
    const apps = appDataAppsOf(applied.content);
    if (apps === null) {
      if (!swapped) continue;
      throw new Error(`applied bundle ${applied.id} content was not loaded`);
    }
    saveAppData(sql, context.id, apps);
  }
}
