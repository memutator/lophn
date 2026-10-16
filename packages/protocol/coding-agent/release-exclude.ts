// release bundle에서 빼는 개발 도구 경로다. apps의 bundle 준비가 git tree를 읽을 때
// 이 목록과 일치하는 경로를 bundle에 넣지 않는다. harness의 project hook 설정과 skill 사본이
// 앱 실행 코드로 퍼지지 않게 한다. 목록은 HARNESS_ADAPTERS에서 계산한다.
import { CODING_SKILL_NAMES, HARNESS_ADAPTERS } from "./harness-adapter.ts";

type ReleaseExcludePath = string;

const RELEASE_EXCLUDE_PATHS: readonly ReleaseExcludePath[] = [
  ...new Set(
    Object.values(HARNESS_ADAPTERS).flatMap((adapter) => [
      ...(adapter.hook === null ? [] : [adapter.hook.path]),
      ...(adapter.skill_dir === null
        ? []
        : CODING_SKILL_NAMES.map((name) => `${adapter.skill_dir}/${name}`)),
    ]),
  ),
];

// bundle에서 뺄지 묻는다. path는 bundle 안 상대 경로다.
export function releaseExcludes(path: string): boolean {
  return RELEASE_EXCLUDE_PATHS.includes(path);
}
