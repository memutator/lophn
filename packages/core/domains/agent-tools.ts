import { ok } from "../../base/mod.ts";
import {
  domainCreate,
  domainGet,
  domainIdSchema,
  domainList,
  domainNameSchema,
  type DomainOwner,
} from "../../protocol/domains/mod.ts";
import {
  commandOf,
  countSummary,
  defineTool,
  fitted,
  invalid,
  readBody,
  readOf,
  type ToolContext,
  type ToolDefinition,
} from "../lophn-agent/tools/spi.ts";
import { z } from "zod";

// agent의 그릇은 입력으로 받지 않고 place에서 정한다. project place는 PM(과 Operator)의 project,
// app place는 App Engineer의 앱이다. place가 없는 lophn은 그릇이 없다.
function ownerOf(ctx: ToolContext): DomainOwner | null {
  const place: { kind: string; id: string } | null = ctx.place;
  if (place === null) return null;
  return place.kind === "project" || place.kind === "app"
    ? { kind: place.kind, id: place.id } as DomainOwner
    : null;
}

export const DOMAIN_AGENT_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "domain.list",
    input: z.strictObject({}),
    routes: [domainList],
    description:
      "List the domains of the project or app you work in (all domains if you have no place).",
    effect: "read",
    handler: async (_input, ctx) => {
      const owner = ownerOf(ctx);
      const read = await readOf(ctx.core, domainList, {
        ...(owner === null ? {} : { owner }),
      });
      if (!read.ok) return read;
      const { body, more } = readBody(read.value);
      return ok(fitted(
        countSummary("domains", body.domains.length, more),
        body,
        ["domains"],
      ));
    },
  }),
  defineTool({
    name: "domain.get",
    input: z.strictObject({ domain: domainIdSchema }),
    routes: [domainGet],
    description: "Read a domain: name, title, purpose, owner and status.",
    effect: "read",
    handler: async (input, ctx) => {
      const read = await readOf(ctx.core, domainGet, input);
      if (!read.ok) return read;
      return ok(fitted(`domain ${read.value.domain.name}`, {
        domain: read.value.domain,
      }));
    },
  }),
  defineTool({
    name: "domain.create",
    input: z.strictObject({
      name: domainNameSchema,
      title: z.string().min(1),
      purpose: z.string(),
    }),
    routes: [domainCreate],
    description:
      "Create a domain in the project or app you work in: a name (slug, unique among all domains), a title and a purpose.",
    effect: "write",
    handler: async (input, ctx) => {
      const owner = ownerOf(ctx);
      if (owner === null) {
        return invalid("domains are made in a project or app place");
      }
      const made = await commandOf(
        ctx.core,
        domainCreate,
        { ...input, owner },
        {},
        ctx.tool_call,
      );
      if (!made.ok) return made;
      return ok(fitted(`created domain ${made.value.name}`, made.value));
    },
  }),
];
