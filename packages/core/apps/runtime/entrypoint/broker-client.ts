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
      body: { ...(body as object), ...deps.child },
    });
  }
  return {
    host: SOCKET_HOST,
    // cap-host port의 `post`다. 신원(process_nonce·mode)은 연결이 붙이고 본문은 그 위에 얹힌다.
    post,
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
    // 다른 앱 connection 준비. source 신원은 broker가 이 자식 연결에서 정한다.
    appsConnect(body: {
      app: string;
      commands: readonly string[];
      parent_invocation: string | null;
      incoming?: {
        app: string;
        release: string;
        parent_invocation: string | null;
      };
    }) {
      return post(BROKER_PATHS.appsConnect, body);
    },
    // confirm=true command의 approval 요청과 결과 수령.
    appsConfirmRequest(body: Record<string, unknown>) {
      return post(BROKER_PATHS.appsConfirmRequest, body);
    },
    appsConfirmPoll(body: Record<string, unknown>) {
      return post(BROKER_PATHS.appsConfirmPoll, body);
    },
    // automation 회차 permit. 신원은 연결이 정하고 release·key만 본문에 싣는다.
    tryAcquireAutomation(body: { release: string; key: string }) {
      return post(BROKER_PATHS.automationsTryAcquire, body);
    },
    releaseAutomation(
      body: { release: string; key: string; invocation: string },
    ) {
      return post(BROKER_PATHS.automationsRelease, body);
    },
  };
}

export type BrokerClient = ReturnType<typeof createBrokerClient>;
