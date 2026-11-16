// "Keep lophn running"의 OS port 구현. 로그인 때 core를 띄우는 per-user 항목(systemd user unit, LaunchAgent,
// HKCU Run 값)과 keep-awake child. OS 명령과 file은 모두 deps로 받는다.
import type { Logger } from "../../../base/mod.ts";
import { keepAwakeCommand, systemRoot } from "./entries.ts";
import { createRegistrar, type OsRun } from "./registrar.ts";

// 아래 port 모양은 always-on의 port와 같아야 한다. core 입구가 잇는 곳에서 type으로 맞춰 본다.
export type ServiceEnv = { PATH: string; TMPDIR?: string };
export type Registration =
  | { state: "registered" }
  | { state: "absent" }
  | { state: "stale" }
  | { state: "off_in_system" }
  | {
      state: "unavailable";
      reason: "no_service_manager" | "unverified_path" | "os_failed";
    };
export type Registrar = {
  mechanism: "systemd" | "launchd" | "windows_run";
  read(env: ServiceEnv): Promise<Registration>;
  register(env: ServiceEnv): Promise<Registration>;
  unregister(): Promise<Registration>;
};
export type KeepAwake = {
  hold(): Promise<
    | { state: "held" }
    | { state: "unavailable"; reason: "no_inhibitor" | "os_failed" }
  >;
  release(): void;
  onLost(listener: (reason: "no_inhibitor" | "os_failed") => void): void;
};
export type AlwaysOnOs = {
  registrar: Registrar;
  keepAwake: KeepAwake;
  captureEnv(): ServiceEnv;
};

export type AlwaysOnOsDeps = {
  platform: NodeJS.Platform;
  dataRoot: string;
  /** 설치본의 Electron 실행 file. */
  execPath: string;
  /** core 입구(`main.ts`)의 절대 경로. */
  coreEntry: string;
  corePid: number;
  uid: number;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  /** shell 없이 띄운다. 기한을 넘기면 끄고 code null로 끝난다. 띄우지 못하면 reject해도 된다. */
  exec(
    file: string,
    args: readonly string[],
    timeoutMs: number,
  ): Promise<{ code: number | null; stdout: string; stderr: string }>;
  /** kill()은 child tree를 끈다(POSIX process group, Windows `taskkill /T`). 띄우지 못하면 onExit(null)이다. */
  spawn(
    file: string,
    args: readonly string[],
    options: { windowsHide: true },
  ): { onExit(listener: (code: number | null) => void): void; kill(): void };
  files: {
    /** 없으면 undefined. */
    read(path: string): Promise<string | undefined>;
    /** 폴더가 없으면 만든다. */
    write(path: string, text: string, mode: number): Promise<void>;
    /** 없어도 오류가 아니다. */
    remove(path: string): Promise<void>;
  };
  /** SHA-256 hex. */
  hash(text: string): string;
  /** 실패한 OS 명령의 이름과 exit code만 남긴다. 경로와 env 값은 싣지 않는다. */
  logger?: Logger;
};

const COMMAND_TIMEOUT_MS = 5000;

export function createAlwaysOnOs(deps: AlwaysOnOsDeps): AlwaysOnOs {
  const log = (command: string, code: number | null) =>
    deps.logger?.warn({
      component: "always-on",
      event: "os_command_failed",
      fields: { command, code },
    });
  const run: OsRun = async (file, args) => {
    try {
      return {
        ...(await deps.exec(file, args, COMMAND_TIMEOUT_MS)),
        started: true,
      };
    } catch {
      return { code: null, stdout: "", stderr: "", started: false };
    }
  };
  return {
    registrar: createRegistrar(deps, run, log),
    keepAwake: createKeepAwake(deps, log),
    captureEnv() {
      const env: ServiceEnv = { PATH: deps.env.PATH ?? "" };
      if (deps.platform === "darwin" && deps.env.TMPDIR !== undefined) {
        env.TMPDIR = deps.env.TMPDIR;
      }
      return env;
    },
  };
}

function createKeepAwake(
  deps: AlwaysOnOsDeps,
  log: (command: string, code: number | null) => void,
): KeepAwake {
  const command = keepAwakeCommand(
    deps.platform,
    deps.corePid,
    systemRoot(deps.env),
  );
  const listeners: ((reason: "no_inhibitor" | "os_failed") => void)[] = [];
  let child: ReturnType<AlwaysOnOsDeps["spawn"]> | undefined;
  return {
    async hold() {
      if (child) return { state: "held" };
      if (!command) return { state: "unavailable", reason: "no_inhibitor" };
      let handle: ReturnType<AlwaysOnOsDeps["spawn"]>;
      try {
        handle = deps.spawn(command.file, command.args, { windowsHide: true });
      } catch {
        log("keep-awake", null);
        return { state: "unavailable", reason: command.lost };
      }
      // fake나 바로 실패한 spawn은 onExit를 여기서 부를 수 있다.
      const early: { exited: boolean; code: number | null } = {
        exited: false,
        code: null,
      };
      let holding = false;
      handle.onExit((code) => {
        if (!holding) {
          early.exited = true;
          early.code = code;
          return;
        }
        // release()가 끈 child는 잃은 것이 아니다.
        if (child !== handle) return;
        child = undefined;
        log("keep-awake", code);
        for (const listener of listeners) listener(command.lost);
      });
      if (early.exited) {
        log("keep-awake", early.code);
        return { state: "unavailable", reason: command.lost };
      }
      holding = true;
      child = handle;
      return { state: "held" };
    },
    release() {
      const held = child;
      child = undefined;
      held?.kill();
    },
    onLost(listener) {
      listeners.push(listener);
    },
  };
}
