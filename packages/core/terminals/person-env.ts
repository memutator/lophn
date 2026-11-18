// 사람의 환경: login shell의 env와 `lophn` launcher 경로. core가 OS 서비스나 다른 process에서 떠도(env가 짧다) 터미널과
// extension이 띄우는 CLI가 사람의 PATH와 rc file의 값을 받는다.
import { dirname, isAbsolute, join } from "node:path";
import { LINUX_LAUNCHERS } from "../../base/install/linux-install.ts";
import { MAC_CLI_LAUNCHER } from "../../base/install/mac-install.ts";
import { WIN_CLI_LAUNCHER } from "../../base/install/win-install.ts";
import type { PersonEnv } from "./ports.ts";

const BEGIN = "<<lophn-env-begin>>";
const END = "<<lophn-env-end>>";
const WAIT_MS = 5000;
// login shell을 한 번 띄운 값이라 그 process의 것이다. 물려주면 틀리다.
const LOGIN_ONLY = new Set(["PWD", "OLDPWD", "SHLVL", "_"]);
// rc file이 tmux나 updater를 띄우지 않게 읽을 때만 넣는다(Emdash). 터미널에 남으면 사람의 shell이 tmux를 띄우지 않는다.
const READ_ONLY_ENV: Readonly<Record<string, string>> = {
  DISABLE_AUTO_UPDATE: "true",
  ZSH_TMUX_AUTOSTART: "false",
  ZSH_TMUX_AUTOSTARTED: "true",
};

// login shell 한 번. 끝나면 stdout 전체를, 5초 안에 못 끝내면(끄고) null을 준다.
export type RunLoginShell = (
  shell: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  timeoutMs: number,
) => Promise<string | null>;

// macOS 12 이하의 BSD `env`에는 -0이 없어 darwin은 줄바꿈으로 나뉜 출력을 읽는다. `NAME=`로 시작하지 않는 줄은 앞 값의 이어진 줄이다.
function splitEnv(text: string, nul: boolean): string[] {
  if (nul) return text.split("\0");
  const entries: string[] = [];
  for (const line of text.replace(/\n$/, "").split("\n")) {
    if (entries.length > 0 && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) {
      entries[entries.length - 1] += `\n${line}`;
    } else {
      entries.push(line);
    }
  }
  return entries;
}

// 표시 사이의 `NAME=value`만 읽는다(rc file이 다른 글을 찍을 수 있다). 표시가 없으면 undefined다.
function parseLoginEnv(
  out: string,
  platform: string,
): Record<string, string> | undefined {
  const start = out.indexOf(BEGIN);
  const end = out.indexOf(END, start);
  if (start < 0 || end < 0) return undefined;
  const env: Record<string, string> = {};
  for (const entry of splitEnv(
    out.slice(start + BEGIN.length, end),
    platform !== "darwin",
  )) {
    const eq = entry.indexOf("=");
    if (eq <= 0) continue;
    const name = entry.slice(0, eq);
    if (!LOGIN_ONLY.has(name)) env[name] = entry.slice(eq + 1);
  }
  return Object.keys(env).length === 0 ? undefined : env;
}

export function createPersonEnv(deps: {
  platform: NodeJS.Platform;
  // core process의 env. login shell을 이것으로 띄우고, 못 읽으면 이것을 쓴다.
  env: Readonly<Record<string, string | undefined>>;
  run: RunLoginShell;
  cli: string | null;
}): PersonEnv {
  const base: Record<string, string> = {};
  for (const [name, value] of Object.entries(deps.env)) {
    if (value !== undefined) base[name] = value;
  }
  // 읽은 값만 지닌다. 못 읽으면 다음에 env가 필요할 때 다시 읽는다. 읽는 중이면 그 하나를 같이 기다린다.
  let login: Record<string, string> | undefined;
  let reading: Promise<Record<string, string> | undefined> | undefined;

  async function read(): Promise<Record<string, string> | undefined> {
    const out = await deps.run(
      base.SHELL || "/bin/sh",
      [
        "-ilc",
        `printf '%s' '${BEGIN}'; env${deps.platform === "darwin" ? "" : " -0"}; printf '%s' '${END}'`,
      ],
      { ...base, ...READ_ONLY_ENV },
      WAIT_MS,
    );
    const env = out === null ? undefined : parseLoginEnv(out, deps.platform);
    if (env === undefined) return undefined;
    for (const name of Object.keys(READ_ONLY_ENV)) {
      if (base[name] === undefined) delete env[name];
      else env[name] = base[name];
    }
    return env;
  }

  return {
    cli: deps.cli,
    async env() {
      // Windows는 login shell이 없다.
      if (deps.platform === "win32") return { ...base };
      if (login !== undefined) return { ...login };
      reading ??= read().finally(() => {
        reading = undefined;
      });
      login = await reading;
      return { ...(login ?? base) };
    },
  };
}

// `lophn` launcher 하나를 고르는 규칙. 설치본은 설치한 launcher(Linux `/usr/bin/lophn`, macOS `Resources/bin/lophn`, Windows
// `bin\lophn.cmd`)이고, 개발 실행은 `LOPHN_CLI`(절대 경로일 때만)다. platformRoot는 설치본의 `platform/` 폴더다.
export function lophnCliPath(input: {
  installed: boolean;
  platformRoot: string;
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
}): string | null {
  if (!input.installed) {
    const given = input.env.LOPHN_CLI;
    return given !== undefined && isAbsolute(given) ? given : null;
  }
  if (input.platform === "linux") return LINUX_LAUNCHERS.cli;
  const root = dirname(input.platformRoot);
  if (input.platform === "darwin") return join(root, MAC_CLI_LAUNCHER);
  if (input.platform === "win32") return join(root, WIN_CLI_LAUNCHER);
  return null;
}
