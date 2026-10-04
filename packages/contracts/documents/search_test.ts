import { assert } from "@std/assert";
import {
  indexCoverageSchema,
  searchQuery,
  searchResultSchema,
  searchStatus,
} from "./search.ts";
import {
  coverage,
  ctx,
  doc,
  hash,
  meta,
  previous,
  range,
  result,
  version,
} from "./read-fixtures.ts";
import { place } from "./document-fixtures.ts";

Deno.test("documents/outline-and-search#R10 R11 R12 R23 T18: keyword queries support place context format filters and reject undefined conditions", () => {
  for (const query of ["한글", "글", "%_"]) {
    assert(
      searchQuery.input.safeParse({
        query,
        place,
        context: ctx,
        formats: ["document"],
        cursor: "opaque",
      }).success,
    );
  }
  for (
    const input of [
      { query: " " },
      { query: "test", embedding: [] },
      { query: "test", tag: "tag" },
      { query: "test", place: { ...place, path: "/private" } },
      { query: "test", cursor: "" },
    ]
  ) {
    assert(!searchQuery.input.safeParse(input).success);
  }
});
Deno.test("documents/outline-and-search#R12 T18: original matches carry actual ranges and exact fixed version reference", () => {
  assert(searchResultSchema.safeParse(result).success);
  assert(!searchResultSchema.safeParse({ ...result, score: Infinity }).success);
  assert(
    !searchResultSchema.safeParse({
      ...result,
      reference: { document: doc, version: null, section: null },
    }).success,
  );
  assert(
    !searchResultSchema.safeParse({
      ...result,
      reference: { document: doc, version: previous, section: null },
    }).success,
  );
  assert(
    !searchResultSchema.safeParse({
      ...result,
      cache_basis: { version, section: null, input_hash: hash, stale: true },
    }).success,
  );
  assert(
    !searchResultSchema.safeParse({
      ...result,
      ranges: [{ start_line: 3, end_line: 1 }],
    }).success,
  );
});
Deno.test("documents/outline-and-search#R18 T18: summary and topic matches have empty original ranges and actual stale cache input", () => {
  const basis = {
    version,
    section: null,
    input_hash: hash,
    stale: true,
    future: 1,
  };
  for (const match_source of ["summary", "topic"]) {
    const value = { ...result, match_source, ranges: [], cache_basis: basis };
    assert(searchResultSchema.safeParse(value).success);
    assert(
      !searchResultSchema.safeParse({ ...value, ranges: [range] }).success,
    );
    assert(
      !searchResultSchema.safeParse({ ...value, cache_basis: null }).success,
    );
    assert(
      !searchResultSchema.safeParse({
        ...value,
        cache_basis: { ...basis, version: previous },
      }).success,
    );
    assert(
      !searchResultSchema.safeParse({
        ...value,
        cache_basis: { ...basis, stale: false },
      }).success,
    );
  }
});
Deno.test("documents/outline-and-search#R14 T18: empty results still require IndexCoverage and lagging is not authority proof", () => {
  const page = { ...meta, results: [], coverage };
  assert(searchQuery.output.safeParse(page).success);
  assert(!searchQuery.output.safeParse({ ...meta, results: [] }).success);
  assert(
    !indexCoverageSchema.safeParse({ ...coverage, lagging: false }).success,
  );
  assert(
    !indexCoverageSchema.safeParse({ ...coverage, processed_seq: "10" })
      .success,
  );
  assert(
    indexCoverageSchema.safeParse({
      ...coverage,
      processed_seq: "9",
      lagging: true,
    }).success,
  );
  assert(
    indexCoverageSchema.safeParse({
      ...coverage,
      processed_seq: "9",
      lagging: false,
    }).success,
  );
  assert(!searchQuery.output.safeParse({ ...page, complete: false }).success);
  assert(
    searchQuery.output.safeParse({
      ...page,
      complete: false,
      next_cursor: "query-bound",
    }).success,
  );
  assert(
    searchStatus.output.safeParse({
      as_of_seq: "9",
      next_cursor: null,
      documents: [{
        document: doc,
        version: null,
        latest_version: version,
        module_hash: null,
        format: null,
      }],
      coverage,
    }).success,
  );
});
