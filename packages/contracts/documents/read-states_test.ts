import { assert, assertEquals } from "@std/assert";
import { readResultSchema } from "./read.ts";
import {
  contextOutlinePageSchema,
  documentOutlinePageSchema,
  placeOutlinePageSchema,
} from "./outline.ts";
import {
  agentHistoryVersionSchema,
  historyPageSchema,
  sectionHistoryEntrySchema,
} from "./history.ts";
import { searchResultSchema } from "./search.ts";
import {
  coverage,
  ctx,
  doc,
  file,
  format,
  hash,
  meta,
  previous,
  read,
  result,
  version,
} from "./read-fixtures.ts";
import {
  app,
  fileSource,
  release,
  run,
  versionRecord,
} from "./document-fixtures.ts";

Deno.test("documents/outline-and-search#R14 T18: empty derived outline still requires coverage", () => {
  const place = { ...meta, kind: "place", basis_seq: "9", entries: [] };
  const context = {
    ...meta,
    kind: "context",
    basis_seq: "9",
    context: ctx,
    title: "Context",
    purpose: "Review",
    entries: [],
    perspectives: { basis: [], reference: [], watch: [] },
    glossary: [],
    candidates: [],
  };
  assert(!placeOutlinePageSchema.safeParse(place).success);
  assert(!contextOutlinePageSchema.safeParse(context).success);
  assert(placeOutlinePageSchema.safeParse({ ...place, coverage }).success);
  assert(contextOutlinePageSchema.safeParse({ ...context, coverage }).success);
});
Deno.test("documents/outline-and-search#R22 T18: nonready reads are terminal with safe failure and exact file fallback", () => {
  for (const section_status of ["missing", "unverified", "unsupported"]) {
    const value = {
      ...read,
      section: "key",
      section_status,
      text: null,
      ranges: [],
      file: section_status === "missing" ? null : { ...file, version },
      failure_reason: section_status === "unverified"
        ? "extraction failed"
        : null,
    };
    assert(readResultSchema.safeParse(value).success);
    assert(
      !readResultSchema.safeParse({
        ...value,
        complete: false,
        next_cursor: "opaque",
      }).success,
    );
    assert(
      !readResultSchema.safeParse({ ...value, omission_reason: "not ready" })
        .success,
    );
    assert(!readResultSchema.safeParse({ ...value, text: "" }).success);
    if (section_status !== "missing") {
      assert(!readResultSchema.safeParse({ ...value, file: null }).success);
    }
    assert(
      !readResultSchema.safeParse({
        ...value,
        failure_reason: section_status === "unverified" ? null : "failure",
      }).success,
    );
    assert(
      !readResultSchema.safeParse({
        ...value,
        file: { ...file, version: previous },
      }).success,
    );
  }
});
Deno.test("documents/outline-and-search#R7 R22 T18: ready null text requires explicit terminal redaction omission and retains ranges", () => {
  for (const section_status of ["whole", "found"]) {
    const value = {
      ...read,
      section_status,
      section: section_status === "whole" ? null : "key",
      text: null,
    };
    assert(!readResultSchema.safeParse(value).success);
    assert(!readResultSchema.safeParse({ ...value, redacted: true }).success);
    const omitted = {
      ...value,
      redacted: true,
      omission_reason: "safe output unavailable",
    };
    const parsed = readResultSchema.parse(omitted);
    assertEquals(parsed.ranges, read.ranges);
    assert(
      !readResultSchema.safeParse({
        ...omitted,
        complete: false,
        next_cursor: "opaque",
      }).success,
    );
    assert(
      !readResultSchema.safeParse({ ...read, omission_reason: "omitted" })
        .success,
    );
  }
  assert(!readResultSchema.safeParse({ ...read, text: "" }).success);
  assert(readResultSchema.safeParse({ ...read, text: "", ranges: [] }).success);
  assert(
    !readResultSchema.safeParse({ ...read, failure_reason: "guest stderr" })
      .success,
  );
});
Deno.test("documents/outline-and-search#R22 R26 T18: document outline failure exposes terminal frozen file not fabricated missing", () => {
  const page = {
    ...meta,
    kind: "document",
    basis_seq: "9",
    document: doc,
    version,
    latest_version: previous,
    format,
    module_hash: hash,
    entries: [],
    section_status: "unverified",
    failure_reason: "module unavailable",
    file: { ...file, version },
  };
  assert(documentOutlinePageSchema.safeParse(page).success);
  assert(
    !documentOutlinePageSchema.safeParse({ ...page, failure_reason: null })
      .success,
  );
  assert(!documentOutlinePageSchema.safeParse({ ...page, file: null }).success);
  assert(
    !documentOutlinePageSchema.safeParse({
      ...page,
      file: { ...file, version: previous },
    }).success,
  );
  assert(
    !documentOutlinePageSchema.safeParse({
      ...page,
      complete: false,
      next_cursor: "opaque",
    }).success,
  );
  assert(
    documentOutlinePageSchema.safeParse({
      ...page,
      section_status: "unsupported",
      failure_reason: null,
    }).success,
  );
  assert(
    !documentOutlinePageSchema.safeParse({ ...page, section_status: "whole" })
      .success,
  );
});
Deno.test("documents/outline-and-search#R12 R19 T18: actual original ranges and distinct modified versions are required", () => {
  assert(!searchResultSchema.safeParse({ ...result, ranges: [] }).success);
  const side = { version, format, module_hash: hash, body_hash: hash };
  const row = {
    section: "key",
    version,
    before: side,
    after: { ...side, body_hash: "b".repeat(64) },
    status: "modified",
    title: "Key",
  };
  assert(!sectionHistoryEntrySchema.safeParse(row).success);
  assert(
    sectionHistoryEntrySchema.safeParse({
      ...row,
      before: { ...side, version: previous },
    }).success,
  );
});
Deno.test("documents/outline-and-search#R3 R19 T18: agent history projection excludes raw disk source while preserving actor invariants", () => {
  assert(!agentHistoryVersionSchema.safeParse(versionRecord).success);
  assert(
    !agentHistoryVersionSchema.safeParse({
      ...versionRecord,
      source: {
        kind: "instruction_file",
        instruction_target: "instruction",
        project: fileSource.project,
        path: fileSource.path,
        original_hash: hash,
        observed_at: fileSource.observed_at,
      },
    }).success,
  );
  const projected = {
    ...versionRecord,
    source: null,
    future: true,
    format: { ...format, future: true },
  };
  const parsed = agentHistoryVersionSchema.parse(projected);
  assertEquals(parsed.source, null);
  assertEquals(parsed.id, version);
  assertEquals(parsed.files, versionRecord.files);
  assert(
    historyPageSchema.safeParse({
      ...meta,
      document: doc,
      versions: [versionRecord],
    }).success,
  );
  const agent = {
    ...projected,
    saved_by: "agent:asg_01arz3ndektsv4rrffq69g5fav",
    run,
  };
  assert(agentHistoryVersionSchema.safeParse(agent).success);
  assert(!agentHistoryVersionSchema.safeParse({ ...agent, run: null }).success);
  const appVersion = {
    ...projected,
    saved_by: `app:${app}`,
    source: { kind: "app", app, release, future: true },
  };
  assert(agentHistoryVersionSchema.safeParse(appVersion).success);
  assertEquals(agentHistoryVersionSchema.parse(appVersion).source?.kind, "app");
  assert(
    !agentHistoryVersionSchema.safeParse({ ...appVersion, source: null })
      .success,
  );
});
