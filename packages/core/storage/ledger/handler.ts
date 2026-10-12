import type { Result } from "../../../base/mod.ts";
import type {
  CommandDefinition,
  Compare,
  Input,
  Output,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import type { CommandRoute } from "../../../protocol/base/mod.ts";

// handler는 동기 함수다. Promise를 돌려주는 함수는 이 타입에 안 들어간다.
// 파일·socket·process handle은 인자로 없고, Tx만 받는다.
type NotPromise<T> = T extends Promise<unknown> ? never : T;

export type SyncHandler<R extends CommandRoute> = (
  tx: Tx,
  ctx: RequestContext,
  input: Input<R>,
  compare: Compare<R>,
) => NotPromise<Result<Output<R>>>;

export function defineSyncCommand<R extends CommandRoute>(
  route: R,
  handle: SyncHandler<R>,
  options: { dispatchable?: boolean; dispatchOnly?: boolean } = {},
): CommandDefinition<R> {
  return {
    route,
    dispatchable: options.dispatchable,
    dispatchOnly: options.dispatchOnly,
    handle(tx, ctx, input, compare) {
      let result: unknown;
      try {
        result = handle(tx, ctx, input, compare);
      } catch (thrown) {
        if (isThenable(thrown)) {
          void (thrown as Promise<unknown>).then(
            () => undefined,
            () => undefined,
          );
          throw new Error("command handler는 동기 함수여야 한다");
        }
        throw thrown;
      }
      if (isThenable(result)) {
        void (result as Promise<unknown>).then(
          () => undefined,
          () => undefined,
        );
        throw new Error("command handler는 동기 함수여야 한다");
      }
      return result as ReturnType<CommandDefinition<R>["handle"]>;
    },
  };
}

function isThenable(value: unknown): boolean {
  return typeof value === "object" && value !== null && "then" in value &&
    typeof (value as { then?: unknown }).then === "function";
}
