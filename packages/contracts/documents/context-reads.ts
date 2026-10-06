import { z } from "zod";
import { revisionSchema, versionIdSchema } from "./values.ts";
import {
  nonblankSchema,
  publicPage,
  publicRead,
  readCursorSchema,
  sectionStatusSchema,
} from "./read-values.ts";
import {
  CONFIRMED_WATCH_CHANGES,
  contextPerspectiveSchema,
  contextSchema,
  contextTargetSchema,
} from "./contexts.ts";

const readFields = {
  status: z.enum(["active", "archived", "all"]).optional(),
  cursor: readCursorSchema.optional(),
  limit: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
};
export const contextListInputSchema = z.strictObject(readFields);
export const contextListOutputSchema = publicPage(z.object({
  contexts: z.array(contextSchema),
}));

export const contextGetOutputSchema = publicRead(z.object({
  context: contextSchema,
}));

const relatedFields = {
  target: contextTargetSchema,
  ...readFields,
};
export const contextRelatedInputSchema = z.strictObject(relatedFields);
export const contextRelatedOutputSchema = publicPage(z.object({
  contexts: z.array(contextSchema),
}));

const exportItemFields = {
  perspective: contextPerspectiveSchema,
  reason: nonblankSchema,
  target: contextTargetSchema,
  fixed_version: versionIdSchema.nullable(),
  section_status: sectionStatusSchema.nullable(),
};
export const contextExportItemSchema = z.object(exportItemFields).refine(
  (value) =>
    value.target.kind === "document"
      ? value.fixed_version !== null
      : value.fixed_version === null && value.section_status === null,
  { message: "export fixes a version for document items only" },
);
export const contextExportOutputSchema = publicRead(z.object({
  context: contextSchema,
  items: z.array(contextExportItemSchema),
  glossary: z.array(z.object({
    name: nonblankSchema,
    definition: nonblankSchema,
  })),
}));

// 한 context의 문서 watch 결과. changes는 기록된 확인된 변화(최근 것부터), unverified는 지금
// 비교의 의미를 말할 수 없는 대상과 그 이유다. 둘은 섞이지 않는다(contexts#R10, R11). 권한 밖
// 문서의 결과는 없는 것과 같이 빠진다.
const watchTargetSchema = contextTargetSchema.options[0];
export const contextWatchOutputSchema = publicRead(z.object({
  changes: z.array(z.object({
    target: watchTargetSchema,
    change_kind: z.enum(CONFIRMED_WATCH_CHANGES),
    before_version: versionIdSchema.nullable(),
    after_version: versionIdSchema,
    source_seq: revisionSchema,
  })),
  unverified: z.array(z.object({
    target: watchTargetSchema,
    before_version: versionIdSchema.nullable(),
    after_version: versionIdSchema,
    reason: nonblankSchema,
  })),
}));

export const contextReadSchemas = {
  list: contextListOutputSchema,
  get: contextGetOutputSchema,
  related: contextRelatedOutputSchema,
  export: contextExportOutputSchema,
  watch: contextWatchOutputSchema,
};
