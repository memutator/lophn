import { spawnSync } from "node:child_process";

const BEGIN = "<<lophn-path-begin>>";
const END = "<<lophn-path-end>>";
const WAIT_MS = 5000;

// Finder·Dock으로 켠 macOS 앱의 PATH는 /usr/bin:/bin:/usr/sbin:/sbin뿐이라 사람의 login shell에서 한 번 읽는다.
// rc file이 출력을 찍을 수 있어 표시 사이의 값만 쓴다. 5초 안에 못 읽으면 버리고 PATH를 그대로 둔다.
export function loginPathOf(
  platform: string,
  env: Readonly<Record<string, string | undefined>>,
  run: typeof spawnSync = spawnSync,
): string | undefined {
  if (platform !== "darwin") return undefined;
  const done = run(
    env.SHELL || "/bin/zsh",
    ["-ilc", `printf '%s' '${BEGIN}'"$PATH"'${END}'`],
    {
      encoding: "utf8",
      timeout: WAIT_MS,
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "ignore"],
      // rc file이 tmux나 updater를 띄우지 않게 막는다.
      env: {
        ...env,
        DISABLE_AUTO_UPDATE: "true",
        ZSH_TMUX_AUTOSTART: "false",
        ZSH_TMUX_AUTOSTARTED: "true",
      },
    },
  );
  if (typeof done.stdout !== "string") return undefined;
  const start = done.stdout.indexOf(BEGIN);
  const end = done.stdout.indexOf(END, start);
  if (start < 0 || end < 0) return undefined;
  return done.stdout.slice(start + BEGIN.length, end) || undefined;
}
