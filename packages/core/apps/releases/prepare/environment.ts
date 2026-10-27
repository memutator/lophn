// release 준비 자식이 쓰는 최소 환경이다. 자식은 앱 source와 대화하므로 부모의 나머지 환경
// (credential·사람의 설정)은 넘기지 않는다. npm이 cache·실행 file·임시 file을 찾는 HOME·PATH·TMPDIR만 준다.
import process from "node:process";

export function childEnvironment(tmp: string): Record<string, string> {
  const env: Record<string, string> = { TMPDIR: tmp };
  for (const name of ["HOME", "PATH"]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}
