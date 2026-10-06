// 앱 프로세스 쪽 앱 쌍 통로(apps/connections#R4, apps/sdk#R40). 앱 runtime(Zod 없음)이 시작할 때
// 설치하고 `@lophn/cap-schedule`의 connectAppCommands가 읽는다. SDK는 packages/apps를 import하지
// 않으므로 두 쪽이 같은 심볼과 같은 모양으로 맞춘다(packages/sdk/cap-schedule/connect.ts).
// 준비 요청만 broker를 지나고, 연결 뒤 업무 요청·응답은 target direct socket으로 core·supervisor·
// ledger queue를 거치지 않고 간다.

export const PAIR_PORT = Symbol.for("lophn.cap-apps");
export const APP_CONNECT_PATH = "/_lophn/broker/apps/connect";
export const APP_CONFIRM_REQUEST_PATH = "/_lophn/broker/apps/confirm/request";
export const APP_CONFIRM_POLL_PATH = "/_lophn/broker/apps/confirm/poll";
// contracts/apps/channel-values.ts의 값과 같다. 시험이 같음을 확인한다.
export const PAIR_SOCKET_HOST = "lophn.invalid";

export type PairResponse = { status: number; body: unknown };

export type PairDirectRequest = {
  method: "GET" | "POST";
  path: string;
  authorization: string;
  body?: unknown;
};

export type PairConnectRequest = {
  app: string;
  commands: readonly string[];
  // 호출하는 현재 invocation. 서비스가 알려진 호출만 부모로 남긴다.
  parent_invocation: string | null;
  // 처리 중인 호출을 다른 앱에게서 받았다면 그 출처의 식별. path는 보내지 않는다.
  incoming?: {
    app: string;
    release: string;
    parent_invocation: string | null;
  };
};

export type PairPort = {
  connect(request: PairConnectRequest): Promise<PairResponse>;
  // confirm=true command의 approval 요청과 결과 수령. 본문의 child 신원은 broker client가 붙인다.
  confirmRequest(body: Record<string, unknown>): Promise<PairResponse>;
  confirmPoll(body: Record<string, unknown>): Promise<PairResponse>;
  // 요청을 보내지 못하면 name이 "NotSent", 보낸 뒤 응답을 잃으면 "ResultLost"인 오류를 던진다.
  direct(endpoint: string, request: PairDirectRequest): Promise<PairResponse>;
};

export class NotSent extends Error {
  constructor() {
    super("the app socket could not be opened");
    this.name = "NotSent";
  }
}

export class ResultLost extends Error {
  constructor() {
    super("the response was lost after the request was sent");
    this.name = "ResultLost";
  }
}

export type PairDirect = PairPort["direct"];

export function createPairPort(deps: {
  // child의 process_nonce·mode는 broker client가 붙인다.
  postConnect(body: PairConnectRequest): Promise<PairResponse>;
  postConfirmRequest(body: Record<string, unknown>): Promise<PairResponse>;
  postConfirmPoll(body: Record<string, unknown>): Promise<PairResponse>;
  direct: PairDirect;
}): PairPort {
  return {
    connect: (request) => deps.postConnect(request),
    confirmRequest: (body) => deps.postConfirmRequest(body),
    confirmPoll: (body) => deps.postConfirmPoll(body),
    direct: (endpoint, request) => deps.direct(endpoint, request),
  };
}

// 앱 프로세스는 runtime 하나다. 나중 설치가 앞의 것을 바꾼다.
export function installPairPort(port: PairPort): PairPort {
  (globalThis as Record<symbol, unknown>)[PAIR_PORT] = port;
  return port;
}

export const unixPairDirect: PairDirect = async (endpoint, request) => {
  // 먼저 소켓이 열리는지만 본다. 여기서 실패하면 요청은 나가지 않은 것이다.
  try {
    const probe = await Deno.connect({ path: endpoint, transport: "unix" });
    probe.close();
  } catch {
    throw new NotSent();
  }
  const client = Deno.createHttpClient({
    proxy: { transport: "unix", path: endpoint },
  });
  try {
    const response = await fetch(`http://${PAIR_SOCKET_HOST}${request.path}`, {
      client,
      method: request.method,
      headers: {
        authorization: request.authorization,
        ...(request.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(request.body === undefined
        ? {}
        : { body: JSON.stringify(request.body) }),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text.length === 0 ? null : JSON.parse(text),
    };
  } catch {
    throw new ResultLost();
  } finally {
    client.close();
  }
};
