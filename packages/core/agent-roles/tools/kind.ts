import { z } from "zod";
import { ok, type Result } from "../../../base/mod.ts";
import { domainIdSchema } from "../../../protocol/domains/mod.ts";
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

// 읽는 domain은 이 agent의 `ctx.domains` 안이어야 한다. 하나뿐이면 생략할 수 있다. 어긋나면 core를 부르지 않는다.
function domainOf(
  given: string | undefined,
  ctx: ToolContext,
): Result<string> {
  const mine = ctx.domains;
  if (given !== undefined) {
    return mine.includes(given)
      ? ok(given)
      : invalid(`domain is not yours; pass domain: ${mine.join(", ")}`);
  }
  if (mine.length === 1) return ok(mine[0]);
  return invalid(
    mine.length === 0
      ? "you have no domain"
      : `pass domain: ${mine.join(", ")}`,
  );
}

const domainInput = { domain: domainIdSchema.optional() };

export const KIND_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "kind.list",
    input: z.strictObject({ ...domainInput, ...kindListQuerySchema.shape }),
    routes: [kindList],
    description:
      "List the documents (items) of one kind of a domain, or aggregate them. domain: the domain to read (may be left out when you have only one). Kind names and fields are in the kind text of your prompt. " +
      "where: a condition { field, op, value } with op eq, ne, in, lt, lte, gt, gte, contains or exists (exists takes no value); combine with { all: [...] }, { any: [...] } or { not: ... } (up to three levels). " +
      "sort: [{ field, dir }]; fields: the fields to return; limit (default 50, max 200); cursor: next_cursor of the previous page. " +
      "aggregate: [{ op: count|sum|min|max, field, as }] with one optional group_by field (cannot be combined with sort, fields, limit or cursor). " +
      "Documents with unreadable or mistyped values are left out and counted in skipped; read kind.check for why. " +
      "Relations are not followed: call it again with the key you got, for example list vendor, then list receipt where vendor eq that key.",
    effect: "read",
    handler: async (input, ctx) => {
      const { domain: given, ...query } = input;
      const domain = domainOf(given, ctx);
      if (!domain.ok) return domain;
      const read = await readOf(ctx.core, kindList, {
        domain: domain.value,
        query,
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
    input: z.strictObject({ ...domainInput, ...kindCheckQuerySchema.shape }),
    routes: [kindCheck],
    description:
      "Run the format check of a domain's kinds now: errors of kinds.yaml itself and the documents that break it. domain: the domain to check (may be left out when you have only one). kind narrows to one kind; limit and cursor page the violations.",
    effect: "read",
    handler: async (input, ctx): Promise<Result<ToolResult>> => {
      const { domain: given, ...query } = input;
      const domain = domainOf(given, ctx);
      if (!domain.ok) return domain;
      const read = await readOf(ctx.core, kindCheck, {
        domain: domain.value,
        query,
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
