import { ok, type Result } from "../../../base/mod.ts";
import type { ToolResult } from "../../../protocol/lophn-agent/mod.ts";
import {
  kindCheck,
  kindCheckQuerySchema,
  kindList,
  kindListQuerySchema,
} from "../../../protocol/projects/mod.ts";
import {
  defineTool,
  fitted,
  invalid,
  readOf,
  type ToolContext,
  type ToolDefinition,
} from "../../lophn-agent/tools/spi.ts";

// 읽는 project는 입력으로 받지 않는다. project place에서만 쓰고, 그 place의 project를 읽는다.
function projectOf(ctx: ToolContext): Result<string> {
  if (ctx.place?.kind !== "project") {
    return invalid("kind tools work in a project place");
  }
  return ok(ctx.place.id);
}

export const KIND_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "kind.list",
    input: kindListQuerySchema,
    routes: [kindList],
    description:
      "List the documents (items) of one kind of this project, or aggregate them. Kind names and fields are in the kind text of your prompt. " +
      "where: a condition { field, op, value } with op eq, ne, in, lt, lte, gt, gte, contains or exists (exists takes no value); combine with { all: [...] }, { any: [...] } or { not: ... } (up to three levels). " +
      "sort: [{ field, dir }]; fields: the fields to return; limit (default 50, max 200); cursor: next_cursor of the previous page. " +
      "aggregate: [{ op: count|sum|min|max, field, as }] with one optional group_by field (cannot be combined with sort, fields, limit or cursor). " +
      "Documents with unreadable or mistyped values are left out and counted in skipped; read kind.check for why. " +
      "Relations are not followed: call it again with the id you got, for example list vendor, then list receipt where vendor eq that id.",
    effect: "read",
    handler: async (input, ctx) => {
      const project = projectOf(ctx);
      if (!project.ok) return project;
      const read = await readOf(ctx.core, kindList, {
        project: project.value,
        query: input,
      });
      if (!read.ok) return read;
      const value = read.value;
      const skipped = value.skipped.count > 0
        ? ` (${value.skipped.count} skipped)`
        : "";
      const more = value.mode === "items" && value.next_cursor !== null
        ? " (more exist; pass next_cursor)"
        : "";
      return ok(
        value.mode === "items"
          ? fitted(
            `${value.total} ${value.kind} items${skipped}${more}`,
            value,
            ["items"],
          )
          : fitted(
            `${value.groups.length} ${value.kind} groups${skipped}`,
            value,
            ["groups"],
          ),
      );
    },
  }),
  defineTool({
    name: "kind.check",
    input: kindCheckQuerySchema,
    routes: [kindCheck],
    description:
      "Run the format check of this project's kinds now: errors of kinds.yaml itself and the documents that break it. kind narrows to one kind; limit and cursor page the violations.",
    effect: "read",
    handler: async (input, ctx): Promise<Result<ToolResult>> => {
      const project = projectOf(ctx);
      if (!project.ok) return project;
      const read = await readOf(ctx.core, kindCheck, {
        project: project.value,
        query: input,
      });
      if (!read.ok) return read;
      const value = read.value;
      const more = value.next_cursor !== null
        ? " (more exist; pass next_cursor)"
        : "";
      return ok(fitted(
        `kinds ${value.status.state}, ${value.total} violations${more}`,
        value,
        ["violations"],
      ));
    },
  }),
];
