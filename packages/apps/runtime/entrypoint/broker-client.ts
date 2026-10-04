// 앱이 broker socket으로 보내는 좁은 요청. supervisor 구현은 T8이다.
import { BROKER_PATHS, SOCKET_HOST } from "./limits.ts";

export type BrokerRequest = {
  socketPath: string;
  credential: string;
  path: string;
  body: unknown;
};

export type BrokerResponse = { status: number; body: unknown };

export type BrokerTransport = (
  request: BrokerRequest,
) => Promise<BrokerResponse>;

export type BrokerChild = {
  process_nonce: string;
  mode: "live" | "preview" | "test";
};

export function createBrokerClient(deps: {
  transport: BrokerTransport;
  socketPath: string;
  credential: string;
  child: BrokerChild;
}) {
  async function post(path: string, body: unknown): Promise<BrokerResponse> {
    return await deps.transport({
      socketPath: deps.socketPath,
      credential: deps.credential,
      path,
      body: { ...deps.child, ...(body as object) },
    });
  }
  return {
    host: SOCKET_HOST,
    ready(attestation: unknown) {
      return post(BROKER_PATHS.ready, { attestation });
    },
    submitInvocation(body: {
      invocation: string;
      fact: "start" | "finish" | "deny";
      summary: unknown;
    }) {
      return post(BROKER_PATHS.invocationsSubmit, body);
    },
  };
}

export type BrokerClient = ReturnType<typeof createBrokerClient>;
