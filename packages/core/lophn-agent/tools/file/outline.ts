import { ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import { parseOutline } from "../../../../protocol/projects/outline-markdown.ts";
import { fitted } from "../fit-result.ts";
import type { ToolContext } from "../tool-context.ts";
import { fail, fsFail, resolveInPlace } from "./scope.ts";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

// md 제목 tree. 줄 번호는 file.read의 offset·limit과 같은 1-based 줄이다.
export async function outlineFile(
  input: { path: string },
  ctx: ToolContext,
): Promise<Result<ToolResult>> {
  if (!/\.(md|markdown)$/i.test(input.path)) {
    return fail("invalid_input", "outline supports markdown files only");
  }
  const at = await resolveInPlace(ctx.scope, input.path, "read");
  if (!at.ok) return at;
  let text: string;
  try {
    const stat = await Deno.stat(at.value.path);
    if (!stat.isFile) return fail("invalid_input", "not a file");
    if (stat.size > MAX_FILE_BYTES) {
      return fail(
        "invalid_input",
        "file is too large; search it with file.grep",
      );
    }
    const bytes = await Deno.readFile(at.value.path);
    if (bytes.includes(0)) throw new Error("binary");
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return fsFail(error);
    return fail("invalid_input", "not a UTF-8 text file");
  }
  const outline = parseOutline("text/markdown", text);
  if (outline.status !== "ready") {
    return fail("invalid_input", "outline supports markdown files only");
  }
  const sections = outline.sections.map((s) => ({
    level: s.level,
    title: s.title,
    start_line: s.subtree_range.start_line,
    end_line: s.subtree_range.end_line,
  }));
  return ok(fitted(
    `outline of ${input.path}: ${sections.length} sections, ${outline.line_count} lines`,
    { title: outline.title, line_count: outline.line_count, sections },
    ["sections"],
  ));
}
