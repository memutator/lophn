import { z } from "zod";
import {
  defineFile,
  defineWorker,
  sha256Schema,
  withReadCommon,
} from "../platform/mod.ts";
import {
  documentIdSchema,
  relativePathSchema,
  sectionKeySchema,
  versionIdSchema,
} from "./values.ts";
import { formatRefOutputSchema } from "./versions.ts";
import { lineRangeOutputSchema, lineRangeSchema } from "./sections.ts";
import {
  boundedJson,
  contentFileReferenceSchema,
  cursorInputFields,
  fixedDocumentInputSchema,
  nonblankSchema,
  paginationFields,
  READ_CODEPOINT_BUDGET,
  readActors,
  readErrors,
  sectionStatusSchema,
  validPagination,
} from "./read-values.ts";
export * from "./history.ts";

export const readSelectionFields = {
  section: sectionKeySchema.nullable().default(null),
  include_children: z.boolean().default(false),
  ranges: z.array(lineRangeSchema).default([]),
  max_codepoints: z.number().int().positive().max(READ_CODEPOINT_BUDGET)
    .default(READ_CODEPOINT_BUDGET),
  ...cursorInputFields,
};
export const documentReadInputSchema = z.strictObject({
  reference: fixedDocumentInputSchema,
  ...readSelectionFields,
}).refine(
  (value) =>
    value.reference.section === null || value.section === null ||
    value.reference.section === value.section,
  { message: "section must match fixed reference" },
);
export const readResultFields = {
  section: sectionKeySchema.nullable(),
  section_status: sectionStatusSchema,
  include_children: z.boolean(),
  ranges: z.array(lineRangeOutputSchema),
  text: z.string().nullable(),
  redacted: z.boolean(),
  failure_reason: nonblankSchema.nullable(),
  omission_reason: nonblankSchema.nullable(),
  ...paginationFields,
};
// 이유는 trusted host의 safe reason이다. raw exception·guest stderr·본문을 복사하지 않는다.
export function validReadSelection(value: {
  section: string | null;
  section_status: string;
  ranges: unknown[];
  text: string | null;
  complete: boolean;
  next_cursor: string | null;
  redacted: boolean;
  failure_reason: string | null;
  omission_reason: string | null;
}): boolean {
  const terminal = value.complete && value.next_cursor === null;
  const nonready = ["missing", "unverified", "unsupported"].includes(
    value.section_status,
  );
  return (value.section_status !== "whole" || value.section === null) &&
    (!["found", "missing"].includes(value.section_status) ||
      value.section !== null) &&
    (value.section_status === "unverified"
      ? value.failure_reason !== null
      : value.failure_reason === null) &&
    (nonready
      ? value.text === null && value.ranges.length === 0 && terminal &&
        value.omission_reason === null
      : value.text === null
      ? value.redacted && value.omission_reason !== null && terminal
      : value.omission_reason === null &&
        [...value.text].length <= READ_CODEPOINT_BUDGET &&
        (value.text !== "" || value.ranges.length === 0));
}
export function validExtractionFallback(value: {
  section_status: string;
  failure_reason: string | null;
  file: unknown;
  entries: unknown[];
  complete: boolean;
  next_cursor: string | null;
}): boolean {
  const nonready = ["missing", "unverified", "unsupported"].includes(
    value.section_status,
  );
  return (value.section_status === "unverified"
    ? value.failure_reason !== null
    : value.failure_reason === null) &&
    (!["unverified", "unsupported"].includes(value.section_status) ||
      value.file !== null) &&
    (!nonready ||
      (value.entries.length === 0 && value.complete &&
        value.next_cursor === null));
}
// fallback도 원문 blob 접근 불가면 unavailable이다. 안전화 failure를 file로 우회하지 않는다.
export const readResultSchema = boundedJson(
  withReadCommon(z.object({
    document: documentIdSchema,
    version: versionIdSchema,
    latest_version: versionIdSchema,
    format: formatRefOutputSchema,
    module_hash: sha256Schema,
    ...readResultFields,
    file: contentFileReferenceSchema.nullable(),
  })).refine(validPagination).refine(validReadSelection).refine((value) =>
    value.module_hash === value.format.module_hash &&
    (value.file === null || value.file.version === value.version) &&
    (!["unverified", "unsupported"].includes(value.section_status) ||
      value.file !== null)
  ),
);
export type ReadResult = z.infer<typeof readResultSchema>;
export const documentRead = defineWorker({
  resource: "documents",
  method: "read",
  name: "document.read",
  input: documentReadInputSchema,
  output: readResultSchema,
  actors: readActors,
  errors: readErrors,
});
export const storedDocumentFileInputSchema = z.strictObject({
  version: versionIdSchema,
  path: relativePathSchema,
});
// file route는 JSON blob/hash 응답이 아니라 저장 bytes다. Content-Type metadata의
// generic fallback만 선언하며 host는 고정 ContentFile.media_type와 bytes를 응답한다.
// 현재 files/read·absolute path·현재 disk 상태로 바꾸지 않는다. redaction은 host 책임이다.
export const documentFile = defineFile({
  resource: "documents",
  method: "file",
  name: "document.file",
  input: storedDocumentFileInputSchema,
  contentType: "application/octet-stream",
  actors: readActors,
  errors: readErrors,
});
// 선택 판 직접 extraction와 본문 값 읽기는 IO/format worker에서, file은 stored bytes 통로에서 한다.
export const READ_ROUTES = [documentRead, documentFile] as const;
