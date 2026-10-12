import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { jsonObjectSchema } from "../base/json-values.ts";
import { pointer } from "./blueprint-scope.ts";

export const SUMMARY_MAX_BYTES = 2048;

const opaqueSchema = z.string().min(1).refine(
  (value) => !/\p{Cc}/u.test(value),
  {
    message: "opaque value contains a control character",
  },
);

export const jsonPointerSchema = z.string().refine(pointer, {
  message: "expected JSON Pointer",
});

export const annotationTargetDeclarationSchema = z.strictObject({
  key: z.string().min(1),
  label: z.string().min(1),
  write_command: z.string().min(1),
});
export type AnnotationTargetDeclarationInput = z.infer<
  typeof annotationTargetDeclarationSchema
>;

export const agentContextDeclarationSchema = z.strictObject({
  screen: z.string().min(1),
  read_command: z.string().min(1),
  sensitive_paths: z.array(jsonPointerSchema).refine(
    (values) => new Set(values).size === values.length,
    { message: "duplicate sensitive path" },
  ),
  annotation_targets: z.array(annotationTargetDeclarationSchema).refine(
    (values) =>
      new Set(values.map((value) => value.key)).size === values.length,
    { message: "duplicate annotation target" },
  ),
});
export type AgentContextDeclarationInput = z.infer<
  typeof agentContextDeclarationSchema
>;

const screenContextFields = {
  screen: z.string().min(1),
  view_session: opaqueSchema,
  detail: z.boolean().default(false),
};
export const screenContextReadInputSchema = z.strictObject(screenContextFields);
export type ScreenContextReadInput = z.infer<
  typeof screenContextReadInputSchema
>;

const summarySchema = z.string().refine(
  (value) => new TextEncoder().encode(value).byteLength <= SUMMARY_MAX_BYTES,
  { message: "summary exceeds 2048 UTF-8 bytes" },
);

export const appScreenContextSchema = z.object({
  app: idSchema("app"),
  release: idSchema("rel"),
  screen: z.string().min(1),
  view_session: opaqueSchema,
  revision: opaqueSchema,
  summary: summarySchema,
  data: jsonObjectSchema.nullable().optional(),
  redacted: z.array(jsonPointerSchema),
});
export type AppScreenContext = z.infer<typeof appScreenContextSchema>;

export const annotationWriteInputSchema = z.strictObject({
  screen: z.string().min(1),
  view_session: opaqueSchema,
  expected_revision: opaqueSchema,
  target: z.string().min(1),
  text: z.string(),
});
export type AnnotationWriteInput = z.infer<typeof annotationWriteInputSchema>;
