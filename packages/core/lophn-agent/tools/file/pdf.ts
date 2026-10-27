import { readFile, stat } from "node:fs/promises";
import { ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import { continuation } from "../bundles/paging.ts";
import { fitJson } from "../result.ts";
import type { ToolContext } from "../tool-context.ts";
import { fail, fsFail, resolveInPlace } from "./scope.ts";

const MAX_PAGES = 20;
const MAX_PAGE_CHARS = 6000;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

// unpdf(MIT, pdf.js 기반). 쓸 때만 불러온다.
type Unpdf = {
  getDocumentProxy(data: Uint8Array): Promise<unknown>;
  extractText(
    pdf: unknown,
    options: { mergePages: false },
  ): Promise<{ totalPages: number; text: string[] }>;
};
const UNPDF = "unpdf";

export async function readPdf(
  input: { path: string; pages: string },
  ctx: ToolContext,
): Promise<Result<ToolResult>> {
  const [first, last] = input.pages.split("-").map(Number) as [number, number?];
  const from = first;
  if (from < 1 || (last !== undefined && last < from)) {
    return fail("invalid_input", "pages must look like 3 or 1-5");
  }
  const at = await resolveInPlace(ctx.scope, input.path, "read");
  if (!at.ok) return at;
  let bytes: Uint8Array;
  try {
    const info = await stat(at.value.path);
    if (!info.isFile()) return fail("invalid_input", "not a file");
    if (info.size > MAX_FILE_BYTES) {
      return fail("invalid_input", "pdf is too large");
    }
    bytes = await readFile(at.value.path);
  } catch (error) {
    return fsFail(error);
  }
  // pdf.js가 넘긴 buffer를 가져가 길이가 0이 된다.
  const size = bytes.length;
  let all: { totalPages: number; text: string[] };
  try {
    const lib = (await import(UNPDF)) as Unpdf;
    all = await lib.extractText(await lib.getDocumentProxy(bytes), {
      mergePages: false,
    });
  } catch {
    return fail("invalid_input", "cannot read this pdf");
  }
  if (from > all.totalPages) {
    return fail("invalid_input", `pdf has ${all.totalPages} pages`);
  }
  const to = Math.min(last ?? from, all.totalPages, from + MAX_PAGES - 1);
  const pages = all.text.slice(from - 1, to).map((text, index) => ({
    page: from + index,
    text: text.slice(0, MAX_PAGE_CHARS),
    ...(text.length > MAX_PAGE_CHARS ? { truncated: true } : {}),
  }));
  const fitted = fitJson({ total_pages: all.totalPages, pages }, ["pages"]);
  const kept =
    fitted.content === null
      ? 0
      : (fitted.content as { pages: unknown[] }).pages.length;
  const end = from + kept - 1;
  const wanted = Math.min(last ?? from, all.totalPages);
  return ok({
    status: "success",
    summary: `read ${input.path} pages ${from}-${end}`,
    content: fitted.content as ToolResult["content"],
    complete: end >= wanted,
    source: {
      target: input.path,
      version: null,
      range: `pages ${from}-${end}`,
      original_bytes: size,
      original_lines: null,
      omitted_count: null,
    },
    continuation: continuation(
      end < wanted ? `pages=${end + 1}-${wanted}` : null,
    ),
    pending: [],
  });
}
