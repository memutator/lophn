// `kind.get`·`kind.list`·`kind.check` core 메모리 route의 handler. 읽기는 worker(별도 process)에 묻는 일이라
// ledger snapshot을 쓰는 reader Worker에는 맞지 않는다.
//
// 호출자가 어느 project를 읽을 수 있는지는 여기서 판정하지 않는다(agent tool이 자기 place로 정한다).
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
  // 없거나 보관된 project는 null이다.
  rootsOf(project: string): string[] | null;
};

const ROUTES = { get: kindGet, list: kindList, check: kindCheck } as const;

export function kindHandlers(
  deps: HandlerDeps,
): Map<string, MemoryHandler> {
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
        const parsed = route.input.safeParse(raw);
        if (!parsed.success) {
          return err({
            code: "invalid_input",
            message: parsed.error.issues[0]?.message ?? "invalid input",
          });
        }
        const input = parsed.data as { project: string; query?: unknown };
        if (deps.rootsOf(input.project) === null) {
          return err({ code: "not_found", message: "project not found" });
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
          input.project,
          input.query === undefined ? {} : { query: input.query },
        );
      },
    );
  }
  return handlers;
}
