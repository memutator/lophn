import { resolve } from "node:path";
import { ok } from "../../../base/mod.ts";
import {
  appConnectSource,
  appCreate,
  appGet,
  appList,
  declarationCheck,
} from "../../../protocol/apps/mod.ts";
import { appToolIndex } from "../../../protocol/apps/declaration/read.ts";
import { domainList } from "../../../protocol/domains/mod.ts";
import {
  commandOf,
  countSummary,
  defineTool,
  fitted,
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
    routes: [appGet],
    description:
      "Read an app: name, description, status, active release and source folder.",
    effect: "read",
    handler: async (input, ctx) => {
      const read = await readOf(ctx.core, appGet, { app: input.app });
      if (!read.ok) return read;
      return ok(fitted(`app ${read.value.app.name}`, { app: read.value.app }));
    },
  }),
  defineTool({
    name: "app.tools",
    input: z.strictObject({ app: idSchema("app").optional() }),
    routes: [appToolIndex, domainList],
    description:
      "List the apps with their tools, or read one app: name, title, description, effect and public of the active release's tools (and inputSchema, plus outputSchema when declared, when you give an app). Tools of other domains show only when public. Use it to see what apps already do and to get exact tool names for blueprint app_connections.",
    effect: "read",
    handler: async (input, ctx) => {
      const read = await readOf(ctx.core, appToolIndex, input);
      if (!read.ok) return read;
      // 다른 domain의 비공개 tool은 뺀다. 부른 agent가 맡은 domain은 `ctx.domains`다(그릇의 active domain id
      // 목록이 이미 풀려 있다). 앱의 domain을 읽지 못하면 그 앱은 public tool만 둔다.
      const apps = [];
      for (const entry of read.value.apps) {
        const listed = await readOf(ctx.core, domainList, {
          owner: { kind: "app", id: entry.app },
          limit: 1000,
        });
        const ids = new Map(
          listed.ok ? listed.value.domains.map((d) => [d.name, d.id]) : [],
        );
        apps.push({
          ...entry,
          tools: entry.tools.filter((tool) => {
            const id = ids.get(tool.domain);
            return tool.public ||
              (id !== undefined && ctx.domains.includes(id));
          }),
        });
      }
      const { body } = readBody({ ...read.value, apps });
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
      name: nonblank,
      purpose: nonblank,
    }),
    routes: [appCreate],
    description:
      "Register a new app with a name and a one line purpose. An app of that name gets its first domain, and its App Engineer looks after it. A git repository started from the app template becomes the source folder of the app. If source_path in the result is null, the folder could not be made: connect a git folder with app.link_source.",
    effect: "write",
    handler: async (input, ctx) => {
      const { name, purpose } = input;
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
  defineTool({
    name: "app.link_source",
    input: z.strictObject({ app: idSchema("app"), path }),
    routes: [appGet, appConnectSource],
    description:
      "Connect a git folder as the source of an app. The folder must be the top of a git repository and have at least one commit. A relative path starts at the place's first folder.",
    effect: "write",
    handler: async (input, ctx) => {
      const { app, path } = input;
      const read = await readOf(ctx.core, appGet, { app });
      if (!read.ok) return read;
      const base = ctx.scope.base ?? ctx.scope.read[0];
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
    name: "declaration.check",
    input: z.strictObject({ app: idSchema("app") }),
    routes: [declarationCheck],
    description:
      "Check the blueprint of an app and return errors, warnings and the permission review separately. Edit the blueprint file with the file tools.",
    effect: "read",
    handler: async (input, ctx) => {
      const { app } = input;
      const checked = await readOf(ctx.core, declarationCheck, { app });
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
