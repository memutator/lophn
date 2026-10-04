import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/mod.ts";
import { EVENTS, ROUTES } from "./mod.ts";
import { doc, format, place, version } from "./document-fixtures.ts";
import { coverage, ctx, meta } from "./read-fixtures.ts";
import {
  DOCUMENT_STATUSES,
  savedViewCreated,
  savedViewDeleted,
  VIEW_EVENTS,
  VIEW_ROUTES,
  VIEW_SORTS,
  viewFilterSchema,
  viewGet,
  viewList,
  viewOpen,
  viewSave,
  viewUpdate,
} from "./views.ts";

const view = "viw_01arz3ndektsv4rrffq69g5fav";
const filter = {
  text: "보고",
  formats: ["document"],
  document_status: "active" as const,
};
const saved = {
  id: view,
  name: "최근 보고",
  place,
  filter,
  sort: "updated_desc" as const,
  revision: "4",
};
const entry = {
  document: doc,
  name: "report",
  title: "보고서",
  version,
  latest_version: version,
  format,
  saved_by: "user" as const,
  saved_at: "2026-10-04T00:00:00.000Z",
  excerpt: "발췌",
  summary: null,
  section_count: 1,
};

// deno-fmt-ignore
const paths = ["/v1/views/list", "/v1/views/get", "/v1/views/open", "/v1/views/save", "/v1/views/update", "/v1/views/delete"];
// deno-fmt-ignore
const types = ["SavedViewCreated", "SavedViewUpdated", "SavedViewDeleted"];

Deno.test("documents/outline-and-search#R23 R24 R25: saved view routes, four sorts and three events match architecture", () => {
  assertEquals(VIEW_ROUTES.map(routePath), paths);
  assertEquals(VIEW_EVENTS.map((event) => event.type), types);
  assertEquals(
    ROUTES.filter((route) => route.resource === "views").map(routePath),
    paths,
  );
  assertEquals(
    EVENTS.filter((event) => event.type.startsWith("SavedView")).map((event) =>
      event.type
    ),
    types,
  );
  assertEquals([...VIEW_SORTS], [
    "updated_desc",
    "updated_asc",
    "title_asc",
    "address_asc",
  ]);
  assertEquals([...DOCUMENT_STATUSES], ["active", "archived", "all"]);
  for (const route of VIEW_ROUTES) {
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
    if (route.kind === "command") assertEquals(route.actors, ["user"]);
  }
  assert(viewList.actors.includes("agent"));
  assert(
    savedViewCreated.payload.safeParse({
      name: saved.name,
      place,
      filter,
      sort: saved.sort,
    }).success,
  );
  assert(
    savedViewDeleted.payload.safeParse({
      before_view: saved,
      before_revision: "4",
    }).success,
  );
  assert(!savedViewCreated.subject.safeParse(doc).success);
});

Deno.test("documents/outline-and-search#R23: a view stores only the defined document conditions", () => {
  assert(
    viewSave.input.safeParse({
      id: view,
      name: saved.name,
      place,
      filter,
      sort: "title_asc",
    }).success,
  );
  assert(viewFilterSchema.safeParse({ document_status: "all" }).success);
  assert(
    viewUpdate.input.safeParse({
      view,
      filter: { context: ctx, changed_within_ms: 86_400_000 },
    }).success,
  );
  for (
    const input of [
      { id: view, name: " ", filter },
      { id: view, name: saved.name, filter: { ...filter, tag: "weekly" } },
      {
        id: view,
        name: saved.name,
        filter: { series: "ser_01arz3ndektsv4rrffq69g5fav" },
      },
      { id: view, name: saved.name, filter: { document_status: "hidden" } },
      { view },
    ]
  ) {
    assert(!viewSave.input.safeParse(input).success);
    assert(!viewUpdate.input.safeParse(input).success);
  }
});

Deno.test("documents/outline-and-search#R24 R25: opening a view returns the current small document page without glossary", () => {
  assert(viewGet.output.safeParse({ ...meta, view: saved }).success);
  assert(viewOpen.input.safeParse({ view, cursor: "opaque" }).success);
  assert(
    viewOpen.output.safeParse({
      ...meta,
      kind: "view",
      basis_seq: "9",
      view,
      revision: "4",
      filter,
      opened_at_ms: 1_759_536_000_000,
      entries: [entry],
      coverage,
    }).success,
  );
  assert(
    !viewOpen.output.safeParse({
      ...meta,
      kind: "view",
      basis_seq: "9",
      view,
      revision: "4",
      filter: { document_status: "active" },
      opened_at_ms: 1,
      entries: [entry],
      coverage,
    }).success,
  );
  assert(
    !viewOpen.output.safeParse({
      ...meta,
      kind: "view",
      basis_seq: "9",
      view,
      revision: "4",
      filter,
      opened_at_ms: 1,
      entries: [entry],
      coverage: null,
      glossary: [],
    }).success,
  );
});
