// Series read. list·get·next는 ledger metadata만 준다. 멤버 문서 본문·판 파일은
// 각 대상 read(documents/versions)가 연다. lophn agent도 읽을 수 있다(가족
// mutation은 command가 거절한다).

import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type Series,
  seriesGet,
  seriesList,
  seriesNext as seriesNextRead,
} from "../../../protocol/projects/mod.ts";
import {
  type ReadDefinition,
  type ReadSnapshot,
  type RequestContext,
  TargetAuthorization,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { seriesNext } from "./work.ts";
import {
  listAllSeries,
  listInstances,
  listReservedKeys,
  listSeries,
  loadSeries,
  loadSeriesByName,
} from "./store.ts";
import { loadDocument, loadLatestVersion } from "../versions/mod.ts";
import { orderMembers } from "./model.ts";

const PAGE = 50;

function rejected(code: string, message: string): Result<never> {
  return err({ code: code as "not_found", message });
}

function readActorAllowed(ctx: RequestContext, allowed: readonly string[]) {
  const kind = parseActor(ctx.actor)?.kind;
  return kind !== undefined && allowed.includes(kind);
}

// owner target은 platform이 주입한 TargetAuthorization port가 판정한다. forbidden은
// 존재를 새지 않는다(list는 건너뛰고 get·next는 not_found다).
function allowed(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  operation: string,
  seriesId: string,
): Result<string | null> {
  const decision = snapshot.port(TargetAuthorization)(
    ctx,
    operation,
    { series: seriesId },
  );
  if (!decision.ok) {
    return decision.error.code === "forbidden" ||
        decision.error.code === "not_found"
      ? ok(null)
      : decision;
  }
  return ok(seriesId);
}

// 가족 목차. 상세(get)와 목차(outline/series)가 같은 기준·순서를 쓴다.
function entriesOf(
  sql: Parameters<typeof loadSeries>[0],
  family: Series,
): Result<{
  key: string;
  document: string;
  title: string;
  version: string;
  latest_version: string;
  status: string;
}[]> {
  const instances = listInstances(sql, family.id);
  if (!instances.ok) return instances;
  const ordered = orderMembers(family.order, instances.value);
  const entries: {
    key: string;
    document: string;
    title: string;
    version: string;
    latest_version: string;
    status: string;
  }[] = [];
  for (const instance of ordered) {
    const document = loadDocument(sql, instance.document);
    if (!document.ok) return document;
    if (document.value === null) {
      return err({ code: "internal", message: "member document missing" });
    }
    const latest = loadLatestVersion(sql, instance.document);
    if (!latest.ok) return latest;
    if (latest.value === null) {
      return err({
        code: "internal",
        message: "member latest version missing",
      });
    }
    entries.push({
      key: instance.key,
      document: document.value.id,
      title: document.value.title,
      version: document.value.latest_version,
      latest_version: latest.value.id,
      status: document.value.status,
    });
  }
  return ok(entries);
}

function statusFilter(status: "active" | "archived" | "all") {
  return status === "all" ? undefined : status;
}

// list cursor의 offset은 contexts·versions와 같은 숫자 page cursor다.
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

export function createSeriesReads(): {
  list: ReadDefinition<typeof seriesList>;
  get: ReadDefinition<typeof seriesGet>;
  next: ReadDefinition<typeof seriesNextRead>;
} {
  return {
    list: {
      route: seriesList,
      handle(snapshot, ctx, input) {
        if (!readActorAllowed(ctx, seriesList.actors)) {
          return rejected("forbidden", "actor cannot read series");
        }
        const offset = offsetOf(input.cursor);
        if (!offset.ok) return offset;
        const status = statusFilter(input.status);
        // 자리가 있으면 그 자리의 가족만, 없으면 전체다.
        const families = input.place === undefined
          ? listAllSeries(snapshot.sql as never, status)
          : listSeries(snapshot.sql as never, input.place, status);
        if (!families.ok) return families;
        const start = offset.value;
        const end = start + PAGE;
        const visible: (Series & { member_count: number })[] = [];
        for (const family of families.value.slice(start, end)) {
          const decision = allowed(snapshot, ctx, seriesList.name, family.id);
          if (!decision.ok) return decision;
          if (decision.value === null) continue;
          const members = listInstances(snapshot.sql as never, family.id);
          if (!members.ok) return members;
          visible.push({ ...family, member_count: members.value.length });
        }
        return ok({
          series: visible,
          complete: families.value.length <= end,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: families.value.length > end ? String(end) : null,
        } as never);
      },
    },
    get: {
      route: seriesGet,
      handle(snapshot, ctx, input) {
        if (!readActorAllowed(ctx, seriesGet.actors)) {
          return rejected("forbidden", "actor cannot read series");
        }
        const loaded = "series" in input.selector
          ? loadSeries(snapshot.sql as never, input.selector.series)
          : loadSeriesByName(
            snapshot.sql as never,
            input.selector.place,
            input.selector.name,
          );
        if (!loaded.ok) return loaded;
        if (loaded.value === null) {
          return rejected("not_found", "series not found");
        }
        const decision = allowed(
          snapshot,
          ctx,
          seriesGet.name,
          loaded.value.id,
        );
        if (!decision.ok) return decision;
        if (decision.value === null) {
          return rejected("not_found", "series not found");
        }
        const entries = entriesOf(snapshot.sql as never, loaded.value);
        if (!entries.ok) return entries;
        return ok({
          series: loaded.value,
          entries: entries.value,
          complete: true,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        } as never);
      },
    },
    next: {
      route: seriesNextRead,
      handle(snapshot, ctx, input) {
        if (!readActorAllowed(ctx, seriesNextRead.actors)) {
          return rejected("forbidden", "actor cannot read series");
        }
        const loaded = "series" in input.selector
          ? loadSeries(snapshot.sql as never, input.selector.series)
          : loadSeriesByName(
            snapshot.sql as never,
            input.selector.place,
            input.selector.name,
          );
        if (!loaded.ok) return loaded;
        if (loaded.value === null) {
          return rejected("not_found", "series not found");
        }
        const decision = allowed(
          snapshot,
          ctx,
          seriesNextRead.name,
          loaded.value.id,
        );
        if (!decision.ok) return decision;
        if (decision.value === null) {
          return rejected("not_found", "series not found");
        }
        // 같은 snapshot의 멤버·예약 key를 읽고 준비 worker의 순수 series-next로
        // 계산한다. 표시 정렬과 무관하게 key 자연 순의 마지막 확정 멤버다.
        const instances = listInstances(snapshot.sql as never, loaded.value.id);
        if (!instances.ok) return instances;
        const members: { key: string; document_name: string | null }[] = [];
        for (const instance of instances.value) {
          const document = loadDocument(
            snapshot.sql as never,
            instance.document,
          );
          if (!document.ok) return document;
          members.push({
            key: instance.key,
            document_name: document.value === null ? null : document.value.name,
          });
        }
        const reserved = listReservedKeys(
          snapshot.sql as never,
          loaded.value.id,
        );
        if (!reserved.ok) return reserved;
        return ok({
          suggestion: seriesNext({
            rule: loaded.value.next_rule,
            revision: loaded.value.revision,
            members,
            reserved_keys: reserved.value,
            draft_key: loaded.value.draft === null
              ? null
              : loaded.value.draft.key,
          }),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        } as never);
      },
    },
  };
}
