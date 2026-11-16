import { join } from "node:path";
import {
  AGENT_WINDOW_INTENT,
  LAUNCH_SHELL_ENV,
} from "../../../protocol/lophn-agent/host-queue.ts";
import { installedLayout, shellFolder } from "./entry-layout.ts";

// core가 shell(Electron 앱)을 띄우는 길이다. browser가 필요한데 shell이 없을 때 host-queue wiring이 부른다.
// core는 shell의 child가 아니다: detached로 띄우고 놓아 core가 끝나도 앱은 남는다.
// 시작이 실패하면(spawn이 던지거나 `error` event) `onError`로 알린다. 띄운 뒤의 일은 stdio를 놓아 알 길이 없고, shell이 붙는지로 판단한다.
type Child = {
  on(event: "error", listener: (error: unknown) => void): unknown;
  unref(): void;
};

// 띄우는 일 자체는 기다리지 않는다. 반환 Promise는 화면 env를 가져오는 동안만 걸리고 reject하지 않는다.
export type ShellLauncher = (
  dataRoot: string,
  onError: (error: unknown) => void,
) => Promise<void>;

// OS service(systemd user unit)가 띄운 core는 화면 세션의 env를 물려받지 못한다. 화면 세션이 user manager에 올린 값 중 앱에 필요한 것만 가져온다.
const SESSION_ENV_NAMES = [
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "XDG_SESSION_TYPE",
  "XDG_CURRENT_DESKTOP",
  "DBUS_SESSION_BUS_ADDRESS",
];
const SHOW_ENVIRONMENT_TIMEOUT_MS = 2000;

// 사람이 쓰는 core를 띄운 쪽(shell main, CLI)이 env로 켠 core만 만든다. 시험과 boot가 띄운 core는 앱을 띄우지 않는다.
export function createShellLauncher(input: {
  // core entry의 기준(설치 묶음의 platform/, 개발은 저장소 root).
  platformRoot: string;
  // core를 띄운 Electron binary. 설치본에서는 앱 실행 file 자체다.
  execPath: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists(path: string): boolean;
  // shell 없이 띄우고 기한을 넘기면 code null이다. 띄우지 못하면 reject한다.
  exec(
    file: string,
    args: readonly string[],
    timeoutMs: number,
  ): Promise<{ code: number | null; stdout: string }>;
  spawn(
    command: string,
    args: string[],
    options: {
      env: NodeJS.ProcessEnv;
      detached: true;
      stdio: "ignore";
    },
  ): Child;
}): ShellLauncher | undefined {
  if (input.env[LAUNCH_SHELL_ENV] !== "1") return undefined;
  const entry = join(
    shellFolder(input.platformRoot),
    "main",
    "dist",
    "main.cjs",
  );
  // 설치 layout에서는 execPath만으로 앱이 뜬다.
  // 개발 저장소는 build한 main.cjs를 앱으로 넘겨야 하고, build하지 않았으면 띄울 길이 없다.
  const dev = !installedLayout(input.platformRoot, input.exists);
  if (dev && !input.exists(entry)) return undefined;
  const needsSessionEnv =
    input.platform === "linux" &&
    input.env.LOPHN_SERVICE === "1" &&
    !input.env.DISPLAY &&
    !input.env.WAYLAND_DISPLAY;
  return async (dataRoot, onError) => {
    // core가 Node로 도는 표시를 물려주면 앱이 아니라 Node로 뜬다.
    const { ELECTRON_RUN_AS_NODE: _, ...base } = input.env;
    // 가져오지 못하면(user manager 없음, 기한) 지금처럼 띄운다. 화면이 없으면 browser 탭이 실패하는 지금 길로 간다.
    const env = needsSessionEnv
      ? { ...base, ...(await sessionEnv(input.exec)) }
      : base;
    const args = [
      // 개발 launcher(tools/dev.ts)와 같이 sandbox를 못 쓰는 Linux 개발 환경은 이 env로 끈다.
      ...(dev && env.ELECTRON_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
      ...(dev ? [entry] : []),
      "--home",
      dataRoot,
      AGENT_WINDOW_INTENT,
    ];
    try {
      // windowsHide를 주지 않는다: 시작 정보의 SW_HIDE가 앱의 첫 창에 걸려 창이 안 보일 수 있다.
      const child = input.spawn(input.execPath, args, {
        env: { ...env, LOPHN_HOME: dataRoot },
        detached: true,
        stdio: "ignore",
      });
      child.on("error", onError);
      child.unref();
    } catch (thrown) {
      onError(thrown);
    }
  };
}

async function sessionEnv(
  exec: Parameters<typeof createShellLauncher>[0]["exec"],
) {
  const found: Record<string, string> = {};
  try {
    const shown = await exec(
      "systemctl",
      ["--user", "show-environment"],
      SHOW_ENVIRONMENT_TIMEOUT_MS,
    );
    if (shown.code !== 0) return found;
    for (const line of shown.stdout.split("\n")) {
      const at = line.indexOf("=");
      const name = line.slice(0, at);
      if (at > 0 && SESSION_ENV_NAMES.includes(name)) {
        found[name] = line.slice(at + 1);
      }
    }
  } catch {
    // user manager가 없으면 가져올 것이 없다.
  }
  return found;
}
