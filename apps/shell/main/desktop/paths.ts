// 데이터 root는 platform이 검증한다. shell은 그 root를 받아 자기 자리만 정한다.
import { homedir } from "node:os";
import { join } from "node:path";

const HOME_ENV = "LOPHN_HOME";

export interface DataRootInput {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  home?: string;
}

/**
 * 개발 데이터 root는 `--home <dir>`로 받는다. 없으면 `LOPHN_HOME`, 그것도 없으면
 * `~/.lophn`. root 검증은 platform이 한다.
 */
export function resolveDataRoot(
  input: DataRootInput | NodeJS.ProcessEnv = {},
  home: string = homedir(),
): string {
  const given = isEnv(input) ? { env: input, home } : { home, ...input };
  const argv = given.argv ?? process.argv;
  const flag = argv.indexOf("--home");
  const fromArg = flag >= 0 ? argv[flag + 1] : undefined;
  if (fromArg !== undefined && fromArg !== "" && !fromArg.startsWith("--")) {
    return fromArg;
  }
  const override = (given.env ?? process.env)[HOME_ENV];
  if (override !== undefined && override !== "") return override;
  return join(given.home ?? home, ".lophn");
}

function isEnv(
  input: DataRootInput | NodeJS.ProcessEnv,
): input is NodeJS.ProcessEnv {
  if (input.argv !== undefined || input.home !== undefined) return false;
  // env를 담은 입력은 `env` 키가 있다. 그 외 문자열 값은 프로세스 환경이다.
  return input.env === undefined || typeof input.env === "string";
}

/** Chromium session 저장 자리. session을 만들기 전에 userData로 잡아야 한다. */
export function browserDataPath(dataRoot: string): string {
  return join(dataRoot, "shell", "browser");
}
