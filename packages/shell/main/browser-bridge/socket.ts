// bridge의 socket 서버. 연결마다 요청 한 줄을 받고 답 한 줄로 끝낸다. POSIX는 unix socket이라
// listen 뒤 0600으로 좁히고, Windows named pipe는 mode가 없어 server close가 곧 정리다.
import { createServer, type Socket } from "node:net";
import { chmod } from "node:fs/promises";

import type { OsPlatform } from "../../../base/os/mod.ts";
import { MAX_REQUEST_BYTES, SOCKET_TIMEOUT_MS } from "./policy.ts";

export async function listenBridge(options: {
  socket: string;
  platform: OsPlatform;
  handleLine(line: string): Promise<"pane" | "declined">;
  log(message: string): void;
}): Promise<{ stop(): Promise<void> }> {
  const open = new Set<Socket>();
  const server = createServer((connection) => {
    open.add(connection);
    connection.on("close", () => open.delete(connection));
    connection.setTimeout(SOCKET_TIMEOUT_MS, () => connection.destroy());
    connection.on("error", () => connection.destroy());
    let received = Buffer.alloc(0);
    let handled = false;
    connection.on("data", (chunk) => {
      if (handled) return;
      received = Buffer.concat([received, chunk]);
      if (received.length > MAX_REQUEST_BYTES) {
        connection.destroy();
        return;
      }
      const end = received.indexOf(0x0a);
      if (end === -1) return;
      handled = true;
      options
        .handleLine(received.subarray(0, end).toString("utf8"))
        .catch(() => "declined" as const)
        .then((result) => {
          if (connection.destroyed) return;
          connection.end(`${JSON.stringify({ result })}\n`);
        });
    });
  });
  server.on("error", () => options.log("browser bridge socket error"));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.socket, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const stop = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      for (const connection of open) connection.destroy();
    });
  if (options.platform !== "win32") {
    try {
      await chmod(options.socket, 0o600);
    } catch (cause) {
      await stop();
      throw cause;
    }
  }
  return { stop };
}
