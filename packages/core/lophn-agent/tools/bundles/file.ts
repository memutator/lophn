import { defineBuiltin } from "./common.ts";
import { readImage } from "../file/image.ts";
import { readPdf } from "../file/pdf.ts";
import { readFile } from "../file/read.ts";
import { globFiles, grepFiles } from "../file/search.ts";
import { editFile, instructionGate, writeFile } from "../file/write.ts";
import type { ToolDefinition } from "../registry.ts";
import type { TOOL_INPUTS } from "../../../../protocol/lophn-agent/tool-catalog.ts";
import type { z } from "zod";

// place 폴더 안의 file tool 일곱 개. agent runtime 안에서 돌고 Gate는 `LOPHN.md` 쓰기에만 걸린다.
// 입력은 실행기가 TOOL_INPUTS로 이미 검사했다.
type Input<Name extends keyof typeof TOOL_INPUTS> = z.infer<
  (typeof TOOL_INPUTS)[Name]
>;

export const FILE_TOOLS: readonly ToolDefinition[] = [
  defineBuiltin({
    name: "file.read",
    description:
      "Read a UTF-8 text file in the place folder by line. Relative paths start at the place's first folder. offset is a 1-based line, limit a line count.",
    effect: "read",
    handler: (input, ctx) => readFile(input as Input<"file.read">, ctx),
  }),
  defineBuiltin({
    name: "file.write",
    description:
      "Write a text file in the place folder, replacing it if it exists. Missing folders are created.",
    effect: "write",
    gate: instructionGate,
    handler: (input, ctx) => writeFile(input as Input<"file.write">, ctx),
  }),
  defineBuiltin({
    name: "file.edit",
    description:
      "Replace old_string with new_string in a text file. old_string must appear exactly once unless replace_all is true.",
    effect: "write",
    gate: instructionGate,
    handler: (input, ctx) => editFile(input as Input<"file.edit">, ctx),
  }),
  defineBuiltin({
    name: "file.glob",
    description:
      "List files whose path matches a glob (**, *, ?, {a,b}) under path, or the place's first folder.",
    effect: "read",
    handler: (input, ctx) => globFiles(input as Input<"file.glob">, ctx),
  }),
  defineBuiltin({
    name: "file.grep",
    description:
      "Search text files with a regular expression. Returns path:line:text. glob narrows the files.",
    effect: "read",
    handler: (input, ctx) => grepFiles(input as Input<"file.grep">, ctx),
  }),
  defineBuiltin({
    name: "pdf.read",
    description:
      'Read the text of a pdf page range, for example pages "1-5". At most 20 pages per call.',
    effect: "read",
    handler: (input, ctx) => readPdf(input as Input<"pdf.read">, ctx),
  }),
  defineBuiltin({
    name: "image.read",
    description:
      "Show an image file (png, jpeg, gif, webp, up to 5 MiB) to the model. path can also be annotation:<id> to open the screenshot of an annotation.",
    effect: "read",
    handler: (input, ctx) => readImage(input as Input<"image.read">, ctx),
  }),
];
