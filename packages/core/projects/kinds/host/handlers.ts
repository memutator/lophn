// `kind.get`·`kind.list`·`kind.check` core 메모리 route의 handler. 읽기는 worker(별도 process)에 묻는 일이라
// ledger snapshot을 쓰는 reader Worker에는 맞지 않는다.
//
// agent는 자격의 그릇(project 또는 app)이 그 domain의 owner일 때만 읽는다. 다른 그릇의 domain은 있는지도 모르게
// not_found다. 그릇 조건이 없는 agent는 forbidden이고, user와 machine은 막지 않는다. 같은 그릇 안에서 어느
// domain을 읽을지는 agent tool이 자기 `ctx.domains`로 정한다.
import { err, type Result } from "../../../../base/mod.ts";
import { parseActor } from "../../../../protocol/base/mod.ts";
import type { DomainOwner } from "../../../../protocol/domains/mod.ts";
import {
  kindCheck,
  kindGet,
  kindList,
} from "../../../../protocol/projects/mod.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import type { KindsAsk, KindsDispatcher } from "./dispatcher.ts";

type HandlerDeps = {
  // 아직 안 붙었으면 undefined. 빈 결과로 꾸미지 않는다.
  dispatcher(): KindsDispatcher | undefined;
  // domain의 그릇. 없는 domain은 null이다.
  ownerOf(domain: string): DomainOwner | null;
  // domain 그릇의 폴더들. 그릇이 없거나 보관됐거나 폴더가 없으면 null이다.
  rootsOf(domain: string): string[] | null;
};

const ROUTES = { get: kindGet, list: kindList, check: kindCheck } as const;

export function kindHandlers(deps: HandlerDeps): Map<string, MemoryHandler> {
  const handlers = new Map<string, MemoryHandler>();
  for (const op of Object.keys(ROUTES) as KindsAsk[]) {
    const route = ROUTES[op];
    handlers.set(
      `${route.resource}/${route.method}`,
      async (ctx, raw): Promise<Result<unknown>> => {
        const kind = parseActor(ctx.actor)?.kind;
        if (kind !== "user" && kind !== "agent" && kind !== "machine") {
          return err({
            code: "forbidden",
            message: `${kind ?? "unknown"} cannot read kinds`,
          });
        }
        if (
          kind === "agent" &&
          ctx.conditions.project === undefined &&
          ctx.conditions.app === undefined
        ) {
          return err({ code: "forbidden", message: "agent has no container" });
        }
        const parsed = route.input.safeParse(raw);
        if (!parsed.success) {
          return err({
            code: "invalid_input",
            message: parsed.error.issues[0]?.message ?? "invalid input",
          });
        }
        const input = parsed.data as { domain: string; query?: unknown };
        if (kind === "agent") {
          const owner = deps.ownerOf(input.domain);
          const mine =
            owner?.kind === "project"
              ? ctx.conditions.project === owner.id
              : owner?.kind === "app" && ctx.conditions.app === owner.id;
          if (!mine) {
            return err({ code: "not_found", message: "domain not found" });
          }
        }
        if (deps.rootsOf(input.domain) === null) {
          return err({ code: "not_found", message: "domain not found" });
        }
        const dispatcher = deps.dispatcher();
        if (dispatcher === undefined) {
          return err({
            code: "unavailable",
            message: "kinds worker is not attached",
          });
        }
        return await dispatcher.ask(
          op,
          input.domain,
          input.query === undefined ? {} : { query: input.query },
        );
      },
    );
  }
  return handlers;
}
