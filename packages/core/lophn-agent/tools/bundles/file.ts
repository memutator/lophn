import { defineTool } from "../define.ts";
import { readImage } from "../file/image.ts";
import { readPdf } from "../file/pdf.ts";
import { readFile } from "../file/read.ts";
import { globFiles, grepFiles } from "../file/search.ts";
import { editFile, instructionGate, writeFile } from "../file/write.ts";
import type { ToolDefinition } from "../registry.ts";
import { TOOL_INPUTS } from "../../../../protocol/lophn-agent/tool-catalog.ts";
import type { z } from "zod";

// place 폴더 안의 file tool 일곱 개. agent runtime 안에서 돌고 Gate는 `LOPHN.md` 쓰기에만 걸린다.
// 입력은 실행기가 TOOL_INPUTS로 이미 검사했다.
type Input<Name extends keyof typeof TOOL_INPUTS> = z.infer<
  (typeof TOOL_INPUTS)[Name]
>;

export const FILE_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "file.read",
    input: TOOL_INPUTS["file.read"],
    routes: [],
    description:
      "Read a UTF-8 text file in the place folder by line. Relative paths start at the place's first folder. offset is a 1-based line, limit a line count.",
    effect: "read",
    handler: (input, ctx) => readFile(input as Input<"file.read">, ctx),
  }),
  defineTool({
    name: "file.write",
    input: TOOL_INPUTS["file.write"],
    routes: [],
    description:
      "Write a text file in the place folder, replacing it if it exists. Missing folders are created.",
    effect: "write",
    gate: instructionGate,
    handler: (input, ctx) => writeFile(input as Input<"file.write">, ctx),
  }),
  defineTool({
    name: "file.edit",
    input: TOOL_INPUTS["file.edit"],
    routes: [],
    description:
      "Replace old_string with new_string in a text file. old_string must appear exactly once unless replace_all is true.",
    effect: "write",
    gate: instructionGate,
    handler: (input, ctx) => editFile(input as Input<"file.edit">, ctx),
  }),
  defineTool({
    name: "file.glob",
    input: TOOL_INPUTS["file.glob"],
    routes: [],
    description:
      "List files whose path matches a glob (**, *, ?, {a,b}) under path, or the place's first folder.",
    effect: "read",
    handler: (input, ctx) => globFiles(input as Input<"file.glob">, ctx),
  }),
  defineTool({
    name: "file.grep",
    input: TOOL_INPUTS["file.grep"],
    routes: [],
    description:
      "Search text files with a regular expression. Returns path:line:text. glob narrows the files.",
    effect: "read",
    handler: (input, ctx) => grepFiles(input as Input<"file.grep">, ctx),
  }),
  defineTool({
    name: "pdf.read",
    input: TOOL_INPUTS["pdf.read"],
    routes: [],
    description:
      'Read the text of a pdf page range, for example pages "1-5". At most 20 pages per call.',
    effect: "read",
    handler: (input, ctx) => readPdf(input as Input<"pdf.read">, ctx),
  }),
  defineTool({
    name: "image.read",
    input: TOOL_INPUTS["image.read"],
    routes: [],
    description:
      "Show an image file (png, jpeg, gif, webp, up to 5 MiB) to the model. path can also be annotation:<id> to open the screenshot of an annotation.",
    effect: "read",
    handler: (input, ctx) => readImage(input as Input<"image.read">, ctx),
  }),
];
