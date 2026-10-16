import { resolve } from "node:path";
import { ok } from "../../../../base/mod.ts";
import {
  appConnectSource,
  appCreate,
  appGet,
  appList,
  blueprintCheck,
} from "../../../../protocol/apps/mod.ts";
import { problemList } from "../../../../protocol/problems/mod.ts";
import { commandOf, readOf } from "../../run-loop/core-call.ts";
import type { ToolDefinition } from "../registry.ts";
import type { ToolInput } from "../domain/input.ts";
import { countSummary, fitted, readBody } from "../domain/result.ts";
import { defineBuiltin } from "./common.ts";

const SLUG_MAX = 63;

// 앱 이름에서 slug를 만든다. 영문 숫자가 하나도 없는 이름(한글 등)이면 tool call ID로 정한다.
function slugOf(name: string, fallback: string): string {
  const slug = name.toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
  return slug === "" ? `app-${fallback}` : slug;
}

export const APP_TOOLS: readonly ToolDefinition[] = [
  defineBuiltin({
    name: "app.list",
    description: "List the registered apps.",
    effect: "read",
    handler: async (_input, ctx) => {
      const read = await readOf(ctx.core, appList, {});
      if (!read.ok) return read;
      const { body, more } = readBody(read.value);
      return ok(fitted(
        countSummary("apps", body.apps.length, more),
        body,
        ["apps"],
      ));
    },
  }),
  defineBuiltin({
    name: "app.get",
    description:
      "Read an app: name, description, status, active release, source folder and the number of open problems.",
    effect: "read",
    handler: async (input, ctx) => {
      const { app } = input as ToolInput<"app.get">;
      const read = await readOf(ctx.core, appGet, { app });
      if (!read.ok) return read;
      const open = await readOf(ctx.core, problemList, {
        app,
        state: "open",
        limit: 100,
      });
      if (!open.ok) return open;
      const count = open.value.problems.length;
      return ok(fitted(`app ${read.value.app.name}`, {
        app: read.value.app,
        open_problems: count,
        // 목록 한 page(100)까지만 센다.
        open_problems_capped: open.value.next_cursor !== null,
      }));
    },
  }),
  defineBuiltin({
    name: "app.create",
    description:
      "Register a new app with a name and a one line purpose. The app gets its own App Engineer.",
    effect: "write",
    handler: async (input, ctx) => {
      const { name, purpose } = input as ToolInput<"app.create">;
      const made = await commandOf(
        ctx.core,
        appCreate,
        {
          slug: slugOf(name, ctx.tool_call.slice(-8).toLowerCase()),
          name,
          description: purpose.trim().replace(/\s*[\r\n]+\s*/g, " "),
        },
        {},
        ctx.tool_call,
      );
      if (!made.ok) return made;
      return ok(fitted(`registered app ${made.value.id}`, made.value));
    },
  }),
  defineBuiltin({
    name: "app.link_source",
    description:
      "Connect a git folder as the source of an app. A relative path starts at the place's first folder.",
    effect: "write",
    handler: async (input, ctx) => {
      const { app, path } = input as ToolInput<"app.link_source">;
      const read = await readOf(ctx.core, appGet, { app });
      if (!read.ok) return read;
      const base = ctx.scope.read[0];
      const linked = await commandOf(
        ctx.core,
        appConnectSource,
        {
          app,
          source_path: base === undefined ? path : resolve(base, path),
        },
        { base_revision: read.value.app.revision },
        ctx.tool_call,
      );
      if (!linked.ok) return linked;
      return ok(fitted(`linked the source of app ${app}`, linked.value));
    },
  }),
  defineBuiltin({
    name: "blueprint.check",
    description:
      "Check the blueprint of an app and return errors, warnings and the permission review separately. Edit the blueprint file with the file tools.",
    effect: "read",
    handler: async (input, ctx) => {
      const { app } = input as ToolInput<"blueprint.check">;
      const checked = await readOf(ctx.core, blueprintCheck, { app });
      if (!checked.ok) return checked;
      const { errors, warnings, permission_review } = checked.value;
      return ok(fitted(
        errors.length === 0
          ? `blueprint of app ${app} has no errors`
          : `blueprint of app ${app} has ${errors.length} errors`,
        { errors, warnings, permission_review },
      ));
    },
  }),
];
