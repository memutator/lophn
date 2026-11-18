// 앱이 broker socket으로 보내는 좁은 요청. supervisor 구현은 runtime/supervisor에 있다.
import { BROKER_PATHS } from "./limits.ts";

type BrokerRequest = {
  socketPath: string;
  credential: string;
  path: string;
  body: unknown;
};

export type BrokerResponse = { status: number; body: unknown };

export type BrokerTransport = (
  request: BrokerRequest,
) => Promise<BrokerResponse>;

type BrokerChild = {
  process_nonce: string;
  mode: "live" | "preview";
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
    // cap-host port의 `post`다. 신원(process_nonce·mode)은 연결이 붙이고 본문은 그 위에 얹힌다.
    post,
    // 앱 시작이 DB를 바꿨으면 그 changeset(base64)을, sync 앱이면 그것에 찍은 clock도 싣는다.
    ready(
      attestation: unknown,
      startChangeset: string | null,
      startHlc: string | null,
    ) {
      return post(BROKER_PATHS.ready, {
        attestation,
        ...(startChangeset === null ? {} : { start_changeset: startChangeset }),
        ...(startHlc === null ? {} : { start_hlc: startHlc }),
      });
    },
    // 다른 앱 호출. 부른 쪽은 core가 정한다.
    appsCall(body: {
      target_app: string;
      command: string;
      input?: unknown;
      parent_invocation: string | null;
      // 다른 기계의 앱을 부를 때 그 기계(이름, mch_, dev_).
      machine?: string;
    }) {
      return post(BROKER_PATHS.appsCall, body);
    },
  };
}

export type BrokerClient = ReturnType<typeof createBrokerClient>;
