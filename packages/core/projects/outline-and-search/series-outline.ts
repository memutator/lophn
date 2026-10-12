// series 가족 목차 read. root/series는 ledger metadata만 읽는다. series.get과 같은
// 기준·순서의 key·제목·고정 최신 판·보관 상태를 돌려준다(series#R4, R12). page는
// T14 outline cursor 방식이며 basis_seq가 지나가면 conflict다.

import { err, ok, type Result } from "../../../base/mod.ts";
import type { z } from "zod";
import {
  outlineSeries,
  type Series,
  type seriesOutlinePageSchema,
} from "../../../protocol/projects/mod.ts";
import {
  parseActor,
  type ReadDefinition,
  type ReadSnapshot,
  type RequestContext,
  TargetAuthorization,
} from "../../../protocol/platform/mod.ts";
import {
  decodeOutlineCursor,
  encodeOutlineCursor,
  estimatedTokens,
} from "./model.ts";
import {
  listInstances,
  loadSeries,
  loadSeriesByName,
  orderMembers,
} from "../series/mod.ts";
import { loadDocument, loadLatestVersion } from "../versions/mod.ts";

const ENTRY_COST = 120;
const PLACE_BUDGET = 3000;

function rejected(code: string, message: string): Result<never> {
  return err({ code: code as "not_found", message });
}

function readActorAllowed(ctx: RequestContext, allowed: readonly string[]) {
  const kind = parseActor(ctx.actor)?.kind;
  return kind !== undefined && allowed.includes(kind);
}

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

export function createSeriesOutlineRead(): ReadDefinition<
  typeof outlineSeries
> {
  return {
    route: outlineSeries,
    handle(snapshot, ctx, input) {
      if (!readActorAllowed(ctx, outlineSeries.actors)) {
        return rejected("forbidden", "actor cannot read the series outline");
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
        outlineSeries.name,
        loaded.value.id,
      );
      if (!decision.ok) return decision;
      if (decision.value === null) {
        return rejected("not_found", "series not found");
      }
      return page(snapshot, ctx, input, loaded.value);
    },
  };
}

type Entry = z.infer<typeof seriesOutlinePageSchema>["entries"][number];

function page(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  input: {
    selector: { series: string } | {
      place: { kind: "project" | "app"; id: string };
      name: string;
    };
    estimated_token_budget?: number;
    cursor?: string;
  },
  family: Series,
): Result<z.output<typeof seriesOutlinePageSchema>> {
  const budget = input.estimated_token_budget ?? PLACE_BUDGET;
  const built = entriesOf(snapshot.sql as never, family);
  if (!built.ok) return built;
  const offset = input.cursor === undefined
    ? ok({ offset: 0 })
    : cursorOf(input.cursor, {
      topic: "outline.series",
      basis_seq: snapshot.as_of_seq,
      sort: "key",
      conditions: { selector: input.selector, budget },
      credential: ctx.credential_ref,
    });
  if (!offset.ok) return offset;
  let used = 0;
  let complete = true;
  const cut: Entry[] = [];
  for (const entry of built.value.slice(offset.value.offset)) {
    const cost = estimatedTokens(ENTRY_COST);
    if (used + cost > budget && cut.length > 0) {
      complete = false;
      break;
    }
    used += cost;
    cut.push(entry);
  }
  return ok({
    kind: "series",
    basis_seq: snapshot.as_of_seq,
    series: family.id,
    entries: cut,
    complete,
    as_of_seq: snapshot.as_of_seq,
    next_cursor: complete ? null : encodeOutlineCursor({
      topic: "outline.series",
      basis_seq: snapshot.as_of_seq,
      sort: "key",
      conditions: { selector: input.selector, budget },
      versions: cut.map((entry) => ({
        document: entry.document,
        version: entry.version,
      })),
      credential: ctx.credential_ref,
    }, offset.value.offset + cut.length),
  } as never);
}

// 가족 목차. get과 같은 기준·순서다(series#R4).
function entriesOf(
  sql: Parameters<typeof loadSeries>[0],
  family: Series,
): Result<Entry[]> {
  const instances = listInstances(sql, family.id);
  if (!instances.ok) return instances;
  const ordered = orderMembers(family.order, instances.value);
  const entries: Entry[] = [];
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

function cursorOf(
  cursor: string,
  current: {
    topic: string;
    basis_seq: string;
    sort: string;
    conditions: unknown;
    credential: string;
  },
): Result<{ offset: number }> {
  return decodeOutlineCursor(cursor, current);
}
