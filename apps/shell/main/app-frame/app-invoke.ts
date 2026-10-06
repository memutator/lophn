// 앱 socket의 command 호출 client(apps/runtime direct socket `/_lophn/commands/invoke`). socket
// 경로·Authorization은 main에만 있다(shell/app-frame#R9).
import { request as httpRequest } from "node:http";

import { SOCKET_HOST } from "./app-protocol.ts";

// 앱 응답을 main 메모리에 모으는 상한. 넘으면 결과를 페이지로 넘기지 않는다.
export const CALL_RESULT_MAX_BYTES = 8 * 1024 * 1024;
export const INVOKE_PATH = "/_lophn/commands/invoke";

export interface InvokeRequest {
  endpoint: string;
  authorization: string;
  body: Record<string, unknown>;
}

export interface InvokeResponse {
  status: number;
  body: unknown;
}

/** 앱 socket POST. 응답을 받지 못하면 throw한다. */
export type Invoker = (request: InvokeRequest) => Promise<InvokeResponse>;

/**
 * main의 Node client. 연결 endpoint의 Unix socket에 POST한다. 응답 상한을 넘으면 끊고 throw한다.
 * 보낸 요청을 다시 보내지 않는다.
 */
export const nodeInvoke: Invoker = (input) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(input.body);
    const outgoing = httpRequest({
      socketPath: input.endpoint,
      path: INVOKE_PATH,
      method: "POST",
      headers: {
        host: SOCKET_HOST,
        authorization: input.authorization,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      },
    });
    outgoing.once("error", reject);
    outgoing.once("response", (incoming) => {
      const chunks: Buffer[] = [];
      let size = 0;
      incoming.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > CALL_RESULT_MAX_BYTES) {
          incoming.destroy(new Error("app response is too large"));
          return;
        }
        chunks.push(chunk);
      });
      incoming.once("error", reject);
      incoming.once("end", () => {
        let body: unknown;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          body = undefined;
        }
        resolve({ status: incoming.statusCode ?? 502, body });
      });
    });
    outgoing.end(payload);
  });
