import { assert, assertEquals } from "@std/assert";
import { declaration, hash, other, section } from "./format-fixtures_test.ts";
import {
  DATA_MEDIA_TYPE,
  FORMAT_CALL_TIMEOUT_MS,
  FORMAT_GUEST_MEMORY_BYTES,
  FORMAT_INPUT_MAX_BYTES,
  FORMAT_OUTPUT_MAX_BYTES,
  FORMAT_PUBLIC_JSON_MAX_BYTES,
  FORMAT_TEXT_PAGE_MAX_CODEPOINTS,
  formatExtract,
  formatExtractionPageSchema,
  formatValidate,
  formatValidationPageSchema,
} from "./formats.ts";
import {
  DATA_MEDIA_TYPE as publicData,
  DOCUMENT_MEDIA_TYPES as publicDocumentTypes,
  type FormatDeclaration,
  formatExtract as publicExtract,
  type FormatExtractionPage,
  type SectionExtractionResult,
} from "./mod.ts";

Deno.test("documents/formats#R4: explicit validation keeps error diagnostics without a version", () => {
  const diagnostic = {
    severity: "error" as const,
    code: "heading",
    message: "duplicate anchor",
    file: "report.md",
    start_line: 2,
    end_line: 2,
    column: 1,
  };
  const page = {
    input_hash: hash,
    module_hash: hash,
    status: "failed" as const,
    error_count: 4,
    warning_count: 1,
    diagnostics_offset: 0,
    diagnostics: [diagnostic],
    complete: false,
    next_cursor: "page-2",
  };
  assert(formatValidationPageSchema.safeParse(page).success);
  assert(
    !formatValidationPageSchema.safeParse({
      ...page,
      status: "passed",
    }).success,
  );
  assert(
    !formatValidationPageSchema.safeParse({
      ...page,
      complete: true,
      next_cursor: "page-2",
    }).success,
  );
  assert(formatValidate.errors.includes("invalid_input"));
  assert(formatValidate.errors.includes("unavailable"));
  assertEquals(formatValidate.kind, "worker");
});

Deno.test("documents/formats#R8: public JSON over 256KiB is unavailable to the schema", () => {
  const huge = {
    input_hash: hash,
    module_hash: hash,
    status: "failed" as const,
    error_count: 1,
    warning_count: 0,
    diagnostics_offset: 0,
    diagnostics: [{
      severity: "error" as const,
      code: "too-big",
      message: "x".repeat(FORMAT_PUBLIC_JSON_MAX_BYTES),
      file: null,
      start_line: null,
      end_line: null,
      column: null,
    }],
    complete: true,
    next_cursor: null,
  };
  assert(!formatValidationPageSchema.safeParse(huge).success);
  const value: FormatDeclaration = declaration;
  const page: FormatExtractionPage = {
    input_hash: hash,
    module_hash: hash,
    status: "unsupported",
    title: null,
    text_hash: null,
    total_text_characters: null,
    total_sections: 0,
    text_offset: 0,
    text: "",
    section_offset: 0,
    sections: [],
    failure_reason: null,
    complete: true,
    next_cursor: null,
  };
  const result: SectionExtractionResult = {
    input_hash: hash,
    module_hash: hash,
    status: "unsupported",
    title: null,
    sections: [],
  };
  assertEquals(publicExtract.name, "format.extract");
  assertEquals(publicDocumentTypes.length, 5);
  assertEquals(publicData, DATA_MEDIA_TYPE);
  assertEquals(value.extracts, true);
  assertEquals(page.status, "unsupported");
  assertEquals(result.status, "unsupported");
});

Deno.test("documents/formats#R20: missing, failed and unsupported extraction stay distinct", () => {
  assert(formatExtract.errors.includes("unavailable"));
  assert(formatExtract.errors.includes("conflict"));
  const page = {
    input_hash: hash,
    module_hash: other,
    status: "ready" as const,
    title: "Title",
    text_hash: other,
    total_text_characters: 4,
    total_sections: 1,
    text_offset: 0,
    text: "body",
    section_offset: 0,
    sections: [section],
    failure_reason: null,
    complete: true,
    next_cursor: null,
  };
  assert(formatExtractionPageSchema.safeParse(page).success);
  assert(
    !formatExtractionPageSchema.safeParse({
      ...page,
      text: "x".repeat(FORMAT_TEXT_PAGE_MAX_CODEPOINTS + 1),
      total_text_characters: FORMAT_TEXT_PAGE_MAX_CODEPOINTS + 1,
    }).success,
  );
  assertEquals(FORMAT_GUEST_MEMORY_BYTES, 64 * 1024 * 1024);
  assertEquals(FORMAT_CALL_TIMEOUT_MS, 5_000);
  assertEquals(FORMAT_INPUT_MAX_BYTES, 16 * 1024 * 1024);
  assertEquals(FORMAT_OUTPUT_MAX_BYTES, 8 * 1024 * 1024);
  assertEquals(FORMAT_PUBLIC_JSON_MAX_BYTES, 256 * 1024);
});

Deno.test("documents/formats#R4: validation continuation ends at the total and rejects count contradictions", () => {
  const diagnostic = {
    severity: "error" as const,
    code: "bad",
    message: "bad",
    file: null,
    start_line: null,
    end_line: null,
    column: null,
  };
  const terminal = {
    input_hash: hash,
    module_hash: hash,
    status: "failed",
    error_count: 1,
    warning_count: 0,
    diagnostics_offset: 0,
    diagnostics: [diagnostic],
    complete: true,
    next_cursor: null,
  };
  assert(formatValidationPageSchema.safeParse(terminal).success);
  for (
    const value of [
      { ...terminal, complete: false, next_cursor: "more" },
      { ...terminal, diagnostics_offset: 1 },
      { ...terminal, diagnostics: [{ ...diagnostic, severity: "warning" }] },
      { ...terminal, diagnostics: [] },
    ]
  ) assert(!formatValidationPageSchema.safeParse(value).success);
});

Deno.test("documents/formats#R4: a validation suffix does not have to equal the whole counts", () => {
  const diagnostic = {
    severity: "warning" as const,
    code: "style",
    message: "late",
    file: null,
    start_line: null,
    end_line: null,
    column: null,
  };
  assert(
    formatValidationPageSchema.safeParse({
      input_hash: hash,
      module_hash: hash,
      status: "failed",
      error_count: 2,
      warning_count: 3,
      diagnostics_offset: 4,
      diagnostics: [diagnostic],
      complete: true,
      next_cursor: null,
    }).success,
  );
  assert(
    !formatValidationPageSchema.safeParse({
      input_hash: hash,
      module_hash: hash,
      status: "failed",
      error_count: 1,
      warning_count: 0,
      diagnostics_offset: 0,
      diagnostics: [],
      complete: false,
      next_cursor: "more",
    }).success,
  );
});

Deno.test("documents/formats#R20: ready extraction continuation advances and ends both streams", () => {
  const page = {
    input_hash: hash,
    module_hash: hash,
    status: "ready",
    title: null,
    text_hash: other,
    total_text_characters: 4,
    total_sections: 1,
    text_offset: 0,
    text: "body",
    section_offset: 0,
    sections: [section],
    failure_reason: null,
    complete: true,
    next_cursor: null,
  };
  assert(formatExtractionPageSchema.safeParse(page).success);
  for (
    const value of [
      { ...page, total_text_characters: 5 },
      { ...page, total_sections: 2 },
      { ...page, complete: false, next_cursor: "more" },
      { ...page, text: "", sections: [], complete: false, next_cursor: "more" },
    ]
  ) assert(!formatExtractionPageSchema.safeParse(value).success);
  assert(
    formatExtractionPageSchema.safeParse({
      ...page,
      text_offset: 4,
      text: "",
      section_offset: 1,
      sections: [],
    }).success,
  );
});

Deno.test("documents/formats#R20: a non-ready extraction page is one complete empty page", () => {
  assert(
    !formatExtractionPageSchema.safeParse({
      input_hash: hash,
      module_hash: hash,
      status: "unsupported",
      title: null,
      text_hash: null,
      total_text_characters: null,
      total_sections: 1,
      text_offset: 0,
      text: "",
      section_offset: 0,
      sections: [],
      failure_reason: null,
      complete: true,
      next_cursor: null,
    }).success,
  );
  assert(
    formatExtractionPageSchema.safeParse({
      input_hash: hash,
      module_hash: hash,
      status: "failed",
      title: null,
      text_hash: null,
      total_text_characters: null,
      total_sections: 0,
      text_offset: 0,
      text: "",
      section_offset: 0,
      sections: [],
      failure_reason: "limit",
      complete: true,
      next_cursor: null,
    }).success,
  );
});
