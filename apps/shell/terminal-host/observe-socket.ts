// lophn이 연 coding TUI마다 만드는 관측 socket(shell/terminal#R12, coding-agent/sessions#R6).
// 0700 폴더 안의 무작위 이름 Unix socket(Windows는 무작위 named pipe)이고 경로만 환경
// `LOPHN_TERMINAL_OBSERVE`로 간다. observation 전용이라 connection credential·token과 섞지 않는다. 한 줄은
// harnessSessionObservation NDJSON이고 64KiB 안이다. host는 이 socket 하나가 runtime 하나라는 사실로
// runtime_ref·generation을 붙이고 payload가 주장한 정체(runtime·connection·ticket·origin)는 쓰지 않는다.

import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type HarnessSessionObservation,
  harnessSessionObservationSchema,
  type ObserveEnvelope,
  observeEnvelopeSchema,
} from "../../../packages/protocol/coding-agent/mod.ts";

/** observe 줄 한 개의 상한이다(coding-agent#T39). */
export const OBSERVE_LINE_LIMIT_BYTES = 64 * 1024;

export type ObserveSocketOptions = {
  platform: NodeJS.Platform;
  /** socket 폴더를 만들 곳. 기본은 OS temp다. */
  root?: string;
  random?: () => string;
  runtime_ref: string;
  generation: number;
  /** payload의 관측에 host가 아는 정체를 덧씌운다. null이면 이 줄은 버린다. */
  stamp(payload: HarnessSessionObservation): HarnessSessionObservation | null;
  accept(envelope: ObserveEnvelope): void;
  /** 열려 있어야 할 socket이 닫히거나 오류가 났다. */
  onLost?(reason: string): void;
};

export type ObserveSocket = {
  readonly path: string;
  listen(): Promise<void>;
  /** 연결을 끊고 socket 파일과 폴더를 지운다. 여러 번 불러도 같다. */
  close(): void;
};

const hex = () => randomBytes(12).toString("hex");

export function createObserveSocket(
  options: ObserveSocketOptions,
): ObserveSocket {
  const random = options.random ?? hex;
  const windows = options.platform === "win32";
  const dir = windows
    ? undefined
    : mkdtempSync(join(options.root ?? tmpdir(), "lophn-obs-"));
  if (dir !== undefined) chmodSync(dir, 0o700);
  const path = windows
    ? `\\\\.\\pipe\\lophn-observe-${random()}`
    : join(dir ?? "", `o-${random()}.sock`);
  const connections = new Set<Socket>();
  let server: Server | undefined;
  let closed = false;

  function onLine(line: string): void {
    if (Buffer.byteLength(line) > OBSERVE_LINE_LIMIT_BYTES) return;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      return;
    }
    const payload = harnessSessionObservationSchema.safeParse(json);
    if (!payload.success) return;
    const stamped = options.stamp(payload.data);
    if (stamped === null) return;
    const envelope = observeEnvelopeSchema.safeParse({
      runtime_ref: options.runtime_ref,
      generation: options.generation,
      observation: stamped,
    });
    if (envelope.success) options.accept(envelope.data);
  }

  function onConnection(socket: Socket): void {
    connections.add(socket);
    socket.setEncoding("utf8");
    let pending = "";
    socket.on("data", (chunk: string) => {
      pending += chunk;
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.length > 0) onLine(line);
        newline = pending.indexOf("\n");
      }
      // 줄바꿈 없이 상한을 넘기는 연결은 observation이 아니다.
      if (Buffer.byteLength(pending) > OBSERVE_LINE_LIMIT_BYTES) {
        pending = "";
        socket.destroy();
      }
    });
    socket.on("close", () => connections.delete(socket));
    socket.on("error", () => socket.destroy());
  }

  function close(): void {
    if (closed) return;
    closed = true;
    for (const socket of connections) socket.destroy();
    connections.clear();
    try {
      server?.close();
    } catch {
      // 이미 닫힌 server다.
    }
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }

  return {
    path,
    listen() {
      return new Promise((resolve, reject) => {
        server = createServer(onConnection);
        server.once("error", (error) => {
          if (!closed) options.onLost?.("observe socket error");
          reject(error);
        });
        server.once("close", () => {
          if (!closed) options.onLost?.("observe socket closed");
        });
        server.listen(path, () => {
          if (dir !== undefined) {
            try {
              chmodSync(path, 0o600);
            } catch {
              // 폴더가 0700이라 다른 사용자는 이미 닿지 못한다.
            }
          }
          resolve();
        });
      });
    },
    close,
  };
}
