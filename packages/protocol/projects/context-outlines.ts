// pdf, docs 파일의 저장 목차. md 목차는 파일에서 바로 읽으므로 여기 없다.
import { z } from "zod";
import { defineCommand, defineRead } from "../base/route.ts";
import { ctxIdSchema, optionalBaseRevisionSchema } from "./context-api.ts";
import { CONTEXT_OUTLINE_SOURCE_FORMATS } from "./context-contract.ts";
import { publicRead } from "./read-values.ts";
import { relativePathSchema, revisionSchema } from "./values.ts";

export const contextOutlineEntrySchema = z.strictObject({
  level: z.number().int().min(1).max(6),
  title: z.string().min(1),
  locator: z.string().min(1),
});
const outlineFields = {
  path: relativePathSchema,
  format: z.enum(CONTEXT_OUTLINE_SOURCE_FORMATS),
  entries: z.array(contextOutlineEntrySchema),
};
export const contextOutlineSchema = z.strictObject(outlineFields);
export type ContextOutline = z.infer<typeof contextOutlineSchema>;

const targetFields = { context: ctxIdSchema, path: relativePathSchema };
export const contextOutlineTargetSchema = z.strictObject(targetFields);
export const contextOutlineSetInputSchema = z.strictObject({
  ...targetFields,
  format: outlineFields.format,
  entries: outlineFields.entries,
});
export const contextOutlineRecordSchema = z.object({
  context: ctxIdSchema,
  ...outlineFields,
  revision: revisionSchema,
});
export const contextOutlineDeleteOutputSchema = z.object(targetFields);

// 모든 role이 읽는다. 없으면 outline은 null이다.
export const outlineGet = defineRead({
  resource: "contexts",
  method: "outline_get",
  name: "outline.get",
  input: contextOutlineTargetSchema,
  output: publicRead(z.object({
    outline: contextOutlineRecordSchema.nullable(),
  })),
  actors: ["user", "agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});
// Project Manager만 쓴다. 파일 하나의 목차 전체가 개체 하나라 entries를 통째로 바꾼다.
export const outlineSet = defineCommand({
  resource: "contexts",
  method: "outline_set",
  name: "outline.set",
  input: contextOutlineSetInputSchema,
  output: contextOutlineRecordSchema,
  compare: optionalBaseRevisionSchema,
  actors: ["agent"],
  errors: ["invalid_input", "not_found", "conflict", "forbidden"],
});
export const outlineDelete = defineCommand({
  resource: "contexts",
  method: "outline_delete",
  name: "outline.delete",
  input: contextOutlineTargetSchema,
  output: contextOutlineDeleteOutputSchema,
  compare: optionalBaseRevisionSchema,
  actors: ["agent"],
  errors: ["not_found", "conflict", "forbidden"],
});

export const CONTEXT_OUTLINE_ROUTES = [
  outlineGet,
  outlineSet,
  outlineDelete,
] as const;
