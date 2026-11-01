// `lophn domain read|create`: domain을 읽고 만든다. "내 project나 app의 domain만", "owner를 자격에서 정하기" 같은 범위는
// core route가 credential을 보고 정한다. 여기서는 route를 부르기만 한다.
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import {
  domainCreate,
  domainGet,
  domainIdSchema,
  domainList,
  domainNameSchema,
} from "../../protocol/domains/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import { PLACE_KINDS } from "../../protocol/lophn-agent/places.ts";
import { defineCommand } from "./types.ts";

const read = defineCommand({
  name: "domain.read",
  summary: "List domains or read one",
  description:
    "List the domains of the project or app you work in (all domains if you have no place), or read one domain (name, title, purpose, owner and status) when you give its ID.",
  input: z.strictObject({ domain: domainIdSchema.optional() }),
  positional: ["domain"],
  effect: "read",
  routes: [domainList, domainGet],
  places: PLACE_KINDS,
  run: async (input, ctx) => {
    if (input.domain !== undefined) {
      const one = await ctx.core.read(domainGet, { domain: input.domain });
      if (!one.ok) return one;
      return ok({
        summary: `domain ${one.value.domain.name}`,
        content: { domain: one.value.domain },
      });
    }
    let cursor: string | undefined;
    let domains: z.output<typeof domainList.output>["domains"] = [];
    for (;;) {
      const page = await ctx.core.read(
        domainList,
        cursor === undefined ? {} : { cursor },
      );
      if (!page.ok) return page;
      domains = [...domains, ...page.value.domains];
      if (page.value.next_cursor === null) break;
      cursor = page.value.next_cursor;
    }
    return ok({
      summary: `${domains.length} domains`,
      content: { domains },
      arrayKeys: ["domains"],
    });
  },
});

const create = defineCommand({
  name: "domain.create",
  summary: "Create a domain",
  description:
    "Create a domain: a name (slug, unique among all domains), a title and a purpose. An agent creates it in the project or app it works in. A person gives --project or --app (an ID).",
  input: z.strictObject({
    name: domainNameSchema,
    title: z.string().min(1),
    purpose: z.string(),
    project: idSchema("prj").optional(),
    app: idSchema("app").optional(),
  }),
  positional: ["name"],
  effect: "write",
  routes: [domainCreate],
  places: ["project", "app"],
  run: async (input, ctx) => {
    const { project, app, ...rest } = input;
    if (project !== undefined && app !== undefined) {
      return err({
        code: "invalid_input",
        message: "give --project or --app, not both",
      });
    }
    const owner =
      project !== undefined
        ? { kind: "project", id: project }
        : app !== undefined
          ? { kind: "app", id: app }
          : undefined;
    const made = await ctx.core.command(
      domainCreate,
      owner === undefined ? rest : { ...rest, owner },
      { key: ctx.key },
    );
    if (!made.ok) return made;
    return ok({
      summary: `created domain ${made.value.name}`,
      content: made.value,
    });
  },
});

export const DOMAIN_COMMANDS = [read, create];
