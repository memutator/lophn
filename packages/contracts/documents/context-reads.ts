import { z } from "zod";
import { versionIdSchema } from "./values.ts";
import {
  nonblankSchema,
  publicPage,
  publicRead,
  readCursorSchema,
  sectionStatusSchema,
} from "./read-values.ts";
import {
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

export const contextReadSchemas = {
  list: contextListOutputSchema,
  get: contextGetOutputSchema,
  related: contextRelatedOutputSchema,
  export: contextExportOutputSchema,
};
