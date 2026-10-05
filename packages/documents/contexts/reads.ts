// Context read. list·get·related는 ledger metadata만 준다. 판 본문·앱 데이터는
// 각 대상 read(command들)가 연다. 관점·이유는 모든 actor에게 보인다.

import { err, ok, type Result } from "../../base/mod.ts";
import {
  type Context,
  contextGet,
  type ContextItem,
  contextList,
  contextRelated,
} from "../../contracts/documents/mod.ts";
import {
  parseActor,
  type ReadDefinition,
  type ReadSnapshot,
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

export function createContextReads(): {
  list: ReadDefinition<typeof contextList>;
  get: ReadDefinition<typeof contextGet>;
  related: ReadDefinition<typeof contextRelated>;
} {
  return {
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
