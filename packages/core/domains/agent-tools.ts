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

// agent의 그릇은 입력으로 받지 않고 place에서 정한다. session의 place가 그릇이다.
// place가 없는 home session은 그릇이 없다.
function ownerOf(ctx: ToolContext): DomainOwner | null {
  const place: { kind: string; id: string } | null = ctx.place;
  if (place === null) return null;
  return place.kind === "project" || place.kind === "app"
    ? ({ kind: place.kind, id: place.id } as DomainOwner)
    : null;
}

export const DOMAIN_AGENT_TOOLS: readonly ToolDefinition[] = [
  // 목록과 상세는 같은 읽기 범위다(agent 자격의 `domain.list`·`domain.get` route). 지정한 domain이 없거나 그릇 밖이면
  // 그 route의 오류이고 목록으로 바꾸지 않는다.
  defineTool({
    name: "domain.read",
    input: z.strictObject({ domain: domainIdSchema.optional() }),
    routes: [domainList, domainGet],
    description:
      "List the domains of the project or app you work in (all domains if you have no place), or read one domain (name, title, purpose, owner and status) when you give its ID.",
    effect: "read",
    handler: async (input, ctx) => {
      if (input.domain !== undefined) {
        const read = await readOf(ctx.core, domainGet, {
          domain: input.domain,
        });
        if (!read.ok) return read;
        return ok(
          fitted(`domain ${read.value.domain.name}`, {
            domain: read.value.domain,
          }),
        );
      }
      const owner = ownerOf(ctx);
      const read = await readOf(ctx.core, domainList, {
        ...(owner === null ? {} : { owner }),
      });
      if (!read.ok) return read;
      const { body, more } = readBody(read.value);
      return ok(
        fitted(countSummary("domains", body.domains.length, more), body, [
          "domains",
        ]),
      );
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
