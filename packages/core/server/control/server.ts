import { chmod, mkdir, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { dirname } from "node:path";
import {
  err,
  errorCode,
  ok,
  type OsPlatform,
  type Result,
} from "../../../base/mod.ts";
import type { ControlReply } from "./handler.ts";

// 요청 한 줄의 상한. handle 등록 payload가 넉넉히 들어간다.
const MAX_LINE_BYTES = 64 * 1024;
// 줄이 끝나지 않는 연결이 core를 붙잡지 않게 한다.
const CONNECTION_TIMEOUT_MS = 10_000;

const DIR_MODE = 0o700;

export type ControlServer = {
  // listener와 socket file을 닫는다. 잡고 있던 lock을 풀기 전에 부른다.
  stop(): Promise<void>;
};

// core control socket. 연결마다 요청 한 줄을 받고 Result 답 한 줄로 끝난다.
// 부르는 쪽은 instance lock을 잡은 뒤에만 부른다. 앞 core가 남긴 socket file은 그때 지운다.
export async function startControlServer(options: {
  socketPath: string;
  platform: OsPlatform;
  // 한 줄 요청 하나. 던지지 않는다.
  handle(line: string): Promise<ControlReply>;
}): Promise<Result<ControlServer>> {
  if (options.platform !== "win32") {
    try {
      const directory = dirname(options.socketPath);
      await mkdir(directory, { recursive: true, mode: DIR_MODE });
      // mkdir의 mode는 umask에 깎인다. socket 자리 폴더는 0700이 경계다.
      await chmod(directory, DIR_MODE);
      await rm(options.socketPath, { force: true });
    } catch {
      return err({
        code: "unavailable",
        message: "control socket 자리를 만들 수 없다",
      });
    }
  }

  const open = new Set<Socket>();
  const server = createServer((connection) => {
    open.add(connection);
    connection.setTimeout(CONNECTION_TIMEOUT_MS, () => connection.destroy());
    connection.on("error", () => connection.destroy());
    let received = Buffer.alloc(0);
    let handled = false;
    const respond = (reply: ControlReply) => {
      // 답이 다 나간 뒤에 stop의 종료를 시작한다.
      connection.end(`${JSON.stringify(reply.response)}\n`, () => {
        reply.after?.();
      });
    };
    connection.on("data", (chunk) => {
      if (handled) return;
      received = Buffer.concat([received, chunk]);
      if (received.length > MAX_LINE_BYTES) {
        connection.destroy();
        return;
      }
      const end = received.indexOf(0x0a);
      if (end === -1) return;
      handled = true;
      const line = received.subarray(0, end).toString("utf8");
      void options.handle(line).then(respond, () =>
        respond({
          response: {
            ok: false,
            error: { code: "internal", message: "internal error" },
          },
        }),
      );
    });
    connection.on("close", () => open.delete(connection));
  });
  server.on("error", () => {});
  const listening = Promise.withResolvers<Result<void>>();
  server.once("error", (thrown) =>
    listening.resolve(
      errorCode(thrown) === "EADDRINUSE"
        ? err({
            code: "conflict",
            message: "control socket이 이미 열려 있다",
          })
        : err({ code: "unavailable", message: "control socket을 열 수 없다" }),
    ),
  );
  server.listen(options.socketPath, () => listening.resolve(ok(undefined)));
  const opened = await listening.promise;
  if (!opened.ok) {
    server.close();
    return opened;
  }
  if (options.platform !== "win32") {
    try {
      // 폴더가 0700이어도 socket file은 소유자만 다룬다.
      await chmod(options.socketPath, 0o600);
    } catch {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      return err({
        code: "unavailable",
        message: "control socket 권한을 좁힐 수 없다",
      });
    }
  }
  return ok({
    stop() {
      const stopped = Promise.withResolvers<void>();
      server.close(() => stopped.resolve());
      for (const connection of open) connection.destroy();
      open.clear();
      return stopped.promise.then(async () => {
        if (options.platform === "win32") return;
        // listener를 닫으면서 unlink하지 않는 플랫폼이 있어 한 번 더 지운다.
        await rm(options.socketPath, { force: true }).catch(() => {});
      });
    },
  });
}
