import { assert, assertEquals } from "@std/assert";
import { DOCUMENT_MEDIA_TYPES } from "./formats.ts";
import { hash, other, section } from "./format-fixtures_test.ts";
import { sectionExtractionResultSchema } from "./format-extraction.ts";

Deno.test("documents/formats#R10: ready extraction accepts an empty section list", () => {
  const ready = {
    input_hash: hash,
    module_hash: hash,
    status: "ready" as const,
    title: null,
    text: "plain\n",
    text_hash: other,
    sections: [],
  };
  assertEquals(sectionExtractionResultSchema.parse(ready).sections, []);
});

Deno.test("documents/formats#R11: skipped heading levels stay inside the parent subtree", () => {
  const parent = {
    ...section,
    key: "one",
    level: 1,
    subtree_range: { start_line: 1, end_line: 2 },
  };
  const child = {
    ...section,
    key: "one/three",
    parent: "one",
    level: 3,
    position: 1,
    subtree_range: { start_line: 2, end_line: 2 },
    own_ranges: [{ start_line: 2, end_line: 2 }],
  };
  assert(
    sectionExtractionResultSchema.safeParse({
      input_hash: hash,
      module_hash: hash,
      status: "ready",
      title: null,
      text: "a\nb",
      text_hash: other,
      sections: [parent, child],
    }).success,
  );
  assert(
    !sectionExtractionResultSchema.safeParse({
      input_hash: hash,
      module_hash: hash,
      status: "ready",
      title: null,
      text: "a\nb",
      text_hash: other,
      sections: [parent, {
        ...child,
        subtree_range: { start_line: 2, end_line: 4 },
        own_ranges: [],
      }],
    }).success,
  );
});

Deno.test("documents/formats#R12: preamble is level zero and a lone h1 is not required as a section", () => {
  assertEquals(section.level, 0);
  assertEquals(section.key, "_preamble");
  assert(
    !sectionExtractionResultSchema.safeParse({
      input_hash: hash,
      module_hash: hash,
      status: "ready",
      title: "Only",
      text: "Only",
      text_hash: other,
      sections: [{ ...section, key: "_preamble", level: 1 }],
    }).success,
  );
});

Deno.test("documents/formats#R13: hidden markup stays out of the extraction contract fields", () => {
  assertEquals(DOCUMENT_MEDIA_TYPES.includes("text/html"), true);
  assertEquals(DOCUMENT_MEDIA_TYPES.includes("application/xhtml+xml"), true);
  const visible = sectionExtractionResultSchema.parse({
    input_hash: hash,
    module_hash: hash,
    status: "ready",
    title: null,
    text: "visible",
    text_hash: other,
    sections: [{ ...section, key: "visible", level: 1, title: "visible" }],
  });
  assertEquals(visible.sections.map((item) => item.title), ["visible"]);
  assertEquals("script" in visible, false);
});

Deno.test("documents/formats#R14: one explicit anchor is not copied onto a second section", () => {
  const first = { ...section, key: "wrap/one", level: 2, anchor: "wrap" };
  const second = {
    ...section,
    key: "wrap/two",
    level: 2,
    anchor: null,
    position: 1,
  };
  const parsed = sectionExtractionResultSchema.parse({
    input_hash: hash,
    module_hash: hash,
    status: "ready",
    title: "From title",
    text: "one\ntwo",
    text_hash: other,
    sections: [first, second],
  });
  assertEquals(parsed.title, "From title");
  assertEquals(parsed.sections.map((item) => item.anchor), ["wrap", null]);
});

Deno.test("documents/formats#R15: section keys preserve an explicit path", () => {
  const named = {
    ...section,
    key: "a--b",
    level: 1,
    anchor: "a--b",
    title: "A & B",
  };
  assertEquals(
    sectionExtractionResultSchema.parse({
      input_hash: hash,
      module_hash: hash,
      status: "ready",
      title: null,
      text: "A & B",
      text_hash: other,
      sections: [named],
    }).sections[0].anchor,
    "a--b",
  );
});

Deno.test("documents/formats#R16: duplicate section keys are a structural failure", () => {
  assert(
    !sectionExtractionResultSchema.safeParse({
      input_hash: hash,
      module_hash: hash,
      status: "ready",
      title: null,
      text: "x",
      text_hash: other,
      sections: [section, section],
    }).success,
  );
});

Deno.test("documents/formats#R17: extracted sections keep ranges, characters and body hash", () => {
  const ready = {
    input_hash: hash,
    module_hash: hash,
    status: "ready" as const,
    title: "Title",
    text: "Title\nbody",
    text_hash: other,
    sections: [section],
  };
  assertEquals(
    sectionExtractionResultSchema.parse(ready).sections[0].body_hash,
    hash,
  );
  assert(
    !sectionExtractionResultSchema.safeParse({
      ...ready,
      sections: [{
        ...section,
        key: "missing-parent",
        parent: "gone",
        level: 1,
      }],
    }).success,
  );
  assert(
    !sectionExtractionResultSchema.safeParse({
      ...ready,
      text: "one",
      sections: [{
        ...section,
        subtree_range: { start_line: 1, end_line: 3 },
        own_ranges: [],
      }],
    }).success,
  );
});

Deno.test("documents/formats#R19: cyclic parents and overlapping ranges fail the result contract", () => {
  const child = { ...section, key: "a", parent: "b", level: 1 };
  const parent = { ...section, key: "b", parent: "a", level: 2 };
  assert(
    !sectionExtractionResultSchema.safeParse({
      input_hash: hash,
      module_hash: hash,
      status: "ready",
      title: null,
      text: "x",
      text_hash: other,
      sections: [child, parent],
    }).success,
  );
  assert(
    !sectionExtractionResultSchema.safeParse({
      input_hash: hash,
      module_hash: hash,
      status: "ready",
      title: null,
      text: "x\ny",
      text_hash: other,
      sections: [{
        ...section,
        own_ranges: [
          { start_line: 1, end_line: 2 },
          { start_line: 2, end_line: 2 },
        ],
      }],
    }).success,
  );
});

Deno.test("documents/formats#R20: failed and unverified extraction stay distinct from ready", () => {
  const base = {
    input_hash: hash,
    module_hash: hash,
    title: null,
    sections: [],
  };
  assert(
    sectionExtractionResultSchema.safeParse({
      ...base,
      status: "failed",
      failure_reason: "runner exited",
    }).success,
  );
  assert(
    !sectionExtractionResultSchema.safeParse({ ...base, status: "failed" })
      .success,
  );
  assert(
    sectionExtractionResultSchema.safeParse({
      ...base,
      status: "unverified",
    }).success,
  );
});

Deno.test("documents/formats#R10: ready empty text cannot carry a section range", () => {
  assert(
    sectionExtractionResultSchema.safeParse({
      input_hash: hash,
      module_hash: hash,
      status: "ready",
      title: null,
      text: "",
      text_hash: other,
      sections: [],
    }).success,
  );
  assert(
    !sectionExtractionResultSchema.safeParse({
      input_hash: hash,
      module_hash: hash,
      status: "ready",
      title: null,
      text: "",
      text_hash: other,
      sections: [section],
    }).success,
  );
});
