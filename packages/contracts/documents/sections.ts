import { z } from "zod";
import { sha256Schema } from "../platform/mod.ts";
import { sectionKeySchema, versionNumberSchema } from "./values.ts";

const lineRangeFields = {
  start_line: versionNumberSchema,
  end_line: versionNumberSchema,
};
export const lineRangeSchema = z.strictObject(lineRangeFields).refine(
  (value) => value.end_line >= value.start_line,
  { message: "invalid inclusive line range" },
);
export const lineRangeOutputSchema = z.object(lineRangeFields).refine(
  (value) => value.end_line >= value.start_line,
);
export type LineRange = z.infer<typeof lineRangeSchema>;

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const sectionFields = {
  key: sectionKeySchema,
  title: z.string(),
  parent: sectionKeySchema.nullable(),
  position: count,
  level: z.number().int().min(0).max(6),
  anchor: z.string().min(1).nullable(),
  characters: count,
  body_hash: sha256Schema,
};

function validRanges(value: {
  key: string;
  level: number;
  own_ranges: LineRange[];
  subtree_range: LineRange;
}): boolean {
  return (value.key === "_preamble" ? value.level === 0 : value.level >= 1) &&
    value.own_ranges.every((range, index) =>
      range.start_line >= value.subtree_range.start_line &&
      range.end_line <= value.subtree_range.end_line &&
      (index === 0 ||
        value.own_ranges[index - 1].end_line < range.start_line)
    );
}

export const extractedSectionInputSchema = z.strictObject({
  ...sectionFields,
  own_ranges: z.array(lineRangeSchema),
  subtree_range: lineRangeSchema,
}).refine(validRanges, { message: "invalid section level or own ranges" });
export const extractedSectionSchema = z.object({
  ...sectionFields,
  own_ranges: z.array(lineRangeOutputSchema),
  subtree_range: lineRangeOutputSchema,
}).refine(validRanges, { message: "invalid section level or own ranges" });
export type ExtractedSection = z.infer<typeof extractedSectionSchema>;
