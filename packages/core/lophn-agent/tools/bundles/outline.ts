import { ok } from "../../../../base/mod.ts";
import {
  outlineDelete,
  outlineGet,
  outlineSet,
} from "../../../../protocol/projects/mod.ts";
import { commandOf, readOf } from "../../run-loop/core-call.ts";
import { checkVisible } from "../context/visible.ts";
import type { ToolInput } from "../domain/input.ts";
import { fitted, invalid, notFound } from "../domain/result.ts";
import type { ToolDefinition } from "../registry.ts";
import { defineBuiltin } from "./common.ts";

// pdf와 docs 파일의 목차를 읽고 쓴다. md 목차는 파일에서 바로 읽으므로 여기 없다.
// 저장은 contexts의 route가 한다. 원본이 바뀐 것은 감지하지 않는다.
export const OUTLINE_TOOLS: readonly ToolDefinition[] = [
  defineBuiltin({
    name: "outline.get",
    description:
      "Read the stored outline of a pdf or docs file of a context (level, title, locator per entry). Returns null when none is stored.",
    effect: "read",
    handler: async (input, ctx) => {
      const { context, path } = input as ToolInput<"outline.get">;
      const seen = await checkVisible(ctx, context);
      if (!seen.ok) return seen;
      const read = await readOf(ctx.core, outlineGet, { context, path });
      if (!read.ok) return read;
      const { outline } = read.value;
      return ok(fitted(
        outline === null
          ? `no outline of ${path}`
          : `outline of ${path}, ${outline.entries.length} entries`,
        { outline },
        ["outline"],
      ));
    },
  }),
  defineBuiltin({
    name: "outline.set",
    description:
      "Replace the whole outline of a pdf or docs file of a context with the given entries (level 1-6, title, locator).",
    effect: "write",
    handler: async (input, ctx) => {
      const { context, path, outline } = input as ToolInput<"outline.set">;
      const lower = path.toLowerCase();
      if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
        return invalid("a markdown outline is read from the file");
      }
      const format = lower.endsWith(".pdf") ? "pdf" : "docs";
      const current = await readOf(ctx.core, outlineGet, { context, path });
      if (!current.ok) return current;
      const base = current.value.outline;
      const done = await commandOf(
        ctx.core,
        outlineSet,
        { context, path, format, entries: outline },
        base === null ? {} : { base_revision: base.revision },
        ctx.tool_call,
      );
      if (!done.ok) return done;
      return ok(fitted(`set the outline of ${path}`, {
        path,
        entries: done.value.entries.length,
      }));
    },
  }),
  defineBuiltin({
    name: "outline.delete",
    description: "Delete the stored outline of a file of a context.",
    effect: "write",
    handler: async (input, ctx) => {
      const { context, path } = input as ToolInput<"outline.delete">;
      const current = await readOf(ctx.core, outlineGet, { context, path });
      if (!current.ok) return current;
      const base = current.value.outline;
      if (base === null) return notFound("no outline stored");
      const done = await commandOf(
        ctx.core,
        outlineDelete,
        { context, path },
        { base_revision: base.revision },
        ctx.tool_call,
      );
      if (!done.ok) return done;
      return ok(fitted(`deleted the outline of ${path}`, { path }));
    },
  }),
];
