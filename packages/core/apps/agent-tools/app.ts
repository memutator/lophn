import { resolve } from "node:path";
import { ok } from "../../../base/mod.ts";
import {
  appConnectSource,
  appCreate,
  appGet,
  appList,
  blueprintCheck,
} from "../../../protocol/apps/mod.ts";
import { appAppApiIndex } from "../../../protocol/apps/blueprint/read.ts";
import { projectList } from "../../../protocol/projects/mod.ts";
import { problemList } from "../../../protocol/problems/mod.ts";
import {
  commandOf,
  countSummary,
  defineTool,
  fitted,
  notFound,
  readBody,
  readOf,
  type ToolDefinition,
} from "../../lophn-agent/tools/spi.ts";
import { z } from "zod";
import { idSchema } from "../../../protocol/base/ids.ts";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});
const path = z.string().min(1);
const none = z.strictObject({});

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
  defineTool({
    name: "app.list",
    input: none,
    routes: [appList],
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
  defineTool({
    name: "app.get",
    input: z.strictObject({ app: idSchema("app") }),
    routes: [appGet, problemList],
    description:
      "Read an app: name, description, status, active release, source folder and the number of open problems.",
    effect: "read",
    handler: async (input, ctx) => {
      const { app } = input;
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
  defineTool({
    name: "app.app_api",
    input: z.strictObject({ app: idSchema("app").optional() }),
    routes: [appAppApiIndex],
    description:
      "List the apps with their tools, or read one app: name, title, description, effect and public of the active release's tools (and inputSchema, plus outputSchema when declared, when you give an app). Use it to see what apps already do and to get exact tool names for blueprint app_connections.",
    effect: "read",
    handler: async (input, ctx) => {
      const read = await readOf(ctx.core, appAppApiIndex, input);
      if (!read.ok) return read;
      const { body } = readBody(read.value);
      return ok(fitted(
        countSummary("apps", body.apps.length, false),
        body,
        ["apps"],
      ));
    },
  }),
  defineTool({
    name: "app.create",
    input: z.strictObject({
      project: nonblank,
      name: nonblank,
      purpose: nonblank,
    }),
    routes: [appCreate, projectList],
    description:
      "Register a new app with a project (name or id), a name and a one line purpose. The app is bound to that project, each project has one app, and the project's Project Manager looks after it.",
    effect: "write",
    handler: async (input, ctx) => {
      const { name, purpose } = input;
      const projects = await readOf(ctx.core, projectList, {});
      if (!projects.ok) return projects;
      const found = projects.value.projects.find((item) =>
        item.id === input.project || item.name === input.project
      );
      if (found === undefined) return notFound("project not found");
      const made = await commandOf(
        ctx.core,
        appCreate,
        {
          slug: slugOf(name, ctx.tool_call.slice(-8).toLowerCase()),
          project: found.id,
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
  defineTool({
    name: "app.link_source",
    input: z.strictObject({ app: idSchema("app"), path }),
    routes: [appGet, appConnectSource],
    description:
      "Connect a git folder as the source of an app. A relative path starts at the place's first folder.",
    effect: "write",
    handler: async (input, ctx) => {
      const { app, path } = input;
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
  defineTool({
    name: "blueprint.check",
    input: z.strictObject({ app: idSchema("app") }),
    routes: [blueprintCheck],
    description:
      "Check the blueprint of an app and return errors, warnings and the permission review separately. Edit the blueprint file with the file tools.",
    effect: "read",
    handler: async (input, ctx) => {
      const { app } = input;
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
