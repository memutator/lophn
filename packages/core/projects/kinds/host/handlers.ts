// `kind.get`·`kind.list`·`kind.check` core 메모리 route의 handler. 읽기는 worker(별도 process)에 묻는 일이라
// ledger snapshot을 쓰는 reader Worker에는 맞지 않는다.
//
// agent는 자기 session이 맡은 domain(agent 정의가 고른 domain과 그릇의 active domain의 교집합)만 읽는다. 맡지 않은
// domain은 invalid_input이고, domain을 생략하면 맡은 domain이 하나일 때 그것을 읽는다. 그릇 조건이 없는 agent는
// forbidden이고, user와 machine은 막지 않는다(domain을 꼭 줘야 한다).
import { err, type Result } from "../../../../base/mod.ts";
import { parseActor } from "../../../../protocol/base/mod.ts";
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
  // session이 맡은 domain id. session이 없으면 []다.
  domainsOfSession(session: string): string[];
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
        const actor = parseActor(ctx.actor);
        const kind = actor?.kind;
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
        const input = parsed.data as { domain?: string; query?: unknown };
        let domain = input.domain;
        if (actor?.kind === "agent") {
          const mine = deps.domainsOfSession(actor.id);
          if (domain === undefined && mine.length === 1) domain = mine[0];
          if (domain === undefined || !mine.includes(domain)) {
            return err({
              code: "invalid_input",
              message:
                mine.length === 0
                  ? "you have no domain"
                  : `domain is missing or not yours; pass domain: ${mine.join(", ")}`,
            });
          }
        } else if (domain === undefined) {
          return err({ code: "invalid_input", message: "domain is required" });
        }
        if (deps.rootsOf(domain) === null) {
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
          domain,
          input.query === undefined ? {} : { query: input.query },
        );
      },
    );
  }
  return handlers;
}
