import { err, ok, type Result } from "../../base/mod.ts";
import { parseActor } from "../../protocol/base/mod.ts";
import {
  domainArchive,
  domainArchived,
  domainCreate,
  domainCreated,
  type DomainOwner,
  type DomainRecord,
  domainUnarchive,
  domainUnarchived,
} from "../../protocol/domains/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../protocol/server/mod.ts";
import { ownerLookupPort } from "./ports.ts";
import { insertDomain, loadDomain, replaceDomainState } from "./store.ts";

function fail(
  code: "forbidden" | "not_found" | "conflict",
  message: string,
): Result<never> {
  return err({ code, message });
}

// user는 어느 그릇에든 만든다. agent는 자기 그릇(자격 조건의 project나 app)에만 만든다.
function mayCreate(ctx: RequestContext, owner: DomainOwner): boolean {
  const kind = parseActor(ctx.actor)?.kind;
  if (kind === "user") return true;
  if (kind !== "agent") return false;
  return owner.kind === "project"
    ? ctx.conditions.project === owner.id
    : ctx.conditions.app === owner.id;
}

// owner를 생략한 agent의 그릇은 자격 조건에서 정한다. user는 꼭 준다.
function ownerOf(
  ctx: RequestContext,
  given?: DomainOwner,
): Result<DomainOwner> {
  if (given !== undefined) return ok(given);
  const { app, project } = ctx.conditions;
  if (parseActor(ctx.actor)?.kind === "agent") {
    if (app !== undefined) {
      return ok({ kind: "app", id: app } as DomainOwner);
    }
    if (project !== undefined) {
      return ok({ kind: "project", id: project } as DomainOwner);
    }
  }
  return err({
    code: "invalid_input",
    message: "owner is required (agents create in their project or app place)",
  });
}

// 그릇 확인 없이 만든다. 확인은 부른 command가 한다(domain.create, 앱을 만드는 command).
export function createDomain(
  tx: Pick<Tx, "sql" | "emit" | "newId">,
  input: {
    id?: string;
    name: string;
    title: string;
    purpose: string;
    owner: DomainOwner;
  },
): Result<DomainRecord> {
  if (
    tx.sql.get("SELECT id FROM domains WHERE name = ?", [input.name]) !==
    undefined
  )
    return fail("conflict", "domain name already exists");
  if (
    input.id !== undefined &&
    tx.sql.get("SELECT id FROM domains WHERE id = ?", [input.id]) !== undefined
  )
    return fail("conflict", "domain id already exists");
  const id = (input.id ?? tx.newId("dom")) as DomainRecord["id"];
  const seq = tx.emit(domainCreated, id, {
    name: input.name,
    title: input.title,
    purpose: input.purpose,
    owner: input.owner,
  });
  const domain: DomainRecord = {
    id,
    name: input.name,
    title: input.title,
    purpose: input.purpose,
    owner: input.owner,
    revision: seq,
    status: "active",
  };
  insertDomain(tx, domain);
  return ok(domain);
}

export function createDomainCommands(): {
  create: CommandDefinition<typeof domainCreate>;
  archive: CommandDefinition<typeof domainArchive>;
  unarchive: CommandDefinition<typeof domainUnarchive>;
} {
  return {
    create: {
      route: domainCreate,
      handle(tx, ctx, input) {
        if (input.id !== undefined && parseActor(ctx.actor)?.kind !== "user")
          return fail("forbidden", "only a person assigns a domain id");
        const given = ownerOf(ctx, input.owner);
        if (!given.ok) return given;
        const owner = given.value;
        if (!mayCreate(ctx, owner)) {
          return fail("forbidden", "a domain is made in the actor's own owner");
        }
        const found = tx.port(ownerLookupPort).get(owner);
        if (found === null) {
          return fail("not_found", `${owner.kind} not found`);
        }
        if (found.status === "archived") {
          return fail("conflict", `${owner.kind} is archived`);
        }
        return createDomain(tx, { ...input, owner });
      },
    },
    archive: {
      route: domainArchive,
      handle(tx, _ctx, input, compare) {
        const current = loadDomain(tx.sql, input.domain);
        if (!current.ok) return current;
        const domain = current.value;
        if (domain === null) return fail("not_found", "domain not found");
        if (domain.status !== "active") {
          return fail("conflict", "domain status is not active");
        }
        if (domain.revision !== compare.base_revision) {
          return fail("conflict", "domain revision changed");
        }
        // 앱은 domain이 0개가 되면 안 된다. project는 0개여도 된다.
        if (domain.owner.kind === "app") {
          const active = tx.sql.get(
            "SELECT count(*) AS n FROM domains WHERE owner_kind = 'app' AND owner_id = ? AND status = 'active'",
            [domain.owner.id],
          );
          if (Number(active?.["n"] ?? 0) <= 1) {
            return fail(
              "conflict",
              "the last domain of an app cannot be archived",
            );
          }
        }
        return move(tx, domain, "archived");
      },
    },
    unarchive: {
      route: domainUnarchive,
      handle(tx, _ctx, input, compare) {
        const current = loadDomain(tx.sql, input.domain);
        if (!current.ok) return current;
        const domain = current.value;
        if (domain === null) return fail("not_found", "domain not found");
        if (domain.status !== "archived") {
          return fail("conflict", "domain status is not archived");
        }
        if (domain.revision !== compare.base_revision) {
          return fail("conflict", "domain revision changed");
        }
        return move(tx, domain, "active");
      },
    },
  };
}

function move(
  tx: Tx,
  domain: DomainRecord,
  to: "active" | "archived",
): Result<DomainRecord> {
  const seq = tx.emit(
    to === "archived" ? domainArchived : domainUnarchived,
    domain.id,
    {},
  );
  const next: DomainRecord = { ...domain, status: to, revision: seq };
  const stored = replaceDomainState(tx, next);
  return stored.ok ? ok(next) : stored;
}
