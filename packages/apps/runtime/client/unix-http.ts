// 앱 direct socket으로 가는 Unix socket HTTP. 가상 host lophn.invalid만 쓰고(apps/runtime#R8)
// 연결을 열지 못한 것(보내지 않았다)과 보낸 뒤 응답을 못 받은 것(결과 모름)을 구별한다.
import { SOCKET_HOST } from "../../../contracts/apps/mod.ts";

export type DirectRequest = {
  method: "GET" | "POST";
  path: string;
  authorization: string;
  body?: unknown;
};

export type DirectResponse = { status: number; body: unknown };

// 요청을 보내지 못했다. 앱은 이 요청을 받지 않았다.
export class NotSent extends Error {
  constructor() {
    super("the app socket could not be opened");
    this.name = "NotSent";
  }
}

// 요청은 보냈지만 응답을 끝까지 받지 못했다. 앱이 처리했는지는 모른다.
export class ResultLost extends Error {
  constructor() {
    super("the response was lost after the request was sent");
    this.name = "ResultLost";
  }
}

export type DirectTransport = (
  endpoint: string,
  request: DirectRequest,
) => Promise<DirectResponse>;

export const unixDirectTransport: DirectTransport = async (
  endpoint,
  request,
) => {
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
    const response = await fetch(`http://${SOCKET_HOST}${request.path}`, {
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
    // 상태줄은 받았지만 본문이 끊기면 JSON 읽기가 실패한다. 이 경우도 결과 모름이다.
    const text = await response.text();
    let body: unknown = null;
    if (text.length > 0) body = JSON.parse(text);
    return { status: response.status, body };
  } catch {
    throw new ResultLost();
  } finally {
    client.close();
  }
};
