import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/mod.ts";
import { DOCUMENT_READ_ROUTES, ROUTES } from "./mod.ts";
import {
  CONTEXT_ESTIMATED_TOKEN_BUDGET,
  contextOutlinePageSchema,
  DOCUMENT_ESTIMATED_TOKEN_BUDGET,
  DOCUMENT_OUTLINE_DEPTH,
  documentOutlinePageSchema,
  GLOSSARY_FIRST_PAGE_LIMIT,
  outlineDocument,
  outlineRoot,
  PLACE_ESTIMATED_TOKEN_BUDGET,
  placeOutlineEntrySchema,
  READ_CODEPOINT_BUDGET,
  ROOT_ESTIMATED_TOKEN_BUDGET,
  rootOutlinePageSchema,
  sectionSchema,
} from "./outline.ts";
import {
  coverage,
  ctx,
  doc,
  format,
  hash,
  meta,
  previous,
  section,
  term,
  version,
} from "./read-fixtures.ts";
import { at, place } from "./document-fixtures.ts";

Deno.test("documents/outline-and-search#R1 T18: fixed route literals and public registry membership", () => {
  assertEquals(DOCUMENT_READ_ROUTES.map(routePath), [
    "/v1/outline/root",
    "/v1/outline/place",
    "/v1/outline/document",
    "/v1/outline/series",
    "/v1/documents/read",
    "/v1/documents/file",
    "/v1/documents/history",
    "/v1/documents/section_history",
    "/v1/documents/diff",
    "/v1/search/query",
    "/v1/search/status",
    "/v1/guides/list",
    "/v1/guides/get",
    "/v1/guides/outline",
    "/v1/guides/read",
  ]);
  assertEquals(DOCUMENT_READ_ROUTES.map((route) => route.name), [
    "outline.root",
    "outline.place",
    "outline.document",
    "outline.series",
    "document.read",
    "document.file",
    "document.history",
    "document.section_history",
    "document.diff",
    "search.query",
    "search.status",
    "guide.list",
    "guide.get",
    "guide.outline",
    "guide.read",
  ]);
  assertEquals(DOCUMENT_READ_ROUTES.map((route) => route.kind), [
    "read",
    "worker",
    "worker",
    "read",
    "worker",
    "file",
    "read",
    "worker",
    "worker",
    "worker",
    "worker",
    "worker",
    "worker",
    "worker",
    "worker",
  ]);
  for (const route of DOCUMENT_READ_ROUTES) {
    assertEquals(ROUTES.filter((candidate) => candidate === route).length, 1);
    assertEquals([...route.errors], [...ERROR_CODES]);
  }
});
Deno.test("documents/outline-and-search#R3 T18: agent projections exclude path and distinguish SummaryCache from excerpt", () => {
  const entry = {
    document: doc,
    name: "report",
    title: "Report",
    version,
    latest_version: previous,
    format: { ...format, future: true },
    saved_by: "user",
    saved_at: at,
    excerpt: "😀".repeat(200),
    summary: null,
    section_count: 1,
    path: "/private/report.md",
  };
  const parsed = placeOutlineEntrySchema.parse(entry);
  assert(!("path" in parsed));
  assert(!("future" in parsed.format));
  assert(
    !placeOutlineEntrySchema.safeParse({ ...entry, excerpt: "😀".repeat(201) })
      .success,
  );
  const summary = {
    version: previous,
    section: null,
    text: "요약",
    input_hash: hash,
    stale: true,
    extra: 1,
  };
  assert(
    placeOutlineEntrySchema.safeParse({ ...entry, excerpt: null, summary })
      .success,
  );
  assert(!placeOutlineEntrySchema.safeParse({ ...entry, summary }).success);
  assert(
    !placeOutlineEntrySchema.safeParse({
      ...entry,
      excerpt: null,
      summary: { ...summary, stale: false },
    }).success,
  );
  assert(!outlineRoot.input.safeParse({ path: "/private" }).success);
});
Deno.test("documents/outline-and-search#R4 T18: context keeps empty perspectives and definitions separate from candidates", () => {
  const item = {
    kind: "document",
    perspective: "basis",
    reason: "판단 기준",
    title: "Report",
    readable: true,
    target: { kind: "document", document: doc, section: null },
    version,
    latest_version: previous,
    format,
    module_hash: hash,
    section_status: "whole",
  };
  const value = {
    ...meta,
    kind: "context",
    basis_seq: "9",
    context: ctx,
    title: "목적",
    purpose: "검토",
    entries: [item],
    perspectives: { basis: [item], reference: [], watch: [] },
    glossary: [{
      id: term,
      context: ctx,
      name: "용어",
      definition: "정의",
      evidence: [],
      revision: "1",
      status: "active",
    }],
    candidates: [],
    coverage,
  };
  assert(contextOutlinePageSchema.safeParse(value).success);
  assert(
    !contextOutlinePageSchema.safeParse({
      ...value,
      glossary: [{ ...value.glossary[0], definition: null }],
    }).success,
  );
  assert(
    !contextOutlinePageSchema.safeParse({
      ...value,
      perspectives: { basis: [item], reference: [] },
    }).success,
  );
  assert(
    !contextOutlinePageSchema.safeParse({
      ...value,
      entries: [{ ...item, version: null }],
    }).success,
  );
});
Deno.test("documents/outline-and-search#R5 T18: budget defaults and complete cursor coupling survive read common", () => {
  assertEquals([
    ROOT_ESTIMATED_TOKEN_BUDGET,
    PLACE_ESTIMATED_TOKEN_BUDGET,
    CONTEXT_ESTIMATED_TOKEN_BUDGET,
    DOCUMENT_ESTIMATED_TOKEN_BUDGET,
    DOCUMENT_OUTLINE_DEPTH,
    READ_CODEPOINT_BUDGET,
    GLOSSARY_FIRST_PAGE_LIMIT,
  ], [1500, 3000, 3000, 2000, 2, 12000, 30]);
  assertEquals(outlineRoot.input.parse({}).estimated_token_budget, 1500);
  assertEquals(
    outlineDocument.input.parse({
      reference: { document: doc, version: null, section: null },
    }).depth,
    2,
  );
  const page = { ...meta, kind: "root", basis_seq: "9", entries: [] };
  assert(rootOutlinePageSchema.safeParse(page).success);
  assert(
    !rootOutlinePageSchema.safeParse({ ...page, next_cursor: "opaque" })
      .success,
  );
  assert(
    !rootOutlinePageSchema.safeParse({ ...page, complete: false }).success,
  );
  assert(
    !rootOutlinePageSchema.safeParse({
      ...page,
      complete: false,
      next_cursor: "",
    }).success,
  );
  assert(
    rootOutlinePageSchema.safeParse({
      ...page,
      complete: false,
      next_cursor: "opaque",
    }).success,
  );
  assert(
    !rootOutlinePageSchema.safeParse({
      ...page,
      entries: [{ kind: "unplaced", document_count: -1 }],
    }).success,
  );
});
Deno.test("documents/outline-and-search#R6 R26 T18: extracted sections keep exact codepoint token estimate and version ranges", () => {
  assert(sectionSchema.safeParse(section).success);
  assert(!sectionSchema.safeParse({ ...section, estimated_tokens: 1 }).success);
  assert(
    !sectionSchema.safeParse({
      ...section,
      own_ranges: [{ start_line: 0, end_line: 1 }],
    }).success,
  );
  assert(
    !sectionSchema.safeParse({
      ...section,
      children_count: 0,
      hidden_children_count: 1,
    }).success,
  );
  const page = {
    ...meta,
    kind: "document",
    basis_seq: "9",
    document: doc,
    version,
    latest_version: previous,
    format,
    module_hash: hash,
    section_status: "whole",
    entries: [section],
    failure_reason: null,
    file: null,
  };
  assert(documentOutlinePageSchema.safeParse(page).success);
  assert(
    !documentOutlinePageSchema.safeParse({
      ...page,
      entries: [{ ...section, version: previous }],
    }).success,
  );
  assert(
    !documentOutlinePageSchema.safeParse({
      ...page,
      section_status: "unverified",
    }).success,
  );
});
Deno.test("documents/outline-and-search#R18 T18: metadata JSON is bounded after UTF8 serialization", () => {
  const page = {
    ...meta,
    kind: "root",
    basis_seq: "9",
    entries: [{
      kind: "project",
      id: place.id,
      title: "x".repeat(262144),
      purpose: "",
      activity_seq: "9",
      document_count: 1,
    }],
  };
  assert(!rootOutlinePageSchema.safeParse(page).success);
});
