// node-pty adapter. PTY host만 이 모듈을 import한다.
// POSIX는 PTY, Windows는 ConPTY. 제어 pipe fd는 child에 상속하지 않는다.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { type ProcessGroup, posixGroup, win32Group } from "./child-group.ts";
import { foregroundOf } from "./foreground.ts";

type PtyExit = { exitCode: number; signal?: number };

export interface PtyHandle {
  readonly pid: number;
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (chunk: string) => void): { dispose(): void };
  onExit(listener: (exit: PtyExit) => void): { dispose(): void };
  /** 지금 PTY foreground에서 도는 process의 argv. shell만 있거나 읽지 못하면 null. */
  foreground(): string[] | null;
}

type NodePtyHandle = Omit<PtyHandle, "foreground"> & {
  readonly process: string;
};

type PtySpawnOptions = {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  columns: number;
  rows: number;
  /** host 제어 pipe. child stdio에 넣지 않는다. */
  controlFd?: number;
};

export interface PtyAdapter {
  spawn(options: PtySpawnOptions): PtyHandle;
  group(pid: number): ProcessGroup;
}

type NodePty = {
  spawn(
    file: string,
    args: string[],
    options: {
      cwd: string;
      env: Record<string, string>;
      cols: number;
      rows: number;
      name: string;
      useConpty?: boolean;
    },
  ): NodePtyHandle;
};

export function nodePtyAdapter(load: () => NodePty = defaultLoad): PtyAdapter {
  return {
    spawn(options) {
      assertNotInherited(options);
      const pty = load();
      const raw = pty.spawn(options.file, options.args, {
        cwd: options.cwd,
        env: options.env,
        cols: options.columns,
        rows: options.rows,
        name: "xterm-256color",
        useConpty: process.platform === "win32",
      });
      return Object.assign(raw, {
        foreground: () =>
          foregroundOf({
            pid: raw.pid,
            platform: process.platform,
            processName: () => raw.process,
            readFile: (path) => readFileSync(path, "utf8"),
          }),
      });
    },
    group: process.platform === "win32" ? win32Group : posixGroup,
  };
}

function defaultLoad(): NodePty {
  // node-pty는 native module(CJS)이다. 테스트는 adapter를 주입하고 이 경로는 host만 탄다.
  return createRequire(import.meta.url)("node-pty") as NodePty;
}

function assertNotInherited(options: PtySpawnOptions): void {
  if (options.controlFd === undefined) return;
  const leaked = Object.values(options.env).some(
    (value) => value === String(options.controlFd),
  );
  if (leaked) {
    throw new Error("control fd must not be passed to the shell child");
  }
}

/** 출력 flood를 chunk 단위로 양보한다. 한 chunk가 host의 요청과 다른 PTY를 붙잡지 않게. */
export function yieldChunk(
  schedule: (done: () => void) => void,
): Promise<void> {
  return new Promise((resolve) => schedule(resolve));
}
