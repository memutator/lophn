import { assert } from "@std/assert";
import {
  encodeFrame,
  type ParentMessage,
} from "../../contracts/platform/mod.ts";
import type { Spawned } from "./process.ts";

export function hello(kind = "platform/io"): ParentMessage {
  return {
    type: "hello",
    core_epoch: "epoch-1",
    process_identity: "proc-1",
    kind,
    task: "task-1",
    scope: { operations: ["blob.put"], targets: {} },
    credential: "credential-value-not-for-argv",
    api_port: 7431,
  };
}

export function spec(over: Record<string, unknown> = {}) {
  return {
    kind: "platform/io",
    entry: "/opt/lophn/entry.ts",
    allow_read: ["/opt/lophn"],
    allow_write: [] as string[],
    allow_net: [] as string[],
    allow_run: [] as string[],
    allow_sys: [] as string[],
    allow_env: [] as string[],
    policy: "always",
    memory_limit_bytes: 1024,
    ...over,
  };
}

export type FakeOptions = {
  // hello를 받으면 ready를 보낸다.
  ready?: boolean;
  // ready 직후 leader가 끝난다.
  exitAfterReady?: boolean;
  // stop frame을 받으면 stopped를 보내고 끝난다.
  exitOnStop?: boolean;
  // 바로 끝난다(stdout EOF, exit 1).
  dieAtStart?: boolean;
  // all: 모든 stdin 쓰기가, stop: stop frame 쓰기만, data: hello·stop을 뺀 쓰기(요청·byte chunk)가
  // 영원히 끝나지 않는다. child가 stdin을 읽지 않는 모양이다.
  blockWrites?: "all" | "stop" | "data";
  // leader exit가 영원히 안 온다(신호를 받아도).
  neverExit?: boolean;
  // group 종료 확인 결과. "hang"이면 영원히 답하지 않는다.
  terminate?: boolean | "hang" | "throw";
  // 이미 쓰인 stdout 뒤의 읽기와 stderr 읽기가 cancel 뒤에도 영원히 끝나지 않는다.
  hangStdio?: boolean;
};

// 같은 kind의 handle이 겹치는지 센다. spawn 때 +1, group 종료가 확인되면 -1.
export type Tracker = { live: number; maxLive: number; spawned: number };

export function tracker(): Tracker {
  return { live: 0, maxLive: 0, spawned: 0 };
}

const frame = (payload: unknown) =>
  encodeFrame({ kind: "json", channel: 0, payload });

export function fakeProcess(
  track: Tracker,
  options: FakeOptions = {},
): Spawned & {
  writes: string[];
  terminated: () => number;
  // leader만 끝낸다. stdout은 cancel 전까지 열려 있다(pipe를 쥔 손자처럼).
  exit: (code: number) => void;
} {
  track.spawned += 1;
  track.live += 1;
  track.maxLive = Math.max(track.maxLive, track.live);
  const chunks: Uint8Array[] = [];
  let ended = false;
  const waiters: Array<() => void> = [];
  const wake = () => waiters.splice(0).forEach((resolve) => resolve());
  let resolveExit: (code: number | null) => void = () => {};
  const exited = new Promise<number | null>((resolve) => {
    resolveExit = options.neverExit ? () => {} : resolve;
  });
  const writes: string[] = [];
  let terminateCalls = 0;
  let confirmed = false;
  if (options.dieAtStart) {
    ended = true;
    resolveExit(1);
  }
  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    wake();
  };
  return {
    pid: 4242,
    writes,
    terminated: () => terminateCalls,
    exit: (code) => resolveExit(code),
    stdin: {
      write(bytes) {
        const text = new TextDecoder().decode(bytes);
        if (
          options.blockWrites === "all" ||
          (options.blockWrites === "stop" && text.includes('"stop"')) ||
          (options.blockWrites === "data" && !text.includes('"hello"') &&
            !text.includes('"stop"'))
        ) return new Promise(() => {});
        writes.push(text);
        if (text.includes('"hello"') && (options.ready ?? true)) {
          push(frame({ type: "ready" }));
          if (options.exitAfterReady) resolveExit(0);
        }
        if (text.includes('"stop"') && (options.exitOnStop ?? true)) {
          push(frame({ type: "stopped" }));
          resolveExit(0);
        }
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
    },
    stdout: {
      async read(buffer) {
        while (true) {
          const next = chunks.shift();
          if (next) {
            buffer.set(next);
            return next.length;
          }
          if (options.hangStdio) return await new Promise<null>(() => {});
          if (ended) return null;
          await new Promise<void>((resolve) => waiters.push(resolve));
        }
      },
      cancel() {
        ended = true;
        wake();
      },
      bufferedBytes: 0,
    },
    stderr: {
      read: () =>
        options.hangStdio ? new Promise(() => {}) : Promise.resolve(null),
      cancel: () => {},
      bufferedBytes: 0,
    },
    exited,
    terminate() {
      terminateCalls += 1;
      const mode = options.terminate ?? true;
      if (mode === "throw") throw new Error("adapter crashed");
      if (mode === "hang") return new Promise(() => {});
      if (!mode) return Promise.resolve(false);
      resolveExit(null);
      if (!confirmed) {
        confirmed = true;
        track.live -= 1;
      }
      return Promise.resolve(true);
    },
  };
}

export async function waitFor(ready: () => boolean, tries = 200) {
  for (let i = 0; i < tries && !ready(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert(ready());
}
