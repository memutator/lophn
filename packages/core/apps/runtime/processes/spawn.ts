// 운영 앱 자식의 기동 모양. 앱은 lophn과 같은 Electron의 Node로 뜨고 권한 flag가 없다.
// token·secret은 argv와 환경에 넣지 않고 시작 JSON 한 줄을 stdin으로만 보낸다.
// 실제 OS spawn은 core/main/app-supervisor entry가 조립한다. 이 모듈은 그 입력을 만든다.
import { dirname } from "node:path";
import { nodeCommand } from "../../../supervision/security/node-command.ts";

export type AppEnvironment = {
  home?: string;
  xdgCacheHome?: string;
  path?: string;
  // Windows에서만 채운다(SystemRoot 같은 시스템 값). 없으면 Node가 crypto·network를 못 쓴다.
  windows?: Record<string, string>;
};

export type AppLaunch = {
  entry: string;
  environment: AppEnvironment;
  startLine: string;
};

export type AppCommand = {
  command: string;
  args: string[];
  env: Record<string, string>;
  // 사본 root. 앱의 상대 경로 import와 DB가 그 폴더 기준이다.
  cwd: string;
};

// 자식 환경. 없는 값은 빈 문자열로 넘기지 않는다. parent의 API token은 여기 없다.
export function appEnv(environment: AppEnvironment): Record<string, string> {
  const env: Record<string, string> = {};
  if (environment.home) env.HOME = environment.home;
  if (environment.xdgCacheHome) env.XDG_CACHE_HOME = environment.xdgCacheHome;
  if (environment.path) env.PATH = environment.path;
  Object.assign(env, environment.windows);
  return env;
}

export function appCommand(launch: AppLaunch): AppCommand {
  const node = nodeCommand(launch.entry);
  return {
    command: node.command,
    args: node.args,
    // ELECTRON_RUN_AS_NODE가 없으면 Electron binary가 앱으로 뜬다.
    env: { ...node.env, ...appEnv(launch.environment) },
    cwd: dirname(launch.entry),
  };
}
