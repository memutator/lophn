import process from "node:process";

// Windows의 child는 이 값들이 없으면 Node의 crypto·network와 shell(cmd)이 동작하지 않는다.
export const WINDOWS_ENV_NAMES = [
  "SystemRoot",
  "ComSpec",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  // agent shell tool이 Git Bash를 찾는 자리다(`tools/shell/run.ts` `findGitBash`). 없으면 runtime child에서 shell tool이 unavailable이다.
  "ProgramFiles",
  "ProgramFiles(x86)",
  "LOPHN_GIT_BASH",
] as const;

// Windows의 env 이름은 대소문자를 가리지 않는다(`Path`·`PATH`). 주입된 평범한 객체에서도 그렇게 읽는다.
export function envValue(
  source: Readonly<Record<string, string | undefined>>,
  name: string,
  platform: string = process.platform,
): string | undefined {
  const exact = source[name];
  if (exact !== undefined || platform !== "win32") return exact;
  const lower = name.toLowerCase();
  const key = Object.keys(source).find(
    (known) => known.toLowerCase() === lower,
  );
  return key === undefined ? undefined : source[key];
}

// child env 목록에 더하는 Windows 전용 값. 다른 OS는 비어 있다.
export function windowsEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
  platform: string = process.platform,
): Record<string, string> {
  const env: Record<string, string> = {};
  if (platform !== "win32") return env;
  for (const name of WINDOWS_ENV_NAMES) {
    const value = envValue(source, name, platform);
    if (value) env[name] = value;
  }
  return env;
}
