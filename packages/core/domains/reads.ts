import { err, ok, type Result } from "../../base/mod.ts";
import { parseActor } from "../../protocol/base/mod.ts";
import {
  domainGet,
  domainList,
  type DomainOwner,
} from "../../protocol/domains/mod.ts";
import type {
  ReadDefinition,
  RequestContext,
} from "../../protocol/server/mod.ts";
import { loadDomain, loadDomains } from "./store.ts";

const PAGE = 50;

// user·machine은 전체를 본다. 자격 조건에 project나 app이 있는 agent는 그 그릇의 domain만 본다. 조건이 없는
// agent(lophn)는 전체를 본다.
function visible(ctx: RequestContext, owner: DomainOwner): boolean {
  if (parseActor(ctx.actor)?.kind !== "agent") return true;
  const { project, app } = ctx.conditions;
  if (project === undefined && app === undefined) return true;
  return owner.kind === "project" ? owner.id === project : owner.id === app;
}

export function createDomainReads(): {
  list: ReadDefinition<typeof domainList>;
  get: ReadDefinition<typeof domainGet>;
} {
  return {
    list: {
      route: domainList,
      handle(snapshot, ctx, input) {
        const loaded = loadDomains(snapshot.sql, {
          ...(input.owner === undefined ? {} : { owner: input.owner }),
          ...(input.status === undefined ? {} : { status: input.status }),
        });
        if (!loaded.ok) return loaded;
        // cursor는 마지막으로 본 id다. 목록이 작아 다 읽고 거른다.
        const rest = loaded.value.filter((domain) =>
          visible(ctx, domain.owner) &&
          (input.cursor === undefined || domain.id > input.cursor)
        );
        const limit = input.limit ?? PAGE;
        const page = rest.slice(0, limit);
        return ok({
          domains: page,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: rest.length > limit ? page[page.length - 1]!.id : null,
        });
      },
    },
    get: {
      route: domainGet,
      handle(snapshot, ctx, input) {
        const found = loadDomain(snapshot.sql, input.domain);
        if (!found.ok) return found;
        if (found.value === null || !visible(ctx, found.value.owner)) {
          return notFound();
        }
        return ok({
          domain: found.value,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}

function notFound(): Result<never> {
  return err({ code: "not_found", message: "domain not found" });
}
