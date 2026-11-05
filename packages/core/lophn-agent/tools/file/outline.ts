import { readFile, stat } from "node:fs/promises";
import { errorCode, ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import { parseOutline } from "../../../../protocol/projects/outline-markdown.ts";
import { fitted } from "../fit-result.ts";
import type { ToolContext } from "../tool-context.ts";
import { fail, resolveInWorkspace } from "./scope.ts";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

// md 제목 tree. 줄 번호는 file.read의 offset·limit과 같은 1-based 줄이다.
export async function outlineFile(
  input: { path: string },
  ctx: ToolContext,
): Promise<Result<ToolResult>> {
  if (!/\.(md|markdown)$/i.test(input.path)) {
    return fail("invalid_input", "outline supports markdown files only");
  }
  const at = await resolveInWorkspace(ctx.scope, input.path, "read");
  if (!at.ok) return at;
  let text: string;
  try {
    const info = await stat(at.value.path);
    if (!info.isFile()) return fail("invalid_input", "not a file");
    if (info.size > MAX_FILE_BYTES) {
      return fail(
        "invalid_input",
        "file is too large; search it with file.grep",
      );
    }
    const bytes = await readFile(at.value.path);
    if (bytes.includes(0)) throw new Error("binary");
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return fail("not_found", "file not found");
    }
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
  return ok(
    fitted(
      `outline of ${input.path}: ${sections.length} sections, ${outline.line_count} lines`,
      { title: outline.title, line_count: outline.line_count, sections },
      ["sections"],
    ),
  );
}
