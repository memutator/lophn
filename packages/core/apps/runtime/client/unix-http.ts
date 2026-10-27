// 앱 direct socket으로 가는 Unix socket HTTP. 가상 host lophn.invalid만 쓰고
// 연결을 열지 못한 것(보내지 않았다)과 보낸 뒤 응답을 못 받은 것(결과 모름)을 구별한다.
import { request as httpRequest, type IncomingMessage } from "node:http";
import { connect } from "node:net";
import { SOCKET_HOST } from "../../../../protocol/apps/mod.ts";

type DirectRequest = {
  method: "GET" | "POST";
  path: string;
  authorization: string;
  body?: unknown;
};

type DirectResponse = { status: number; body: unknown };

// 요청을 보내지 못했다. 앱은 이 요청을 받지 않았다.
class NotSent extends Error {
  constructor() {
    super("the app socket could not be opened");
    this.name = "NotSent";
  }
}

// 요청은 보냈지만 응답을 끝까지 받지 못했다. 앱이 처리했는지는 모른다.
class ResultLost extends Error {
  constructor() {
    super("the response was lost after the request was sent");
    this.name = "ResultLost";
  }
}

type DirectTransport = (
  endpoint: string,
  request: DirectRequest,
) => Promise<DirectResponse>;

function socketOpens(endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ path: endpoint });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
  });
}

function readAll(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    response.on("data", (chunk: Uint8Array) => {
      chunks.push(chunk);
      total += chunk.byteLength;
    });
    response.on("end", () => {
      const joined = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(new TextDecoder().decode(joined));
    });
    response.on("error", reject);
  });
}

export const unixDirectTransport: DirectTransport = async (
  endpoint,
  request,
) => {
  // 먼저 소켓이 열리는지만 본다. 여기서 실패하면 요청은 나가지 않은 것이다.
  if (!(await socketOpens(endpoint))) throw new NotSent();
  try {
    const body =
      request.body === undefined ? undefined : JSON.stringify(request.body);
    const reply = await new Promise<{ status: number; text: string }>(
      (resolve, reject) => {
        const call = httpRequest(
          {
            socketPath: endpoint,
            path: request.path,
            method: request.method,
            agent: false,
            headers: {
              host: SOCKET_HOST,
              authorization: request.authorization,
              ...(body === undefined
                ? {}
                : {
                    "content-type": "application/json",
                    "content-length": String(
                      new TextEncoder().encode(body).byteLength,
                    ),
                  }),
            },
          },
          (response) => {
            readAll(response).then(
              (text) => resolve({ status: response.statusCode ?? 0, text }),
              reject,
            );
          },
        );
        call.on("error", reject);
        call.end(body);
      },
    );
    // 상태줄은 받았지만 본문이 끊기면 JSON 읽기가 실패한다. 이 경우도 결과 모름이다.
    let parsed: unknown = null;
    if (reply.text.length > 0) parsed = JSON.parse(reply.text);
    return { status: reply.status, body: parsed };
  } catch {
    throw new ResultLost();
  }
};
