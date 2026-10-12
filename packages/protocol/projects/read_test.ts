import { assert, assertEquals } from "@std/assert";
import {
  documentFile,
  documentReadInputSchema,
  readResultSchema,
} from "./read.ts";
import {
  diffPageSchema,
  documentDiff,
  documentHistory,
  documentSectionHistory,
  sectionHistoryPageSchema,
} from "./history.ts";
import {
  doc,
  file,
  format,
  hash,
  meta,
  previous,
  range,
  read,
  version,
} from "./read-fixtures.ts";
import { versionRecord } from "./document-fixtures.ts";

Deno.test("documents/outline-and-search#R7 R8 T18: frozen reads bound codepoints and keep opaque continuation in a long line", () => {
  const reference = { document: doc, version, section: null };
  const input = documentReadInputSchema.parse({ reference });
  assertEquals(input.max_codepoints, 12000);
  assertEquals(input.include_children, false);
  assertEquals(input.ranges, []);
  assert(readResultSchema.safeParse(read).success);
  assert(
    readResultSchema.safeParse({
      ...read,
      text: "😀".repeat(12000),
      complete: false,
      ranges: [{ start_line: 1, end_line: 1 }],
      next_cursor: "opaque-line-codepoint-position",
    }).success,
  );
  assert(
    !readResultSchema.safeParse({ ...read, text: "😀".repeat(12001) }).success,
  );
  assert(!readResultSchema.safeParse({ ...read, complete: false }).success);
  assert(
    !readResultSchema.safeParse({ ...read, next_cursor: "opaque" }).success,
  );
  assert(
    !documentReadInputSchema.safeParse({
      reference: { ...reference, version: null },
    }).success,
  );
  assert(
    !documentReadInputSchema.safeParse({
      reference,
      ranges: [{ start_line: 2, end_line: 1 }],
    }).success,
  );
  assert(!documentReadInputSchema.safeParse({ reference, cursor: "" }).success);
  assert(
    !documentReadInputSchema.safeParse({
      reference: { ...reference, surprise: true },
    }).success,
  );
  assert(
    !documentReadInputSchema.safeParse({
      reference: { ...reference, section: "a" },
      section: "b",
    }).success,
  );
});
Deno.test("documents/outline-and-search#R22 T18: missing, unverified and unsupported do not invent text or ranges", () => {
  for (const status of ["missing", "unverified", "unsupported"]) {
    const result = {
      ...read,
      section: "key",
      section_status: status,
      text: null,
      ranges: [],
      file: status !== "missing" ? { ...file, version } : null,
      failure_reason: status === "unverified" ? "extraction unavailable" : null,
    };
    assert(readResultSchema.safeParse(result).success);
    assert(
      !readResultSchema.safeParse({ ...result, text: "inferred" }).success,
    );
    assert(!readResultSchema.safeParse({ ...result, ranges: [range] }).success);
  }
  assert(
    !readResultSchema.safeParse({
      ...read,
      section_status: "unsupported",
      text: null,
      ranges: [],
    }).success,
  );
  assert(
    !readResultSchema.safeParse({
      ...read,
      file: { ...file, version: previous },
    }).success,
  );
  assert(
    !readResultSchema.safeParse({ ...read, module_hash: "b".repeat(64) })
      .success,
  );
});
Deno.test("documents/outline-and-search#R8 T18: stored file uses fixed version and manifest-relative path not hash or current path", () => {
  assertEquals(documentFile.kind, "file");
  assertEquals(documentFile.output, {
    contentType: "application/octet-stream",
  });
  assert(documentFile.input.safeParse({ version, path: file.path }).success);
  for (
    const input of [
      { path: file.path },
      { version, path: "/current/report.md" },
      { version, path: "../report.md" },
      { version, path: file.path, hash },
      { hash },
    ]
  ) {
    assert(!documentFile.input.safeParse(input).success);
  }
});
Deno.test("documents/outline-and-search#R19 R20 T18: cropped exact-key history preserves predecessor and has no rename inference", () => {
  const side = {
    version,
    format: { ...format, future: true },
    module_hash: hash,
    body_hash: hash,
  };
  const row = {
    section: "key",
    version,
    before: { ...side, version: previous },
    after: side,
    status: "unchanged",
    title: "Key",
  };
  const page = {
    ...meta,
    document: doc,
    section: "key",
    entries: [row],
    omissions: [],
  };
  assert(sectionHistoryPageSchema.safeParse(page).success);
  assert(
    !sectionHistoryPageSchema.safeParse({
      ...page,
      entries: [{ ...row, status: "modified" }],
    }).success,
  );
  assert(
    sectionHistoryPageSchema.safeParse({
      ...page,
      entries: [{
        ...row,
        status: "modified",
        after: { ...side, body_hash: "b".repeat(64) },
      }],
    }).success,
  );
  assert(
    !sectionHistoryPageSchema.safeParse({
      ...page,
      entries: [{
        ...row,
        before: {
          ...row.before,
          module_hash: "b".repeat(64),
          format: { ...format, module_hash: "b".repeat(64) },
        },
      }],
    }).success,
  );
  assert(
    !sectionHistoryPageSchema.safeParse({
      ...page,
      entries: [{ ...row, section: "renamed" }],
    }).success,
  );
  assert(
    !sectionHistoryPageSchema.safeParse({
      ...page,
      entries: [{ ...row, status: "renamed" }],
    }).success,
  );
  assert(
    !sectionHistoryPageSchema.safeParse({
      ...page,
      entries: [{ ...row, before: null }],
    }).success,
  );
  assert(
    sectionHistoryPageSchema.safeParse({
      ...page,
      entries: [{ ...row, before: null, status: "added" }],
    }).success,
  );
  assert(
    sectionHistoryPageSchema.safeParse({
      ...page,
      entries: [{
        ...row,
        status: "missing",
        after: { ...side, body_hash: null },
        title: null,
      }],
    }).success,
  );
  assert(
    !sectionHistoryPageSchema.safeParse({
      ...page,
      entries: [{ ...row, after: { ...side, version: previous } }],
    }).success,
  );
  assert(
    documentSectionHistory.input.safeParse({
      document: doc,
      section: "key",
      from: version,
    }).success,
  );
});
Deno.test("documents/outline-and-search#R21 T18: line diff is bounded worker output with explicit restoration omissions", () => {
  const side = { version, format, module_hash: hash };
  const page = {
    ...meta,
    document: doc,
    before: { ...side, version: previous },
    after: side,
    section: null,
    additions: [{ range, text: "added" }],
    deletions: [],
    omissions: [{
      version: previous,
      section: null,
      ranges: [range],
      reason: "blob missing",
    }],
  };
  assertEquals(documentDiff.kind, "worker");
  assert(diffPageSchema.safeParse(page).success);
  assert(!diffPageSchema.safeParse({ ...page, complete: false }).success);
  assert(
    diffPageSchema.safeParse({
      ...page,
      complete: false,
      next_cursor: "change-block",
    }).success,
  );
  assert(
    !diffPageSchema.safeParse({
      ...page,
      omissions: [{ ...page.omissions[0], reason: "" }],
    }).success,
  );
  assert(
    !diffPageSchema.safeParse({
      ...page,
      additions: [{ range, text: "가".repeat(90000) }],
    }).success,
  );
});
Deno.test("documents/outline-and-search#R19 T18: fixed version history reuses additive version output", () => {
  const page = {
    ...meta,
    document: doc,
    versions: [{
      ...versionRecord,
      format: { ...format, future: 1 },
      files: [{ ...file, future: 1 }],
      future: true,
    }],
  };
  assertEquals(documentHistory.kind, "read");
  assert(documentHistory.output.safeParse(page).success);
  assert(
    !documentHistory.input.safeParse({ document: doc, from: "latest" }).success,
  );
});
