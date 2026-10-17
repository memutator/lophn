import { readImage } from "../file/image.ts";
import { readPdf } from "../file/pdf.ts";
import { readFile } from "../file/read.ts";
import { globFiles, grepFiles } from "../file/search.ts";
import { editFile, instructionGate, writeFile } from "../file/write.ts";
import { defineTool, type ToolDefinition } from "../spi.ts";
import { z } from "zod";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});
const path = z.string().min(1);
const lineCount = z.number().int().positive();

// place 폴더 안의 file tool 일곱 개. agent runtime 안에서 돌고 Gate는 `LOPHN.md` 쓰기에만 걸린다.

export const FILE_TOOLS: readonly ToolDefinition[] = [
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
    handler: (input, ctx) => readFile(input, ctx),
  }),
  defineTool({
    name: "file.write",
    input: z.strictObject({ path, content: z.string() }),
    routes: [],
    description:
      "Write a text file in the place folder, replacing it if it exists. Missing folders are created.",
    effect: "write",
    gate: instructionGate,
    handler: (input, ctx) => writeFile(input, ctx),
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
    gate: instructionGate,
    handler: (input, ctx) => editFile(input, ctx),
  }),
  defineTool({
    name: "file.glob",
    input: z.strictObject({ pattern: nonblank, path: path.optional() }),
    routes: [],
    description:
      "List files whose path matches a glob (**, *, ?, {a,b}) under path, or the place's first folder.",
    effect: "read",
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
    handler: (input, ctx) => grepFiles(input, ctx),
  }),
  defineTool({
    name: "pdf.read",
    input: z.strictObject({ path, pages: z.string().regex(/^\d+(-\d+)?$/) }),
    routes: [],
    description:
      'Read the text of a pdf page range, for example pages "1-5". At most 20 pages per call.',
    effect: "read",
    handler: (input, ctx) => readPdf(input, ctx),
  }),
  defineTool({
    name: "image.read",
    input: z.strictObject({ path }),
    routes: [],
    description:
      "Show an image file (png, jpeg, gif, webp, up to 5 MiB) to the model. path can also be annotation:<id> to open the screenshot of an annotation.",
    effect: "read",
    handler: (input, ctx) => readImage(input, ctx),
  }),
];
