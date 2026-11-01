import { resolve } from "node:path";
import { ok } from "../../../base/mod.ts";
import {
  appConnectSource,
  appCreate,
  appGet,
  appList,
  appSlugOf,
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

export const APP_TOOLS: readonly ToolDefinition[] = [
  // 목록과 상세는 같은 읽기 범위다(둘 다 agent 자격의 `app.list`·`app.get` route). 지정한 앱이 없거나 범위 밖이면
  // 그 route의 오류이고 목록으로 바꾸지 않는다.
  defineTool({
    name: "app.read",
    input: z.strictObject({ app: idSchema("app").optional() }),
    routes: [appList, appGet],
    description:
      "List the registered apps, or read one app (name, description, status, active release and source folder) when you give its ID.",
    effect: "read",
    handler: async (input, ctx) => {
      if (input.app !== undefined) {
        const read = await readOf(ctx.core, appGet, { app: input.app });
        if (!read.ok) return read;
        return ok(
          fitted(`app ${read.value.app.name}`, { app: read.value.app }),
        );
      }
      const read = await readOf(ctx.core, appList, {});
      if (!read.ok) return read;
      const { body, more } = readBody(read.value);
      return ok(
        fitted(countSummary("apps", body.apps.length, more), body, ["apps"]),
      );
    },
  }),
  defineTool({
    name: "app.tools",
    input: z.strictObject({ app: idSchema("app").optional() }),
    routes: [appToolIndex, domainList],
    description:
      "List the apps with their commands, or read one app: name, description, effect and public of the active release's commands (and inputSchema when you give an app). Commands of other domains show only when public. An app's operations (what its screens call) are not listed. Use it to see what apps already do and to get exact command names for `app_connections` in the app's declaration.",
    effect: "read",
    handler: async (input, ctx) => {
      const read = await readOf(ctx.core, appToolIndex, input);
      if (!read.ok) return read;
      // 다른 domain의 비공개 command는 뺀다. 부른 agent가 맡은 domain은 `ctx.domains`다(그릇의 active domain id
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
            return (
              tool.public || (id !== undefined && ctx.domains.includes(id))
            );
          }),
        });
      }
      const { body } = readBody({ ...read.value, apps });
      return ok(
        fitted(countSummary("apps", body.apps.length, false), body, ["apps"]),
      );
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
      "Register a new app with a name and a one line purpose. An app of that name gets its first domain. Work on the app is done in a conversation at the app's place. A git repository started from the app template becomes the source folder of the app. If source_path in the result is null, the folder could not be made: connect a git folder with app.link_source.",
    effect: "write",
    handler: async (input, ctx) => {
      const { name, purpose } = input;
      const made = await commandOf(
        ctx.core,
        appCreate,
        {
          slug: appSlugOf(name, ctx.tool_call.slice(-8).toLowerCase()),
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
      "Check the declaration of an app and return errors, warnings and the permission review separately. The declaration is `lophn.ts` in the app's source, sealed with each release; edit it with the file tools.",
    effect: "read",
    handler: async (input, ctx) => {
      const { app } = input;
      const checked = await readOf(ctx.core, declarationCheck, { app });
      if (!checked.ok) return checked;
      const { errors, warnings, permission_review } = checked.value;
      return ok(
        fitted(
          errors.length === 0
            ? `declaration of app ${app} has no errors`
            : `declaration of app ${app} has ${errors.length} errors`,
          { errors, warnings, permission_review },
        ),
      );
    },
  }),
];
