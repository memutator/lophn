// core 수명은 창과 따로다. 창을 닫아도 pipe는 남고, 명시 종료나 pipe EOF만 core를 끝낸다.
import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";

import {
  coreToMainMessageSchema,
  encodeFrame,
  FrameDecoder,
  type MainHello,
  mainToCoreMessageSchema,
} from "../../../../../packages/contracts/platform/mod.ts";

/** 창 닫기와 무관한 core 종료 요청. tray의 명시 중지와 OS 종료가 이 값을 쓴다. */
export const STOP_GRACE_MS = 5_000;

// architecture/platform 2.4. core 자신은 설치 코드·data root·loopback·고정 child만 연다.
export const CORE_PERMISSION_FLAGS = [
  "--allow-read=apps/core,packages",
  "--allow-write",
  "--allow-net=127.0.0.1,::1",
  "--allow-env=LOPHN_HOME,HOME,NODE_V8_COVERAGE",
  "--allow-run=/usr/bin/kill",
];

export interface CoreSpawn {
  command: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
}

export interface LaunchOptions {
  /** 저장소 루트. core entry와 Deno 권한 경로의 기준이다. */
  repoRoot: string;
  dataRoot: string;
  /** 개발은 `deno`. packaged는 bundle된 Deno binary. */
  denoBinary: string;
  packaged: boolean;
  port?: number;
  env?: NodeJS.ProcessEnv;
}

/** `deno run <flags> apps/core/main.ts`. argv·env에 credential은 없다. */
export function coreLaunch(options: LaunchOptions): CoreSpawn {
  const entry = join(options.repoRoot, "apps", "core", "main.ts");
  const port = options.port ?? 0;
  const flags = options.packaged
    ? [
      "run",
      "--cached-only",
      "--frozen",
      "--no-prompt",
      ...CORE_PERMISSION_FLAGS,
    ]
    : ["run", "--allow-all"];
  return {
    command: options.denoBinary,
    args: [...flags, entry, `--port=${port}`],
    env: { ...options.env, LOPHN_HOME: options.dataRoot },
  };
}

export type CorePhase = "starting" | "ready" | "stopped";

export interface CoreProcess {
  readonly phase: CorePhase;
  /** hello 한 번. 실패·protocol 위반이면 reject. */
  readonly hello: Promise<MainHello>;
  /** core가 보낸 이후 json frame의 payload. token은 여기 없다. */
  onMessage(listener: (payload: unknown) => void): () => void;
  /** 명시 종료. 창 닫기는 이 함수를 부르지 않는다. */
  stop(graceMs?: number): void;
  /** 테스트가 child를 이미 끝났다고 알릴 때. */
  ended(): void;
}

export interface CoreChild {
  stdin: { write(bytes: Uint8Array): void };
  stdout: { on(event: "data", listener: (chunk: Uint8Array) => void): void };
  on(event: "exit", listener: () => void): void;
  kill(): void;
}

/** 길이 prefix frame으로 hello를 받고, 명시 stop만 보낸다. */
export function supervise(child: CoreChild): CoreProcess {
  const decoder = new FrameDecoder();
  const messages = new Set<(payload: unknown) => void>();
  let phase: CorePhase = "starting";
  let helloSent = false;
  let resolveHello: (hello: MainHello) => void = () => {};
  let rejectHello: (error: Error) => void = () => {};
  const hello = new Promise<MainHello>((resolve, reject) => {
    resolveHello = resolve;
    rejectHello = reject;
  });
  // 아무도 await하지 않아도 거부가 프로세스를 죽이지 않게 한다.
  hello.catch(() => {});

  const fail = (error: Error) => {
    if (phase === "stopped") return;
    phase = "stopped";
    if (!helloSent) rejectHello(error);
    try {
      child.kill();
    } catch { /* 이미 끝남 */ }
  };

  child.stdout.on("data", (chunk) => {
    let frames;
    try {
      frames = decoder.push(chunk);
    } catch {
      fail(new Error("core stdout이 frame이 아니다"));
      return;
    }
    for (const frame of frames) {
      if (frame.kind !== "json") {
        fail(new Error("core 제어 frame이 아니다"));
        return;
      }
      const parsed = coreToMainMessageSchema.safeParse(frame.payload);
      if (!parsed.success) {
        fail(new Error("core 메시지를 읽지 못했다"));
        return;
      }
      if (!helloSent) {
        const first = parsed.data as { user_token?: string };
        if (first.user_token === undefined) {
          fail(new Error("첫 frame이 hello가 아니다"));
          return;
        }
        helloSent = true;
        phase = "ready";
        resolveHello(parsed.data as MainHello);
        continue;
      }
      for (const listener of messages) listener(parsed.data);
    }
  });
  child.on("exit", () => {
    if (phase === "stopped") return;
    phase = "stopped";
    if (!helloSent) rejectHello(new Error("core가 hello 전에 끝났다"));
  });

  return {
    get phase() {
      return phase;
    },
    hello,
    onMessage(listener) {
      messages.add(listener);
      return () => messages.delete(listener);
    },
    stop(graceMs = STOP_GRACE_MS) {
      if (phase === "stopped") return;
      const message = mainToCoreMessageSchema.parse({
        type: "stop",
        grace_ms: graceMs,
      });
      try {
        child.stdin.write(
          encodeFrame({ kind: "json", channel: 0, payload: message }),
        );
      } catch { /* pipe가 이미 닫힘 */ }
    },
    ended() {
      phase = "stopped";
    },
  };
}

export interface SpawnedCore extends CoreProcess {
  readonly child: ChildProcess;
}

/** 실제 core 프로세스를 띄운다. 환경에는 data root만 더한다. */
export function spawnCore(options: LaunchOptions): SpawnedCore {
  const launch = coreLaunch(options);
  const child = spawn(launch.command, [...launch.args], {
    cwd: options.repoRoot,
    env: launch.env,
    stdio: ["pipe", "pipe", "inherit"],
  });
  const core = supervise(child);
  return Object.assign(core, { child });
}
