import type { LophnError, Result } from "../../base/mod.ts";
import type { CommandRoute, Route } from "../../protocol/base/mod.ts";

// core client 중 앱·sdk 흐름이 쓰는 두 호출이다. CoreClient가 구조로 맞는다.
export type FlowClient = {
  command(
    route: CommandRoute,
    body: {
      input: unknown;
      idempotency_key: string;
      compare?: unknown;
      prepared?: readonly string[];
    },
  ): Promise<Result<unknown, LophnError>>;
  read(route: Route, input: unknown): Promise<Result<unknown, LophnError>>;
};
