import { z } from "zod";
import {
  defineRead,
  defineWorker,
  jsonObjectSchema,
  withReadCommon,
} from "../platform/mod.ts";
import { contentFilesOutputSchema } from "./versions.ts";
import { documentFilesInputSchema } from "./document-files.ts";
import { sha256Schema } from "../platform/values.ts";
import { formatDiagnosticOutputSchema } from "./versions.ts";
import { extractedSectionSchema } from "./sections.ts";
import {
  codePointLength,
  FORMAT_TEXT_PAGE_MAX_CODEPOINTS,
  publicJsonBound,
} from "./format-bounds.ts";

export {
  FORMAT_CALL_TIMEOUT_MS,
  FORMAT_CHECK_CONTENT_MAX_BYTES,
  FORMAT_GUEST_MEMORY_BYTES,
  FORMAT_INPUT_MAX_BYTES,
  FORMAT_OUTPUT_MAX_BYTES,
  FORMAT_PUBLIC_JSON_MAX_BYTES,
  FORMAT_TEXT_PAGE_MAX_CODEPOINTS,
  formatCheckLimitMessage,
  formatChecksContent,
  FORMATS_CHECKING_CONTENT,
} from "./format-bounds.ts";
export {
  EXTRACTION_STATUSES,
  type SectionExtractionResult,
  sectionExtractionResultSchema,
  sectionsFitResult,
} from "./format-extraction.ts";

export const BUILTIN_FORMAT_NAMES = [
  "document",
  "pdf",
  "image",
  "data",
] as const;
export const builtinFormatNameSchema = z.enum(BUILTIN_FORMAT_NAMES);
export type BuiltinFormatName = z.infer<typeof builtinFormatNameSchema>;

export const DOCUMENT_MEDIA_TYPES = [
  "text/markdown",
  "text/x-markdown",
  "text/html",
  "application/xhtml+xml",
  "text/plain",
] as const;
export const PDF_MEDIA_TYPE = "application/pdf";
export const IMAGE_MEDIA_TYPE = "image/*";
export const DATA_MEDIA_TYPE = "*/*";

const mediaTypeSchema = z.string().regex(
  /^[\w!#$&^.+*-]+\/[\w!#$&^.+*-]+$/,
);
const declarationFields = {
  name: builtinFormatNameSchema,
  module_hash: sha256Schema,
  media_types: z.array(mediaTypeSchema).min(1),
  structure: jsonObjectSchema,
  metadata: jsonObjectSchema,
  template: contentFilesOutputSchema,
  guide: z.object({
    text: z.string(),
    examples: z.array(z.string()),
  }),
  vocabulary: z.array(z.object({
    name: z.string().min(1),
    description: z.string(),
  })),
  extracts: z.boolean(),
};

const formatDeclarationObject = z.strictObject({
  ...declarationFields,
  media_types: z.array(mediaTypeSchema).min(1).refine(
    (types) => new Set(types).size === types.length,
    { message: "media types must be unique" },
  ),
});
export const formatDeclarationSchema = publicJsonBound(formatDeclarationObject);
export type FormatDeclaration = z.infer<typeof formatDeclarationSchema>;
const formatDeclarationOutputObject = z.object(formatDeclarationObject.shape);

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const pageCursor = {
  complete: z.boolean(),
  next_cursor: z.string().min(1).nullable(),
};
const executionIdentity = {
  input_hash: sha256Schema,
  module_hash: sha256Schema,
};

export const formatListOutputSchema = publicJsonBound(withReadCommon(z.object({
  formats: z.array(formatDeclarationOutputObject),
})));
export type FormatListOutput = z.infer<typeof formatListOutputSchema>;

export const formatGetInputSchema = z.strictObject({
  name: builtinFormatNameSchema,
  module_hash: sha256Schema,
});
export const formatGetOutputSchema = publicJsonBound(
  withReadCommon(formatDeclarationObject),
);

const executionInputFields = {
  name: builtinFormatNameSchema,
  module_hash: sha256Schema,
  files: documentFilesInputSchema,
  input_hash: sha256Schema,
  explicit: z.boolean(),
  cursor: z.string().min(1).optional(),
};
export const formatExecutionInputSchema = z.strictObject(executionInputFields);

export const formatValidationPageSchema = publicJsonBound(
  z.object({
    ...executionIdentity,
    status: z.enum(["passed", "failed"]),
    error_count: count,
    warning_count: count,
    diagnostics_offset: count,
    diagnostics: z.array(formatDiagnosticOutputSchema),
    ...pageCursor,
  }).refine((value) => {
    const total = value.error_count + value.warning_count;
    const errors = value.diagnostics.filter((item) =>
      item.severity === "error"
    ).length;
    const warnings =
      value.diagnostics.filter((item) => item.severity === "warning").length;
    const end = value.diagnostics_offset + value.diagnostics.length;
    return (value.status === "passed") === (value.error_count === 0) &&
      end <= total && errors <= value.error_count &&
      warnings <= value.warning_count &&
      (value.complete
        ? value.next_cursor === null && end === total
        : value.next_cursor !== null && end < total &&
          value.diagnostics.length >= 1);
  }, { message: "validation page does not match its totals" }),
);
export type FormatValidationPage = z.infer<typeof formatValidationPageSchema>;

export const formatExtractionPageSchema = publicJsonBound(
  z.object({
    ...executionIdentity,
    status: z.enum(["ready", "unsupported", "unverified", "failed"]),
    title: z.string().nullable(),
    text_hash: sha256Schema.nullable(),
    total_text_characters: count.nullable(),
    total_sections: count,
    text_offset: count,
    text: z.string(),
    section_offset: count,
    sections: z.array(extractedSectionSchema),
    failure_reason: z.string().refine((value) => value.trim().length > 0)
      .nullable(),
    ...pageCursor,
  }).refine((value) => {
    if (codePointLength(value.text) > FORMAT_TEXT_PAGE_MAX_CODEPOINTS) {
      return false;
    }
    if (value.status !== "ready") {
      return value.text === "" && value.sections.length === 0 &&
        value.text_hash === null && value.total_text_characters === null &&
        value.total_sections === 0 && value.text_offset === 0 &&
        value.section_offset === 0 && value.complete &&
        value.next_cursor === null &&
        (value.status === "failed"
          ? value.failure_reason !== null
          : value.failure_reason === null);
    }
    if (
      value.text_hash === null || value.total_text_characters === null ||
      value.failure_reason !== null
    ) return false;
    const textEnd = value.text_offset + codePointLength(value.text);
    const sectionEnd = value.section_offset + value.sections.length;
    if (
      textEnd > value.total_text_characters || sectionEnd > value.total_sections
    ) return false;
    const finished = textEnd === value.total_text_characters &&
      sectionEnd === value.total_sections;
    return value.complete
      ? value.next_cursor === null && finished
      : value.next_cursor !== null && !finished &&
        (value.text.length > 0 || value.sections.length > 0);
  }, { message: "extraction page does not match its status" }),
);
export type FormatExtractionPage = z.infer<typeof formatExtractionPageSchema>;

const readErrors = [
  "invalid_input",
  "not_found",
  "unauthorized",
  "forbidden",
  "unavailable",
] as const;
const workerErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "conflict",
  "unavailable",
] as const;
const actors = ["user", "coding_agent", "agent", "app", "machine"] as const;

export const formatList = defineRead({
  resource: "formats",
  method: "list",
  name: "format.list",
  input: z.strictObject({}),
  output: formatListOutputSchema,
  actors,
  errors: readErrors,
});

export const formatGet = defineRead({
  resource: "formats",
  method: "get",
  name: "format.get",
  input: formatGetInputSchema,
  output: formatGetOutputSchema,
  actors,
  errors: readErrors,
});

export const formatValidate = defineWorker({
  resource: "formats",
  method: "validate",
  name: "format.validate",
  input: formatExecutionInputSchema,
  output: formatValidationPageSchema,
  actors,
  errors: workerErrors,
});

export const formatExtract = defineWorker({
  resource: "formats",
  method: "extract",
  name: "format.extract",
  input: formatExecutionInputSchema,
  output: formatExtractionPageSchema,
  actors,
  errors: workerErrors,
});

export const FORMAT_ROUTES = [
  formatList,
  formatGet,
  formatValidate,
  formatExtract,
] as const;
