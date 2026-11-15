import { AsyncLocalStorage } from "node:async_hooks";
import { installPort, type InvocationContext } from "./context.ts";
import { registryPort } from "./handlers.ts";

const storage = new AsyncLocalStorage<InvocationContext>();

// 이미 설치된 port가 있으면 그 registry를 쓴다. 두 load가 문맥을 나누지 않는다.
installPort(
  registryPort(
    (context, fn) => storage.run(context, () => Promise.resolve(fn())),
    () => storage.getStore() ?? null,
  ),
);
