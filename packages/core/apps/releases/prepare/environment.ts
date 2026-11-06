// release 준비 자식이 쓰는 최소 환경이다. 자식은 앱 source와 대화하므로 부모의 나머지 환경
// (credential·사람의 설정)은 넘기지 않는다. npm이 cache·실행 file·임시 file을 찾는 HOME·PATH·TMPDIR과
// npm 설정(`npm_config_*`, 예: e2e가 정하는 cache 위치와 offline)만 준다.
import process from "node:process";
import { windowsEnvironment } from "../../../supervision/security/child-env.ts";

export function childEnvironment(tmp: string): Record<string, string> {
  const env: Record<string, string> = {
    ...npmConfigEnvironment(),
    ...windowsEnvironment(),
    TMPDIR: tmp,
  };
  for (const name of ["HOME", "PATH"]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

export function npmConfigEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith("npm_config_") && value !== undefined)
      env[name] = value;
  }
  return env;
}
