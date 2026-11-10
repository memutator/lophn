import process from "node:process";
import { AGENT_SHELL_ENV } from "../../../../protocol/lophn-agent/tool-lists.ts";
import {
  envValue,
  WINDOWS_ENV_NAMES,
} from "../../../supervision/security/child-env.ts";
import {
  nodeShimFolder,
  withNodeShims,
} from "../../../supervision/security/node-shims.ts";

// shell 자식 process에 넘기는 환경 변수의 허용 목록이다. lophn token과 secret은 이 목록에 없다.
// 이름이 목록에 든 것만 나가므로 `LOPHN_`로 시작하는 이름이나 *_TOKEN, *_KEY 같은 이름은 나갈 수 없다.
// 하나만 일부러 연 예외가 `LOPHN_SESSION_ID`다: 이 명령을 돌리는 session의 id다(아래 `shellEnvironment`의 session). 부모 env에서 물려주지 않고
// 부르는 쪽이 준 값만 싣는다. 앱이 process 목록에서 session의 process를 찾는 표지이고(session lifecycle) secret이 아니다.
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

// PATH 맨 앞에 node·npm shim 폴더를 붙인다. 앱을 짓는 agent가 shell에서 부르는 node·npm이 사용자 PATH의
// 것(없거나 Temporal이 없는 plain node)이 아니라 lophn을 도는 Electron의 Node가 되게 한다.
export function shellEnvironment(
  parentEnv: Readonly<Record<string, string | undefined>>,
  shimFolder: string | undefined,
  platform: string = process.platform,
  session?: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  // Windows의 Git Bash와 cmd는 SystemRoot 같은 시스템 값 없이는 기본 명령도 못 돈다.
  const names =
    platform === "win32"
      ? [...SHELL_ENV_NAMES, ...WINDOWS_ENV_NAMES]
      : SHELL_ENV_NAMES;
  for (const name of names) {
    const value = envValue(parentEnv, name, platform);
    if (value !== undefined) env[name] = value;
  }
  if (shimFolder !== undefined) env.PATH = withNodeShims(shimFolder, env.PATH);
  if (session !== undefined) env.LOPHN_SESSION_ID = session;
  env[AGENT_SHELL_ENV] = "1";
  return env;
}

// LOPHN_HOME은 agent runtime child에 늘 있다. 없으면(단위 test) PATH를 그대로 둔다.
export function readShellEnvironment(
  parent: Readonly<Record<string, string | undefined>> = process.env,
  platform: string = process.platform,
  session?: string,
): Record<string, string> {
  const dataRoot = parent["LOPHN_HOME"];
  return shellEnvironment(
    parent,
    dataRoot === undefined || dataRoot === ""
      ? undefined
      : nodeShimFolder(dataRoot),
    platform,
    session,
  );
}
