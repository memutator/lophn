// shell 자식 process에 넘기는 환경 변수의 허용 목록이다. lophn token과 secret은 이 목록에 없다.
// 이름이 목록에 든 것만 나가므로 `LOPHN_`로 시작하는 이름이나 *_TOKEN, *_KEY 같은 이름은 나갈 수 없다.
export const SHELL_ENV_NAMES = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "SHELL",
] as const;

export function shellEnvironment(
  parentEnv: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of SHELL_ENV_NAMES) {
    const value = parentEnv[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

// runtime process의 `allow_env`가 허락한 이름만 읽는다. 부모 환경 전체를 읽지 않는다.
export function readShellEnvironment(): Record<string, string> {
  const parent: Record<string, string | undefined> = {};
  for (const name of SHELL_ENV_NAMES) parent[name] = Deno.env.get(name);
  return shellEnvironment(parent);
}
