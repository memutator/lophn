// Context read. list·get·related는 ledger metadata만 준다. 판 본문·앱 데이터는
// 각 대상 read(command들)가 연다. 관점·이유는 모든 actor에게 보인다.

import { err, ok, type Result } from "../../base/mod.ts";
import {
  type Context,
  contextExport,
  contextGet,
  type ContextItem,
  contextList,
  contextRelated,
  contextWatch,
  type SECTION_STATUSES,
} from "../../contracts/documents/mod.ts";
import {
  parseActor,
  type ReadDefinition,
  type ReadSnapshot,
  REDACTION_REPLACEMENT,
  type RequestContext,
  type Sql,
  TargetAuthorization,
} from "../../contracts/platform/mod.ts";
import { loadDocument } from "../versions/mod.ts";
import { targetKey } from "./model.ts";
import {
  type ContextItemRow,
  listContexts,
  listContextsByTargetKey,
  listWatchChanges,
  loadContext,
} from "./store.ts";

const PAGE = 50;

function rejected(code: string, message: string): Result<never> {
  return err({ code: code as "not_found", message });
}

function readActorAllowed(ctx: RequestContext, allowed: readonly string[]) {
  const kind = parseActor(ctx.actor)?.kind;
  return kind !== undefined && allowed.includes(kind);
}

// 대상 범위는 platform이 주입한 TargetAuthorization port가 판정한다. forbidden은
// 존재를 새지 않는다(list는 건너뛰고 get은 not_found다).
function allowed(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  operation: string,
  contextId: string,
): Result<Context | null> {
  const decision = snapshot.port(TargetAuthorization)(
    ctx,
    operation,
    { context: contextId },
  );
  if (!decision.ok) {
    return decision.error.code === "forbidden" ||
        decision.error.code === "not_found"
      ? ok(null)
      : decision;
  }
  return ok(contextId as never);
}

function offsetOf(cursor: string | undefined): Result<number> {
  if (cursor === undefined) return ok(0);
  if (!/^[0-9]+$/.test(cursor)) {
    return rejected("invalid_input", "cursor is invalid");
  }
  const value = Number(cursor);
  if (!Number.isSafeInteger(value)) {
    return rejected("invalid_input", "cursor is invalid");
  }
  return ok(value);
}

// export가 쓰는 주입 값. redactor는 platform redaction과 같은 모양이고, 없으면 내보내지
// 않는다(fail-closed). glossary는 documents/terms의 활성 정의를 주는 근원이다(terms가
// contexts를 import하므로 같은 모양의 값만 주입받는다). sectionStatus는 derived store를
// 읽는 reader가 주고, 없으면 section 항목은 unverified다(추정하지 않는다).
export type ContextExportRedactor = (
  source: { concern: string; revision: string; scope: string },
  mediaType: string,
  text: string,
) => string | null;

export type ContextExportDeps = {
  redactor?: ContextExportRedactor;
  glossary?: (
    contextId: string,
  ) => Result<readonly { name: string; definition: string | null }[]>;
  sectionStatus?: (
    document: string,
    version: string,
    section: string,
  ) => (typeof SECTION_STATUSES)[number];
};

// watch 미확인 목록의 근원. derived store(documents/outline-and-search의 `watch_unverified`)를
// 읽는 reader가 준다. 없으면 미확인을 읽지 못한 것이라 watch read는 unavailable이다(빈 목록으로
// 꾸미지 않는다).
export type WatchUnverifiedSource = (contextId: string) => Result<
  readonly {
    document: string;
    section: string | null;
    before_version: string | null;
    after_version: string;
    reason: string;
  }[]
>;

export type ContextReadDeps = ContextExportDeps & {
  unverified?: WatchUnverifiedSource;
};

/** watch read가 돌려주는 확인된 변화 수의 상한. 최근 기록부터다. */
export const WATCH_CHANGES_LIMIT = 100;

// 문서 대상 권한. 판정을 못 하면(port 없음·throw·Promise) 없는 것과 같이 뺀다.
function readableTarget(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  target: Record<string, string | undefined>,
  operation: string = contextExport.name,
): boolean {
  try {
    const decision = snapshot.port(TargetAuthorization)(
      ctx,
      operation,
      target as never,
    ) as unknown;
    if (typeof decision !== "object" || decision === null) return false;
    if ("then" in decision) return false;
    return (decision as { ok?: unknown }).ok === true;
  } catch {
    return false;
  }
}

// 외부 출력 redaction. 하나라도 안전화를 끝내지 못하면 export 전체를 내지 않는다.
function exportSafe(
  redactor: ContextExportRedactor,
  context: Context,
  text: string,
): Result<string> {
  const out = redactor(
    { concern: "documents", revision: context.revision, scope: context.id },
    "text/plain",
    text,
  );
  if (out === null) {
    return err({
      code: "unavailable",
      message: "export redaction failed",
    });
  }
  return ok(out.trim().length === 0 ? REDACTION_REPLACEMENT : out);
}

// 사람이 고른 context를 목적·관점별 직접 항목·선택 이유·읽은 고정 판 참조·glossary로
// 낸다. 하위 context·관계 지도는 없고, 권한 밖 문서·앱 항목은 항목과 근거 모두에서
// 없는 것과 같이 빠진다. 문서 항목의 고정 판은 읽은 시점의 최신 판이다(R4: 항목에는 판이
// 저장되지 않는다). 판이 없는 문서는 고정할 판이 없어 항목을 싣지 않는다.
function exportHandle(
  deps: ContextExportDeps,
): ReadDefinition<typeof contextExport>["handle"] {
  return (snapshot, ctx, input) => {
    // export는 사람만 고른다(route 등록 actor가 ["user"]다).
    if (!readActorAllowed(ctx, contextExport.actors)) {
      return rejected("forbidden", "actor cannot export contexts");
    }
    const loaded = loadContext(snapshot.sql as never, input.context);
    if (!loaded.ok) return loaded;
    // 없는 context와 권한 밖 context의 답은 같다.
    if (loaded.value === null) {
      return rejected("not_found", "context not found");
    }
    const decision = allowed(
      snapshot,
      ctx,
      contextExport.name,
      input.context,
    );
    if (!decision.ok) return decision;
    if (decision.value === null) {
      return rejected("not_found", "context not found");
    }
    const redactor = deps.redactor;
    if (redactor === undefined) {
      return rejected("unavailable", "export redaction is not available");
    }
    const context = loaded.value;
    const visible: ContextItem[] = [];
    const items: {
      perspective: ContextItem["perspective"];
      reason: string;
      target: ContextItem["target"];
      fixed_version: string | null;
      section_status: (typeof SECTION_STATUSES)[number] | null;
    }[] = [];
    for (const item of context.items) {
      let fixed: string | null = null;
      let sectionStatus: (typeof SECTION_STATUSES)[number] | null = null;
      if (item.target.kind === "document") {
        const document = loadDocument(
          snapshot.sql as never,
          item.target.document,
        );
        if (!document.ok) return document;
        if (document.value === null) continue;
        if (
          !readableTarget(snapshot, ctx, {
            document: document.value.id,
            place_kind: document.value.place?.kind,
            place: document.value.place?.id,
          })
        ) continue;
        fixed = document.value.latest_version;
        if (fixed === null) continue;
        sectionStatus = item.target.section === null
          ? "whole"
          : deps.sectionStatus === undefined
          ? "unverified"
          : deps.sectionStatus(
            item.target.document,
            fixed,
            item.target.section,
          );
      } else if (!readableTarget(snapshot, ctx, { app: item.target.app })) {
        continue;
      }
      const reason = exportSafe(redactor, context, item.reason);
      if (!reason.ok) return reason;
      visible.push({ ...item, reason: reason.value });
      items.push({
        perspective: item.perspective,
        reason: reason.value,
        target: item.target,
        fixed_version: fixed,
        section_status: sectionStatus,
      });
    }
    const title = exportSafe(redactor, context, context.title);
    if (!title.ok) return title;
    const purpose = exportSafe(redactor, context, context.purpose);
    if (!purpose.ok) return purpose;
    // glossary는 documents/terms의 활성 정의다. 근원이 없거나 읽지 못하면 빈 glossary로
    // 꾸미지 않는다.
    if (deps.glossary === undefined) {
      return rejected("unavailable", "glossary source is not connected");
    }
    const terms = deps.glossary(context.id);
    if (!terms.ok) return terms;
    const glossary: { name: string; definition: string }[] = [];
    for (const term of terms.value) {
      if (term.definition === null) continue;
      const name = exportSafe(redactor, context, term.name);
      if (!name.ok) return name;
      const definition = exportSafe(redactor, context, term.definition);
      if (!definition.ok) return definition;
      glossary.push({ name: name.value, definition: definition.value });
    }
    return ok({
      context: {
        ...context,
        title: title.value,
        purpose: purpose.value,
        items: visible,
      },
      items,
      glossary,
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    } as never);
  };
}

// 한 context의 문서 watch 결과. 확인된 변화는 ledger 기록에서, 미확인은 주입받은 derived
// 근원에서 읽어 따로 낸다(contexts#R10, R11). 권한 밖 문서의 결과는 없는 것과 같이 빠진다.
function watchHandle(
  deps: ContextReadDeps,
): ReadDefinition<typeof contextWatch>["handle"] {
  return (snapshot, ctx, input) => {
    if (!readActorAllowed(ctx, contextWatch.actors)) {
      return rejected("forbidden", "actor cannot read contexts");
    }
    const loaded = loadContext(snapshot.sql as never, input.context);
    if (!loaded.ok) return loaded;
    if (loaded.value === null) {
      return rejected("not_found", "context not found");
    }
    const decision = allowed(snapshot, ctx, contextWatch.name, input.context);
    if (!decision.ok) return decision;
    if (decision.value === null) {
      return rejected("not_found", "context not found");
    }
    if (deps.unverified === undefined) {
      return rejected("unavailable", "watch results are not connected");
    }
    const unverified = deps.unverified(input.context);
    if (!unverified.ok) return unverified;
    const changes = listWatchChanges(
      snapshot.sql as never,
      input.context,
      WATCH_CHANGES_LIMIT,
    );
    if (!changes.ok) return changes;
    const readable = new Map<string, boolean>();
    const visible = (document: string): Result<boolean> => {
      const known = readable.get(document);
      if (known !== undefined) return ok(known);
      const row = loadDocument(snapshot.sql as never, document);
      if (!row.ok) return row;
      const value = row.value !== null &&
        readableTarget(snapshot, ctx, {
          document: row.value.id,
          place_kind: row.value.place?.kind,
          place: row.value.place?.id,
        }, contextWatch.name);
      readable.set(document, value);
      return ok(value);
    };
    const shownChanges = [];
    for (const change of changes.value) {
      const shown = visible(change.target.document);
      if (!shown.ok) return shown;
      if (shown.value) shownChanges.push(change);
    }
    const shownUnverified = [];
    for (const row of unverified.value) {
      const shown = visible(row.document);
      if (!shown.ok) return shown;
      if (!shown.value) continue;
      shownUnverified.push({
        target: {
          kind: "document" as const,
          document: row.document,
          section: row.section,
        },
        before_version: row.before_version,
        after_version: row.after_version,
        reason: row.reason,
      });
    }
    return ok({
      changes: shownChanges,
      unverified: shownUnverified,
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    } as never);
  };
}

export function createContextReads(deps: ContextReadDeps = {}): {
  list: ReadDefinition<typeof contextList>;
  get: ReadDefinition<typeof contextGet>;
  related: ReadDefinition<typeof contextRelated>;
  export: ReadDefinition<typeof contextExport>;
  watch: ReadDefinition<typeof contextWatch>;
} {
  return {
    export: { route: contextExport, handle: exportHandle(deps) },
    watch: { route: contextWatch, handle: watchHandle(deps) },
    list: {
      route: contextList,
      handle(snapshot, ctx, input) {
        if (!readActorAllowed(ctx, contextList.actors)) {
          return rejected("forbidden", "actor cannot read contexts");
        }
        const limit = input.limit ?? PAGE;
        const offset = offsetOf(input.cursor);
        if (!offset.ok) return offset;
        // "all"과 미지정은 필터가 없다. active·archived만 표로 좁힌다.
        const status = input.status === "all" || input.status === undefined
          ? undefined
          : input.status;
        const contexts = listContexts(snapshot.sql as never, {
          status,
          limit: limit + 1,
          offset: offset.value,
        });
        if (!contexts.ok) return contexts;
        const visible: Context[] = [];
        for (const context of contexts.value.slice(0, limit)) {
          const decision = allowed(snapshot, ctx, contextList.name, context.id);
          if (!decision.ok) return decision;
          if (decision.value === null) continue;
          visible.push(context);
        }
        const more = contexts.value.length > limit;
        return ok({
          contexts: visible,
          complete: !more,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: more ? String(offset.value + limit) : null,
        } as never);
      },
    },
    get: {
      route: contextGet,
      handle(snapshot, ctx, input) {
        if (!readActorAllowed(ctx, contextGet.actors)) {
          return rejected("forbidden", "actor cannot read contexts");
        }
        const loaded = loadContext(snapshot.sql as never, input.context);
        if (!loaded.ok) return loaded;
        if (loaded.value === null) {
          return rejected("not_found", "context not found");
        }
        const decision = allowed(snapshot, ctx, contextGet.name, input.context);
        if (!decision.ok) return decision;
        if (decision.value === null) {
          return rejected("not_found", "context not found");
        }
        return ok({
          context: loaded.value,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        } as never);
      },
    },
    related: {
      route: contextRelated,
      handle(snapshot, ctx, input) {
        if (!readActorAllowed(ctx, contextRelated.actors)) {
          return rejected("forbidden", "actor cannot read contexts");
        }
        const limit = input.limit ?? PAGE;
        const offset = offsetOf(input.cursor);
        if (!offset.ok) return offset;
        // 역조회는 항목이 직접 든 context에서 계산한다. 별도 연결 표는 없다.
        const contexts = listContextsByTargetKey(
          snapshot.sql as never,
          targetKey(input.target),
          { limit: limit + 1, offset: offset.value },
        );
        if (!contexts.ok) return contexts;
        const visible: Context[] = [];
        for (const context of contexts.value.slice(0, limit)) {
          const decision = allowed(
            snapshot,
            ctx,
            contextRelated.name,
            context.id,
          );
          if (!decision.ok) return decision;
          if (decision.value === null) continue;
          visible.push(context);
        }
        const more = contexts.value.length > limit;
        return ok({
          contexts: visible,
          complete: !more,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: more ? String(offset.value + limit) : null,
        } as never);
      },
    },
  };
}

// get에서 item의 현재 상태를 볼 때 쓴다. watch는 T24의 몫이다.
export function itemOf(
  items: readonly ContextItemRow[],
  target: ContextItem["target"],
): ContextItemRow | undefined {
  return items.find((item) => item.target_key === targetKey(target));
}

// context 목차(documents/outline-and-search의 `/v1/outline/context`와 root)가 읽는
// 근원. 구성과 항목 대상의 현재 ledger 상태만 준다. 본문·앱 데이터는 싣지 않는다.
// 항목에는 판이 저장되지 않으므로(R4) 문서 항목의 version은 읽은 시점의 최신 판 id이고,
// 이 값을 받은 읽기는 그 고정 판으로 결과와 전달 근거를 남긴다. 항목별 옛 판 고정 옵션은
// 없다. outline-and-search는 이 모듈을 import하지 않고 같은 모양의 값만 주입받는다.
export type ContextOutlineItemRecord = {
  target: ContextItem["target"];
  perspective: ContextItem["perspective"];
  reason: string;
  document?: {
    title: string;
    status: "active" | "archived";
    place: { kind: "project" | "app"; id: string } | null;
    version: string | null;
  };
};

export type ContextOutlineRecord = {
  id: string;
  title: string;
  purpose: string;
  revision: string;
  status: "active" | "archived";
  items: ContextOutlineItemRecord[];
};

export type ContextOutlineSource = {
  active(): Result<ContextOutlineRecord[]>;
  get(contextId: string): Result<ContextOutlineRecord | null>;
};

function outlineRecord(
  sql: Sql,
  context: Context,
): Result<ContextOutlineRecord> {
  const items: ContextOutlineItemRecord[] = [];
  for (const item of context.items) {
    const record: ContextOutlineItemRecord = {
      target: item.target,
      perspective: item.perspective,
      reason: item.reason,
    };
    if (item.target.kind === "document") {
      const document = loadDocument(sql, item.target.document);
      if (!document.ok) return document;
      if (document.value !== null) {
        record.document = {
          title: document.value.title,
          status: document.value.status,
          place: document.value.place,
          version: document.value.latest_version,
        };
      }
    }
    items.push(record);
  }
  return ok({
    id: context.id,
    title: context.title,
    purpose: context.purpose,
    revision: context.revision,
    status: context.status,
    items,
  });
}

export function createContextOutlineSource(sql: Sql): ContextOutlineSource {
  return {
    active() {
      const contexts = listContexts(sql, {
        status: "active",
        limit: Number.MAX_SAFE_INTEGER,
        offset: 0,
      });
      if (!contexts.ok) return contexts;
      const records: ContextOutlineRecord[] = [];
      for (const context of contexts.value) {
        const record = outlineRecord(sql, context);
        if (!record.ok) return record;
        records.push(record.value);
      }
      return ok(records);
    },
    get(contextId) {
      const loaded = loadContext(sql, contextId);
      if (!loaded.ok) return loaded;
      return loaded.value === null
        ? ok(null)
        : outlineRecord(sql, loaded.value);
    },
  };
}
