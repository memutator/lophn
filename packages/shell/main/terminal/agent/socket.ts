// hook의 socket 서버. 연결마다 줄 하나를 받고 답 없이 닫는다. POSIX는 unix socket이라 listen 뒤
// 0600으로 좁히고, Windows named pipe는 mode가 없어 server close가 곧 정리다.
import { createServer, type Socket } from "node:net";
import { chmod } from "node:fs/promises";

import type { OsPlatform } from "../../../../base/os/mod.ts";

const SOCKET_TIMEOUT_MS = 3000;

export async function listenHooks(options: {
  socket: string;
  platform: OsPlatform;
  maxBytes: number;
  handleLine(line: string): void;
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
      if (received.length > options.maxBytes + 1) {
        connection.destroy();
        return;
      }
      const end = received.indexOf(0x0a);
      if (end === -1) return;
      handled = true;
      try {
        options.handleLine(received.subarray(0, end).toString("utf8"));
      } catch {
        options.log("terminal hook line failed");
      }
      connection.end();
    });
  });
  server.on("error", () => options.log("terminal hook socket error"));
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
