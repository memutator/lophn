import { installPort, type InvocationContext } from "./context.ts";
import { registryPort } from "./handlers.ts";

// 폰 host가 호출을 하나씩 돌리므로 호출 문맥은 변수 하나면 된다. 보통은 host가 먼저 깐 port를 쓰고 이 port는
// 그것이 없을 때만 쓰인다.
let active: InvocationContext | null = null;

installPort(
  registryPort(
    <T>(context: InvocationContext, fn: () => Promise<T> | T): Promise<T> => {
      const previous = active;
      active = context;
      return new Promise<T>((resolve) => resolve(fn())).finally(() => {
        active = previous;
      });
    },
    () => active,
  ),
);
