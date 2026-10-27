import process from "node:process";
import {
  nodeShimFolder,
  withNodeShims,
} from "../../../supervision/security/node-shims.ts";

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

// PATH 맨 앞에 node·npm shim 폴더를 붙인다. 앱을 짓는 agent가 shell에서 부르는 node·npm이 사용자 PATH의
// 것(없거나 Temporal이 없는 plain node)이 아니라 lophn을 도는 Electron의 Node가 되게 한다.
export function shellEnvironment(
  parentEnv: Readonly<Record<string, string | undefined>>,
  shimFolder: string | undefined,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of SHELL_ENV_NAMES) {
    const value = parentEnv[name];
    if (value !== undefined) env[name] = value;
  }
  if (shimFolder !== undefined) env.PATH = withNodeShims(shimFolder, env.PATH);
  return env;
}

// LOPHN_HOME은 agent runtime child에 늘 있다. 없으면(단위 test) PATH를 그대로 둔다.
export function readShellEnvironment(): Record<string, string> {
  const parent: Record<string, string | undefined> = {};
  for (const name of SHELL_ENV_NAMES) parent[name] = process.env[name];
  const dataRoot = process.env["LOPHN_HOME"];
  return shellEnvironment(
    parent,
    dataRoot === undefined || dataRoot === ""
      ? undefined
      : nodeShimFolder(dataRoot),
  );
}
