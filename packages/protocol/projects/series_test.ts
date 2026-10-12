import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../base/route.ts";
import { EVENTS, ROUTES } from "./mod.ts";
import { doc, format, hash, place, version } from "./document-fixtures.ts";
import {
  compareSeriesKeys,
  documentNameForKey,
  nextRuleSchema,
  SERIES_EVENTS,
  SERIES_ROUTES,
  seriesAddInstance,
  seriesArchive,
  seriesClearDraft,
  seriesCreate,
  seriesCreated,
  seriesGet,
  seriesInstanceAdded,
  seriesList,
  seriesNext,
  seriesSetDraft,
  seriesUpdate,
  suggestNextKey,
} from "./series.ts";

const series = "ser_01arz3ndektsv4rrffq69g5fav";
const order = { kind: "key" as const, direction: "ascending" as const };
const create = {
  id: series,
  place,
  name: "weekly",
  title: "주간 보고",
  format: "document",
  order,
  next_rule: "{minor}",
};
const page = { as_of_seq: "9", complete: true, next_cursor: null };
const entry = {
  key: "0.3",
  document: doc,
  title: "셋째",
  version,
  latest_version: version,
  status: "active" as const,
};
const draft = {
  document: doc,
  key: "0.4",
  base_version: null,
  format,
  content: { hash, size_bytes: 12 },
};

// deno-fmt-ignore
const paths = ["/v1/series/list", "/v1/series/get", "/v1/series/next", "/v1/series/create", "/v1/series/update", "/v1/series/set_draft", "/v1/series/clear_draft", "/v1/series/add_instance", "/v1/series/update_instance", "/v1/series/remove_instance", "/v1/series/archive", "/v1/series/unarchive"];
// deno-fmt-ignore
const types = ["SeriesCreated", "SeriesUpdated", "SeriesDraftSet", "SeriesDraftCleared", "SeriesInstanceAdded", "SeriesInstanceUpdated", "SeriesInstanceRemoved", "SeriesArchived", "SeriesUnarchived"];

Deno.test("documents/series#R1 R4 R12: series routes and nine events match architecture", () => {
  assertEquals(SERIES_ROUTES.map(routePath), paths);
  assertEquals(SERIES_EVENTS.map((event) => event.type), types);
  assertEquals(
    ROUTES.filter((route) => route.resource === "series").map(routePath),
    paths,
  );
  assertEquals(
    EVENTS.filter((event) => event.type.startsWith("Series")).map((event) =>
      event.type
    ),
    types,
  );
  for (const route of SERIES_ROUTES) {
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
  }
  for (
    const route of [
      seriesCreate,
      seriesUpdate,
      seriesAddInstance,
    ]
  ) assertEquals(route.actors, ["user", "coding_agent", "app"]);
  for (
    const route of [seriesSetDraft, seriesClearDraft, seriesArchive]
  ) assertEquals(route.actors, ["user"]);
  assertEquals(seriesList.actors.includes("agent"), true);
  assert(seriesCreated.payload.safeParse(create).success);
  assert(
    !seriesCreated.subject.safeParse(series.replace("ser_", "doc_")).success,
  );
});

Deno.test("documents/series#R1 R2 R3 R8: family registration accepts key rules and rejects unknown fields and unsupported rules", () => {
  assert(seriesCreate.input.safeParse(create).success);
  assert(
    seriesAddInstance.input.safeParse({
      series,
      document: doc,
      key: "0.3",
    }).success,
  );
  assert(nextRuleSchema.safeParse("P{n+1:03}").success);
  for (
    const input of [
      { ...create, relation: doc },
      { ...create, id: "doc_01arz3ndektsv4rrffq69g5fav" },
      { ...create, next_rule: "{n+1:5}" },
      { ...create, next_rule: "{week}" },
      { ...create, title: "   " },
      { series, document: doc },
      { series, document: doc, key: " " },
    ]
  ) {
    assert(
      !seriesCreate.input.safeParse(input).success ||
        !seriesAddInstance.input.safeParse(input).success,
    );
  }
});

Deno.test("documents/series#R4 R12: get reads a family by id or place and name with the same member rows", () => {
  const body = {
    ...page,
    series: { ...create, draft: null, revision: "4", status: "active" },
    entries: [entry],
  };
  for (
    const selector of [{ series }, { place, name: "weekly" }]
  ) {
    assert(seriesGet.input.safeParse({ selector, cursor: "opaque" }).success);
    assert(seriesGet.output.safeParse(body).success);
  }
  assert(
    seriesList.output.safeParse({
      ...page,
      series: [{
        ...create,
        draft: null,
        revision: "4",
        status: "active",
        member_count: 1,
      }],
    }).success,
  );
  assert(!seriesGet.input.safeParse({ selector: { name: "weekly" } }).success);
  assert(
    !seriesGet.input.safeParse({
      selector: { series },
      address: "weekly/report",
    }).success,
  );
});

Deno.test("documents/series#R5 R6 R7 R8: next key follows numeric rules and returns an empty suggestion otherwise", () => {
  assertEquals(suggestNextKey("P{n+1:03}", "P001"), "P002");
  assertEquals(suggestNextKey("{minor}", "0.2"), "0.3");
  assertEquals(suggestNextKey("{major}", "0.2"), "1.0");
  assertEquals(suggestNextKey("{patch}", "0.2.1"), "0.2.2");
  assertEquals(suggestNextKey("v{n+1}", "v1"), "v2");
  assertEquals(suggestNextKey("{minor}", null), "");
  assertEquals(suggestNextKey("{n}", "2026-09-28"), "");
  assertEquals(
    ["0.10", "free", "0.2", "0.9"].sort(compareSeriesKeys),
    ["0.2", "0.9", "0.10", "free"],
  );
  assertEquals(documentNameForKey("0.3"), null);
  assertEquals(documentNameForKey("P002"), "p002");
  assert(seriesNext.input.safeParse({ selector: { series } }).success);
  assert(
    seriesNext.output.safeParse({
      ...page,
      suggestion: {
        series_revision: "4",
        key: "",
        title: "",
        from: null,
        taken: false,
        document_name: null,
      },
    }).success,
  );
  assert(
    !seriesNext.output.safeParse({
      ...page,
      suggestion: {
        series_revision: "4",
        key: "",
        title: "",
        from: null,
        taken: false,
        document_name: "made-up",
      },
    }).success,
  );
});

Deno.test("documents/series#R11: one draft keeps a planned key and content without becoming a member", () => {
  assert(seriesSetDraft.input.safeParse({ series, draft }).success);
  assert(
    seriesInstanceAdded.payload.safeParse({
      document: doc,
      key: "0.4",
      order_value: null,
      order_version: null,
      before_revision: "4",
    }).success,
  );
  assert(
    !seriesSetDraft.input.safeParse({
      series,
      draft: { ...draft, content: { hash: "nope", size_bytes: 1 } },
    }).success,
  );
  assert(!seriesUpdate.input.safeParse({ series }).success);
});
