// `lophn kind list|check`: domain의 kind 문서를 조회·집계하고 kinds.yaml과 문서를 검사한다. 어느 domain을 읽을 수 있는지와
// domain 생략은 core route가 credential을 보고 정한다. 여기서는 route를 부르기만 한다.
import { z } from "zod";
import { ok } from "../../base/mod.ts";
import { domainIdSchema } from "../../protocol/domains/mod.ts";
import {
  kindCheck,
  kindCheckQuerySchema,
  kindList,
  kindListQuerySchema,
} from "../../protocol/projects/mod.ts";
import { defineCommand } from "./types.ts";

const domain = domainIdSchema
  .optional()
  .describe("domain ID; may be omitted when you have exactly one domain");

const list = defineCommand({
  name: "kind.list",
  summary: "Query or aggregate documents of one kind",
  description:
    "Query or aggregate documents of one kind in your domains; omit domain when you have one. Kind names and fields are in your prompt. " +
    "where accepts a leaf {field, op, value} or nested all/any/not groups (up to 3 levels; pass it with --input as JSON); exists omits value, other ops require it. " +
    "limit defaults to 50; pass next_cursor as cursor for another page. aggregate/group_by cannot combine with sort, fields, limit or cursor. " +
    "Invalid documents are counted in skipped; use kind check for details. Query related kinds separately using the returned keys.",
  input: z.strictObject({ domain, ...kindListQuerySchema.shape }),
  positional: ["kind"],
  effect: "read",
  routes: [kindList],
  places: ["project", "app"],
  run: async (input, ctx) => {
    const { domain: given, ...query } = input;
    const read = await ctx.core.read(kindList, {
      ...(given === undefined ? {} : { domain: given }),
      query,
    });
    if (!read.ok) return read;
    const value = read.value;
    const skipped =
      value.skipped.count > 0 ? ` (${value.skipped.count} skipped)` : "";
    if (value.mode === "aggregate") {
      return ok({
        summary: `${value.groups.length} ${value.kind} groups${skipped}`,
        content: value,
        arrayKeys: ["groups"],
      });
    }
    const more =
      value.next_cursor !== null ? " (more exist; pass next_cursor)" : "";
    return ok({
      summary: `${value.total} ${value.kind} items${skipped}${more}`,
      content: value,
      arrayKeys: ["items"],
    });
  },
});

const check = defineCommand({
  name: "kind.check",
  summary: "Check kinds.yaml and documents",
  description:
    "Check kinds.yaml and documents in one of your domains. Omit domain when you have one; kind filters violations, limit/cursor page them.",
  input: z.strictObject({ domain, ...kindCheckQuerySchema.shape }),
  effect: "read",
  routes: [kindCheck],
  places: ["project", "app"],
  run: async (input, ctx) => {
    const { domain: given, ...query } = input;
    const read = await ctx.core.read(kindCheck, {
      ...(given === undefined ? {} : { domain: given }),
      query,
    });
    if (!read.ok) return read;
    const value = read.value;
    const more =
      value.next_cursor !== null ? " (more exist; pass next_cursor)" : "";
    return ok({
      summary: `kinds ${value.status.state}, ${value.total} violations${more}`,
      content: value,
      arrayKeys: ["violations"],
    });
  },
});

export const KIND_COMMANDS = [list, check];
