import { readImage } from "../file/image.ts";
import { readPdf } from "../file/pdf.ts";
import { outlineFile } from "../file/outline.ts";
import { readFile } from "../file/read.ts";
import { globFiles, grepFiles } from "../file/search.ts";
import { editFile, writeFile } from "../file/write.ts";
import type { FileHooks } from "../ports.ts";
import { defineTool, type ToolDefinition } from "../spi.ts";
import { z } from "zod";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});
const path = z.string().min(1);
const lineCount = z.number().int().positive();

// offset이나 limit이 있을 때만 범위를 붙인다. 시작은 offset ?? 1이고 limit이 없으면 끝은 비운다.
function lineRange(input: { offset?: number; limit?: number }): string {
  if (input.offset === undefined && input.limit === undefined) return "";
  const start = input.offset ?? 1;
  return input.limit === undefined
    ? ` (${start}-)`
    : ` (${start}-${start + input.limit - 1})`;
}

// place 폴더 안의 file tool 여덟 개. agent runtime 안에서 돌고 쓰기 기록은 hook이 맡는다.

export const createFileTools = (
  hooks: FileHooks,
): readonly ToolDefinition[] => [
  defineTool({
    name: "file.read",
    input: z.strictObject({
      path,
      offset: lineCount.optional(),
      limit: lineCount.optional(),
    }),
    routes: [],
    description:
      "Read a UTF-8 text file in the place folder by line. Relative paths start at the place's first folder. offset is a 1-based line, limit a line count.",
    effect: "read",
    display: (input) => ({
      category: "read",
      title: `Read ${input.path}${lineRange(input)}`,
    }),
    handler: (input, ctx) => readFile(input, ctx),
  }),
  defineTool({
    name: "file.write",
    input: z.strictObject({ path, content: z.string() }),
    routes: [],
    description:
      "Write a text file in the place folder, replacing it if it exists. Missing folders are created.",
    effect: "write",
    handler: (input, ctx) => writeFile(input, ctx, hooks),
  }),
  defineTool({
    name: "file.edit",
    input: z.strictObject({
      path,
      old_string: z.string(),
      new_string: z.string(),
      replace_all: z.boolean().optional(),
    }),
    routes: [],
    description:
      "Replace old_string with new_string in a text file. old_string must appear exactly once unless replace_all is true.",
    effect: "write",
    handler: (input, ctx) => editFile(input, ctx, hooks),
  }),
  defineTool({
    name: "file.glob",
    input: z.strictObject({ pattern: nonblank, path: path.optional() }),
    routes: [],
    description:
      "List files whose path matches a glob (**, *, ?, {a,b}) under path, or the place's first folder.",
    effect: "read",
    display: (input) => ({ category: "list", title: `List ${input.pattern}` }),
    handler: (input, ctx) => globFiles(input, ctx),
  }),
  defineTool({
    name: "file.grep",
    input: z.strictObject({
      pattern: nonblank,
      path: path.optional(),
      glob: nonblank.optional(),
    }),
    routes: [],
    description:
      "Search text files with a regular expression. Returns path:line:text. glob narrows the files.",
    effect: "read",
    display: (input) => ({
      category: "search",
      title: `Search ${input.pattern}${
        input.path === undefined ? "" : ` in ${input.path}`
      }`,
    }),
    handler: (input, ctx) => grepFiles(input, ctx),
  }),
  defineTool({
    name: "file.outline",
    input: z.strictObject({ path }),
    routes: [],
    description:
      "Show the heading tree of a markdown file with the line range of each section. Read a section with file.read using offset and limit.",
    effect: "read",
    display: (input) => ({ category: "list", title: `Outline ${input.path}` }),
    handler: (input, ctx) => outlineFile(input, ctx),
  }),
  defineTool({
    name: "pdf.read",
    input: z.strictObject({ path, pages: z.string().regex(/^\d+(-\d+)?$/) }),
    routes: [],
    description:
      'Read the text of a pdf page range, for example pages "1-5". At most 20 pages per call.',
    effect: "read",
    display: (input) => ({
      category: "read",
      title: `Read ${input.path} (pages ${input.pages})`,
    }),
    handler: (input, ctx) => readPdf(input, ctx),
  }),
  defineTool({
    name: "image.read",
    input: z.strictObject({ path }),
    routes: [],
    description:
      "Show an image file (png, jpeg, gif, webp, up to 5 MiB) to the model. path can also be annotation:<id> to open the screenshot of an annotation, or attachment:<id> to open an image the person attached to a message.",
    effect: "read",
    display: (input) => ({ category: "read", title: `Read ${input.path}` }),
    handler: (input, ctx) => readImage(input, ctx),
  }),
];
