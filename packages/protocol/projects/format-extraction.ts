import { z } from "zod";
import { sha256Schema } from "../server/mod.ts";
import {
  type ExtractedSection,
  extractedSectionSchema,
  type LineRange,
} from "./sections.ts";

export const EXTRACTION_STATUSES = [
  "ready",
  "unsupported",
  "unverified",
  "failed",
] as const;

const extractionBase = {
  input_hash: sha256Schema,
  module_hash: sha256Schema,
  title: z.string().nullable(),
};

function lineCount(text: string): number {
  return text.split("\n").length;
}

function contains(outer: LineRange, inner: LineRange): boolean {
  return inner.start_line >= outer.start_line &&
    inner.end_line <= outer.end_line;
}

// key 유일, parent 존재·비순환, text 줄 안, parent subtree 포함.
// hash 계산·fixture·OS 격리는 runtime 책임이다.
export function sectionsFitResult(
  text: string,
  sections: readonly ExtractedSection[],
): boolean {
  const byKey = new Map(sections.map((section) => [section.key, section]));
  if (byKey.size !== sections.length) return false;
  if (text === "") return sections.length === 0;
  const lines = lineCount(text);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const acyclic = (key: string): boolean => {
    if (visiting.has(key)) return false;
    if (visited.has(key)) return true;
    const section = byKey.get(key);
    if (section === undefined) return false;
    visiting.add(key);
    if (section.parent !== null && !acyclic(section.parent)) return false;
    visiting.delete(key);
    visited.add(key);
    return true;
  };
  return sections.every((section) => {
    if (!acyclic(section.key)) return false;
    const parent = section.parent === null
      ? undefined
      : byKey.get(section.parent);
    if (section.parent !== null && parent === undefined) return false;
    if (
      parent !== undefined &&
      !contains(parent.subtree_range, section.subtree_range)
    ) {
      return false;
    }
    const ranges = [...section.own_ranges, section.subtree_range];
    return ranges.every((range) => range.end_line <= lines);
  });
}

export const sectionExtractionResultSchema = z.discriminatedUnion("status", [
  z.object({
    ...extractionBase,
    status: z.literal("ready"),
    text: z.string(),
    text_hash: sha256Schema,
    sections: z.array(extractedSectionSchema),
  }).refine((value) => sectionsFitResult(value.text, value.sections), {
    message: "sections do not fit the ready text",
  }),
  z.object({
    ...extractionBase,
    status: z.literal("unsupported"),
    sections: z.array(extractedSectionSchema).max(0),
  }),
  z.object({
    ...extractionBase,
    status: z.literal("unverified"),
    sections: z.array(extractedSectionSchema).max(0),
  }),
  z.object({
    ...extractionBase,
    status: z.literal("failed"),
    failure_reason: z.string().refine((value) => value.trim().length > 0),
    sections: z.array(extractedSectionSchema).max(0),
  }),
]);
export type SectionExtractionResult = z.infer<
  typeof sectionExtractionResultSchema
>;
