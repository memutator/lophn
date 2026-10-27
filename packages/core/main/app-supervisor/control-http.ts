// 앱 process의 control socket HTTP 호출. 가상 host lophn.invalid만 쓴다. 앱에 닿기 전에 실패한 것
// (`not_sent`)과 보낸 뒤 끊기거나 시간이 넘거나 응답이 상한을 넘은 것(`lost`)을 구별한다.
import { request as httpRequest, type IncomingMessage } from "node:http";
import { connect } from "node:net";
import { SOCKET_HOST } from "../../../protocol/apps/mod.ts";
import type {
  ControlReply,
  ControlRequest,
  ControlTransport,
} from "../../apps/runtime/supervisor/mod.ts";

function socketOpens(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ path });
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

// 응답을 끝까지 읽는다. 상한을 넘은 본문은 도중에 끊는다.
function readCapped(
  response: IncomingMessage,
  maxBytes: number,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const length = Number(response.headers["content-length"] ?? "0");
    if (length > maxBytes) {
      response.destroy();
      resolve(undefined);
      return;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    response.on("data", (chunk: Uint8Array) => {
      total += chunk.byteLength;
      if (total > maxBytes) {
        response.destroy();
        resolve(undefined);
        return;
      }
      chunks.push(chunk);
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
    response.on("error", () => resolve(undefined));
  });
}

function callControl(
  socketPath: string,
  request: { path: string; body: string; timeoutMs: number; maxBytes: number },
): Promise<{ status: number; body: string } | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (reply: { status: number; body: string } | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(reply);
    };
    timer = setTimeout(() => {
      call.destroy(new Error("the control call timed out"));
    }, request.timeoutMs);
    const call = httpRequest(
      {
        socketPath,
        path: request.path,
        method: "POST",
        agent: false,
        headers: {
          host: SOCKET_HOST,
          "content-type": "application/json",
          "content-length": String(
            new TextEncoder().encode(request.body).byteLength,
          ),
        },
      },
      (response) => {
        readCapped(response, request.maxBytes).then((body) =>
          finish(
            body === undefined
              ? undefined
              : { status: response.statusCode ?? 0, body },
          ),
        );
      },
    );
    call.on("error", () => finish(undefined));
    call.end(request.body);
  });
}

export const unixControlTransport: ControlTransport = async (
  request: ControlRequest,
): Promise<ControlReply> => {
  // 연결부터 확인한다. 연결하지 못하면 앱에는 아무것도 가지 않았다.
  if (!(await socketOpens(request.socket))) return { kind: "not_sent" };
  const reply = await callControl(request.socket, request);
  return reply === undefined
    ? { kind: "lost" }
    : { kind: "reply", status: reply.status, body: reply.body };
};
