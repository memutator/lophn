// 데이터 root는 platform이 검증한다. shell은 그 root를 받아 자기 자리만 정한다.
import { homedir } from "node:os";
import { join } from "node:path";

const HOME_ENV = "LOPHN_HOME";

/** Linux 기본은 `~/.lophn`. 다른 OS의 root 규칙은 platform 소유라 여기 두지 않는다. */
export function resolveDataRoot(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const override = env[HOME_ENV];
  if (override !== undefined && override !== "") return override;
  return join(home, ".lophn");
}

/** Chromium session 저장 자리. session을 만들기 전에 userData로 잡아야 한다. */
export function browserDataPath(dataRoot: string): string {
  return join(dataRoot, "shell", "browser");
}
