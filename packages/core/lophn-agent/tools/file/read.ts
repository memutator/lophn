import { ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import { openableKind } from "../../../../protocol/projects/openable-format.ts";
import { continuation } from "../bundles/paging.ts";
import { limitText, TEXT_MAX_BYTES, TEXT_MAX_LINES } from "../result.ts";
import type { ToolContext } from "../tool-context.ts";
import { fail, fsFail, resolveInPlace } from "./scope.ts";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function readFile(
  input: { path: string; offset?: number; limit?: number },
  ctx: ToolContext,
): Promise<Result<ToolResult>> {
  const at = await resolveInPlace(ctx.scope, input.path, "read");
  if (!at.ok) return at;
  let bytes: Uint8Array;
  try {
    const stat = await Deno.stat(at.value.path);
    if (!stat.isFile) return fail("invalid_input", "not a file");
    if (stat.size > MAX_FILE_BYTES) {
      return fail(
        "invalid_input",
        "file is too large; search it with file.grep",
      );
    }
    bytes = await Deno.readFile(at.value.path);
  } catch (error) {
    return fsFail(error);
  }
  let text: string;
  try {
    if (bytes.includes(0)) throw new Error("binary");
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    const kind = openableKind(at.value.path);
    return fail(
      "invalid_input",
      kind === "pdf"
        ? "not a text file; use pdf.read"
        : kind === "image"
        ? "not a text file; use image.read"
        : "not a UTF-8 text file",
    );
  }

  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const start = (input.offset ?? 1) - 1;
  if (start >= lines.length && lines.length > 0) {
    return fail("invalid_input", "offset is past the end of the file");
  }
  const wanted = Math.min(input.limit ?? TEXT_MAX_LINES, TEXT_MAX_LINES);
  const kept: string[] = [];
  let size = 0;
  for (const line of lines.slice(start, start + wanted)) {
    const cut = limitText(line, "head");
    size += new TextEncoder().encode(cut.text).length + 1;
    if (kept.length > 0 && size > TEXT_MAX_BYTES) break;
    kept.push(cut.text);
  }
  const end = start + kept.length;
  const more = end < lines.length;
  return ok({
    status: "success",
    summary: `read ${input.path} lines ${start + 1}-${end}`,
    content: {
      text: kept.join("\n"),
      start_line: start + 1,
      end_line: end,
      total_lines: lines.length,
    },
    complete: !more,
    source: {
      target: input.path,
      version: null,
      range: `lines ${start + 1}-${end}`,
      original_bytes: bytes.length,
      original_lines: lines.length,
      omitted_count: lines.length - end,
    },
    continuation: continuation(more ? `offset=${end + 1}` : null),
    pending: [],
  });
}
