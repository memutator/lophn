// 운영 앱 자식의 기동 모양. Deno flag는 apps/permissions가 계산한 그대로 쓴다.
// token·secret은 argv와 환경에 넣지 않고 시작 JSON 한 줄을 stdin으로만 보낸다.
// 실제 OS spawn은 core/main/app-supervisor entry가 조립한다. 이 모듈은 그 입력을 만든다.
import type { FlagSet } from "../../permissions/mod.ts";

export type AppEnvironment = {
  home?: string;
  denoDir?: string;
  xdgCacheHome?: string;
  path?: string;
};

export type AppLaunch = {
  deno: string;
  entry: string;
  flags: FlagSet;
  importMap: string;
  environment: AppEnvironment;
  startLine: string;
};

const FORBIDDEN = [
  "--allow-all",
  "-A",
  "--allow-run",
  "--allow-ffi",
  "--allow-sys",
  "--allow-env",
];

function flagName(flag: string): string {
  return flag.split("=")[0];
}

// 계산된 flag 안에 금지 flag가 있으면 띄우지 않는다. 목록을 다시 계산하지 않는다.
export function flagsAccepted(flags: FlagSet): boolean {
  return flags.args.every((flag) => !FORBIDDEN.includes(flagName(flag)));
}

// 자식 환경. 없는 값은 빈 문자열로 넘기지 않는다. parent의 API token은 여기 없다.
export function appEnv(environment: AppEnvironment): Record<string, string> {
  const env: Record<string, string> = {};
  if (environment.home) env.HOME = environment.home;
  if (environment.denoDir) env.DENO_DIR = environment.denoDir;
  if (environment.xdgCacheHome) env.XDG_CACHE_HOME = environment.xdgCacheHome;
  if (environment.path) env.PATH = environment.path;
  return env;
}

export function appArgv(launch: AppLaunch): string[] {
  return [
    "run",
    ...launch.flags.args,
    `--import-map=${launch.importMap}`,
    launch.entry,
  ];
}
