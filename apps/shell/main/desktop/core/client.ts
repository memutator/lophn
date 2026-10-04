// 사람 token은 이 객체의 메모리에만 있다. 직렬화·log·renderer로 나가지 않는다.
import {
  createRpcClient,
  type Route,
  type RpcClient,
  type RpcFetch,
} from "../../../../../packages/contracts/platform/mod.ts";
import {
  type ErrorCode,
  type Result,
} from "../../../../../packages/base/mod.ts";

import { isAllowed, lookupCall } from "./allowlist.ts";
import { routeByName } from "./routes.ts";

export interface CoreSession {
  readonly apiPort: number;
  readonly coreEpoch: string;
  /** 인증된 read·command. allowlist 밖은 네트워크로 나가지 않는다. */
  call(
    kind: string,
    resource: string,
    method: string,
    body: unknown,
  ): Promise<Result<unknown>>;
}

export interface SessionInput {
  apiPort: number;
  coreEpoch: string;
  userToken: string;
  fetch: RpcFetch;
  /** 지금 호출이 연결 화면의 고정 intent인지. 그 화면만 true를 준다. */
  connectionIntent?: () => boolean;
}

export function openSession(input: SessionInput): CoreSession {
  const rpc: RpcClient = createRpcClient({
    baseUrl: `http://127.0.0.1:${input.apiPort}`,
    token: input.userToken,
    fetch: input.fetch,
  });
  return {
    apiPort: input.apiPort,
    coreEpoch: input.coreEpoch,
    async call(kind, resource, method, body) {
      const name = lookupCall(kind, resource, method);
      const route = name === undefined ? undefined : routeByName(name);
      if (
        route === undefined ||
        !isAllowed(kind, resource, method) ||
        (kind === "command" && resource === "coding_agent_connections" &&
          method === "create" && input.connectionIntent?.() !== true)
      ) {
        return {
          ok: false,
          error: {
            code: "forbidden" as ErrorCode,
            message: "허용되지 않은 호출이다",
          },
        };
      }
      return await rpc.call(route as Route, body as never);
    },
  };
}
