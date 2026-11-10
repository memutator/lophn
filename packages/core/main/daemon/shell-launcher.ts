import { join } from "node:path";
import {
  AGENT_WINDOW_INTENT,
  LAUNCH_SHELL_ENV,
} from "../../../protocol/lophn-agent/host-queue.ts";

// core가 shell(Electron 앱)을 띄우는 길이다. browser가 필요한데 shell이 없을 때 host-queue wiring이 부른다.
// core는 shell의 child가 아니다: detached로 띄우고 놓아 core가 끝나도 앱은 남는다.
// 시작이 실패하면(spawn이 던지거나 `error` event) `onError`로 알린다. 띄운 뒤의 일은 stdio를 놓아 알 길이 없고, shell이 붙는지로 판단한다.
type Child = {
  on(event: "error", listener: (error: unknown) => void): unknown;
  unref(): void;
};

export type ShellLauncher = (
  dataRoot: string,
  onError: (error: unknown) => void,
) => void;

// 사람이 쓰는 core를 띄운 쪽(shell main, CLI)이 env로 켠 core만 만든다. 시험과 boot가 띄운 core는 앱을 띄우지 않는다.
export function createShellLauncher(input: {
  // core entry의 기준(설치 묶음의 platform/, 개발은 저장소 root).
  platformRoot: string;
  // core를 띄운 Electron binary. 설치본에서는 앱 실행 file 자체다.
  execPath: string;
  env: NodeJS.ProcessEnv;
  exists(path: string): boolean;
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
  const shellFolder = join(input.platformRoot, "packages", "shell");
  const entry = join(shellFolder, "main", "dist", "main.cjs");
  // 설치 묶음의 platform/에는 packages/shell이 없다(shell은 Electron 앱 쪽이다). 그때는 execPath만으로 앱이 뜬다.
  // 개발 저장소는 build한 main.cjs를 앱으로 넘겨야 하고, build하지 않았으면 띄울 길이 없다.
  const dev = input.exists(shellFolder);
  if (dev && !input.exists(entry)) return undefined;
  return (dataRoot, onError) => {
    // core가 Node로 도는 표시를 물려주면 앱이 아니라 Node로 뜬다.
    const { ELECTRON_RUN_AS_NODE: _, ...env } = input.env;
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
