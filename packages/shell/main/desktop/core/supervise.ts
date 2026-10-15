// core 수명은 창과 따로다. 창을 닫아도 pipe는 남고, 명시 종료나 pipe EOF만 core를 끝낸다.
import { type ChildProcess, spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  type CoreToMainMessage,
  coreToMainMessageSchema,
  type MainHello,
  mainToCoreMessageSchema,
} from "../../../../protocol/supervision/mod.ts";
import { encodeFrame, FrameDecoder } from "../../../../protocol/base/mod.ts";

/** 창 닫기와 무관한 core 종료 요청. tray의 명시 중지와 OS 종료가 이 값을 쓴다. */
export const STOP_GRACE_MS = 5_000;

/** hello가 이 안에 오지 않으면 core 시작이 실패다. */
export const HELLO_TIMEOUT_MS = 30_000;

// core 자신은 설치 코드·data root·loopback·고정 child만 연다.
// loopback의 IPv6 주소는 Deno 규칙대로 대괄호가 필요하다.
export const CORE_PERMISSION_FLAGS = ["--allow-sys=uid,gid,statfs"];

export interface CoreSpawn {
  command: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
}

export interface LaunchOptions {
  /** 저장소 루트(개발) 또는 설치 묶음의 platform/(packaged). core entry의 기준이다. */
  repoRoot: string;
  dataRoot: string;
  /** 개발은 `deno`. packaged는 bundle된 Deno binary. */
  denoBinary: string;
  packaged: boolean;
  port?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Deno transpile cache. 설치 묶음은 `~/.cache/lophn/deno`다.
 * 지워도 data root는 그대로고 고정 의존성으로 다시 만든다.
 */
export function packagedDenoDir(home: string = homedir()): string {
  return join(home, ".cache", "lophn", "deno");
}

/** packaged core의 읽기·쓰기·환경·실행 권한. 일반 `--allow-all`·ffi·전체 환경 접근은 없다. */
export function packagedPermissionFlags(
  options: LaunchOptions,
  denoDir: string,
): string[] {
  // platform/ 옆의 guides/는 설치 묶음의 읽기 전용 안내다.
  const guides = join(dirname(options.repoRoot), "guides");
  return [
    `--allow-read=${
      [options.repoRoot, guides, options.dataRoot, denoDir].join(",")
    }`,
    `--allow-write=${options.dataRoot}`,
    "--allow-env=LOPHN_HOME,LOPHN_INSTALL_ROOT,HOME,PATH,DENO_DIR,XDG_RUNTIME_DIR,XDG_CACHE_HOME,DBUS_SESSION_BUS_ADDRESS,NODE_V8_COVERAGE",
    // kill과 설치된 Deno, keychain 도구(`secret-tool`) 말고는 실행하지 않는다.
    `--allow-run=/usr/bin/kill,/usr/bin/secret-tool,/usr/local/bin/secret-tool,${options.denoBinary}`,
    // loopback과 보호 loader가 이어 오는 소유자 전용 socket(`<H>/run/credential.sock`) 하나다.
    `--allow-net=127.0.0.1,[::1],unix:${options.dataRoot}/run/credential.sock`,
    ...CORE_PERMISSION_FLAGS,
  ];
}

/** `deno run <flags> packages/core/main/daemon/main.ts`. argv·env에 credential은 없다. */
export function coreLaunch(options: LaunchOptions): CoreSpawn {
  const entry = join(
    options.repoRoot,
    "packages",
    "core",
    "main",
    "daemon",
    "main.ts",
  );
  const port = options.port ?? 0;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    LOPHN_HOME: options.dataRoot,
  };
  if (options.packaged && !env.DENO_DIR) env.DENO_DIR = packagedDenoDir();
  const flags = options.packaged
    ? [
      "run",
      "--cached-only",
      "--frozen",
      "--no-prompt",
      ...packagedPermissionFlags(options, env.DENO_DIR!),
    ]
    : ["run", "--allow-all"];
  return {
    command: options.denoBinary,
    args: [...flags, entry, `--port=${port}`],
    // spawn에 기본 env는 없다. PATH가 사라지면 `deno`를 못 찾으므로 프로세스
    // 환경을 바탕으로 LOPHN_HOME만 덮어쓴다. credential은 env에 넣지 않는다.
    env,
  };
}

export type CorePhase = "starting" | "ready" | "stopped";

/** core가 hello 전에 `start_failed`로 알린 시작 실패. reason이 화면이 보일 이유를 가른다. */
export type StartFailure = Extract<
  CoreToMainMessage,
  { type: "start_failed" }
>["reason"];

export class StartFailedError extends Error {
  readonly reason: StartFailure;
  constructor(reason: StartFailure) {
    super(`core가 시작하지 못했다: ${reason}`);
    this.reason = reason;
  }
}

export interface CoreProcess {
  readonly phase: CorePhase;
  /** hello 한 번. 실패·protocol 위반이면 reject. */
  readonly hello: Promise<MainHello>;
  /** core가 보낸 이후 json frame의 payload. token은 여기 없다. */
  onMessage(listener: (payload: unknown) => void): () => void;
  /** 명시 종료. 창 닫기는 이 함수를 부르지 않는다. */
  stop(graceMs?: number): void;
  /**
   * 안전 진단 하나를 감독 pipe로 보낸다(diagnostic 메시지). contract 모양이
   * 아니거나 core가 멈췄으면 보내지 않고 false다.
   */
  diagnostic(message: unknown): boolean;
  /**
   * 사람 결정 handle 등록 하나를 비공�� pipe로 보낸다. contract 모양의
   * confirmation_handle_register가 아니거나 core가 멈췄으면 보내지 않고 false다.
   */
  confirmation(message: unknown): boolean;
  /** 테스트가 child를 이미 끝났다고 알릴 때. */
  ended(): void;
}

export interface CoreChild {
  stdin: { write(bytes: Uint8Array): void };
  stdout: { on(event: "data", listener: (chunk: Uint8Array) => void): void };
  on(
    event: "exit" | "close" | "error",
    listener: (error?: Error) => void,
  ): void;
  kill(): void;
}

/** 길이 prefix frame으로 hello를 받고, 명시 stop만 보낸다. */
export function supervise(
  child: CoreChild,
  timers: {
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(id: unknown): void;
  } = {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) =>
      globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
  },
): CoreProcess {
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

  // hello가 오지 않는 core는 준비 화면만 막는다. 시간 안에 끝낸다.
  const helloTimer = timers.setTimeout(() => {
    if (!helloSent) {
      fail(new Error(`core hello가 ${HELLO_TIMEOUT_MS}ms 안에 오지 않았다`));
    }
  }, HELLO_TIMEOUT_MS);

  const fail = (error: Error) => {
    if (phase === "stopped") return;
    phase = "stopped";
    timers.clearTimeout(helloTimer);
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
      if ("type" in parsed.data && parsed.data.type === "start_failed") {
        // core가 이유를 알리고 곧 끝난다. exit가 먼저 와도 이 이유가 먼저 간다.
        if (!helloSent) rejectHello(new StartFailedError(parsed.data.reason));
        continue;
      }
      if (!helloSent) {
        const first = parsed.data as { user_token?: string };
        if (first.user_token === undefined) {
          fail(new Error("첫 frame이 hello가 아니다"));
          return;
        }
        helloSent = true;
        phase = "ready";
        timers.clearTimeout(helloTimer);
        resolveHello(parsed.data as MainHello);
        continue;
      }
      for (const listener of messages) listener(parsed.data);
    }
  });
  child.on("exit", () => {
    if (phase === "stopped") return;
    phase = "stopped";
    timers.clearTimeout(helloTimer);
  });
  // stdout을 다 읽은 뒤에 거부한다. 그래야 끝나기 직전에 보낸 start_failed 이유가 먼저 닿는다.
  child.on("close", () => {
    if (!helloSent) rejectHello(new Error("core가 hello 전에 끝났다"));
  });
  // spawn 실패(ENOENT 등)는 exit와 다른 error event다. 받지 않으면 Electron
  // main이 uncaught로 죽는다.
  child.on("error", (error) => {
    fail(error ?? new Error("core를 시작하지 못했다"));
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
      // grace가 지나도 core가 끝나지 않으면 강제로 끝낸다.
      timers.setTimeout(() => {
        if (phase !== "stopped") {
          phase = "stopped";
          child.kill();
        }
      }, graceMs);
    },
    diagnostic(message) {
      if (phase === "stopped") return false;
      const parsed = mainToCoreMessageSchema.safeParse(message);
      if (!parsed.success || parsed.data.type !== "diagnostic") return false;
      try {
        child.stdin.write(
          encodeFrame({ kind: "json", channel: 0, payload: parsed.data }),
        );
        return true;
      } catch {
        return false;
      }
    },
    confirmation(message) {
      if (phase !== "ready") return false;
      const parsed = mainToCoreMessageSchema.safeParse(message);
      if (
        !parsed.success ||
        parsed.data.type !== "confirmation_handle_register"
      ) return false;
      try {
        child.stdin.write(
          encodeFrame({ kind: "json", channel: 0, payload: parsed.data }),
        );
        return true;
      } catch {
        return false;
      }
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
