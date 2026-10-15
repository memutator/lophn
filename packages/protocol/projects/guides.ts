import { z } from "zod";
import { sha256Schema } from "../base/values.ts";
import { relativePathSchema } from "./values.ts";

const guideReferenceFields = {
  lophn_version: z.string().refine((value) => value.trim().length > 0),
  title: z.string().refine((value) => value.trim().length > 0),
  content_hash: sha256Schema,
};
export const guideReferenceSchema = z.strictObject(guideReferenceFields);
export type GuideReference = z.infer<typeof guideReferenceSchema>;

// 안내 file 하나의 모양.
const contentFileFields = {
  path: relativePathSchema,
  blob_hash: sha256Schema,
  bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  media_type: z.string().regex(/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/),
  primary: z.boolean(),
};
export const contentFileSchema = z.strictObject(contentFileFields);
export type ContentFile = z.infer<typeof contentFileSchema>;
export const contentFilesOutputSchema = z.array(z.object(contentFileFields))
  .min(1)
  .refine((files) =>
    files.filter((f) => f.primary).length === 1 &&
    new Set(files.map((f) => f.path)).size === files.length
  );

export const bundledGuideSchema = z.object({
  ...guideReferenceFields,
  files: contentFilesOutputSchema,
});
export type BundledGuide = z.infer<typeof bundledGuideSchema>;
