import { assert, assertEquals } from "@std/assert";
import { canonicalize, ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/mod.ts";
import { documentFilesInputSchema } from "./document-files.ts";
import { declaration, hash, input, section } from "./format-fixtures_test.ts";
import {
  BUILTIN_FORMAT_NAMES,
  DATA_MEDIA_TYPE,
  DOCUMENT_MEDIA_TYPES,
  FORMAT_ROUTES,
  formatDeclarationSchema,
  formatExecutionInputSchema,
  formatExtract,
  formatGet,
  formatList,
  formatValidate,
  IMAGE_MEDIA_TYPE,
  PDF_MEDIA_TYPE,
  sectionExtractionResultSchema,
} from "./formats.ts";
import { ROUTES } from "./mod.ts";
import {
  formatDiagnosticSchema,
  formatRefSchema,
  formatValidationResultSchema,
} from "./versions.ts";

Deno.test("documents/formats#R1: built-in format routes expose four names", () => {
  assertEquals([...BUILTIN_FORMAT_NAMES], ["document", "pdf", "image", "data"]);
  assertEquals(FORMAT_ROUTES.map(routePath), [
    "/v1/formats/list",
    "/v1/formats/get",
    "/v1/formats/validate",
    "/v1/formats/extract",
  ]);
  assertEquals(formatList.kind, "read");
  assertEquals(formatGet.kind, "read");
  assertEquals(formatValidate.kind, "worker");
  assertEquals(formatExtract.kind, "worker");
  assertEquals(
    ROUTES.filter((route) => route.resource === "formats").map(routePath),
    FORMAT_ROUTES.map(routePath),
  );
  for (const route of FORMAT_ROUTES) {
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
    assertEquals([...route.errors].sort(), [...new Set(route.errors)].sort());
  }
  assert(formatDeclarationSchema.safeParse(declaration).success);
  assert(
    !formatDeclarationSchema.safeParse({ ...declaration, template: [] })
      .success,
  );
  for (
    const template of [
      [{ ...declaration.template[0], primary: false }],
      [declaration.template[0], { ...declaration.template[0], primary: false }],
      [declaration.template[0], {
        ...declaration.template[0],
        path: "other.md",
      }],
    ]
  ) {
    assert(
      !formatDeclarationSchema.safeParse({ ...declaration, template })
        .success,
    );
  }
  assert(!formatList.output.safeParse({ formats: [declaration] }).success);
  assert(
    formatGet.output.safeParse({
      ...declaration,
      as_of_seq: "1",
      next_cursor: null,
      omitted: [{ reason: "byte_limit", count: 0 }],
    }).success,
  );
  const read = { as_of_seq: "1", next_cursor: null };
  assertEquals(
    formatList.output.parse({
      ...read,
      formats: [{ ...declaration, future: true }],
    }).formats[0].module_hash,
    hash,
  );
  assert(
    formatList.output.safeParse({
      ...read,
      formats: [
        declaration,
        {
          ...declaration,
          name: "pdf",
          media_types: [PDF_MEDIA_TYPE],
          extracts: false,
        },
        {
          ...declaration,
          name: "image",
          media_types: [IMAGE_MEDIA_TYPE],
          extracts: false,
        },
        {
          ...declaration,
          name: "data",
          media_types: [DATA_MEDIA_TYPE],
          extracts: false,
        },
      ],
    }).success,
  );
});

Deno.test("documents/formats#R8: declaration JSON keeps own keys and public bytes", () => {
  const json = JSON.parse(
    '{"__proto__":{"type":"fixed"},"nested":{"__proto__":{"required":true}},"constructor":{"prototype":false}}',
  );
  const value = { ...declaration, structure: json, metadata: json };
  const before = canonicalize(json);
  const parsed = formatDeclarationSchema.parse(value);
  assertEquals(canonicalize(parsed.structure), before);
  assertEquals(canonicalize(parsed.metadata), before);
  assertEquals(Object.getPrototypeOf(parsed.structure), Object.prototype);
  const common = { as_of_seq: "1", next_cursor: null };
  const listed = formatList.output.parse({ ...common, formats: [value] });
  const fetched = formatGet.output.parse({ ...value, ...common });
  assertEquals(canonicalize(listed.formats[0].structure), before);
  assertEquals(canonicalize(fetched.metadata), before);
  assertEquals(canonicalize(json), before);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (
    const invalid of [
      { item: undefined },
      { item: Infinity },
      { item: 1n },
      new Date(),
      cyclic,
    ]
  ) {
    assert(
      !formatDeclarationSchema.safeParse({ ...value, structure: invalid })
        .success,
    );
    assert(
      !formatList.output.safeParse({
        ...common,
        formats: [{ ...value, metadata: invalid }],
      }).success,
    );
    assert(
      !formatGet.output.safeParse({ ...value, ...common, structure: invalid })
        .success,
    );
  }
  const oversized = JSON.parse(
    `{"__proto__":"${"x".repeat(256 * 1024)}"}`,
  );
  assert(
    !formatDeclarationSchema.safeParse({ ...value, metadata: oversized })
      .success,
  );
  assert(
    !formatList.output.safeParse({
      ...common,
      formats: [{ ...value, structure: oversized }],
    }).success,
  );
  assert(
    !formatGet.output.safeParse({ ...value, ...common, metadata: oversized })
      .success,
  );
});

Deno.test("documents/formats#R2: document media types are the five text types", () => {
  assertEquals([...DOCUMENT_MEDIA_TYPES], [
    "text/markdown",
    "text/x-markdown",
    "text/html",
    "application/xhtml+xml",
    "text/plain",
  ]);
  assert(
    !formatDeclarationSchema.safeParse({
      ...declaration,
      media_types: ["text/markdown", "text/markdown"],
    }).success,
  );
});

Deno.test("documents/formats#R3: pdf image and data do not extract sections", () => {
  assertEquals(PDF_MEDIA_TYPE, "application/pdf");
  assertEquals(IMAGE_MEDIA_TYPE, "image/*");
  assertEquals(DATA_MEDIA_TYPE, "*/*");
  const unsupported = {
    input_hash: hash,
    module_hash: hash,
    status: "unsupported" as const,
    title: null,
    sections: [],
  };
  assertEquals(sectionExtractionResultSchema.parse(unsupported), unsupported);
  assert(
    !sectionExtractionResultSchema.safeParse({
      ...unsupported,
      sections: [section],
    }).success,
  );
});

Deno.test("documents/formats#R5: omitted format is not a latest-name fallback", () => {
  assert(formatExecutionInputSchema.safeParse(input).success);
  assert(
    !formatExecutionInputSchema.safeParse({ ...input, name: undefined })
      .success,
  );
  assert(
    !formatExecutionInputSchema.safeParse({
      ...input,
      module_hash: undefined,
    }).success,
  );
  assert(
    !formatExecutionInputSchema.safeParse({ ...input, extra: true }).success,
  );
  assert(documentFilesInputSchema.safeParse(input.files).success);
});

Deno.test("documents/formats#R8: declaration is data and validate does not create a version", () => {
  assert(
    !formatDeclarationSchema.safeParse({
      ...declaration,
      validate: () => undefined,
    }).success,
  );
  assertEquals(formatGet.input.parse({ name: "document", module_hash: hash }), {
    name: "document",
    module_hash: hash,
  });
  assert(!formatGet.input.safeParse({ name: "document" }).success);
  assert(
    formatValidationResultSchema.safeParse({
      input_hash: hash,
      module_hash: hash,
      status: "passed",
      diagnostics: [],
      error_count: 0,
      warning_count: 0,
    }).success,
  );
  assertEquals(formatValidate.method, "validate");
  assertEquals("version" in formatValidate, false);
  assert(
    formatRefSchema.safeParse({
      name: "document",
      module_hash: hash,
      explicit: false,
    }).success,
  );
  assert(
    formatDiagnosticSchema.safeParse({
      severity: "error",
      code: "heading",
      message: "duplicate anchor",
      file: "report.md",
      start_line: 2,
      end_line: 2,
      column: 1,
    }).success,
  );
});
