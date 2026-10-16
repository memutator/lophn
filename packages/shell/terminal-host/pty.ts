// node-pty adapter. renderer는 이 모듈을 import하지 않는다.
// POSIX는 PTY, Windows는 ConPTY. 제어 pipe fd는 child에 상속하지 않는다.

import { createRequire } from "node:module";

import { posixGroup, type ProcessGroup } from "./child-group.ts";

type PtyExit = { exitCode: number; signal?: number };

export interface PtyHandle {
  readonly pid: number;
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (chunk: string) => void): { dispose(): void };
  onExit(listener: (exit: PtyExit) => void): { dispose(): void };
}

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
  ): PtyHandle;
};

export function nodePtyAdapter(load: () => NodePty = defaultLoad): PtyAdapter {
  return {
    spawn(options) {
      assertNotInherited(options);
      const pty = load();
      return pty.spawn(options.file, options.args, {
        cwd: options.cwd,
        env: options.env,
        cols: options.columns,
        rows: options.rows,
        name: "xterm-256color",
        useConpty: process.platform === "win32",
      });
    },
    group: posixGroup,
  };
}

function defaultLoad(): NodePty {
  // node-pty는 native module이다. 테스트는 adapter를 주입하고 이 경로는 host만 탄다.
  return requireNodePty();
}

function requireNodePty(): NodePty {
  // 묶인 host는 CJS라 module의 require가 있다. 전역 eval("require")는 CJS module
  // 안에서 보이지 않아 실제 host에서 늘 시작 실패가 됐다. 묶지 않고 돌 때는 실행한
  // script 자리에서 찾는다.
  const req = typeof require === "function"
    ? require
    : createRequire(process.argv[1] ?? `${process.cwd()}/`);
  return req("node-pty") as NodePty;
}

function assertNotInherited(options: PtySpawnOptions): void {
  if (options.controlFd === undefined) return;
  const leaked = Object.values(options.env).some((value) =>
    value === String(options.controlFd)
  );
  if (leaked) {
    throw new Error("control fd must not be passed to the shell child");
  }
}

/** 출력 flood를 chunk 단위로 양보한다. 한 chunk가 main과 다른 PTY를 붙잡지 않게. */
export function yieldChunk(
  schedule: (done: () => void) => void,
): Promise<void> {
  return new Promise((resolve) => schedule(resolve));
}
