import { z } from "zod";
import { ok, type Result } from "../../../base/mod.ts";
import { domainIdSchema } from "../../../protocol/domains/mod.ts";
import type { ToolResult } from "../../../protocol/lophn-agent/mod.ts";
import {
  kindCheck,
  kindCheckQuerySchema,
  conditionSchema,
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
function domainOf(given: string | undefined, ctx: ToolContext): Result<string> {
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
const listInput = z.strictObject({
  ...domainInput,
  ...kindListQuerySchema.shape,
});
const nestedCondition = conditionSchema.options[1].shape.not.unwrap();
// 같은 조건 tree를 세 번씩 펼치면 schema가 커진다. model에는 한 층과 재귀 모양만 알리고 실행은 listInput으로 검사한다.
const listInputSchema = z.toJSONSchema(listInput, {
  override({ zodSchema, jsonSchema }) {
    if (zodSchema !== nestedCondition) return;
    for (const key of Object.keys(jsonSchema)) delete jsonSchema[key];
    Object.assign(jsonSchema, {
      type: "object",
      description:
        "A condition in the same leaf or all/any/not form as where. The whole where tree has at most 3 levels and 20 terms per group.",
    });
  },
});
delete listInputSchema.$schema;

export const KIND_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "kind.list",
    input: listInput,
    inputSchema: listInputSchema,
    routes: [kindList],
    description:
      "Query or aggregate documents of one kind in your domains; omit domain when you have one. Kind names and fields are in your prompt. " +
      "where accepts a leaf {field, op, value} or nested all/any/not groups (up to 3 levels); exists omits value, other ops require it. " +
      "limit defaults to 50; pass next_cursor as cursor for another page. aggregate/group_by cannot combine with sort, fields, limit or cursor. " +
      "Invalid documents are counted in skipped; use kind.check for details. Query related kinds separately using the returned keys.",
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
      const skipped =
        value.skipped.count > 0 ? ` (${value.skipped.count} skipped)` : "";
      const more =
        value.mode === "items" && value.next_cursor !== null
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
      "Check kinds.yaml and documents in one of your domains. Omit domain when you have one; kind filters violations, limit/cursor page them.",
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
      const more =
        value.next_cursor !== null ? " (more exist; pass next_cursor)" : "";
      return ok(
        fitted(
          `kinds ${value.status.state}, ${value.total} violations${more}`,
          value,
          ["violations"],
        ),
      );
    },
  }),
];
